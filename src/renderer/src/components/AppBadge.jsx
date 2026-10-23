import { appColor } from '../time'

// Coloured initial for an app, so each app is recognisable at a glance.
export default function AppBadge({ app, size = 28 }) {
  return (
    <span
      className="badge"
      style={{ background: appColor(app), width: size, height: size, fontSize: size * 0.42 }}
    >
      {app.charAt(0).toUpperCase()}
    </span>
  )
}
