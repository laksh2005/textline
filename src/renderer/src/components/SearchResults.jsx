// Search results for the Timeline: the newest match in each session, with a snippet.
// Clicking a result opens that screen, exactly like clicking the timeline at that time.
import { useEffect, useState } from 'react'
import AppBadge from './AppBadge'
import { formatClock } from '../time'

export default function SearchResults({ query, pickedId, onPick }) {
  const [results, setResults] = useState([])

  // Search shortly after the user stops typing.
  useEffect(() => {
    const id = setTimeout(() => window.api.search(query).then(setResults), 250)
    return () => clearTimeout(id)
  }, [query])

  if (results.length === 0) return <p className="notice">No matches.</p>

  return results.map((r) => (
    <li key={r.id} className={pickedId === r.id ? 'selected' : ''} onClick={() => onPick(r.ts)}>
      <AppBadge app={r.app} />
      <div className="s-main">
        <div className="s-title">{r.title || r.app}</div>
        <div className="s-meta">
          {r.app} · {formatClock(r.ts)}
        </div>
        <Snippet text={r.snippet} />
      </div>
    </li>
  ))
}

// SQLite wraps the matched words in [[ ]]; show them highlighted.
function Snippet({ text }) {
  return (
    <div className="snippet">
      {text.split(/\[\[|\]\]/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </div>
  )
}
