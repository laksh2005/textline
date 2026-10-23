// "Timeline": where you have been. Click any point on the bar (or any row in the
// list) to read what was on screen at that moment.
import { useCallback, useEffect, useState } from 'react'
import ScreenText from './ScreenText'
import { appColor, formatDuration, formatTime } from '../time'

const RANGES = [
  { label: '15 min', ms: 15 * 60e3 },
  { label: '1 hour', ms: 60 * 60e3 },
  { label: '4 hours', ms: 4 * 60 * 60e3 },
  { label: '24 hours', ms: 24 * 60 * 60e3 }
]

export default function TimelineView() {
  const [rangeMs, setRangeMs] = useState(RANGES[1].ms)
  const [to, setTo] = useState(() => Date.now())
  const [sessions, setSessions] = useState([])
  const [picked, setPicked] = useState(null) // { t, session, snapshot }
  const [snapshotTimes, setSnapshotTimes] = useState([])
  const from = to - rangeMs

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

  function onBarClick(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    pickTime(from + ((e.clientX - rect.left) / rect.width) * rangeMs)
  }

  const position = (t) => `${((Math.max(t, from) - from) / rangeMs) * 100}%`
  const width = (s) =>
    `${((Math.min(s.ended_at ?? to, to) - Math.max(s.started_at, from)) / rangeMs) * 100}%`
  const index = snapshotTimes.findIndex((s) => s.id === picked?.snapshot?.id)

  return (
    <div className="timeline">
      <div className="toolbar">
        {RANGES.map((r) => (
          <button
            key={r.ms}
            className={r.ms === rangeMs ? 'active' : ''}
            onClick={() => setRangeMs(r.ms)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="bar" onClick={onBarClick}>
        {sessions.map((s) => (
          <div
            key={s.id}
            className="block"
            style={{ left: position(s.started_at), width: width(s), background: appColor(s.app) }}
            title={`${s.app} · ${s.title}`}
          />
        ))}
        {picked && <div className="cursor" style={{ left: position(picked.t) }} />}
      </div>
      <div className="bar-labels">
        <span>{formatTime(from)}</span>
        <span>now</span>
      </div>

      <div className="split">
        <ol className="sessions">
          {[...sessions].reverse().map((s) => (
            <li
              key={s.id}
              className={picked?.session?.id === s.id ? 'selected' : ''}
              onClick={() => pickTime(Math.min(s.ended_at ?? Date.now(), Date.now()))}
            >
              <span className="dot" style={{ background: appColor(s.app) }} />
              <span className="s-app">{s.app}</span>
              <span className="s-title">{s.title}</span>
              <span className="s-time">
                {formatTime(s.started_at)} · {formatDuration((s.ended_at ?? to) - s.started_at)}
              </span>
            </li>
          ))}
          {sessions.length === 0 && <p className="empty">No activity in this range.</p>}
        </ol>

        <div className="viewer">
          {!picked && (
            <p className="empty">Click a point on the bar or a row to see that screen.</p>
          )}
          {picked && (
            <>
              {snapshotTimes.length > 1 && (
                <div className="stepper">
                  <button
                    disabled={index <= 0}
                    onClick={() => pickSnapshot(snapshotTimes[index - 1].id)}
                  >
                    ← Earlier
                  </button>
                  <span>
                    Capture {index + 1} of {snapshotTimes.length}
                  </span>
                  <button
                    disabled={index < 0 || index >= snapshotTimes.length - 1}
                    onClick={() => pickSnapshot(snapshotTimes[index + 1].id)}
                  >
                    Later →
                  </button>
                </div>
              )}
              <ScreenText session={picked.session} snapshot={picked.snapshot} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
