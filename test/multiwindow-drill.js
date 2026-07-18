// Apex — headless drill for the multi-window bus (STUDIO v2, Wave S S1/S2)
// and the studio window's toggle seam. Outside an Electron process
// require('electron') is only the npm package's path string, so a
// require.cache stub supplies the ipcMain that main/bus.js destructures —
// the drill then drives the REAL bus: broadcast to every registered window,
// the destroyed-window guard, self-unregister, per-sender renderer→main
// routing, ctx.sender, the ready reply-scope, postTo's one-window targeting,
// and studioWindow's open-then-focus truth, open/closed notify, the close
// cascade, and the reopen-preference persistence. Zero Electron, zero LLM
// spend. Run: node test/multiwindow-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// stub electron BEFORE bus.js destructures it — capture the one ipc listener
let ipcListener = null;
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true,
  exports: { ipcMain: {
    on: (ch, fn) => { if (ch === 'apex:msg') ipcListener = fn; },
    removeAllListeners: (ch) => { if (ch === 'apex:msg') ipcListener = null; },
  } } };

const bus = require('../main/bus');
const studioWindow = require('../main/studioWindow');

let passed = 0, failed = 0;
function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

// A BrowserWindow-shaped mock: exactly the surface bus.addWindow touches.
function mockWindow() {
  const hooks = {};
  const wc = {
    sent: [],
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    send(_ch, msg) { this.sent.push(msg); },
    once(evt, fn) { (hooks[evt] = hooks[evt] || []).push(fn); },
  };
  return {
    webContents: wc,
    got(type) { return wc.sent.filter((m) => m.type === type).length; },
    // destroy(fireHook): flip isDestroyed; fireHook=false models the gap
    // where the flag flips before the 'destroyed' event lands
    destroy(fireHook) {
      wc.destroyed = true;
      if (fireHook !== false) (hooks.destroyed || []).forEach((fn) => fn());
    },
  };
}

const A = mockWindow();
const B = mockWindow();

gate('post broadcasts to every registered window', () => {
  bus.addWindow(A);
  bus.addWindow(B);
  bus.post('mwT1', { v: 1 });
  assert.equal(A.got('mwT1'), 1);
  assert.equal(B.got('mwT1'), 1);
  assert.deepEqual(A.webContents.sent[0], { type: 'mwT1', v: 1 }, 'payload merged under type');
});

gate('a destroyed-but-still-registered window never receives, never crashes the loop', () => {
  B.destroy(false);   // isDestroyed flips; the 'destroyed' hook has NOT fired
  bus.post('mwT2', {});
  assert.equal(A.got('mwT2'), 1, 'live window still receives');
  assert.equal(B.got('mwT2'), 0, 'destroyed window skipped');
});

gate('the destroyed hook self-unregisters a closed window', () => {
  const C = mockWindow();
  bus.addWindow(C);
  C.destroy(true);    // the normal close path: hook fires, set shrinks
  bus.post('mwT3', {});
  assert.equal(C.got('mwT3'), 0);
  assert.equal(A.got('mwT3'), 1);
});

gate('removeWindow unregisters a live window explicitly', () => {
  const D = mockWindow();
  bus.addWindow(D);
  bus.removeWindow(D);
  bus.post('mwT4', {});
  assert.equal(D.got('mwT4'), 0);
  assert.equal(A.got('mwT4'), 1);
});

const E = mockWindow();   // second live window for the routing + ready gates

gate('renderer→main routing is per-sender and unaffected by multiple windows', () => {
  bus.addWindow(E);
  const seen = [];
  bus.on('mwPing', (m) => seen.push(m.n));
  ipcListener({ sender: A.webContents }, { type: 'mwPing', n: 1 });
  ipcListener({ sender: E.webContents }, { type: 'mwPing', n: 2 });
  assert.deepEqual(seen, [1, 2], 'both windows reach the same handlers');
});

gate("a ready re-post goes to the readying window alone", () => {
  bus.on('ready', () => bus.post('mwWorld', {}));
  ipcListener({ sender: E.webContents }, { type: 'ready' });
  assert.equal(E.got('mwWorld'), 1, 'the readying window got the world');
  assert.equal(A.got('mwWorld'), 0, 'the other window was not replayed at');
  bus.post('mwAfter', {});   // outside a ready dispatch: broadcast again
  assert.equal(A.got('mwAfter'), 1);
  assert.equal(E.got('mwAfter'), 1);
});

gate('an injected ready (no sender) still broadcasts — the smoke path', () => {
  bus.inject({ type: 'ready' });
  assert.equal(A.got('mwWorld'), 1);
  assert.equal(E.got('mwWorld'), 2);
});

gate('handlers receive the sending webContents as ctx.sender (S2)', () => {
  let got = 'unset';
  bus.on('mwWho', (m, ctx) => { got = ctx && ctx.sender; });
  ipcListener({ sender: A.webContents }, { type: 'mwWho' });
  assert.equal(got, A.webContents, 'the ready winState reply keys off this');
  bus.inject({ type: 'mwWho' });
  assert.equal(got, undefined, 'an injected message (smoke) has no sender');
});

gate('postTo targets one window alone; a dead or null target never throws (S2)', () => {
  bus.postTo(A, 'mwSolo', { v: 7 });
  assert.equal(A.got('mwSolo'), 1, 'the target received');
  assert.equal(E.got('mwSolo'), 0, 'not a broadcast — per-window winState rides this');
  assert.deepEqual(A.webContents.sent[A.webContents.sent.length - 1], { type: 'mwSolo', v: 7 });
  const dead = mockWindow();
  dead.destroy(false);
  bus.postTo(dead, 'mwSolo', {});   // destroyed target: guarded, silent
  bus.postTo(null, 'mwSolo', {});   // no target at all: guarded, silent
  assert.equal(dead.got('mwSolo'), 0);
});

gate('an unknown type warns, never throws', () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try { bus.inject({ type: 'mwNobodyOwnsThis' }); } finally { console.warn = realWarn; }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /mwNobodyOwnsThis/);
});

// ---- studioWindow.toggle: the open-or-focus truth main.js consumes ----

function mockToggleWindow() {
  const hooks = {};
  return {
    destroyed: false, minimized: false, focusCount: 0, restoreCount: 0, closeCount: 0,
    isDestroyed() { return this.destroyed; },
    isMinimized() { return this.minimized; },
    focus() { this.focusCount++; },
    restore() { this.restoreCount++; },
    // Electron's close() ends in 'closed'; the module only listens for that
    close() { this.closeCount++; this.destroyed = true; this.emit('closed'); },
    on(evt, fn) { (hooks[evt] = hooks[evt] || []).push(fn); },
    emit(evt) { (hooks[evt] || []).forEach((fn) => fn()); },
  };
}

let created = [];
const create = () => { const w = mockToggleWindow(); created.push(w); return w; };

gate('toggle opens the studio window when none is live', () => {
  created = [];
  const w = studioWindow.toggle(create);
  assert.equal(created.length, 1);
  assert.equal(w, created[0]);
});

gate('toggle focuses (not reopens) while it lives; restore lifts a minimized one', () => {
  studioWindow.toggle(create);
  assert.equal(created.length, 1, 'no second window created');
  assert.equal(created[0].focusCount, 1);
  assert.equal(created[0].restoreCount, 0);
  created[0].minimized = true;
  studioWindow.toggle(create);
  assert.equal(created[0].restoreCount, 1, 'minimized → restored');
  assert.equal(created[0].focusCount, 2);
});

gate('toggle reopens after close, and after a destroy that skipped closed', () => {
  created[0].emit('closed');
  studioWindow.toggle(create);
  assert.equal(created.length, 2, "closed → next toggle creates anew");
  created[1].destroyed = true;   // destroyed without 'closed' — never crash
  studioWindow.toggle(create);
  assert.equal(created.length, 3);
});

gate('toggle notifies open once on create, never on focus; closed notifies false (S2)', () => {
  created[2].emit('closed');   // clear the survivor of the reopen gate
  const states = [];
  const notify = (open) => states.push(open);
  studioWindow.toggle(create, notify);
  assert.deepEqual(states, [true], 'a fresh open announces studioWindowState');
  studioWindow.toggle(create, notify);
  assert.deepEqual(states, [true], 'focusing an already-open window never re-announces');
  created[created.length - 1].emit('closed');
  assert.deepEqual(states, [true, false], 'the close announces to the survivors');
});

gate('isOpen tracks the live window, counting destroyed as closed (S2)', () => {
  assert.equal(studioWindow.isOpen(), false);
  studioWindow.toggle(create);
  assert.equal(studioWindow.isOpen(), true);
  created[created.length - 1].destroyed = true;   // dead without 'closed'
  assert.equal(studioWindow.isOpen(), false);
});

gate('close() closes the live studio window and no-ops when none is (S2)', () => {
  studioWindow.close();   // previous gate left only a destroyed corpse — silent
  studioWindow.toggle(create);
  const w = created[created.length - 1];
  studioWindow.close();   // the main-closed lifecycle cascade
  assert.equal(w.closeCount, 1, 'the live window was told to close');
  assert.equal(studioWindow.isOpen(), false, 'and the module saw it die');
});

// ---- the reopen preference: state merge + the launch decision (S2) ----

gate('saveState merges the open flag beside the bounds; loadState defaults empty', () => {
  const f = path.join(os.tmpdir(), 'apex-mw-drill-' + process.pid + '.json');
  try { fs.unlinkSync(f); } catch { /* fresh */ }
  assert.deepEqual(studioWindow.loadState(f), {}, 'no file → empty record, no throw');
  studioWindow.saveState({ x: -1280, y: 40, width: 1280, height: 860 }, f);
  studioWindow.saveState({ open: true }, f);
  assert.deepEqual(studioWindow.loadState(f),
    { x: -1280, y: 40, width: 1280, height: 860, open: true },
    'the open-flag write kept the bounds (and negative x — a left monitor)');
  studioWindow.saveState(Object.assign({ x: -1280, y: 40, width: 999, height: 860 },
    { open: false }), f);   // the close-time shape main.js writes
  const s = studioWindow.loadState(f);
  assert.equal(s.width, 999, 'bounds updated');
  assert.equal(s.open, false, 'a user close clears the preference');
  fs.unlinkSync(f);
});

gate('shouldReopen: open-at-quit only, and never in smoke', () => {
  assert.equal(studioWindow.shouldReopen({ open: true }, {}), true);
  assert.equal(studioWindow.shouldReopen({ open: false }, {}), false);
  assert.equal(studioWindow.shouldReopen({}, {}), false, 'a pre-S2 bounds-only file never reopens');
  assert.equal(studioWindow.shouldReopen({ open: true }, { APEX_SMOKE: '1' }), false,
    'a smoke run must never spawn a second window');
});

console.log('\nMULTIWINDOW DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
