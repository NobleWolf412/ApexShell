// Apex — the detached studio window's toggle truth (STUDIO v2, Wave S S1/S2).
// Electron-free on purpose: the open-or-focus decision, the open/closed
// bookkeeping, and the reopen-preference persistence live here so
// test/multiwindow-drill.js can prove the semantics hermetically; main.js
// supplies the Electron shell as the `create` factory and owns everything
// BrowserWindow-shaped (preload, nav lock, the close-time bounds capture).
'use strict';

const fs = require('fs');
const path = require('path');

let current = null;   // the live studio window, or null

// toggle(create, notify): open the studio window if closed, focus (and
// un-minimize) it if open. `create` returns the new window; a second
// monitor's window hiding behind the main one is the case restore/focus
// exists for. `notify(open)` (optional, S2) fires true on a fresh open and
// false when the window dies — the studioWindowState post's single source,
// so focusing an already-open window never re-announces.
function toggle(create, notify) {
  if (current && !current.isDestroyed()) {
    if (current.isMinimized()) current.restore();
    current.focus();
    return current;
  }
  current = create();
  current.on('closed', () => {
    current = null;
    if (notify) notify(false);
  });
  if (notify) notify(true);
  return current;
}

// isOpen() — the affordance truth a late-registering renderer asks for
// (studioWindowGet): is a studio window live right now?
function isOpen() {
  return !!(current && !current.isDestroyed());
}

// close() — the S2 lifecycle cascade: when the MAIN window truly closes, the
// studio follows (it is a companion surface; see main.js's argument). No-op
// when nothing is open.
function close() {
  if (current && !current.isDestroyed()) current.close();
}

// ---- persisted window state: bounds (S1) + the reopen preference (S2) ----
// One flat record in state/studio-window.json: {x, y, width, height, open}.
// Flat because S1 shipped bare getNormalBounds() bytes — merging keeps every
// existing file readable, and a pre-S2 file (no `open`) simply never reopens.
// The `file` parameter exists for the drill alone; production callers take
// the default.
const STATE_FILE = path.join(__dirname, '..', 'state', 'studio-window.json');

function loadState(file) {
  try { return JSON.parse(fs.readFileSync(file || STATE_FILE, 'utf8')) || {}; }
  catch { return {}; }   // first run / unreadable — behave as "never opened"
}

// saveState(patch): merge onto the existing record so the open-flag writer
// and the bounds writer never clobber each other's half.
function saveState(patch, file) {
  const target = file || STATE_FILE;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const merged = Object.assign(loadState(target), patch);
    fs.writeFileSync(target, JSON.stringify(merged));
    return merged;
  } catch { return null; }   // a failed save must never block open/close
}

// shouldReopen(state, env): the launch-time decision. True only when the
// window was open at quit AND this is not a smoke run — a smoke must never
// spawn a second window (state/ is shared with the operator's real installs,
// so the guard has to live here, not in the smoke's userData split).
function shouldReopen(state, env) {
  return !!(state && state.open === true) && (env || {}).APEX_SMOKE !== '1';
}

module.exports = { toggle, isOpen, close, loadState, saveState, shouldReopen };
