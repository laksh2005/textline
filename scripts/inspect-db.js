// Dev tool: summary of what Textline has stored. Read-only.
// Usage: node scripts/inspect-db.js [app]
const { DatabaseSync } = require('node:sqlite')
const { join } = require('path')
const db = new DatabaseSync(join(process.env.APPDATA, 'Textline', 'textline.db'), {
  readOnly: true
})

console.table(
  db
    .prepare(
      `SELECT s.app, substr(s.title, 1, 50) AS title,
              datetime(s.started_at / 1000, 'unixepoch', 'localtime') AS started,
              round((COALESCE(s.ended_at, strftime('%s','now') * 1000) - s.started_at) / 1000.0) AS secs,
              COUNT(n.id) AS snaps, MAX(length(n.text)) AS chars
       FROM sessions s LEFT JOIN snapshots n ON n.session_id = s.id
       GROUP BY s.id ORDER BY s.started_at DESC LIMIT 25`
    )
    .all()
)
const app = process.argv[2]
if (app) {
  const row = db
    .prepare(
      `SELECT n.url, n.text FROM snapshots n JOIN sessions s ON s.id = n.session_id
       WHERE s.app LIKE ? ORDER BY n.ts DESC LIMIT 1`
    )
    .get(`%${app}%`)
  console.log(row ? `URL: ${row.url}\n${row.text.slice(0, 4000)}` : 'no snapshot')
}
