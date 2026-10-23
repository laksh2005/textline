// Renders one captured screen: a header (app, window, URL, time) and its structured text.
import { useState } from 'react'
import AppBadge from './AppBadge'
import { formatTime } from '../time'

// A short line ending in ":" is a label for what follows, e.g. a sender ("Alex:", "You:").
const isLabel = (line) => line.kind === 'text' && /^[^:]{1,40}:$/.test(line.text)

// By default show what you'd actually read: the app's main content (if it marks one)
// without buttons and menus. "Show whole window" shows every captured line.
function readableLines(lines, wholeWindow) {
  if (wholeWindow) return lines
  const hasMain = lines.some((l) => l.region === 'main')
  const shown = lines.filter((l) => l.kind !== 'control' && (!hasMain || l.region === 'main'))
  const minDepth = Math.min(...shown.map((l) => l.depth))
  return shown.map((l) => ({ ...l, depth: l.depth - minDepth }))
}

export default function ScreenText({ session, snapshot, live = false }) {
  const [wholeWindow, setWholeWindow] = useState(false)

  if (!session) return <p className="notice">Nothing was captured at this moment.</p>
  const lines = readableLines(snapshot?.lines ?? [], wholeWindow)

  return (
    <article className="screen">
      <header className="screen-head">
        <AppBadge app={session.app} size={38} />
        <div className="screen-meta">
          <h1>{session.title || session.app}</h1>
          <div className="sub">
            <span>{session.app}</span>
            {snapshot && (
              <span>
                {live ? 'Updated' : 'Captured'} {formatTime(snapshot.ts)}
              </span>
            )}
          </div>
          {snapshot?.url && <div className="url">{snapshot.url}</div>}
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={wholeWindow}
            onChange={(e) => setWholeWindow(e.target.checked)}
          />
          Show whole window
        </label>
      </header>

      {!snapshot ? (
        <p className="notice">No text could be read from this window.</p>
      ) : (
        <div className="lines">
          {lines.map((line, i) => (
            <div
              key={i}
              className={`line ${line.kind}${line.level ? ` h${line.level}` : ''}${isLabel(line) ? ' label' : ''}`}
              style={{ marginLeft: Math.min(line.depth, 6) * 12 }}
              title={line.role}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
