// Apex — the detached studio window's toggle truth (STUDIO v2, Wave S S1).
// Electron-free on purpose: the open-or-focus decision and the closed
// bookkeeping live here so test/multiwindow-drill.js can prove the semantics
// hermetically; main.js supplies the Electron shell as the `create` factory
// and owns everything BrowserWindow-shaped (bounds, preload, nav lock).
'use strict';

let current = null;   // the live studio window, or null

// toggle(create): open the studio window if closed, focus (and un-minimize)
// it if open. `create` returns the new window; a second monitor's window
// hiding behind the main one is the case restore/focus exists for.
function toggle(create) {
  if (current && !current.isDestroyed()) {
    if (current.isMinimized()) current.restore();
    current.focus();
    return current;
  }
  current = create();
  current.on('closed', () => { current = null; });
  return current;
}

module.exports = { toggle };
