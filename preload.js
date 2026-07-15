// Apex — the preload bridge. THE ONE DOOR (floorplan §): the renderer is
// sandboxed (contextIsolation on, nodeIntegration off), so this is the only
// surface it can reach the main process through. Everything here is an
// explicit, minimal verb — no ipcRenderer handed across, no Node exposed.
//
// Reconstructed from the two sides of the contract that ship in the repo:
//   - main/main.js + main/bus.js (the ipc channels this must speak to)
//   - renderer/bus.js, shell.js, termView.js (the `apex.*` calls made)
// If a byte-original preload.js resurfaces upstream, prefer it; this matches
// the observed contract and passes the APEX_SMOKE boot with zero console errors.
'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Zoom clamp lives here by contract (renderer/shell.js §Ctrl+scroll zoom:
// "clamped 60–200% in the preload").
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.0;
const clampZoom = (f) => {
  const n = Number(f);
  if (!isFinite(n)) return webFrame.getZoomFactor();
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
};

contextBridge.exposeInMainWorld('apex', {
  // The typed message bus — main <-> renderer over ONE channel ('apex:msg').
  // renderer/bus.js layers exact-type routing (window.ApexBus) on top of this.
  bus: {
    on: (cb) => ipcRenderer.on('apex:msg', (_e, msg) => cb(msg)),
    post: (msg) => ipcRenderer.send('apex:msg', msg),
  },

  // Clipboard for the sandboxed renderer (terminal copy/paste rides these).
  // main/main.js exposes these as ipcMain.handle -> both return promises.
  clipboard: {
    read: () => ipcRenderer.invoke('clip:read'),
    write: (text) => ipcRenderer.invoke('clip:write', String(text == null ? '' : text)),
  },

  // Window caption controls — plain ipc, not bus verbs (they exist pre-boot).
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    fullscreen: () => ipcRenderer.send('win:fullscreen'),
    reload: () => ipcRenderer.send('win:reload'),
    // OS-close handshake: main asks, the renderer answers with (id, allow).
    closeDecision: (requestId, allow) =>
      ipcRenderer.send('win:close-decision', requestId, !!allow),
  },

  // Ctrl+scroll / Ctrl+= zoom. webFrame is available in a sandboxed preload;
  // the renderer persists the value, this owns the clamp.
  zoom: {
    get: () => webFrame.getZoomFactor(),
    set: (f) => { webFrame.setZoomFactor(clampZoom(f)); return webFrame.getZoomFactor(); },
  },
});
