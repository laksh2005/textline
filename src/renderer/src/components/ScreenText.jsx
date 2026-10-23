// Renders one captured screen: a header (app, window, URL, time) and its structured text.
import { useState } from 'react'
import AppBadge from './AppBadge'
import { formatTime } from '../time'

// A short line ending in ":" is a label for what follows, e.g. a sender ("Alex:", "You:").
const isLabel = (line) => line.kind === 'text' && /^[^:]{1,40}:$/.test(line.text)

export default function ScreenText({ session, snapshot, live = false }) {
  // Buttons and menu items are captured too, but they're mostly noise when reading.
  const [showInterface, setShowInterface] = useState(false)

  if (!session) return <p className="notice">Nothing was captured at this moment.</p>
  const lines = snapshot?.lines.filter((l) => showInterface || l.kind !== 'control') ?? []

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
            checked={showInterface}
            onChange={(e) => setShowInterface(e.target.checked)}
          />
          Show interface
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
