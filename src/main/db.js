// Local storage. Uses SQLite built into Electron's Node (node:sqlite), so there is
// no extra native database module to build. The file lives in the user's AppData.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { mkdirSync, readdirSync, rmSync } from 'fs'
import { app } from 'electron'

const KEEP_BACKUPS = 7 // one per day

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

    -- Full-text search over snapshot text (SQLite FTS5), kept in sync by a trigger.
    CREATE VIRTUAL TABLE IF NOT EXISTS snapshots_fts
      USING fts5(text, content = 'snapshots', content_rowid = 'id');
    CREATE TRIGGER IF NOT EXISTS snapshots_to_fts AFTER INSERT ON snapshots BEGIN
      INSERT INTO snapshots_fts (rowid, text) VALUES (new.id, new.text);
    END;
  `)
  // If the app crashed, close any session left open.
  db.prepare('UPDATE sessions SET ended_at = started_at WHERE ended_at IS NULL').run()
}

// Writes the write-ahead log back into the main file and closes cleanly.
export function closeDb() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
}

// Daily backup: a consistent copy (VACUUM INTO works while the app is writing) in
// <userData>/backups/textline-YYYY-MM-DD.db. Keeps the newest KEEP_BACKUPS files.
export function backupDb() {
  const dir = join(app.getPath('userData'), 'backups')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `textline-${new Date().toLocaleDateString('sv')}.db`) // 'sv' formats as YYYY-MM-DD, in local time
  rmSync(file, { force: true }) // VACUUM INTO won't overwrite
  db.prepare('VACUUM INTO ?').run(file)

  const daily = readdirSync(dir).filter((f) => /^textline-\d{4}-\d{2}-\d{2}\.db$/.test(f))
  for (const old of daily.sort().slice(0, -KEEP_BACKUPS)) rmSync(join(dir, old))
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

// "When did I see X?" -> the newest matching capture in each session, with a snippet.
// Each word is quoted so user input can't break the FTS query syntax.
export function search(query) {
  const words = query.match(/\S+/g)
  if (!words) return []
  const match = words.map((w) => `"${w.replaceAll('"', '""')}"`).join(' ')
  const rows = db
    .prepare(
      `SELECT n.id, n.ts, n.session_id, s.app, s.title,
              snippet(snapshots_fts, 0, '[[', ']]', '…', 14) AS snippet
       FROM snapshots_fts
       JOIN snapshots n ON n.id = snapshots_fts.rowid
       JOIN sessions s ON s.id = n.session_id
       WHERE snapshots_fts MATCH ?
       ORDER BY n.ts DESC LIMIT 200`
    )
    .all(match)
  // Rows are newest first, so the first row seen for a session is its newest match.
  const results = []
  const seen = new Set()
  for (const row of rows) {
    if (seen.has(row.session_id)) continue
    seen.add(row.session_id)
    results.push(row)
  }
  return results.slice(0, 30)
}

export function listSessions(from, to) {
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE started_at <= ? AND COALESCE(ended_at, ?) >= ?
       ORDER BY started_at`
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
