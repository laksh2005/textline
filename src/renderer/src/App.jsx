import { useState } from 'react'
import NowView from './components/NowView'
import TimelineView from './components/TimelineView'

export default function App() {
  const [view, setView] = useState('now')

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Textline</span>
        <nav>
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
      </header>
      <main>{view === 'now' ? <NowView /> : <TimelineView />}</main>
    </div>
  )
}
