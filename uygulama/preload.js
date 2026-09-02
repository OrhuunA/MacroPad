'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('macropad', {
  hello: () => ipcRenderer.invoke('renderer:hello'),
  send: (msg) => ipcRenderer.invoke('engine:send', msg),
  restart: () => ipcRenderer.invoke('engine:restart'),
  onEvent: (cb) => ipcRenderer.on('engine:event', (_e, payload) => cb(payload)),
  saveMacro: (data) => ipcRenderer.invoke('macro:save', data),
  openMacro: () => ipcRenderer.invoke('macro:open')
});
