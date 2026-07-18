// Apex — headless drill for the app frame (STUDIO v2, Wave B slice B2).
// main/appFrame.js is Electron-free by construction (the studioWindow.js
// precedent — no require.cache stub even needed): the drill drives the REAL
// module with a recording view factory and BrowserWindow-shaped mocks, and
// proves the localhost URL wall, the navigation-confinement origin rule,
// bounds sanitation (finite, non-negative, capped, zoom-scaled), the
// per-window registry's show/position/hide/navigate/destroy contract, the
// destroyed-window cleanup, and the bus verbs' per-window postTo replies.
// Slice B3 extends it: instrument-event shaping (two kinds, hard caps), the
// per-frame rate gate (20/s, drop beyond, one honest summary per second),
// reset-on-navigate, and the appFrameEvent postTo wiring.
// Slice C2 extends it again: the inspect seam (install/remove scripts via the
// adapter's runScript, idempotence by page guard, reset on every page
// replacement, honest refusal without the seam) and the pick channel —
// shapePickPayload as the A5 validator's twin (caps, rebuilt fields,
// fail-closed) and the magic-prefix routing order (prefix BEFORE the
// error-level chip gate, which moved into the registry for exactly that:
// raw console events now carry `level`, and only 'error' lines ever chip).
// Zero Electron, zero LLM spend. Run: node test/appframe-drill.js
'use strict';

const assert = require('assert');
const appFrame = require('../main/appFrame');

let passed = 0, failed = 0;
function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

// ---- the URL wall ----------------------------------------------------------

gate('the wall admits localhost and 127.0.0.1 with an explicit port, normalized', () => {
  assert.equal(appFrame.validateFrameUrl('http://localhost:5173'), 'http://localhost:5173/');
  assert.equal(appFrame.validateFrameUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000/');
  assert.equal(appFrame.validateFrameUrl('http://localhost:8080/app?x=1#y'),
    'http://localhost:8080/app?x=1#y', 'paths/query/hash ride the same origin freely');
  assert.equal(appFrame.validateFrameUrl('http://LOCALHOST:5173/'), 'http://localhost:5173/',
    'WHATWG parsing normalizes case before the check');
});

gate('the wall refuses every hostile origin, scheme, and port shape', () => {
  const hostile = [
    'https://localhost:5173/',            // wrong scheme (a local dev server is http)
    'http://evil.com:5173/',              // not localhost
    'http://localhost/',                  // no port — implied :80 refuses
    'http://localhost:0/',                // port 0
    'http://localhost:99999/',            // out of range (URL parser rejects)
    'http://user@localhost:5173/',        // credentials
    'http://localhost:5173@evil.com/',    // userinfo spoof — hostname is evil.com
    'http://[::1]:5173/',                 // IPv6 loopback is NOT on the allowlist
    'http://127.0.0.2:5173/',             // loopback range but not the named host
    'http://localhost.evil.com:5173/',    // suffix spoof
    'file:///C:/Windows/system32',        // no file
    'ftp://localhost:21/',                // no other scheme
    '//localhost:5173/',                  // relative — no base, no deal
    'javascript:alert(1)',
    '', null, undefined, 42, {},          // non-strings
    'http://localhost:5173/' + 'a'.repeat(3000),   // oversized
  ];
  for (const url of hostile)
    assert.equal(appFrame.validateFrameUrl(url), null, 'must refuse: ' + String(url).slice(0, 60));
});

gate('sameFrameOrigin confines navigation to the frame\'s exact localhost origin', () => {
  const home = 'http://localhost:5173/';
  assert.equal(appFrame.sameFrameOrigin(home, 'http://localhost:5173/about?tab=2'), true,
    'the SPA may route freely on its own origin');
  assert.equal(appFrame.sameFrameOrigin(home, 'http://localhost:4000/'), false, 'another port refuses');
  assert.equal(appFrame.sameFrameOrigin(home, 'http://127.0.0.1:5173/'), false,
    'localhost and 127.0.0.1 are DIFFERENT origins — no cross-hop');
  assert.equal(appFrame.sameFrameOrigin(home, 'https://localhost:5173/'), false);
  assert.equal(appFrame.sameFrameOrigin(home, 'https://evil.com/'), false);
  assert.equal(appFrame.sameFrameOrigin(null, home), false, 'no allowed url = nothing allowed');
});

// ---- bounds sanitation -----------------------------------------------------

gate('bounds sanitize: rounded ints, negatives clamp to 0, the cap holds', () => {
  assert.deepEqual(appFrame.sanitizeBounds({ x: 10.6, y: 20.2, width: 300.5, height: 200 }),
    { x: 11, y: 20, width: 301, height: 200 });
  assert.deepEqual(appFrame.sanitizeBounds({ x: -15, y: -0.5, width: 100, height: 100 }),
    { x: 0, y: 0, width: 100, height: 100 }, 'half-scrolled-off placeholder clamps, not drops');
  const capped = appFrame.sanitizeBounds({ x: 1e9, y: 5, width: 999999, height: 50 });
  assert.deepEqual(capped, { x: 20000, y: 5, width: 20000, height: 50 }, 'hostile sizes cap');
});

gate('bounds sanitize refuses non-finite, missing, zero-box, and junk shapes', () => {
  assert.equal(appFrame.sanitizeBounds({ x: NaN, y: 0, width: 10, height: 10 }), null);
  assert.equal(appFrame.sanitizeBounds({ x: 0, y: Infinity, width: 10, height: 10 }), null);
  assert.equal(appFrame.sanitizeBounds({ x: 0, y: 0, width: 10 }), null, 'missing height');
  assert.equal(appFrame.sanitizeBounds({ x: 0, y: 0, width: 0, height: 10 }), null,
    'a zero box is a hide, never a show');
  assert.equal(appFrame.sanitizeBounds(null), null);
  assert.equal(appFrame.sanitizeBounds('big'), null);
  assert.equal(appFrame.sanitizeBounds({ x: '5', y: '6', width: '10', height: '10' }),
    null, 'strings refuse — the renderer sends numbers or nothing');
});

gate('bounds scale by the sender\'s zoom factor; a junk factor is 1', () => {
  assert.deepEqual(appFrame.sanitizeBounds({ x: 100, y: 50, width: 200, height: 100 }, 1.5),
    { x: 150, y: 75, width: 300, height: 150 }, 'CSS px × zoom = DIP');
  assert.deepEqual(appFrame.sanitizeBounds({ x: 100, y: 50, width: 200, height: 100 }, NaN),
    { x: 100, y: 50, width: 200, height: 100 });
  assert.deepEqual(appFrame.sanitizeBounds({ x: 100, y: 50, width: 200, height: 100 }, -2),
    { x: 100, y: 50, width: 200, height: 100 });
});

// ---- the per-window registry -----------------------------------------------

// A BrowserWindow-shaped mock: exactly the surface the registry touches.
function mockWindow() {
  const hooks = {};
  return {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    once(evt, fn) { (hooks[evt] = hooks[evt] || []).push(fn); },
    emit(evt) { const fns = hooks[evt] || []; hooks[evt] = []; fns.forEach((fn) => fn()); },
  };
}

// A recording view adapter — the exact contract main.js's factory returns
// (runScript is C2's addition: executeJavaScript on the hosted page).
function stubView(allowedUrl) {
  return { allowedUrl, loads: [], boundsSet: [], visibleSet: [], destroyed: 0, scripts: [],
    loadURL(u) { this.loads.push(u); },
    setBounds(b) { this.boundsSet.push(b); },
    setVisible(v) { this.visibleSet.push(v); },
    runScript(js) { this.scripts.push(js); },
    destroy() { this.destroyed++; } };
}

const made = [];
const factory = { createView: (win, allowedUrl) => { const v = stubView(allowedUrl); made.push(v); return v; } };
const goodBounds = { x: 300, y: 120, width: 800, height: 440 };

gate('show creates ONE view per window: load + position + visible', () => {
  const reg = appFrame.createFrameRegistry(factory);
  const win = mockWindow();
  const r = reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'http://localhost:5173/');
  assert.equal(made.length, 1);
  const v = made[0];
  assert.deepEqual(v.loads, ['http://localhost:5173/']);
  assert.deepEqual(v.boundsSet, [goodBounds]);
  assert.deepEqual(v.visibleSet, [true]);
  assert.equal(v.allowedUrl(), 'http://localhost:5173/', 'the confinement accessor sees the live url');

  // re-show with fresh bounds = the bounds sync: reposition, NO reload
  reg.show(win, { projectId: 'p1', url: 'http://localhost:5173/', bounds: { x: 10, y: 10, width: 500, height: 300 } });
  assert.equal(made.length, 1, 'still one view for this window');
  assert.equal(v.loads.length, 1, 'same url never reloads on a bounds sync');
  assert.equal(v.boundsSet.length, 2);

  // a CHANGED url reloads in place and the confinement origin follows
  reg.show(win, { projectId: 'p1', url: 'http://localhost:4000/', bounds: goodBounds });
  assert.deepEqual(v.loads, ['http://localhost:5173/', 'http://localhost:4000/']);
  assert.equal(v.allowedUrl(), 'http://localhost:4000/');
});

gate('the visibility contract: hide keeps the view and url; re-show reveals without reload', () => {
  const reg = appFrame.createFrameRegistry(factory);
  const win = mockWindow();
  reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = made[made.length - 1];
  const h = reg.hide(win);
  assert.equal(h.ok, true);
  assert.equal(h.visible, false);
  assert.equal(v.visibleSet[v.visibleSet.length - 1], false);
  assert.equal(v.destroyed, 0, 'a hide is a tab flip, never a teardown');
  assert.equal(reg.stateOf(win).url, 'http://localhost:5173/', 'the url survives the hide');
  reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  assert.equal(v.loads.length, 1, 're-show is a reveal, not a reload — the app keeps its state');
  assert.equal(v.visibleSet[v.visibleSet.length - 1], true);
  assert.equal(reg.hide(mockWindow()).ok, true, 'hiding what was never shown is a quiet yes');
});

gate('show refuses a hostile url or junk bounds WITHOUT creating a view', () => {
  const reg = appFrame.createFrameRegistry(factory);
  const win = mockWindow();
  const before = made.length;
  const r1 = reg.show(win, { projectId: 'p1', url: 'https://evil.com/', bounds: goodBounds });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /localhost/);
  const r2 = reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: { x: NaN } });
  assert.equal(r2.ok, false);
  const r3 = reg.show(win, {});   // no url at all
  assert.equal(r3.ok, false);
  assert.equal(made.length, before, 'refusals never touch the factory');
  assert.equal(reg.stateOf(win).present, false);
});

gate('navigate: existing frame only, wall-checked, same-url = reload', () => {
  const reg = appFrame.createFrameRegistry(factory);
  const win = mockWindow();
  const miss = reg.navigate(win, { url: 'http://localhost:5173/' });
  assert.equal(miss.ok, false, 'navigate never conjures a view — show owns creation');
  reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = made[made.length - 1];
  const bad = reg.navigate(win, { url: 'https://evil.com/' });
  assert.equal(bad.ok, false);
  assert.equal(v.loads.length, 1, 'a refused navigate loads nothing');
  const same = reg.navigate(win, { url: 'http://localhost:5173/' });
  assert.equal(same.ok, true);
  assert.equal(v.loads.length, 2, 'same-url navigate IS the reload button');
  reg.navigate(win, { url: 'http://127.0.0.1:8080/' });
  assert.equal(v.allowedUrl(), 'http://127.0.0.1:8080/', 'confinement follows the navigate');
});

gate('per-window isolation: two host windows, two independent frames', () => {
  const reg = appFrame.createFrameRegistry(factory);
  const a = mockWindow(), b = mockWindow();
  reg.show(a, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  reg.show(b, { projectId: 'p2', url: 'http://localhost:4000', bounds: goodBounds });
  const va = made[made.length - 2], vb = made[made.length - 1];
  assert.notEqual(va, vb);
  reg.hide(a);
  assert.equal(reg.stateOf(a).visible, false);
  assert.equal(reg.stateOf(b).visible, true, 'hiding the docked pane never touches the detached window');
  assert.equal(reg.stateOf(b).projectId, 'p2');
});

gate('destroyed-window cleanup: the closed hook tears the frame down; a fresh show rebuilds', () => {
  const reg = appFrame.createFrameRegistry(factory);
  const win = mockWindow();
  reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = made[made.length - 1];
  win.destroyed = true;
  win.emit('closed');
  assert.equal(v.destroyed, 1, 'the window\'s death is the one destroy trigger');
  assert.equal(reg.stateOf(win).present, false);
  const dead = reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  assert.equal(dead.ok, false, 'a destroyed window hosts nothing');
  const win2 = mockWindow();
  const again = reg.show(win2, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  assert.equal(again.ok, true, 'a fresh window gets a fresh frame');
});

gate('destroyAll (the quit backstop) destroys every live frame once', () => {
  const reg = appFrame.createFrameRegistry(factory);
  const a = mockWindow(), b = mockWindow();
  reg.show(a, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  reg.show(b, { projectId: 'p2', url: 'http://localhost:4000', bounds: goodBounds });
  const va = made[made.length - 2], vb = made[made.length - 1];
  reg.destroyAll();
  assert.equal(va.destroyed, 1);
  assert.equal(vb.destroyed, 1);
  assert.equal(reg.stateOf(a).present, false);
  assert.equal(reg.stateOf(b).present, false);
  a.emit('closed');   // the closed hook after destroyAll: no double destroy, no throw
  assert.equal(va.destroyed, 1);
});

// ---- instrument events (B3): shaping, the rate gate, reset-on-navigate -----

gate('event shaping: two kinds only, text/url hard-capped, junk drops silently', () => {
  assert.deepEqual(
    appFrame.shapeFrameEvent({ kind: 'console', text: 'boom', url: 'http://localhost:5173/a.js' }),
    { kind: 'console', text: 'boom', url: 'http://localhost:5173/a.js' });
  assert.deepEqual(appFrame.shapeFrameEvent({ kind: 'net', text: 'ERR_CONNECTION_REFUSED (-102)' }),
    { kind: 'net', text: 'ERR_CONNECTION_REFUSED (-102)' }, 'url is optional');
  const long = appFrame.shapeFrameEvent({ kind: 'console', text: 'x'.repeat(900), url: 'u'.repeat(900) });
  assert.equal(long.text.length, 300, 'text caps at 300');
  assert.equal(long.url.length, 200, 'url caps at 200');
  assert.equal(appFrame.shapeFrameEvent({ kind: 'console', text: 'ok', url: 42 }).url, undefined,
    'a junk url drops off; the event survives');
  const junk = [null, undefined, 42, 'boom', {}, [],
    { kind: 'debugger', text: 'x' },          // only console|net exist on this wire
    { kind: 'drop', text: 'spoof' },          // a page cannot forge the summary kind
    { kind: 'console' },                      // no text
    { kind: 'console', text: '' },
    { kind: 'console', text: 42 }];
  for (const raw of junk)
    assert.equal(appFrame.shapeFrameEvent(raw), null, 'must drop: ' + JSON.stringify(raw));
});

// A rig owning time: createView hands the registry's onEvent inlet back out,
// postEvent records what left, and `now` is the drill's clock.
function instrumentRig() {
  const rig = { t: 100000, posted: [], views: [] };
  rig.reg = appFrame.createFrameRegistry({
    createView: (win, allowedUrl, onEvent) => {
      const v = stubView(allowedUrl); v.onEvent = onEvent; rig.views.push(v); return v;
    },
    postEvent: (win, msg) => rig.posted.push({ win, msg }),
    now: () => rig.t,
  });
  return rig;
}

gate('events forward shaped, to the frame\'s own window; junk raw events never leave', () => {
  const rig = instrumentRig();
  const win = mockWindow();
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = rig.views[0];
  v.onEvent({ kind: 'console', level: 'error', text: 'a'.repeat(500), url: 'http://localhost:5173/x.js' });
  assert.equal(rig.posted.length, 1);
  assert.equal(rig.posted[0].win, win, 'the event lands on the hosting window alone');
  assert.equal(rig.posted[0].msg.kind, 'console');
  assert.equal(rig.posted[0].msg.text.length, 300, 'the cap holds through the registry');
  assert.equal(rig.posted[0].msg.level, undefined, 'level is routing input, never payload');
  v.onEvent({ kind: 'evil', text: 'x' });
  v.onEvent(null);
  assert.equal(rig.posted.length, 1, 'junk drops silently');
  // C2 moved the error-level gate here: the factory now forwards EVERY
  // console line with its level, and only 'error' ones chip.
  v.onEvent({ kind: 'console', level: 'info', text: 'chatty page' });
  v.onEvent({ kind: 'console', text: 'no level at all' });
  assert.equal(rig.posted.length, 1, 'non-error console lines never chip');
  v.onEvent({ kind: 'net', text: 'net events carry no level and still ride' });
  assert.equal(rig.posted.length, 2);
});

gate('the rate gate: 20/s forward, overflow drops, ONE honest summary opens the next second', () => {
  const rig = instrumentRig();
  const win = mockWindow();
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = rig.views[0];
  for (let i = 0; i < 25; i++) v.onEvent({ kind: 'console', level: 'error', text: 'err ' + i });
  assert.equal(rig.posted.length, 20, 'the 21st..25th dropped inside the window');
  rig.t += 1000;
  v.onEvent({ kind: 'net', text: 'late one' });
  assert.equal(rig.posted.length, 22, 'the boundary flushes the summary, then the event');
  assert.equal(rig.posted[20].msg.kind, 'drop');
  assert.match(rig.posted[20].msg.text, /dropped 5/, 'the count is honest');
  assert.equal(rig.posted[21].msg.text, 'late one');
  // a clean window emits no summary
  rig.t += 1000;
  v.onEvent({ kind: 'console', level: 'error', text: 'quiet second' });
  assert.equal(rig.posted.length, 23);
  assert.equal(rig.posted[22].msg.kind, 'console');
});

gate('reset-on-navigate: a fresh page gets a fresh budget and no stale drop count', () => {
  const rig = instrumentRig();
  const win = mockWindow();
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = rig.views[0];
  for (let i = 0; i < 25; i++) v.onEvent({ kind: 'console', level: 'error', text: 'err' });
  assert.equal(rig.posted.length, 20, 'saturated, 5 pending drops');
  rig.reg.navigate(win, { url: 'http://localhost:5173/' });   // the reload button
  v.onEvent({ kind: 'console', level: 'error', text: 'fresh' });
  assert.equal(rig.posted.length, 21, 'the budget reset — the event forwards');
  assert.equal(rig.posted[20].msg.text, 'fresh', 'and NO stale summary preceded it');
  // a changed-url show (reload path) resets the same way
  for (let i = 0; i < 25; i++) v.onEvent({ kind: 'console', level: 'error', text: 'err' });
  const before = rig.posted.length;
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:4000', bounds: goodBounds });
  v.onEvent({ kind: 'net', text: 'new page' });
  assert.equal(rig.posted[rig.posted.length - 1].msg.text, 'new page');
  assert.equal(rig.posted.length, before + 1, 'no summary from the old page\'s drops');
});

gate('per-frame budgets are independent; a destroyed frame forwards nothing', () => {
  const rig = instrumentRig();
  const a = mockWindow(), b = mockWindow();
  rig.reg.show(a, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  rig.reg.show(b, { projectId: 'p2', url: 'http://localhost:4000', bounds: goodBounds });
  const va = rig.views[0], vb = rig.views[1];
  for (let i = 0; i < 30; i++) va.onEvent({ kind: 'console', level: 'error', text: 'storm' });
  assert.equal(rig.posted.length, 20, 'window A saturated');
  vb.onEvent({ kind: 'console', level: 'error', text: 'b speaks' });
  assert.equal(rig.posted.length, 21, 'window B\'s budget is its own');
  assert.equal(rig.posted[20].win, b);
  rig.reg.destroyFor(b);
  vb.onEvent({ kind: 'console', level: 'error', text: 'ghost' });
  assert.equal(rig.posted.length, 21, 'a straggler event after destroy is dead air');
});

// ---- the bus verbs: per-window postTo replies (the S2 discipline) ----------

gate('appFrameShow/Hide/Navigate reply to the sender\'s window ALONE; senderless posts drop', () => {
  const handlers = new Map();
  const sent = [];   // { win, type, msg }
  const stubBus = {
    on: (type, fn) => handlers.set(type, fn),
    postTo: (win, type, msg) => sent.push({ win, type, msg }),
  };
  const winA = mockWindow(), winB = mockWindow();
  const senderA = { winIs: winA }, senderB = { winIs: winB };
  const reg = appFrame.register({
    bus: stubBus,
    windowFor: (sender) => (sender && sender.winIs) || null,
    zoomOf: () => 1.25,
    createView: factory.createView,
  });
  assert.ok(handlers.has('appFrameShow') && handlers.has('appFrameHide') && handlers.has('appFrameNavigate'));

  handlers.get('appFrameShow')(
    { type: 'appFrameShow', projectId: 'p1', url: 'http://localhost:5173', bounds: { x: 0, y: 0, width: 100, height: 100 } },
    { sender: senderA });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].win, winA, 'the reply is postTo\'d at the asking window, never broadcast');
  assert.equal(sent[0].type, 'appFrameState');
  assert.equal(sent[0].msg.ok, true);
  assert.deepEqual(made[made.length - 1].boundsSet[0], { x: 0, y: 0, width: 125, height: 125 },
    'the sender\'s zoom factor scaled the bounds main-side');

  handlers.get('appFrameShow')(
    { type: 'appFrameShow', projectId: 'p2', url: 'https://evil.com/', bounds: { x: 0, y: 0, width: 9, height: 9 } },
    { sender: senderB });
  assert.equal(sent[1].win, winB);
  assert.equal(sent[1].msg.ok, false, 'a refusal still answers — with the story');
  assert.equal(reg.stateOf(winB).present, false);

  handlers.get('appFrameHide')({ type: 'appFrameHide' }, { sender: senderA });
  assert.equal(sent[2].msg.visible, false);

  // an injected post (smoke) has no sender → no host window → silent drop
  const before = sent.length;
  handlers.get('appFrameShow')({ type: 'appFrameShow', url: 'http://localhost:5173' }, {});
  handlers.get('appFrameHide')({ type: 'appFrameHide' }, undefined);
  handlers.get('appFrameNavigate')({ type: 'appFrameNavigate', url: 'http://localhost:5173' }, {});
  assert.equal(sent.length, before, 'senderless verbs neither reply nor create');
});

gate('register wires appFrameEvent onto bus.postTo at the hosting window', () => {
  const handlers = new Map();
  const sent = [];
  const stubBus = {
    on: (type, fn) => handlers.set(type, fn),
    postTo: (win, type, msg) => sent.push({ win, type, msg }),
  };
  const win = mockWindow();
  let onEv = null;
  appFrame.register({
    bus: stubBus,
    windowFor: (sender) => (sender && sender.winIs) || null,
    zoomOf: () => 1,
    createView: (w, allowedUrl, onEvent) => { onEv = onEvent; return stubView(allowedUrl); },
  });
  handlers.get('appFrameShow')(
    { type: 'appFrameShow', projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds },
    { sender: { winIs: win } });
  onEv({ kind: 'net', text: 'ERR_CONNECTION_REFUSED (-102)', url: 'http://localhost:5173/' });
  const ev = sent.find((s) => s.type === 'appFrameEvent');
  assert.ok(ev, 'the shaped event rides the appFrameEvent verb');
  assert.equal(ev.win, win, 'postTo\'d at the hosting window, never broadcast');
  assert.deepEqual(ev.msg, { kind: 'net', text: 'ERR_CONNECTION_REFUSED (-102)', url: 'http://localhost:5173/' });
});

// ---- the pick payload (C2): the A5 validator's twin ------------------------

const PREFIX = appFrame.PICK_PREFIX;
const goodPick = () => ({
  selector: '#hero > button.cta', classes: ['cta', 'big'],
  text: 'Get started', tag: 'button', html: '<button class="cta big">Get started</button>',
});
const pickLine = (payload) => PREFIX + JSON.stringify(payload);

gate('shapePickPayload admits the two known shapes, REBUILT field by field', () => {
  const pick = appFrame.shapePickPayload(pickLine({ ...goodPick(), evil: 'extra', __proto__: null }));
  assert.deepEqual(pick, { kind: 'pick', ...goodPick() }, 'known fields only, unknown keys dropped');
  assert.deepEqual(appFrame.shapePickPayload(pickLine({ cancel: true })), { kind: 'cancel' });
  assert.deepEqual(appFrame.shapePickPayload(pickLine({ ...goodPick(), classes: [] })).classes, [],
    'a class-free element is a fine pick');
});

gate('shapePickPayload fails CLOSED on every hostile vector — drop whole, never repair', () => {
  const over = (payload) => pickLine(payload);
  const hostile = [
    'no prefix at all',
    PREFIX,                                        // empty JSON
    PREFIX + 'not json',
    PREFIX + '[1,2,3]',                            // array, not object
    PREFIX + '"string"',
    PREFIX + 'null',
    over({ ...goodPick(), selector: '' }),         // empty selector
    over({ ...goodPick(), selector: 'x'.repeat(257) }),
    over({ ...goodPick(), text: 'x'.repeat(161) }),
    over({ ...goodPick(), tag: '' }),
    over({ ...goodPick(), tag: 'x'.repeat(25) }),
    over({ ...goodPick(), html: 'x'.repeat(2001) }),
    over({ ...goodPick(), classes: 'cta' }),       // not an array
    over({ ...goodPick(), classes: Array(9).fill('c') }),   // 9 > 8
    over({ ...goodPick(), classes: ['ok', 42] }),  // non-string class
    over({ ...goodPick(), classes: ['x'.repeat(65)] }),
    over({ selector: '#a', classes: [], text: '', tag: 'p' }),   // html missing
    over({ ...goodPick(), selector: 42 }),
    over({ cancel: 'true' }),                      // cancel must be literal true
    PREFIX + JSON.stringify({ ...goodPick(), html: 'x'.repeat(1999) }).slice(0, 20),  // torn JSON
    PREFIX + '{"selector":"#a","classes":[],"text":"","tag":"p","html":"' + 'x'.repeat(9000) + '"}',  // whole line over MAX_PICK_JSON
    null, undefined, 42,
  ];
  for (const line of hostile)
    assert.equal(appFrame.shapePickPayload(line), null,
      'must refuse: ' + String(line).slice(0, 60));
});

// ---- inspect + the magic-prefix routing (C2) --------------------------------

// The instrument rig plus the pick outlet — createView hands back onEvent,
// postPick records what left the pick channel.
function pickRig() {
  const rig = { t: 100000, posted: [], picks: [], views: [] };
  rig.reg = appFrame.createFrameRegistry({
    createView: (win, allowedUrl, onEvent) => {
      const v = stubView(allowedUrl); v.onEvent = onEvent; rig.views.push(v); return v;
    },
    postEvent: (win, msg) => rig.posted.push({ win, msg }),
    postPick: (win, msg) => rig.picks.push({ win, msg }),
    now: () => rig.t,
  });
  return rig;
}

gate('inspect: existing frame only, install/remove scripts through the adapter seam', () => {
  const rig = pickRig();
  const win = mockWindow();
  const miss = rig.reg.inspect(win, { on: true });
  assert.equal(miss.ok, false, 'inspect never conjures a frame — show owns creation');
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = rig.views[0];
  const on = rig.reg.inspect(win, { on: true });
  assert.equal(on.ok, true);
  assert.equal(on.inspect, true);
  assert.equal(v.scripts.length, 1);
  assert.match(v.scripts[0], /__apexInspect/, 'the install script carries the double-inject guard');
  assert.ok(v.scripts[0].includes(PREFIX), 'the install script posts with the magic prefix');
  assert.equal(rig.reg.stateOf(win).inspect, true);
  const off = rig.reg.inspect(win, { on: false });
  assert.equal(off.inspect, false);
  assert.match(v.scripts[1], /__apexInspect/, 'off runs the guarded uninstall');
  assert.equal(rig.reg.stateOf(win).inspect, false);
});

gate('an adapter without runScript refuses inspect honestly', () => {
  const reg = appFrame.createFrameRegistry({
    createView: (win, allowedUrl) => {
      const v = stubView(allowedUrl); delete v.runScript; return v;
    },
  });
  const win = mockWindow();
  reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const r = reg.inspect(win, { on: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /inspector/);
});

gate('magic-prefix routing: prefixed lines NEVER chip, unprefixed error lines chip as ever', () => {
  const rig = pickRig();
  const win = mockWindow();
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = rig.views[0];
  rig.reg.inspect(win, { on: true });
  // a plain error line still chips normally
  v.onEvent({ kind: 'console', level: 'error', text: 'boom happened' });
  assert.equal(rig.posted.length, 1);
  assert.equal(rig.picks.length, 0);
  // a valid pick parses and rides the pick outlet alone
  v.onEvent({ kind: 'console', level: 'log', text: pickLine(goodPick()) });
  assert.equal(rig.picks.length, 1);
  assert.equal(rig.picks[0].win, win, 'per-window like every frame post');
  assert.equal(rig.picks[0].msg.kind, 'pick');
  assert.equal(rig.picks[0].msg.selector, '#hero > button.cta');
  assert.equal(rig.posted.length, 1, 'a prefixed line never chips');
  // a prefixed line at ERROR level still never chips (prefix runs first)
  v.onEvent({ kind: 'console', level: 'error', text: pickLine(goodPick()) });
  assert.equal(rig.posted.length, 1);
  assert.equal(rig.picks.length, 2);
  // hostile prefixed payloads fail closed — dead air on BOTH wires
  v.onEvent({ kind: 'console', level: 'log', text: PREFIX + '{"selector":42}' });
  v.onEvent({ kind: 'console', level: 'error', text: PREFIX + 'not json' });
  assert.equal(rig.posted.length, 1);
  assert.equal(rig.picks.length, 2);
});

gate('picks only speak while inspect is on; an in-page Esc cancels AND drops the flag', () => {
  const rig = pickRig();
  const win = mockWindow();
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  const v = rig.views[0];
  // inspect off: a spoofed prefix line goes nowhere (and still never chips)
  v.onEvent({ kind: 'console', level: 'error', text: pickLine(goodPick()) });
  assert.equal(rig.picks.length, 0);
  assert.equal(rig.posted.length, 0);
  rig.reg.inspect(win, { on: true });
  v.onEvent({ kind: 'console', level: 'log', text: pickLine({ cancel: true }) });
  assert.equal(rig.picks.length, 1);
  assert.equal(rig.picks[0].msg.kind, 'cancel');
  assert.equal(rig.reg.stateOf(win).inspect, false, 'the page\'s Esc flipped the flag');
  v.onEvent({ kind: 'console', level: 'log', text: pickLine(goodPick()) });
  assert.equal(rig.picks.length, 1, 'after the cancel, picks are dead air again');
});

gate('every page replacement drops the inspect flag (the script died with the document)', () => {
  const rig = pickRig();
  const win = mockWindow();
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds });
  rig.reg.inspect(win, { on: true });
  rig.reg.navigate(win, { url: 'http://localhost:5173/' });   // the reload button
  assert.equal(rig.reg.stateOf(win).inspect, false, 'navigate resets inspect');
  rig.reg.inspect(win, { on: true });
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:4000', bounds: goodBounds });
  assert.equal(rig.reg.stateOf(win).inspect, false, 'a changed-url show resets inspect');
  // a bounds-sync re-show (same url) keeps it — nothing reloaded
  rig.reg.inspect(win, { on: true });
  rig.reg.show(win, { projectId: 'p1', url: 'http://localhost:4000', bounds: goodBounds });
  assert.equal(rig.reg.stateOf(win).inspect, true, 'a same-url bounds sync is not a page replacement');
});

gate('register wires appFrameInspect and appFramePick onto per-window postTo', () => {
  const handlers = new Map();
  const sent = [];
  const stubBus = {
    on: (type, fn) => handlers.set(type, fn),
    postTo: (win, type, msg) => sent.push({ win, type, msg }),
  };
  const win = mockWindow();
  let onEv = null;
  appFrame.register({
    bus: stubBus,
    windowFor: (sender) => (sender && sender.winIs) || null,
    zoomOf: () => 1,
    createView: (w, allowedUrl, onEvent) => { onEv = onEvent; return stubView(allowedUrl); },
  });
  assert.ok(handlers.has('appFrameInspect'));
  handlers.get('appFrameShow')(
    { type: 'appFrameShow', projectId: 'p1', url: 'http://localhost:5173', bounds: goodBounds },
    { sender: { winIs: win } });
  handlers.get('appFrameInspect')({ type: 'appFrameInspect', on: true }, { sender: { winIs: win } });
  const st = sent.find((s) => s.type === 'appFrameInspectState');
  assert.ok(st, 'the toggle answers on its own verb');
  assert.equal(st.win, win);
  assert.equal(st.msg.ok, true);
  assert.equal(st.msg.inspect, true);
  onEv({ kind: 'console', level: 'log', text: pickLine(goodPick()) });
  const pick = sent.find((s) => s.type === 'appFramePick');
  assert.ok(pick, 'the shaped pick rides the appFramePick verb');
  assert.equal(pick.win, win, 'postTo\'d at the hosting window, never broadcast');
  assert.equal(pick.msg.kind, 'pick');
  // senderless inspect (smoke) drops silently, like every frame verb
  const before = sent.length;
  handlers.get('appFrameInspect')({ type: 'appFrameInspect', on: true }, {});
  assert.equal(sent.length, before);
});

console.log('\nAPPFRAME DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
