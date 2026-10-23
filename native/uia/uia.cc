// Textline native layer: the only code that talks to Windows.
//
// Exposes three functions to Node:
//   start(callback)   - listens for window events, calls callback("foreground" | "change")
//   stop()
//   getForeground()   - { hwnd, pid, title, exe } of the window in focus
//   snapshot(hwnd)    - Promise<{ nodes: [{ depth, type, name, value, heading, offscreen }] }>
//
// Text comes only from the UI Automation accessibility tree. No pixels are read.

#include <napi.h>
#include <windows.h>
#include <UIAutomation.h>
#include <thread>
#include <string>
#include <vector>

// ---------- helpers ----------

static std::string ToUtf8(const wchar_t* w, int len = -1) {
  if (!w) return "";
  int size = WideCharToMultiByte(CP_UTF8, 0, w, len, nullptr, 0, nullptr, nullptr);
  if (size <= 0) return "";
  std::string out(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, len, &out[0], size, nullptr, nullptr);
  if (len == -1) out.pop_back();  // drop the null terminator
  return out;
}

static std::string BstrToUtf8(BSTR b) {
  return b ? ToUtf8(b, SysStringLen(b)) : "";
}

static std::string ExePathOf(DWORD pid) {
  HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!p) return "";
  wchar_t path[MAX_PATH];
  DWORD size = MAX_PATH;
  std::string out;
  if (QueryFullProcessImageNameW(p, 0, path, &size)) out = ToUtf8(path, size);
  CloseHandle(p);
  return out;
}

// ---------- window events ----------

static Napi::ThreadSafeFunction g_callback;
static std::thread g_hookThread;
static DWORD g_hookThreadId = 0;
static ULONGLONG g_lastChange = 0;

static void CALLBACK OnWinEvent(HWINEVENTHOOK, DWORD event, HWND hwnd, LONG, LONG,
                                DWORD, DWORD) {
  const char* type;
  if (event == EVENT_SYSTEM_FOREGROUND) {
    type = "foreground";
  } else {
    // Only care about changes inside the window the user is looking at.
    if (event == EVENT_OBJECT_LOCATIONCHANGE) return;  // caret/mouse noise
    if (!hwnd || GetAncestor(hwnd, GA_ROOT) != GetForegroundWindow()) return;
    // Throttle: apps fire hundreds of these per second. JS also polls as a backstop.
    ULONGLONG now = GetTickCount64();
    if (now - g_lastChange < 250) return;
    g_lastChange = now;
    type = "change";
  }
  g_callback.NonBlockingCall([type](Napi::Env env, Napi::Function cb) {
    cb.Call({Napi::String::New(env, type)});
  });
}

static void HookLoop() {
  g_hookThreadId = GetCurrentThreadId();
  const DWORD flags = WINEVENT_OUTOFCONTEXT;
  HWINEVENTHOOK hooks[] = {
      SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, OnWinEvent, 0, 0, flags),
      SetWinEventHook(EVENT_SYSTEM_SCROLLINGEND, EVENT_SYSTEM_SCROLLINGEND, nullptr, OnWinEvent, 0, 0,
                      flags | WINEVENT_SKIPOWNPROCESS),
      // SHOW..VALUECHANGE covers new elements, name changes (tab titles), value changes.
      SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_VALUECHANGE, nullptr, OnWinEvent, 0, 0,
                      flags | WINEVENT_SKIPOWNPROCESS),
      SetWinEventHook(EVENT_OBJECT_CONTENTSCROLLED, EVENT_OBJECT_CONTENTSCROLLED, nullptr, OnWinEvent, 0, 0,
                      flags | WINEVENT_SKIPOWNPROCESS),
  };
  MSG msg;
  while (GetMessage(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }
  for (HWINEVENTHOOK h : hooks)
    if (h) UnhookWinEvent(h);
}

static Napi::Value Start(const Napi::CallbackInfo& info) {
  if (g_hookThreadId) return info.Env().Undefined();
  g_callback = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "uia-events", 0, 1);
  g_hookThread = std::thread(HookLoop);
  return info.Env().Undefined();
}

static Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (!g_hookThreadId) return info.Env().Undefined();
  PostThreadMessage(g_hookThreadId, WM_QUIT, 0, 0);
  g_hookThread.join();
  g_hookThreadId = 0;
  g_callback.Release();
  return info.Env().Undefined();
}

// ---------- foreground window ----------

// Store apps run inside ApplicationFrameHost.exe; the real app is a child window
// owned by a different process. Find it so the timeline shows the real app name.
struct ChildSearch { DWORD hostPid; DWORD pid; };
static BOOL CALLBACK FindRealApp(HWND child, LPARAM param) {
  auto* s = reinterpret_cast<ChildSearch*>(param);
  DWORD pid = 0;
  GetWindowThreadProcessId(child, &pid);
  if (pid && pid != s->hostPid) { s->pid = pid; return FALSE; }
  return TRUE;
}

static Napi::Value GetForeground(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND hwnd = GetForegroundWindow();
  if (!hwnd) return env.Null();

  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  std::string exe = ExePathOf(pid);
  if (exe.find("ApplicationFrameHost.exe") != std::string::npos) {
    ChildSearch s{pid, 0};
    EnumChildWindows(hwnd, FindRealApp, reinterpret_cast<LPARAM>(&s));
    if (s.pid) { pid = s.pid; exe = ExePathOf(pid); }
  }

  wchar_t title[512];
  int len = GetWindowTextW(hwnd, title, 512);

  Napi::Object out = Napi::Object::New(env);
  out.Set("hwnd", Napi::Number::New(env, (double)(uintptr_t)hwnd));
  out.Set("pid", Napi::Number::New(env, pid));
  out.Set("title", Napi::String::New(env, ToUtf8(title, len)));
  out.Set("exe", Napi::String::New(env, exe));
  return out;
}

// ---------- accessibility snapshot ----------

struct Node {
  int depth;
  int type;          // UIA control type id, mapped to a name in JS
  std::string name;
  std::string value;
  int heading;       // 0 = not a heading, 1..9 = heading level
  bool offscreen;
};

static const size_t kMaxNodes = 8000;

static void Walk(IUIAutomationElement* el, int depth, std::vector<Node>& out) {
  if (!el || out.size() >= kMaxNodes) return;

  Node n{depth, 0, "", "", 0, false};
  CONTROLTYPEID type = 0;
  el->get_CachedControlType(&type);
  n.type = type;

  BSTR name = nullptr;
  if (SUCCEEDED(el->get_CachedName(&name))) { n.name = BstrToUtf8(name); SysFreeString(name); }

  BOOL isPassword = FALSE;
  el->get_CachedIsPassword(&isPassword);
  VARIANT v;
  VariantInit(&v);
  if (!isPassword && SUCCEEDED(el->GetCachedPropertyValue(UIA_ValueValuePropertyId, &v)) &&
      v.vt == VT_BSTR) {
    n.value = BstrToUtf8(v.bstrVal);
  }
  VariantClear(&v);

  VariantInit(&v);
  if (SUCCEEDED(el->GetCachedPropertyValue(UIA_HeadingLevelPropertyId, &v)) && v.vt == VT_I4 &&
      v.lVal > HeadingLevel_None && v.lVal <= HeadingLevel9) {
    n.heading = v.lVal - HeadingLevel_None;
  }
  VariantClear(&v);

  BOOL offscreen = FALSE;
  el->get_CachedIsOffscreen(&offscreen);
  n.offscreen = offscreen != FALSE;

  IUIAutomationElementArray* children = nullptr;
  int count = 0;
  if (SUCCEEDED(el->GetCachedChildren(&children)) && children) children->get_Length(&count);

  // Text editors (Notepad, Word, terminals) keep their content behind TextPattern,
  // not Value. Read it only for leaf documents/edits; containers like web pages
  // already expose their text as child elements.
  if (!isPassword && count == 0 && (type == UIA_DocumentControlTypeId || type == UIA_EditControlTypeId)) {
    IUIAutomationTextPattern* tp = nullptr;
    if (SUCCEEDED(el->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&tp))) && tp) {
      IUIAutomationTextRange* range = nullptr;
      if (SUCCEEDED(tp->get_DocumentRange(&range)) && range) {
        BSTR text = nullptr;
        if (SUCCEEDED(range->GetText(50000, &text)) && text) {
          std::string body = BstrToUtf8(text);
          if (!body.empty()) n.value = body;
          SysFreeString(text);
        }
        range->Release();
      }
      tp->Release();
    }
  }
  out.push_back(n);

  if (children) {
    for (int i = 0; i < count; i++) {
      IUIAutomationElement* child = nullptr;
      if (SUCCEEDED(children->GetElement(i, &child)) && child) {
        Walk(child, depth + 1, out);
        child->Release();
      }
    }
    children->Release();
  }
}

// Runs on a worker thread so a slow app never freezes Textline.
class SnapshotWorker : public Napi::AsyncWorker {
 public:
  SnapshotWorker(Napi::Env env, HWND hwnd)
      : Napi::AsyncWorker(env), hwnd_(hwnd), deferred_(Napi::Promise::Deferred::New(env)) {}
  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    IUIAutomation* uia = nullptr;
    IUIAutomationCacheRequest* cache = nullptr;
    IUIAutomationCondition* controlView = nullptr;
    IUIAutomationElement* root = nullptr;

    if (FAILED(CoCreateInstance(CLSID_CUIAutomation8, nullptr, CLSCTX_INPROC_SERVER,
                                IID_IUIAutomation, (void**)&uia)) &&
        FAILED(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
                                IID_IUIAutomation, (void**)&uia))) {
      SetError("Could not create UI Automation");
      CoUninitialize();
      return;
    }

    // Give up on apps that stop responding instead of hanging forever.
    IUIAutomation2* uia2 = nullptr;
    if (SUCCEEDED(uia->QueryInterface(IID_IUIAutomation2, (void**)&uia2))) {
      uia2->put_ConnectionTimeout(2000);
      uia2->put_TransactionTimeout(4000);
      uia2->Release();
    }

    // Fetch the whole tree with its properties in ONE cross-process call,
    // instead of one call per element.
    uia->CreateCacheRequest(&cache);
    cache->AddProperty(UIA_ControlTypePropertyId);
    cache->AddProperty(UIA_NamePropertyId);
    cache->AddProperty(UIA_ValueValuePropertyId);
    cache->AddProperty(UIA_IsPasswordPropertyId);
    cache->AddProperty(UIA_IsOffscreenPropertyId);
    cache->AddProperty(UIA_HeadingLevelPropertyId);
    cache->put_TreeScope(TreeScope_Subtree);
    // Control view hides layout noise, but Chromium also marks plain text runs
    // (e.g. a chat message body) as non-control. So: control view OR any Text element.
    IUIAutomationCondition* isText = nullptr;
    VARIANT textType;
    textType.vt = VT_I4;
    textType.lVal = UIA_TextControlTypeId;
    uia->get_ControlViewCondition(&controlView);
    uia->CreatePropertyCondition(UIA_ControlTypePropertyId, textType, &isText);
    IUIAutomationCondition* filter = nullptr;
    uia->CreateOrCondition(controlView, isText, &filter);
    cache->put_TreeFilter(filter);
    isText->Release();
    filter->Release();

    HRESULT hr = uia->ElementFromHandleBuildCache(hwnd_, cache, &root);
    if (SUCCEEDED(hr) && root) {
      Walk(root, 0, nodes_);
    } else {
      SetError("Window has no accessibility tree");
    }

    if (root) root->Release();
    if (controlView) controlView->Release();
    if (cache) cache->Release();
    uia->Release();
    CoUninitialize();
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array arr = Napi::Array::New(env, nodes_.size());
    for (size_t i = 0; i < nodes_.size(); i++) {
      const Node& n = nodes_[i];
      Napi::Object o = Napi::Object::New(env);
      o.Set("depth", n.depth);
      o.Set("type", n.type);
      o.Set("name", n.name);
      o.Set("value", n.value);
      o.Set("heading", n.heading);
      o.Set("offscreen", n.offscreen);
      arr.Set(i, o);
    }
    Napi::Object result = Napi::Object::New(env);
    result.Set("nodes", arr);
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  HWND hwnd_;
  std::vector<Node> nodes_;
  Napi::Promise::Deferred deferred_;
};

static Napi::Value Snapshot(const Napi::CallbackInfo& info) {
  HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
  auto* worker = new SnapshotWorker(info.Env(), hwnd);
  worker->Queue();
  return worker->Promise();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("getForeground", Napi::Function::New(env, GetForeground));
  exports.Set("snapshot", Napi::Function::New(env, Snapshot));
  return exports;
}

NODE_API_MODULE(uia, Init)
