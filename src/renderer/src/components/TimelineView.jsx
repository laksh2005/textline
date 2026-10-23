// "Timeline": where you have been. Click any point on the bar (or any row in the
// list) to read what was on screen at that moment.
import { useCallback, useEffect, useState } from 'react'
import ScreenText from './ScreenText'
import AppBadge from './AppBadge'
import { appColor, formatClock, formatDuration, formatTime } from '../time'

const RANGES = [
  { label: '15m', ms: 15 * 60e3 },
  { label: '1h', ms: 60 * 60e3 },
  { label: '4h', ms: 4 * 60 * 60e3 },
  { label: '24h', ms: 24 * 60 * 60e3 }
]

export default function TimelineView() {
  const [rangeMs, setRangeMs] = useState(RANGES[1].ms)
  const [to, setTo] = useState(() => Date.now())
  const [sessions, setSessions] = useState([])
  const [picked, setPicked] = useState(null) // { t, session, snapshot }
  const [snapshotTimes, setSnapshotTimes] = useState([])
  const [hover, setHover] = useState(null) // { x, t } while the mouse is over the bar
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([]) // search hits, newest first
  const from = to - rangeMs

  // Search all captured text, shortly after the user stops typing.
  useEffect(() => {
    if (!query.trim()) return
    const id = setTimeout(() => window.api.search(query).then(setResults), 250)
    return () => clearTimeout(id)
  }, [query])

  // Keep the window sliding with the clock.
  useEffect(() => {
    const id = setInterval(() => setTo(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    window.api.listSessions(from, to).then(setSessions)
  }, [from, to])

  const pickTime = useCallback(async (t) => {
    const result = await window.api.getScreenAt(t)
    setPicked(result ? { t, ...result } : { t, session: null, snapshot: null })
    setSnapshotTimes(result ? await window.api.listSnapshots(result.session.id) : [])
  }, [])

  async function pickSnapshot(id) {
    const snapshot = await window.api.getSnapshot(id)
    setPicked((p) => ({ ...p, t: snapshot.ts, snapshot }))
  }

  // Converts a mouse position on the bar into a point in time.
  function timeAt(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    return { x, t: from + (x / rect.width) * rangeMs }
  }

  const position = (t) => `${((Math.max(t, from) - from) / rangeMs) * 100}%`
  const width = (s) =>
    `${((Math.min(s.ended_at ?? to, to) - Math.max(s.started_at, from)) / rangeMs) * 100}%`
  const sessionAt = (t) => sessions.find((s) => s.started_at <= t && (s.ended_at ?? to) >= t)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => from + f * rangeMs)
  const index = snapshotTimes.findIndex((s) => s.id === picked?.snapshot?.id)
  const hoverSession = hover && sessionAt(hover.t)

  return (
    <div className="timeline">
      <div className="timeline-head">
        <h2>Where you&apos;ve been</h2>
        <nav className="segmented small">
          {RANGES.map((r) => (
            <button
              key={r.ms}
              className={r.ms === rangeMs ? 'active' : ''}
              onClick={() => setRangeMs(r.ms)}
            >
              {r.label}
            </button>
          ))}
        </nav>
      </div>

      <div
        className="bar"
        onClick={(e) => pickTime(timeAt(e).t)}
        onMouseMove={(e) => setHover(timeAt(e))}
        onMouseLeave={() => setHover(null)}
      >
        {sessions.map((s) => (
          <div
            key={s.id}
            className="block"
            style={{ left: position(s.started_at), width: width(s), background: appColor(s.app) }}
          />
        ))}
        {picked && <div className="cursor" style={{ left: position(picked.t) }} />}
        {hover && (
          <div className="tooltip" style={{ left: hover.x }}>
            <strong>{formatTime(hover.t)}</strong>
            {hoverSession ? ` · ${hoverSession.app}` : ' · nothing recorded'}
          </div>
        )}
      </div>
      <div className="ticks">
        {ticks.map((t, i) => (
          <span key={i}>{i === ticks.length - 1 ? 'Now' : formatClock(t)}</span>
        ))}
      </div>

      <div className="split">
        <ol className="sessions">
          <input
            className="search"
            type="search"
            placeholder="Search everything you've seen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {query.trim() &&
            results.map((r) => (
              <li
                key={r.id}
                className={picked?.snapshot?.id === r.id ? 'selected' : ''}
                onClick={() => pickTime(r.ts)}
              >
                <AppBadge app={r.app} />
                <div className="s-main">
                  <div className="s-title">{r.title || r.app}</div>
                  <div className="s-meta">
                    {r.app} · {formatClock(r.ts)}
                  </div>
                  <Snippet text={r.snippet} />
                </div>
              </li>
            ))}
          {query.trim() && results.length === 0 && <p className="notice">No matches.</p>}

          {!query.trim() &&
            [...sessions].reverse().map((s) => (
              <li
                key={s.id}
                className={picked?.session?.id === s.id ? 'selected' : ''}
                onClick={() => pickTime(Math.min(s.ended_at ?? Date.now(), Date.now()))}
              >
                <AppBadge app={s.app} />
                <div className="s-main">
                  <div className="s-title">{s.title || s.app}</div>
                  <div className="s-meta">
                    {s.app} · {formatClock(s.started_at)} ·{' '}
                    {formatDuration((s.ended_at ?? to) - s.started_at)}
                  </div>
                </div>
              </li>
            ))}
          {!query.trim() && sessions.length === 0 && (
            <p className="notice">No activity in this range yet.</p>
          )}
        </ol>

        <div className="viewer">
          {!picked && (
            <p className="notice">Click any point on the bar, or a row, to read that screen.</p>
          )}
          {picked && snapshotTimes.length > 1 && (
            <div className="stepper">
              <button
                className="ghost"
                disabled={index <= 0}
                onClick={() => pickSnapshot(snapshotTimes[index - 1].id)}
              >
                ← Earlier
              </button>
              <span>
                Capture {index + 1} of {snapshotTimes.length}
              </span>
              <button
                className="ghost"
                disabled={index < 0 || index >= snapshotTimes.length - 1}
                onClick={() => pickSnapshot(snapshotTimes[index + 1].id)}
              >
                Later →
              </button>
            </div>
          )}
          {picked && <ScreenText session={picked.session} snapshot={picked.snapshot} />}
        </div>
      </div>
    </div>
  )
}

// A search snippet, with the matched words (wrapped in [[ ]] by SQLite) highlighted.
function Snippet({ text }) {
  return (
    <div className="snippet">
      {text.split(/\[\[|\]\]/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </div>
  )
}
