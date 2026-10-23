// System tray: the app keeps recording here after the window is closed.
import { app, Tray, Menu, nativeImage } from 'electron'
import icon from '../../resources/icon.png?asset'

export function createTray({ onOpen, onTogglePause, isPaused, onQuit }) {
  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))

  function refresh() {
    tray.setToolTip(isPaused() ? 'Textline (paused)' : 'Textline (recording)')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Textline', click: onOpen },
        { label: isPaused() ? 'Resume recording' : 'Pause recording', click: onTogglePause },
        {
          label: 'Start at login',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          // --hidden: start straight into the tray, without opening the window.
          click: (item) =>
            app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
        },
        { type: 'separator' },
        { label: 'Quit', click: onQuit }
      ])
    )
  }

  tray.on('click', onOpen)
  refresh()
  return { refresh }
}
