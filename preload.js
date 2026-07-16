// Apex — preload. The ONLY door between renderer and main (plan §3).
// Two surfaces: window caption controls, and the typed message bus.
'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('apex', {
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    closeDecision: (requestId, allow) =>
      ipcRenderer.send('win:close-decision', requestId, !!allow),
    fullscreen: () => ipcRenderer.send('win:fullscreen'),
    reload: () => ipcRenderer.send('win:reload')
  },
  zoom: {
    get: () => webFrame.getZoomFactor(),
    set: (f) => webFrame.setZoomFactor(Math.min(2, Math.max(0.6, f)))
  },
  // navigator.clipboard is permission-denied in the sandboxed renderer —
  // clipboard rides ipc to main (found via agy copy/paste, 2026-07-12)
  clipboard: {
    read: () => ipcRenderer.invoke('clip:read'),
    write: (t) => ipcRenderer.invoke('clip:write', t)
  },
  bus: {
    post: (msg) => ipcRenderer.send('apex:msg', msg),
    on: (fn) => ipcRenderer.on('apex:msg', (_e, msg) => fn(msg))
  }
});
