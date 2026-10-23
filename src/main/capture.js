// The capture loop. This is the whole workflow of the app:
//
//   Windows event (switch / content change) or 3s poll
//     -> which window is in focus?   (new window or title = new session)
//     -> read its accessibility tree (native snapshot)
//     -> format into structured text
//     -> hash it; same as last time? skip. Otherwise save it.
//     -> tell the UI
import { createHash } from 'crypto'
import { basename } from 'path'
import * as db from './db'
import { cleanTitle, formatTree } from './format'

const POLL_MS = 3000 // backstop for changes that fire no event
const DEBOUNCE_MS = 500 // wait for a burst of changes to settle
const READ_TIMEOUT_MS = 5000 // give up on a window that doesn't answer in time
const SKIP_SLOW_MS = 60000 // ...and don't ask it again for a minute

export function createCapture(uia, onUpdate) {
  const slowUntil = new Map() // hwnd -> time until which we skip it
  let current = null // { hwnd, title, sessionId, app, exe, lastHash, snapshot }
  let last = null // the previous `current`, shown while Textline itself is in focus
  let paused = false
  let busy = false
  let again = false
  let debounce = null

  function tick() {
    if (paused) return
    if (busy) {
      again = true // a capture is running; run once more when it finishes
      return
    }
    busy = true
    capture()
      .catch((e) => console.error('capture failed:', e.message))
      .finally(() => {
        busy = false
        if (again) {
          again = false
          tick()
        }
      })
  }

  async function capture() {
    const fg = uia.getForeground()
    const now = Date.now()

    // Nothing in focus, or the user is looking at Textline itself: not tracked.
    if (!fg || !fg.exe || fg.pid === process.pid) {
      closeCurrent(now)
      return
    }

    // A different window, or the same window with a new title (e.g. a new tab),
    // is a switch: end the old session and start a new one.
    const title = cleanTitle(fg.title)
    if (!current || current.hwnd !== fg.hwnd || current.title !== title) {
      closeCurrent(now)
      const app = basename(fg.exe).replace(/\.exe$/i, '') // WINWORD.EXE -> WINWORD
      const sessionId = db.startSession({ app, exe: fg.exe, title }, now)
      current = {
        hwnd: fg.hwnd,
        title,
        app,
        exe: fg.exe,
        sessionId,
        lastHash: null,
        snapshot: null
      }
      emit()
    }

    let nodes = await readWindow(fg)
    // Chromium apps build their tree lazily the first time a reader asks. Retry once.
    if (nodes.length < 50) {
      await new Promise((r) => setTimeout(r, 800))
      nodes = await readWindow(fg)
    }
    if (!current || current.hwnd !== fg.hwnd) return // user switched while we read

    const { url, lines, text } = formatTree(nodes)
    // What's typed into input boxes is left out of the hash, so each keystroke in a
    // message box isn't a new capture. The draft is still saved with the next real change.
    const content = lines.filter((l) => l.kind !== 'input').map((l) => l.text)
    const hash = createHash('sha256')
      .update(`${url}\n${content.join('\n')}`)
      .digest('hex')
    if (hash === current.lastHash) return // duplicate: nothing changed on screen

    current.lastHash = hash
    current.snapshot = { ts: Date.now(), url, lines, text }
    db.addSnapshot(current.sessionId, { url, hash, text, lines }, current.snapshot.ts)
    emit()
  }

  // The focused window's tree, plus any windows embedded in it by helper processes
  // (e.g. WebView2 content). A window that has no tree or doesn't answer in time is
  // skipped, so one unresponsive app can never stop recording.
  async function readWindow(fg) {
    const nodes = []
    for (const hwnd of [fg.hwnd, ...fg.embedded]) {
      if (slowUntil.get(hwnd) > Date.now()) continue
      try {
        nodes.push(...(await withTimeout(uia.snapshot(hwnd), READ_TIMEOUT_MS)).nodes)
      } catch (e) {
        if (e.message === 'timeout') slowUntil.set(hwnd, Date.now() + SKIP_SLOW_MS)
      }
    }
    return nodes
  }

  function withTimeout(promise, ms) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  function closeCurrent(now) {
    if (!current) return
    db.endSession(current.sessionId, now)
    last = current
    current = null
    emit()
  }

  function emit() {
    onUpdate(getNow())
  }

  // While the user looks at Textline itself, "Now" keeps showing the last app they
  // were in (inFocus: false) instead of going blank.
  function getNow() {
    const shown = current ?? last
    if (!shown) return { paused, inFocus: false, session: null, snapshot: null }
    const { app, exe, title, sessionId, snapshot } = shown
    return {
      paused,
      inFocus: shown === current,
      session: { id: sessionId, app, exe, title },
      snapshot
    }
  }

  return {
    start() {
      uia.start((type) => {
        clearTimeout(debounce)
        // A switch is captured right away; content changes wait to settle.
        debounce = setTimeout(tick, type === 'foreground' ? 0 : DEBOUNCE_MS)
      })
      setInterval(tick, POLL_MS)
      tick()
    },
    stop() {
      uia.stop()
      closeCurrent(Date.now())
    },
    setPaused(value) {
      paused = value
      if (paused) closeCurrent(Date.now())
      else tick()
      emit()
    },
    isPaused: () => paused,
    getNow
  }
}
