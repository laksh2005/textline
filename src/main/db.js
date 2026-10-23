// Local storage. Uses SQLite built into Electron's Node (node:sqlite), so there is
// no extra native database module to build. The file lives in the user's AppData.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { app } from 'electron'

let db

export function openDb() {
  db = new DatabaseSync(join(app.getPath('userData'), 'textline.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;

    -- One row per stretch of time in one window (a switch starts a new row).
    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY,
      app        TEXT NOT NULL,     -- e.g. "chrome"
      exe        TEXT NOT NULL,     -- full path of the program
      title      TEXT NOT NULL,     -- window title
      started_at INTEGER NOT NULL,  -- ms since epoch
      ended_at   INTEGER            -- null while still in focus
    );

    -- One row per distinct thing seen on screen within a session.
    CREATE TABLE IF NOT EXISTS snapshots (
      id         INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id),
      ts         INTEGER NOT NULL,
      url        TEXT,              -- browser URL, when there is one
      hash       TEXT NOT NULL,     -- used to skip duplicates
      text       TEXT NOT NULL,     -- plain text, for reading and search
      lines      TEXT NOT NULL      -- JSON: structured lines for the UI
    );

    CREATE INDEX IF NOT EXISTS snapshots_by_session ON snapshots(session_id, ts);
    CREATE INDEX IF NOT EXISTS sessions_by_time ON sessions(started_at);
  `)
  // If the app crashed, close any session left open.
  db.prepare('UPDATE sessions SET ended_at = started_at WHERE ended_at IS NULL').run()
}

export function startSession({ app, exe, title }, now) {
  const r = db
    .prepare('INSERT INTO sessions (app, exe, title, started_at) VALUES (?, ?, ?, ?)')
    .run(app, exe, title, now)
  return Number(r.lastInsertRowid)
}

export function endSession(id, now) {
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(now, id)
}

export function addSnapshot(sessionId, { url, hash, text, lines }, now) {
  db.prepare(
    'INSERT INTO snapshots (session_id, ts, url, hash, text, lines) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sessionId, now, url, hash, text, JSON.stringify(lines))
}

export function listSessions(from, to) {
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM snapshots WHERE session_id = s.id) AS snapshot_count
       FROM sessions s
       WHERE s.started_at <= ? AND COALESCE(s.ended_at, ?) >= ?
       ORDER BY s.started_at`
    )
    .all(to, Date.now(), from)
}

export function listSnapshotTimes(sessionId) {
  return db.prepare('SELECT id, ts FROM snapshots WHERE session_id = ? ORDER BY ts').all(sessionId)
}

export function getSnapshot(id) {
  return parseSnapshot(db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id))
}

// "What was on screen at time t?" -> the session in focus at t, and the latest
// snapshot taken at or before t (or the first one after, if t is before any).
export function getScreenAt(t) {
  const session = db
    .prepare(
      `SELECT * FROM sessions
       WHERE started_at <= ? AND COALESCE(ended_at, ?) >= ?
       ORDER BY started_at DESC LIMIT 1`
    )
    .get(t, Date.now(), t)
  if (!session) return null
  const snapshot =
    db
      .prepare('SELECT * FROM snapshots WHERE session_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1')
      .get(session.id, t) ??
    db.prepare('SELECT * FROM snapshots WHERE session_id = ? ORDER BY ts LIMIT 1').get(session.id)
  return { session, snapshot: parseSnapshot(snapshot) }
}

function parseSnapshot(row) {
  return row ? { ...row, lines: JSON.parse(row.lines) } : null
}
