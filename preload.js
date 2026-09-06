const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todoAPI', {
  load: () => ipcRenderer.invoke('load-todo'),
  save: (content) => ipcRenderer.invoke('save-todo', content),
  changeFile: () => ipcRenderer.invoke('change-file'),
  getFilePath: () => ipcRenderer.invoke('get-file-path'),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  beginTransientEdit: () => ipcRenderer.invoke('begin-transient-edit'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  getWorkArea: () => ipcRenderer.invoke('get-work-area'),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  toggleAutoStart: () => ipcRenderer.invoke('toggle-auto-start'),
  setFocusable: (v) => ipcRenderer.invoke('set-focusable', v),
  getZoneHeights: () => ipcRenderer.invoke('get-zone-heights'),
  saveZoneHeights: (h) => ipcRenderer.invoke('save-zone-heights', h),
  onPinStateChanged: (callback) => ipcRenderer.on('pin-state-changed', (_e, pinned) => callback(pinned)),
  reloadRenderer: () => ipcRenderer.invoke('reload-renderer'),
  getFileMtime: () => ipcRenderer.invoke('get-file-mtime'),
  backupTodoFile: () => ipcRenderer.invoke('backup-todo-file'),
});
