const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('probe', { where: () => ipcRenderer.invoke('where'), mini: () => ipcRenderer.invoke('mini') });
