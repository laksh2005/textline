// The only bridge between the React UI and the main process.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getNow: () => ipcRenderer.invoke('now:get'),
  onNow: (callback) => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('now:update', listener)
    return () => ipcRenderer.removeListener('now:update', listener)
  },
  listSessions: (from, to) => ipcRenderer.invoke('sessions:list', from, to),
  getScreenAt: (t) => ipcRenderer.invoke('screen:at', t),
  listSnapshots: (sessionId) => ipcRenderer.invoke('snapshots:list', sessionId),
  getSnapshot: (id) => ipcRenderer.invoke('snapshot:get', id),
  search: (query) => ipcRenderer.invoke('search', query),
  setPaused: (paused) => ipcRenderer.invoke('capture:setPaused', paused)
})
