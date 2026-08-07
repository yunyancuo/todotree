const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todoAPI', {
  load: () => ipcRenderer.invoke('load-todo'),
  save: (content) => ipcRenderer.invoke('save-todo', content),
  changeFile: () => ipcRenderer.invoke('change-file'),
  getFilePath: () => ipcRenderer.invoke('get-file-path'),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  getWorkArea: () => ipcRenderer.invoke('get-work-area'),
  onPinStateChanged: (callback) => ipcRenderer.on('pin-state-changed', (_e, pinned) => callback(pinned)),
});
