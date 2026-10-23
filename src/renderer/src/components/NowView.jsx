// "Now": the app in focus and its on-screen text, pushed live from the main process.
import { useEffect, useState } from 'react'
import ScreenText from './ScreenText'

export default function NowView() {
  const [now, setNow] = useState(null)

  useEffect(() => {
    window.api.getNow().then(setNow)
    // Main sends an update on every switch and every new (non-duplicate) capture.
    return window.api.onNow((update) => setNow((prev) => ({ ...prev, ...update })))
  }, [])

  if (!now) return null

  return (
    <div className="now">
      <div className="toolbar">
        <span className={`status ${now.paused ? 'paused' : 'live'}`}>
          {now.paused ? 'Paused' : 'Recording'}
        </span>
        <button onClick={() => window.api.setPaused(!now.paused)}>
          {now.paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      {now.error && <p className="error">{now.error}</p>}
      {!now.session && !now.error && (
        <p className="empty">Switch to another app. Textline doesn&apos;t record itself.</p>
      )}
      {now.session && <ScreenText session={now.session} snapshot={now.snapshot} />}
    </div>
  )
}
