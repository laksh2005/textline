// Renders one captured screen: header (app, window, URL, time) and its structured text.
import { formatTime } from '../time'

export default function ScreenText({ session, snapshot }) {
  if (!session) return <p className="empty">Nothing captured.</p>

  return (
    <section className="screen">
      <div className="screen-head">
        <div className="app-name">{session.app}</div>
        <div className="window-title">{session.title}</div>
        {snapshot?.url && <div className="url">{snapshot.url}</div>}
        {snapshot && <div className="captured">Captured {formatTime(snapshot.ts)}</div>}
      </div>

      {!snapshot ? (
        <p className="empty">No text could be read from this window.</p>
      ) : (
        <div className="lines">
          {snapshot.lines.map((line, i) => (
            <div
              key={i}
              className={`line ${line.kind}${line.level ? ` h${line.level}` : ''}`}
              style={{ paddingLeft: line.depth * 14 }}
              title={line.role}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
