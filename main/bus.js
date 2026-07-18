// Apex — the message bus (main side). ONE channel ('apex:msg'), typed
// messages, EXACT-type routing (J23 law: no prefix claims, no silent
// swallows — an unknown type logs loudly). Modules register their verbs;
// nothing else touches ipcMain.
// MULTI-HANDLER per type (2026-07-12): the original Map held ONE handler and
// silently last-wins'd — seats' 'ready' clobbered monitors' 'ready' and the
// tracker went dark. Same defect class J23 named, one layer down.
// MULTI-WINDOW (Wave S, 2026-07-18): post() broadcasts to every registered
// live window — the docked shell and the detached studio are two live views
// of the same main-side truth. The one exception is 'ready' (see replyTo).
'use strict';

const { ipcMain } = require('electron');

const handlers = new Map();   // type -> [fn(payload, ctx), ...]
const windows = new Set();    // every registered window's webContents

// A 'ready' is ONE freshly-loaded renderer asking for the world. Its re-posts
// go to that sender alone: broadcasting them would replay seatNew/permission
// events at windows that already hold them. Sound because every ready handler
// re-posts synchronously (audited 2026-07-18, Wave S S1); anything a handler
// starts asynchronously posts after dispatch — broadcast, as a state change
// should be.
let replyTo = null;

function route(msg, sender) {
  const fns = handlers.get(msg && msg.type);
  if (!fns || !fns.length) { console.warn('[bus] unhandled message type:', msg && msg.type); return; }
  replyTo = (msg.type === 'ready' && sender && !sender.isDestroyed()) ? sender : null;
  // ctx carries the sending webContents (S2): handlers that answer with a
  // WINDOW's truth (the ready winState re-post) need to know which window
  // asked. Additive — every pre-S2 handler ignores it. Injected messages
  // (smoke) have no sender; handlers must tolerate ctx.sender === undefined.
  try { fns.forEach((fn) => fn(msg, { post, sender })); }
  finally { replyTo = null; }
}

// addWindow(win) — register a window with the bus (init(win) in the
// single-window era; main.js is the only caller). Its webContents receives
// every post until it dies; the 'destroyed' hook self-unregisters so a closed
// window can never linger in the broadcast set.
function addWindow(win) {
  const wc = win.webContents;
  windows.add(wc);
  wc.once('destroyed', () => windows.delete(wc));
  // idempotent re-hook (init's idiom kept) — one listener however many windows
  ipcMain.removeAllListeners('apex:msg');
  ipcMain.on('apex:msg', (e, msg) => route(msg, e.sender));
}

// Explicit unregister for callers that hold a still-live window. The
// destroyed hook covers the normal close path, so nobody in main/ needs
// this today; a destroyed window's webContents getter throws, hence the try.
function removeWindow(win) {
  try { windows.delete(win.webContents); } catch { /* destroyed — the hook already removed it */ }
}

// register('action', fn) — exact type match; multiple modules may share a type
function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(fn);
}

// post('data', {...}) — main -> renderer: every live registered window, or
// the readying window alone during a 'ready' dispatch
function post(type, payload) {
  const msg = Object.assign({ type }, payload);
  if (replyTo) {
    if (!replyTo.isDestroyed()) replyTo.send('apex:msg', msg);
    return;
  }
  for (const wc of windows) if (!wc.isDestroyed()) wc.send('apex:msg', msg);
}

// postTo(win, 'winState', {...}) — main -> ONE window, outside any dispatch
// scope. For per-window cosmetic state (each window's caption glyphs reflect
// ITS OWN maximize/fullscreen) where a broadcast would be a lie to every
// other window. Deliberately takes the window, not its webContents: callers
// hold BrowserWindows, and the one-channel knowledge stays in here.
function postTo(win, type, payload) {
  try {
    const wc = win && win.webContents;
    if (wc && !wc.isDestroyed()) wc.send('apex:msg', Object.assign({ type }, payload));
  } catch { /* destroyed window — the getter throws; nothing to tell it */ }
}

// TEST AFFORDANCE (smoke only): drive a message through the exact routing a
// renderer post would take — proves main-side handling without a renderer.
// No sender, so even an injected 'ready' broadcasts (single-window smoke:
// identical behavior).
function inject(msg) { route(msg); }

module.exports = { addWindow, removeWindow, on, post, postTo, inject };
