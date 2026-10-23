// Main process entry: wires storage, capture, tray, window and IPC together.
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import * as db from './db'
import { loadUia } from './native'
import { createCapture } from './capture'
import { createTray } from './tray'
import icon from '../../resources/icon.png?asset'

let win = null
let capture = null
let tray = null
let quitting = false
let captureError = null

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    title: 'Textline',
    icon, // taskbar + title bar icon (the green logo)
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())
  // Closing the window only hides it; recording continues in the tray.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })

  // In dev, electron-vite serves the UI with hot reload; packaged, it's a local file.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow() {
  if (!win) createWindow()
  win.show()
  win.focus()
}

function setPaused(paused) {
  capture?.setPaused(paused)
  tray?.refresh()
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

function registerIpc() {
  ipcMain.handle('now:get', () => ({ ...(capture?.getNow() ?? {}), error: captureError }))
  ipcMain.handle('sessions:list', (_, from, to) => db.listSessions(from, to))
  ipcMain.handle('screen:at', (_, t) => db.getScreenAt(t))
  ipcMain.handle('snapshots:list', (_, sessionId) => db.listSnapshotTimes(sessionId))
  ipcMain.handle('snapshot:get', (_, id) => db.getSnapshot(id))
  ipcMain.handle('capture:setPaused', (_, paused) => setPaused(paused))
}

// One instance only: a second launch just opens the existing window.
if (!app.requestSingleInstanceLock()) app.quit()
else app.on('second-instance', showWindow)

app.whenReady().then(() => {
  app.setAppUserModelId('com.textline.app') // groups the taskbar icon correctly
  db.openDb()
  registerIpc()

  const { uia, error } = loadUia()
  captureError = error
  if (uia) {
    capture = createCapture(uia, (now) => send('now:update', now))
    capture.start()
  }

  tray = createTray({
    onOpen: showWindow,
    onTogglePause: () => setPaused(!capture?.isPaused()),
    isPaused: () => capture?.isPaused() ?? true,
    onQuit: () => app.quit()
  })

  // Started with --hidden (e.g. at login): live in the tray only.
  if (!process.argv.includes('--hidden')) createWindow()
})

app.on('before-quit', () => {
  quitting = true
  capture?.stop()
})

// Keep running in the tray when the window is gone.
app.on('window-all-closed', () => {})
