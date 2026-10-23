// "Now": the app in focus and its on-screen text. `now` is pushed live by the main
// process on every switch and every new (non-duplicate) capture.
import ScreenText from './ScreenText'

export default function NowView({ now }) {
  if (!now) return null
  if (now.error) return <p className="notice error">{now.error}</p>
  if (now.paused) return <p className="notice">Recording is paused.</p>
  if (!now.session) {
    return (
      <p className="notice">
        Switch to any app. Its text shows up here as you go. Textline doesn&apos;t record itself.
      </p>
    )
  }
  return <ScreenText session={now.session} snapshot={now.snapshot} live />
}
