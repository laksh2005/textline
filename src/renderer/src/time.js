export function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Stable colour per app name, so each app keeps its colour on the timeline.
export function appColor(app) {
  let h = 0
  for (const c of app) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 55% 55%)`
}
