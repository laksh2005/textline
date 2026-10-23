# Textline

Your Windows screen history, read as text.

Textline runs in the system tray and records which app and window you are in, plus the text on
screen. It reads that text from the Windows accessibility tree (UI Automation), the same way a
screen reader does. It takes **no screenshots, no screen recording and no OCR**, and nothing leaves
the device.

> "I was on WhatsApp 10 minutes ago. What was on my screen?" Open **Timeline**, click that moment,
> and read the chat as text.

## Setup

Requirements: Windows 10/11, Node.js 22+, and
[Visual Studio 2022 Build Tools](https://aka.ms/vs/17/release/vs_BuildTools.exe) with the
**Desktop development with C++** workload (it compiles the small native module).

```bash
npm install
npm run build:native   # compile the UI Automation addon for Electron
npm run dev            # start the app (window + tray icon)
```

Build an installer with `npm run build:win` (output in `dist/`).

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
| `src/main/db.js` | SQLite storage (`node:sqlite`, built into Electron): `sessions` and `snapshots`. |
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
| WhatsApp Web (Chrome) | ✅ Messages, senders, links, chat name | Senders appear as labels ("You:", contact name) before each message. Message bodies are plain text runs that Chromium marks as non-control, so Textline adds every Text element to the control view. Tested in Chrome; the WhatsApp desktop app was not installed on the test machine. |
| Microsoft Teams | ✅ Messages, senders, day/time headings | Each message is exposed as a heading like "message by Sender". |
| Discord | ✅ Channels, messages, links | Electron app; same lazy tree as Chrome. |
| Microsoft Word | ✅ Document text, headings | Page content comes through TextPattern. Headers and footers are captured too. |
| File Explorer, Windows Search | ✅ Files, folders, results | |
| Visual Studio Code | ⚠️ UI only, **no editor text** | VS Code hides editor contents from accessibility clients unless screen reader mode is on ("The editor is not accessible at this time"). Turn on `"editor.accessibilitySupport": "on"` and the editor's visible lines become readable. Textline doesn't flip the Windows-wide "screen reader running" flag to force it, because that's a system setting that changes how every app behaves. |

General limits:

- **Apps with no accessibility tree:** games, DirectX/OpenGL/canvas-drawn UIs and some Java apps
  expose little or no text.
- **Elevated (admin) windows** can't be read by a non-admin process (Windows UIPI).
- **Virtualised lists** (long chats, big tables) only expose the rows that exist on screen, so
  scrolling is what reveals older messages. That matches "what was on screen".
- **Very large trees** are capped at 8,000 elements, and editor text at 50,000 characters.
- **Offscreen filtering** relies on apps reporting `IsOffscreen` correctly. If an app marks
  everything offscreen, the whole tree is kept.
- **Change detection** is event-driven with a 3 s poll, so a change that appears and disappears
  within about 3 s without firing an event can be missed.

## Dev scripts

```powershell
$env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/probe.js 5        # print the capture of the window in focus after 5 s
$env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/inspect-db.js chrome  # recent sessions + latest Chrome snapshot
```
