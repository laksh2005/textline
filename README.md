# Textline

Your Windows screen history, read as text.

Textline runs in the system tray and records which app and window you are in, plus the text on
screen. It reads that text from the Windows accessibility tree (UI Automation), the same way a
screen reader does. It takes **no screenshots, no screen recording and no OCR**, and nothing leaves
the device.

> "I was on WhatsApp 10 minutes ago. What was on my screen?" Open **Timeline**, click that moment,
> and read the chat as text.

**Stack:** Electron 44 + React 19 (JavaScript, electron-vite), a C++ Node addon calling Windows UI
Automation, SQLite via Electron's built-in `node:sqlite`, and electron-builder for the installer.

## How the brief is met

| Requirement | How | Where |
|---|---|---|
| **Now** view: app in focus + its text, live | Main pushes every switch and every new capture to the UI over IPC. While you look at Textline itself, it keeps showing the last app. | `NowView.jsx`, `capture.js` |
| **Timeline**: app, window, time, duration; click any point | A bar of sessions over 15m/1h/4h/24h. Clicking a point finds the session in focus then and its latest capture. You can step through earlier and later captures, or search all captured text. | `TimelineView.jsx`, `db.getScreenAt`, `db.search` |
| Track foreground app + window, timestamp every switch | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`. Each new window, or new title (e.g. a browser tab), starts a session with a start and end time. Unread counts like "(3) WhatsApp" are ignored. | `uia.cc`, `capture.js` |
| Read text from the accessibility tree, with structure | UI Automation tree → lines with roles: headings, list items, links, inputs, sender labels ("Name:"), and the region they sit in (main content vs. navigation). The browser URL comes from the web document. | `uia.cc`, `format.js` |
| Re-capture on change, skip duplicates | Name, value, scroll and structure events (debounced) plus a 3 s poll. A SHA-256 of URL + content is compared with the last capture. | `uia.cc`, `capture.js` |
| Runs in the background from the tray | Closing the window hides it. The tray has open, pause/resume, start at login and quit. | `tray.js`, `index.js` |
| Stored locally | SQLite file at `%APPDATA%\Textline\textline.db`, with a daily backup in `backups/` (last 7 kept) | `db.js` |
| Electron + React only | UI is React in Electron. Windows access is a native Node addon loaded in Electron's main process, with no helper process or other runtime. | `native/uia` |
| No screenshots, recording or OCR | Text comes only from UI Automation properties (Name, Value, TextPattern). No pixel APIs are used anywhere. | `uia.cc` |
| No per-app integrations | One code path for every app. Nothing branches on app names. | `format.js` |
| No cloud | There is no network code. Everything stays in the local database. | |

## Setup

Requirements: Windows 10/11, Node.js 22.13+, and
[Visual Studio 2022 Build Tools](https://aka.ms/vs/17/release/vs_BuildTools.exe) with the
**Desktop development with C++** workload (it compiles the small native module).

```bash
npm install    # also compiles the native addon (npm run build:native)
npm run dev    # start the app (window + tray icon)
```

### Installer

```bash
npm run build:win   # -> dist/Textline-1.0.0-setup.exe
```

The installer is per-user (no admin needed) and adds Start menu and desktop shortcuts. It's
unsigned, so Windows SmartScreen may ask you to confirm with "More info → Run anyway".

If packaging fails with `EXDEV`/`EPERM` while renaming a `7zip` folder in the electron-builder
cache (antivirus can lock freshly extracted tools), point the cache at the project drive:
`set ELECTRON_BUILDER_CACHE=%CD%\node_modules\.cache\electron-builder`, then build again.

Closing the window keeps Textline recording in the tray. Right-click the tray icon to pause,
resume or quit. Data is stored in `%APPDATA%\Textline\textline.db`.

## How it works

```
 Windows                       Main process (Node)                         Renderer (React)
┌──────────────────┐  events  ┌───────────────────────────────────────┐    ┌──────────────────┐
│ native/uia (C++) │ ───────▶ │ capture.js                            │    │ Now view         │
│ - window events  │          │  1. which window is in focus?         │ ─▶ │  live app + text │
│ - getForeground  │ ◀─────── │  2. new window/title → new session    │IPC │                  │
│ - snapshot(tree) │  read    │  3. read tree → format.js → lines     │    │ Timeline view    │
└──────────────────┘          │  4. sha256; same as last? skip        │ ◀─ │  bar + sessions, │
                              │  5. save to db.js (SQLite) + notify UI │    │  click → screen  │
                              └───────────────────────────────────────┘    └──────────────────┘
```

| File | Job |
|---|---|
| `native/uia/uia.cc` | The only code that talks to Windows. Hooks focus and content-change events (`SetWinEventHook`), returns the focused window, and reads its UI Automation tree. |
| `src/main/capture.js` | The capture loop: event or 3 s poll → session switch → snapshot → dedupe → save → notify. |
| `src/main/format.js` | Turns the raw tree into structured lines (headings, list items, links, inputs, body text) and finds the browser URL. App-agnostic. |
| `src/main/db.js` | SQLite storage (`node:sqlite`, built into Electron): `sessions`, `snapshots`, full-text search (FTS5) and daily backups. |
| `src/main/tray.js`, `index.js` | Tray menu, window and IPC wiring. |
| `src/preload/index.js` | The only bridge between React and the main process. |
| `src/renderer/` | React UI: **Now** and **Timeline**. |

### Key decisions

- **One generic capture layer.** Every app goes through the same UI Automation code. There is no
  per-app logic. Structure comes from roles: list items keep "who said what" together, headings stay
  headings, and the browser URL is the web document's value.
- **Native addon instead of a helper process.** UI Automation is a COM API, so it needs native
  code. A Node addon loads inside Electron itself, so the app stays Electron + React only (no
  PowerShell/.NET sidecar).
- **Whole tree in one call.** A UIA cache request fetches every element with its properties in a
  single cross-process call, so a capture takes about 200 ms instead of seconds.
- **Events plus a poll.** Window events (focus, name/value change, scroll, new elements) trigger a
  capture after a 500 ms debounce, so bursts collapse into one capture. A 3 s poll catches apps that
  change without firing events.
- **Skip duplicates by hash.** Each capture is hashed (URL + text). If it matches the last capture
  of the session, nothing is written. Text typed into input boxes is left out of the hash, so typing
  a message isn't a capture per keystroke. The draft is saved with the next real change.
- **A session is one window with one title.** Switching apps or browser tabs (the title changes)
  starts a new timeline entry with its own timestamp.
- **Embedded content windows.** Some apps draw their content in a window owned by a helper
  process they started, placed on top of their own frame. WhatsApp Desktop does this with WebView2:
  its frame has no text, and the chat lives in a `msedgewebview2` window. Textline also reads
  visible windows of the app's child processes that sit inside its window. That's one generic rule,
  with no app names.
- **Main content first.** Apps mark regions of their window as UI Automation landmarks (HTML
  `<main>`/`<nav>`, ARIA roles). The reading view shows only the main region when there is one,
  hiding buttons and menus. "Show whole window" brings everything back. Apps without landmarks show
  everything except buttons.
- **One slow app can't stop recording.** Each window read has a 5 s limit. A window that doesn't
  answer is skipped for a minute instead of being asked again, which would pile up and slow it down.
- **Built-in SQLite.** Electron's Node ships `node:sqlite`, so there is no second native module to
  compile.
- **Runs off the main thread.** Snapshots run on a worker thread with UIA timeouts (2 s connect,
  4 s transaction), so a frozen app can't freeze Textline.

### Privacy

- Password fields (`IsPassword`) are never read.
- Textline does not record its own window.
- No network code. Everything is in the local SQLite file. Pause from the tray at any time.

## Known limits

| App | Result | Notes |
|---|---|---|
| Google Chrome / Microsoft Edge | ✅ Text, tabs, URL | Chromium builds its tree lazily: the first read can be thin, so Textline retries once. |
| Electron apps (e.g. Claude desktop) | ✅ Full text, URL | Same lazy tree behaviour as Chrome. |
| Notepad | ✅ Full file text | Editor text comes from TextPattern, not Value. |
| WhatsApp Desktop | ✅ Chat list, messages, message box | The window in focus (a WinUI frame) has no text and can stop answering. The chat is a WebView2 window owned by a child process, so it's read as an embedded window. There is no "main" landmark, so the whole window is shown. |
| WhatsApp Web (Chrome) | ✅ Messages, senders, links, chat name | Senders appear as labels ("You:", contact name) before each message. Message bodies are plain text runs that Chromium marks as non-control, so Textline adds every Text element to the control view. |
| Microsoft Teams | ✅ Messages, senders, day/time headings | Each message is exposed as a heading like "message by Sender". |
| Discord | ✅ Channels, messages, links | Electron app; same lazy tree as Chrome. |
| Microsoft Word | ✅ Document text, headings | Page content comes through TextPattern. Headers and footers are captured too. |
| File Explorer, Windows Search | ✅ Files, folders, results | |
| Visual Studio Code | ⚠️ **Editor text only with a setting** | By default VS Code hides editor contents from accessibility clients ("The editor is not accessible at this time"), so only the UI is captured. With `"editor.accessibilitySupport": "on"` the file's text is captured and tagged as the main region (tested). Textline doesn't flip the Windows-wide "screen reader running" flag to force it, because that's a system setting that changes how every app behaves. |

General limits:

- **Apps with no accessibility tree:** games, DirectX/OpenGL/canvas-drawn UIs and some Java apps
  expose little or no text.
- **Elevated (admin) windows** can't be read by a non-admin process (Windows UIPI).
- **Virtualised lists** (long chats, big tables) only expose the rows that exist on screen, so
  scrolling is what reveals older messages. That matches "what was on screen".
- **Very large trees** are capped at 8,000 elements, and editor text at 50,000 characters.
- **Offscreen filtering** relies on apps reporting `IsOffscreen` correctly. If an app marks
  everything offscreen, the whole tree is kept.
- **Storage grows with use.** Each capture stores the full screen text (about 7 MB for an hour of
  active use in testing). Next steps: store diffs between captures, compress, and a retention setting.
- **Unresponsive windows** are skipped for a minute after a 5 s timeout. A stuck read keeps a worker
  thread busy until the app answers.
- **Main content** relies on apps marking landmarks. Many web and Electron apps do, but most native
  apps and Teams don't, so those show the whole window.
- **Cost:** about 1 to 2% of total CPU (8 cores) while switching apps actively, and about 420 MB of
  RAM, mostly Electron's own baseline. Idle cost wasn't measured separately.
- **Change detection** is event-driven with a 3 s poll, so a change that appears and disappears
  within about 3 s without firing an event can be missed.

## Tests

```bash
npm test   # formatter: URL, roles, multi-line text, repeats, offscreen, regions, title cleanup
```

## Dev scripts

```powershell
$env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/probe.js 5   # print what the focused window gives after 5 s
node scripts/inspect-db.js chrome                                # recent sessions + latest Chrome snapshot
npm run icons                                                    # regenerate icons from resources/logo.svg
```
