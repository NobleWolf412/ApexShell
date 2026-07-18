// Apex — the app frame (STUDIO v2, Wave B slice B2): the user's real app,
// hosted INSIDE the studio in a main-owned Electron WebContentsView (Law 2:
// the renderer never gains node or webview powers — it only tells main WHERE
// its placeholder rectangle sits and WHEN it is visible; main owns the view,
// the URL wall, and the teardown).
//
// Electron-free on purpose (the studioWindow.js precedent): the URL allowlist,
// bounds sanitation, the per-window registry, and the show/hide/navigate/
// destroy semantics all live here so test/appframe-drill.js proves them
// hermetically; main.js supplies the Electron shell as the `createView`
// factory (WebContentsView + window-open deny + navigation confinement) and
// the `windowFor`/`zoomOf` seams around ctx.sender.
//
// ONE view per host window, keyed by the BrowserWindow itself: the docked
// shell and the detached studio window are independent hosts (S2 — both may
// preview at once; each renderer's posts land on its own window via
// BrowserWindow.fromWebContents(ctx.sender)). Hide keeps the view alive —
// a hide is a tab/step flip, and reloading the user's app on every flip
// would throw away its in-page state; only a window's death destroys.
//
// Slice B3 adds the instruments: the hosted page's error-level console lines
// and failed loads forward to the renderer as capped, structured, RATE-BOUND
// events. The same split holds — shaping, caps, the per-frame rate gate, and
// reset-on-navigate are all pure logic here (drilled); main.js's factory
// contributes exactly two thin webContents listeners feeding raw events in.
//
// Slice C2 adds the inspect seam: inspect(win, on) injects a picker overlay
// into the HOSTED page (executeJavaScript via the adapter's runScript — the
// registry itself stays Electron-free) and the picks ride BACK on the same
// console wire the B3 instruments use, keyed by a magic prefix. The routing
// order is the drilled contract: prefix first (a prefixed line NEVER chips,
// valid or not), THEN the error-level chip gate — which moved here from the
// shell factory for exactly that reason (the factory now forwards every
// console line with its level; the filter that decides what a line IS must
// live where the drill can prove it). shapePickPayload is the A5
// validatePickMessage twin: caps, known fields rebuilt, fail-closed — the
// hosted page can console.log ANYTHING, so a prefixed payload is hostile
// until proven shaped.
'use strict';

const MAX_URL = 2048;         // a dev-server URL is short; anything huge is hostile
const BOUNDS_CAP = 20000;     // px — beyond any real monitor wall; caps a hostile post
const MAX_EVENT_TEXT = 300;   // one console line tells its story in this much
const MAX_EVENT_URL = 200;
const EVENT_RATE = 20;        // forwarded events per frame per second — beyond is a storm
const EVENT_WINDOW_MS = 1000;

// ---- the pick channel (C2) -------------------------------------------------
// The injected picker posts console.log(PICK_PREFIX + JSON) — no debugger API,
// no second wire: the B3 console-message listener already flows to main. The
// caps twin lib/mockup.js's A5 pick-message numbers (selector/text) plus the
// picker-capture extras the C2 brief names (tag, classes, an outerHTML slice
// for data-source hints). Oversized fields DROP the whole payload — the
// injected script slices before posting, so anything over a cap was not our
// script talking.
const PICK_PREFIX = '[apex-pick]';
const MAX_PICK_JSON = 8 * 1024;   // the whole JSON line — fields sum well under this
const MAX_PICK_SELECTOR = 256;
const MAX_PICK_TEXT = 160;
const MAX_PICK_TAG = 24;
const MAX_PICK_CLASSES = 8;
const MAX_PICK_CLASS_CHARS = 64;
const MAX_PICK_HTML = 2000;

// ---- the URL wall ----------------------------------------------------------
// The frame loads ONLY http://localhost:<port> or http://127.0.0.1:<port>
// (the port comes from the project's B1 server state, but the SEAM is the
// authority — a renderer post naming any other origin refuses). WHATWG URL
// does the parsing so userinfo spoofs (http://localhost:3000@evil.com puts
// evil.com in .hostname) and case/percent tricks land normalized before the
// checks. An explicit numeric port is REQUIRED: a dev server always has one,
// and ":80 implied" shapes are exactly the ambiguity the wall exists to kill.
function validateFrameUrl(url) {
  if (typeof url !== 'string' || !url || url.length > MAX_URL) return null;
  let u;
  try { u = new URL(url); } catch { return null; }   // relative/garbage/oversized port
  if (u.protocol !== 'http:') return null;
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null;
  if (!/^[0-9]+$/.test(u.port)) return null;         // empty (implied 80) refuses
  const port = Number(u.port);
  if (port < 1 || port > 65535) return null;
  if (u.username || u.password) return null;         // credentials never belong here
  return u.toString();                               // normalized — the string the view loads
}

// will-navigate confinement: a target is allowed only if it (a) passes the
// wall itself and (b) shares the frame's current protocol+host+port — the
// user's SPA may route freely, but a link off localhost (or to another
// port's server) is denied at the seam.
function sameFrameOrigin(allowedUrl, targetUrl) {
  const a = validateFrameUrl(allowedUrl);
  const t = validateFrameUrl(targetUrl);
  if (!a || !t) return false;
  const ua = new URL(a), ut = new URL(t);
  return ua.protocol === ut.protocol && ua.hostname === ut.hostname && ua.port === ut.port;
}

// ---- bounds sanitation -----------------------------------------------------
// The renderer measures its placeholder with getBoundingClientRect (CSS px);
// setBounds wants integer DIPs. `zoom` is the sender's webFrame zoom factor
// (Ctrl+scroll zoom, shell.js) — CSS px scale UP with it, so DIP = css × zoom.
// Finite-or-refuse, negative clamps to 0 (a placeholder half-scrolled off the
// top measures negative — clamp, don't drop the frame), capped both ways.
function sanitizeBounds(bounds, zoom) {
  if (!bounds || typeof bounds !== 'object') return null;
  const factor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const out = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    const v = bounds[key];   // numbers or nothing — no string coercion at a seam
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[key] = Math.min(BOUNDS_CAP, Math.max(0, Math.round(v * factor)));
  }
  if (!out.width || !out.height) return null;   // a zero box is a hide, not a show
  return out;
}

// ---- instrument events (B3) ------------------------------------------------
// The hosted page is UNTRUSTED input on this wire too: only two kinds exist
// ('console' = an error-level console line, 'net' = a failed load), text/url
// are hard-capped, and any other shape drops silently — a hostile page must
// not be able to smuggle arbitrary payloads at the studio through its own
// error stream. Shaping lives here (Electron-free) so the drill proves the
// caps; the listeners are two thin lines in main.js's createView factory.
function shapeFrameEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'console' && raw.kind !== 'net') return null;
  if (typeof raw.text !== 'string' || !raw.text) return null;
  const out = { kind: raw.kind, text: raw.text.slice(0, MAX_EVENT_TEXT) };
  if (typeof raw.url === 'string' && raw.url) out.url = raw.url.slice(0, MAX_EVENT_URL);
  return out;
}

// ---- the pick payload (C2) ---------------------------------------------------
// The A5 validatePickMessage twin, applied to a console line instead of a
// postMessage: strip the prefix, bound the JSON, parse, then REBUILD known
// fields only (never a spread — unknown keys drop by construction). Total and
// fail-closed: any wrong type, any over-cap string, any non-string class
// refuses the WHOLE payload (drop whole, never repair — the mockup.js rule).
// Two shapes exist and nothing else ever leaves here: { kind: 'cancel' }
// (Esc in the page) and the full { kind: 'pick', … } capture.
function shapePickPayload(line) {
  if (typeof line !== 'string' || !line.startsWith(PICK_PREFIX)) return null;
  const json = line.slice(PICK_PREFIX.length);
  if (!json || json.length > MAX_PICK_JSON) return null;
  let raw;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.cancel === true) return { kind: 'cancel' };
  if (typeof raw.selector !== 'string' || !raw.selector.trim() ||
      raw.selector.length > MAX_PICK_SELECTOR) return null;
  if (typeof raw.text !== 'string' || raw.text.length > MAX_PICK_TEXT) return null;
  if (typeof raw.tag !== 'string' || !raw.tag.trim() || raw.tag.length > MAX_PICK_TAG) return null;
  if (typeof raw.html !== 'string' || raw.html.length > MAX_PICK_HTML) return null;
  if (!Array.isArray(raw.classes) || raw.classes.length > MAX_PICK_CLASSES) return null;
  const classes = [];
  for (const c of raw.classes) {
    if (typeof c !== 'string' || c.length > MAX_PICK_CLASS_CHARS) return null;
    classes.push(c);
  }
  return {
    kind: 'pick',
    selector: raw.selector,
    classes,
    text: raw.text,
    tag: raw.tag,
    html: raw.html,
  };
}

// ---- the injected picker (C2) ------------------------------------------------
// The A5 overlay pattern applied to the app frame's UNTRUSTED page: one fixed
// pointer-events-none highlight box, hover tracks, a click captures the
// element and posts it via console.log with the magic prefix, Esc uninstalls
// and posts a cancel. Idempotent by guard (window.__apexInspect — a second
// install is a no-op) and fully removable (off() detaches every listener,
// removes the box, deletes the guard); a navigate needs no removal at all —
// the script dies with the document, and the registry drops its inspect flag
// at the same trigger so the two truths never diverge. The script mutates
// nothing in the page beyond appending the overlay box, and it speaks ONLY
// the two prefixed shapes shapePickPayload admits.
const INSPECT_INSTALL_JS = [
  '(function () {',
  "  'use strict';",
  '  // Apex STUDIO boom-change inspector (slice C2) — injected by',
  '  // main/appFrame.js inspect(); posts ONLY prefixed pick/cancel lines.',
  '  if (window.__apexInspect) return;   // double-inject guard',
  '  var box = document.createElement("div");',
  '  box.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;" +',
  '    "z-index:2147483647;border:2px solid #7aa2ff;border-radius:2px;" +',
  '    "background:rgba(122,162,255,0.15);display:none;";',
  '  document.documentElement.appendChild(box);',
  '  function place(el) {',
  '    if (!el || el === box || el === document.documentElement || el === document.body) {',
  '      box.style.display = "none"; return;',
  '    }',
  '    var r = el.getBoundingClientRect();',
  '    box.style.display = "block";',
  '    box.style.left = r.left + "px"; box.style.top = r.top + "px";',
  '    box.style.width = r.width + "px"; box.style.height = r.height + "px";',
  '  }',
  '  // Short selector: id wins; else a tag.class chain (at most 4 hops, 2',
  '  // classes each); a class-free hop falls back to :nth-of-type. A locating',
  '  // HINT for the resolver, not a query — capped, best effort (the A5 shape).',
  '  function selectorFor(el) {',
  '    if (el.id) return "#" + el.id;',
  '    var parts = [];',
  '    var node = el;',
  '    while (node && node.nodeType === 1 && node !== document.body && parts.length < 4) {',
  '      var part = node.tagName.toLowerCase();',
  '      var cls = (typeof node.className === "string" ? node.className : "")',
  '        .trim().split(/\\s+/).filter(Boolean);',
  '      if (cls.length) { part += "." + cls.slice(0, 2).join("."); }',
  '      else {',
  '        var i = 1, sib = node;',
  '        while ((sib = sib.previousElementSibling)) { if (sib.tagName === node.tagName) i += 1; }',
  '        part += ":nth-of-type(" + i + ")";',
  '      }',
  '      parts.unshift(part);',
  '      node = node.parentElement;',
  '    }',
  '    return parts.join(" > ");',
  '  }',
  '  function post(payload) { console.log(' + JSON.stringify(PICK_PREFIX) + ' + JSON.stringify(payload)); }',
  '  function onMove(e) { place(e.target); }',
  '  function onLeave() { box.style.display = "none"; }',
  '  function onClick(e) {',
  '    e.preventDefault(); e.stopPropagation();',
  '    var el = e.target;',
  '    if (!el || el === box || el.nodeType !== 1) return;',
  '    var cls = (typeof el.className === "string" ? el.className : "")',
  '      .trim().split(/\\s+/).filter(Boolean).slice(0, ' + MAX_PICK_CLASSES + ')',
  '      .map(function (c) { return c.slice(0, ' + MAX_PICK_CLASS_CHARS + '); });',
  '    post({',
  '      selector: selectorFor(el).slice(0, ' + MAX_PICK_SELECTOR + '),',
  '      classes: cls,',
  '      text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, ' + MAX_PICK_TEXT + '),',
  '      tag: el.tagName.toLowerCase().slice(0, ' + MAX_PICK_TAG + '),',
  '      html: (el.outerHTML || "").slice(0, ' + MAX_PICK_HTML + ')',
  '    });',
  '  }',
  '  function off() {',
  '    document.removeEventListener("mousemove", onMove, true);',
  '    document.removeEventListener("mouseleave", onLeave, true);',
  '    document.removeEventListener("click", onClick, true);',
  '    document.removeEventListener("keydown", onKey, true);',
  '    if (box.parentNode) box.parentNode.removeChild(box);',
  '    delete window.__apexInspect;',
  '  }',
  '  function onKey(e) { if (e.key === "Escape") { off(); post({ cancel: true }); } }',
  '  document.addEventListener("mousemove", onMove, true);',
  '  document.addEventListener("mouseleave", onLeave, true);',
  '  document.addEventListener("click", onClick, true);',
  '  document.addEventListener("keydown", onKey, true);',
  '  window.__apexInspect = { off: off };',
  '})(); true;',
].join('\n');

// The uninstall is one guarded call — safe on a page that never got the
// install (a reload since inspect-on), safe twice. Ends in a serializable
// literal so executeJavaScript never trips on cloning a DOM return value.
const INSPECT_REMOVE_JS =
  'window.__apexInspect && window.__apexInspect.off && window.__apexInspect.off(); true;';

// ---- the per-window registry -----------------------------------------------
// createFrameRegistry({ createView, postEvent?, postPick?, now? }) → { show,
// hide, navigate, inspect, stateOf, destroyFor, destroyAll }. `createView(win,
// allowedUrl, onEvent)` returns an adapter {loadURL, setBounds, setVisible,
// destroy, runScript?} — Electron's WebContentsView in production, a recording
// stub in the drill (runScript is C2's one adapter addition: executeJavaScript
// on the hosted page; an adapter without it simply cannot inspect, refused
// honestly). `allowedUrl` is a live accessor onto the entry's current URL: the
// shell's will-navigate guard reads it, so confinement follows every navigate
// without the shell holding state. `onEvent(raw)` (B3) is the raw instrument
// inlet: the shell's listeners call it with EVERY console line (level along
// for the ride since C2), the gate below routes/shapes/rate-bounds, and
// survivors leave through `postEvent(win, shaped)`; shaped picks leave through
// `postPick(win, pick)`. `now` is the gate's clock — injectable so the drill
// owns time.
function createFrameRegistry({ createView, postEvent, postPick, now }) {
  const entries = new Map();   // win -> { view, url, visible, bounds, projectId, ev, inspect }

  const clock = typeof now === 'function' ? now : Date.now;
  const say = typeof postEvent === 'function' ? postEvent : () => {};
  const pickOut = typeof postPick === 'function' ? postPick : () => {};
  const dead = (win) => !win || (typeof win.isDestroyed === 'function' && win.isDestroyed());
  const refuse = (projectId, error) => ({ ok: false, projectId: projectId || null, error });

  // the per-frame rate gate: at most EVENT_RATE forwarded per fixed one-second
  // window; overflow counts silently and the FIRST event past the boundary
  // flushes one honest '…dropped N' summary (kind:'drop' — never costumed as a
  // console line) before the fresh window opens. Event-driven on purpose: no
  // timers in an Electron-free module, so a storm that ends silently holds its
  // tail count until the next event — or a navigate/reload wipes it with the
  // chips (a stale count from the old page would lie about the new one).
  const freshGate = () => ({ winStart: 0, sent: 0, dropped: 0 });
  function deliver(win, e, raw) {
    if (entries.get(win) !== e) return;              // the frame died under it
    // C2 — the pick channel, filtered FIRST: a console line opening with the
    // magic prefix belongs to the inspector wire and NEVER chips, whether it
    // parses or not (a hostile page spoofing the prefix earns dead air, not a
    // costumed chip). Picks only speak while inspect is on — off, the prefix
    // is still stripped from the chip flow but goes nowhere. An in-page Esc
    // (kind 'cancel') flips the flag here so the toggle truth never lags the
    // page's own uninstall.
    if (raw && raw.kind === 'console' && typeof raw.text === 'string' &&
        raw.text.startsWith(PICK_PREFIX)) {
      if (!e.inspect) return;
      const pick = shapePickPayload(raw.text);
      if (!pick) return;                             // hostile payload — fail closed
      if (pick.kind === 'cancel') e.inspect = false;
      pickOut(win, pick);
      return;
    }
    // The B3 error-level gate, AFTER the prefix filter (it moved here from the
    // shell factory so that ordering is drilled, not assumed): the picker logs
    // at plain log level, but only error lines ever chip.
    if (raw && raw.kind === 'console' && raw.level !== 'error') return;
    const shaped = shapeFrameEvent(raw);
    if (!shaped) return;                             // junk drops silently
    const t = clock();
    if (t - e.ev.winStart >= EVENT_WINDOW_MS) {
      if (e.ev.dropped > 0)
        say(win, { kind: 'drop',
          text: '…dropped ' + e.ev.dropped + ' frame events (max ' + EVENT_RATE + '/s)' });
      e.ev = { winStart: t, sent: 0, dropped: 0 };
    }
    if (e.ev.sent < EVENT_RATE) { e.ev.sent++; say(win, shaped); }
    else e.ev.dropped++;
  }

  // show doubles as the bounds sync: the renderer re-posts appFrameShow with
  // fresh bounds on every layout change, and only a CHANGED url reloads.
  function show(win, msg, zoom) {
    const m = msg || {};
    if (dead(win)) return refuse(m.projectId, 'That window is gone.');
    const url = validateFrameUrl(m.url);
    if (!url) return refuse(m.projectId,
      'The app frame only loads http://localhost:<port> or http://127.0.0.1:<port>.');
    const bounds = sanitizeBounds(m.bounds, zoom);
    if (!bounds) return refuse(m.projectId, 'The app frame needs a real on-screen rectangle.');
    let e = entries.get(win);
    if (!e) {
      e = { view: null, url: null, visible: false, bounds: null, projectId: null,
            ev: freshGate(), inspect: false };
      e.view = createView(win, () => e.url, (raw) => deliver(win, e, raw));
      entries.set(win, e);
      // the window's death is the ONE destroy trigger (hide never tears down)
      if (typeof win.once === 'function') win.once('closed', () => destroyFor(win));
    }
    e.projectId = m.projectId || null;
    // a CHANGED url reloads — a fresh page earns a fresh event budget, and the
    // inspector died with the old document, so the flag follows it (C2)
    if (e.url !== url) { e.url = url; e.view.loadURL(url); e.ev = freshGate(); e.inspect = false; }
    e.bounds = bounds;
    e.view.setBounds(bounds);
    if (!e.visible) { e.visible = true; e.view.setVisible(true); }
    return { ok: true, projectId: e.projectId, url: e.url, visible: true };
  }

  // hide = the step/pane/tab went away: view and URL survive so the next show
  // is a reveal, not a reload. Hiding what was never shown is a quiet yes.
  function hide(win) {
    const e = entries.get(win);
    if (!e) return { ok: true, projectId: null, visible: false };
    if (e.visible) { e.visible = false; e.view.setVisible(false); }
    return { ok: true, projectId: e.projectId, visible: false };
  }

  // navigate = reload/point the EXISTING frame (same-url navigate is the
  // reload button); it never conjures a view — show owns creation, because
  // only show carries bounds.
  function navigate(win, msg) {
    const m = msg || {};
    if (dead(win)) return refuse(m.projectId, 'That window is gone.');
    const e = entries.get(win);
    if (!e) return refuse(m.projectId, 'Show the app frame before navigating it.');
    const url = validateFrameUrl(m.url);
    if (!url) return refuse(e.projectId,
      'The app frame only loads http://localhost:<port> or http://127.0.0.1:<port>.');
    e.url = url;
    e.view.loadURL(url);
    // reset-on-navigate: the renderer's chips clear at the same trigger, so a
    // saturated budget or a pending drop count must not haunt the new page —
    // and the injected inspector died with the document (C2), so its flag
    // resets here too rather than lying about a picker that no longer exists
    e.ev = freshGate();
    e.inspect = false;
    return { ok: true, projectId: e.projectId, url: e.url, visible: e.visible };
  }

  // C2 — inspect mode: on injects the picker (idempotent — the script's own
  // window.__apexInspect guard makes a double install a no-op), off runs the
  // guarded uninstall. Existing-frame-only like navigate (show owns creation),
  // and honest about an adapter that cannot run scripts. The flag is the
  // registry's truth for the pick channel above: picks flow only while it is
  // set, and every page replacement (navigate, changed-url show) clears it.
  function inspect(win, msg) {
    const m = msg || {};
    if (dead(win)) return refuse(m.projectId, 'That window is gone.');
    const e = entries.get(win);
    if (!e) return refuse(m.projectId, 'Show the app frame before inspecting it.');
    if (typeof e.view.runScript !== 'function')
      return refuse(e.projectId, 'This frame cannot host the inspector.');
    e.inspect = m.on === true;
    e.view.runScript(e.inspect ? INSPECT_INSTALL_JS : INSPECT_REMOVE_JS);
    return { ok: true, projectId: e.projectId, inspect: e.inspect };
  }

  function destroyFor(win) {
    const e = entries.get(win);
    if (!e) return false;
    entries.delete(win);
    try { e.view.destroy(); } catch { /* window teardown already took it */ }
    return true;
  }

  function destroyAll() { for (const win of [...entries.keys()]) destroyFor(win); }

  // drill/debug introspection — never part of any bus payload
  function stateOf(win) {
    const e = entries.get(win);
    return e
      ? { present: true, url: e.url, visible: e.visible, bounds: e.bounds,
          projectId: e.projectId, inspect: e.inspect }
      : { present: false };
  }

  return { show, hide, navigate, inspect, destroyFor, destroyAll, stateOf };
}

// ---- the bus verbs ---------------------------------------------------------
// register({ bus, windowFor, zoomOf, createView }) wires appFrameShow/Hide/
// Navigate. Replies ride bus.postTo (the S2 discipline): the answering truth
// is per-window, and a broadcast would hand window A's frame state to window
// B. A senderless post (bus.inject — smoke) has no host window and drops
// silently: nothing to attach a view to, nothing to answer. That is also the
// fail-soft contract with the studio extension: on a core without this
// module the posts land as the bus's unhandled-type warning and the studio
// simply never shows a frame.
function register({ bus, windowFor, zoomOf, createView }) {
  const registry = createFrameRegistry({
    createView,
    // instrument events (B3) ride per-window postTo like every frame reply —
    // the hosted page's noise belongs to the window that hosts it, alone
    postEvent: (win, msg) => bus.postTo(win, 'appFrameEvent', msg),
    // picks (C2) ride the same per-window discipline: a click in THIS
    // window's frame is this window's boom card, nobody else's
    postPick: (win, msg) => bus.postTo(win, 'appFramePick', msg),
  });
  const host = (ctx) => windowFor(ctx && ctx.sender);

  bus.on('appFrameShow', (m, ctx) => {
    const win = host(ctx);
    if (!win) return;
    bus.postTo(win, 'appFrameState', registry.show(win, m, zoomOf ? zoomOf(ctx.sender) : 1));
  });
  bus.on('appFrameHide', (m, ctx) => {
    const win = host(ctx);
    if (!win) return;
    bus.postTo(win, 'appFrameState', registry.hide(win));
  });
  bus.on('appFrameNavigate', (m, ctx) => {
    const win = host(ctx);
    if (!win) return;
    bus.postTo(win, 'appFrameState', registry.navigate(win, m));
  });
  // C2 — the strip toggle's verb. Its OWN reply type (not appFrameState:
  // the renderer's frame-state handler surfaces errors in the RUN drawer,
  // and an inspect refusal belongs to the inspect toggle, not the server).
  bus.on('appFrameInspect', (m, ctx) => {
    const win = host(ctx);
    if (!win) return;
    bus.postTo(win, 'appFrameInspectState', registry.inspect(win, m));
  });

  return registry;   // main.js holds it for the quit-time destroyAll backstop
}

module.exports = { validateFrameUrl, sameFrameOrigin, sanitizeBounds, shapeFrameEvent,
  PICK_PREFIX, shapePickPayload, createFrameRegistry, register };
