import { useEffect, useState } from 'react'
import NowView from './components/NowView'
import TimelineView from './components/TimelineView'
import logo from './assets/logo.png'

export default function App() {
  const [view, setView] = useState('now')
  const [now, setNow] = useState(null) // live state pushed from the main process

  useEffect(() => {
    window.api.getNow().then(setNow)
    return window.api.onNow((update) => setNow((prev) => ({ ...prev, ...update })))
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={logo} alt="" />
          Textline
        </div>

        <nav className="segmented">
          <button className={view === 'now' ? 'active' : ''} onClick={() => setView('now')}>
            Now
          </button>
          <button
            className={view === 'timeline' ? 'active' : ''}
            onClick={() => setView('timeline')}
          >
            Timeline
          </button>
        </nav>

        {now && !now.error && (
          <div className="recording">
            <span className={`status ${now.paused ? 'paused' : 'live'}`}>
              <i />
              {now.paused ? 'Paused' : 'Recording'}
            </span>
            <button className="ghost" onClick={() => window.api.setPaused(!now.paused)}>
              {now.paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        )}
      </header>

      <main>{view === 'now' ? <NowView now={now} /> : <TimelineView />}</main>
    </div>
  )
}
