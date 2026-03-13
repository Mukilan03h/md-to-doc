const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  exportDocx: (data) => ipcRenderer.invoke('export:docx', data),
  exportPdf: (data) => ipcRenderer.invoke('export:pdf', data),
  exportBatch: (files) => ipcRenderer.invoke('export:batch', files),

  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFiles: (paths) => ipcRenderer.invoke('dialog:openFiles', paths),
  saveFolder: () => ipcRenderer.invoke('dialog:saveFolder'),

  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content, isSavingFromApp) => ipcRenderer.invoke('fs:writeFile', {filePath, content, isSavingFromApp}),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', {key, value}),

  onFileChanged: (callback) => {
    // In React, strict mode can mount/unmount and cause duplicate listeners
    // We should probably return an unsubscribe function or handle it safely.
    const listener = (_event, filePath) => callback(filePath);
    ipcRenderer.on('file:changed', listener);
    return () => ipcRenderer.removeListener('file:changed', listener);
  },

  showToast: (message) => ipcRenderer.send('toast:show', message)
});
