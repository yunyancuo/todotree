const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todoAPI', {
  load: () => ipcRenderer.invoke('load-todo'),
  save: (content) => ipcRenderer.invoke('save-todo', content),
  changeFile: () => ipcRenderer.invoke('change-file'),
  getFilePath: () => ipcRenderer.invoke('get-file-path'),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  getWorkArea: () => ipcRenderer.invoke('get-work-area'),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  toggleAutoStart: () => ipcRenderer.invoke('toggle-auto-start'),
  createDesktopShortcut: () => ipcRenderer.invoke('create-desktop-shortcut'),
  onPinStateChanged: (callback) => ipcRenderer.on('pin-state-changed', (_e, pinned) => callback(pinned)),
});
