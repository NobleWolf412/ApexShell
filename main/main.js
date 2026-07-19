// Apex — main process. Window lifecycle + module registration, no business
// logic: theme owns colors, monitors owns the data plane, bus owns messaging.
// Renderer is sandboxed; the preload contextBridge is the only door (plan §3).
'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const bus = require('./bus');
const studioWindow = require('./studioWindow');
const appFrame = require('./appFrame');
const theme = require('./theme');
const monitors = require('./monitors');
const seats = require('./seats');
const tasks = require('./tasks');
const auditWatch = require('./audit');
const consult = require('./consult');
const skills = require('./skills');
const terminal = require('./terminal');
const artifacts = require('./artifacts');
const extensions = require('./extensions');
const liveUpdate = require('./liveUpdate');
const usage = require('./usage');
const mobile = require('./mobile');
const { normalizeExternalUrl } = require('./externalUrl');

// apex:// serves local files to the working view's iframe (HTML artifacts) —
// our own resource policy, replacing VS Code's localResourceRoots wall.
// Must be declared before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'apex', privileges: { standard: true, supportFetchAPI: true } },
]);

// Windows taskbar identity: without this, pinned/grouped windows show as "Electron".
app.setAppUserModelId('Apex');

// Smoke runs live in their own userData so they NEVER contend with the real
// window — a smoke bouncing off the operator's instance-lock exits 0 having tested
// nothing (the 2026-07-12 false-green: every "pass" while Apex was open was
// a bounce).
if (process.env.APEX_SMOKE === '1')
  app.setPath('userData', path.join(require('os').tmpdir(), 'apex-smoke-userdata'));

let win = null;
let quitting = false;
let closeApproved = false;
let closePending = 0;
let closeTimer = null;
// S2 lifecycle: set the instant the MAIN window has truly closed, before the
// studio cascade-closes — the studio's close-time preference write reads it
// to record "open at quit" instead of "user closed me".
let studioFollowsQuit = false;

app.on('before-quit', () => {
  // app.quit() is already an explicit main-process decision (smoke, restart,
  // window-all-closed). It must never wait on a renderer close gate.
  quitting = true;
  clearTimeout(closeTimer);
  closeTimer = null;
  closePending = 0;
});

// One Apex. A second launch focuses the existing window instead.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

// The brand icon ships in-app (R32 — the shell must not reach outside its own
// folder). Fall back to no icon rather than crashing.
function findIcon() {
  const ico = path.resolve(__dirname, '..', 'assets', 'apex.ico');
  return fs.existsSync(ico) ? ico : undefined;
}

// Lifecycle log — GUI launches have no visible console; a window that
// never appears must leave a trail (2026-07-12: process alive, no window).
// Module-scoped since Wave S: both shell windows write the same trail.
const logDir = path.join(__dirname, '..', 'state', 'logs');
try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* exists */ }
const lifeLog = (line) => {
  try {
    fs.appendFileSync(path.join(logDir, 'main-' + new Date().toISOString().slice(0, 10) + '.log'),
      new Date().toISOString().slice(11, 19) + ' ' + line + '\n');
  } catch { /* never block on logging */ }
};

// Navigation lock (external audit H1): every shell window's top frame carries
// preload.js, so nothing may navigate it off the initial loadFile — CSP does
// not stop navigation. A drop-in extension's renderer script (vetted only by
// CSP 'self') could otherwise point the webContents at a remote origin.
// Module-scoped since Wave S: the studio window carries the same preload and
// gets the exact same lock.
const guardNav = (e, url) => {
  // the app's own index.html (initial + reloads), and our confined+CSP-locked
  // apex:// artifact protocol — everything else is denied
  if (/^(file|apex):\/\//i.test(url)) return;
  e.preventDefault();
  lifeLog(`blocked navigation to ${url}`);
};

// Keep a renderer's window controls truthful whichever side changes state
// (drag-to-top maximize, F11-class fullscreen, our own buttons). Per-window
// since Wave S S2: each window's own maximize/fullscreen events post to that
// window ALONE (bus.postTo) — a broadcast would flip the OTHER window's
// caption glyphs to a state it isn't in.
function postWinState(w) {
  if (!w || w.isDestroyed()) return;
  bus.postTo(w, 'winState', { maximized: w.isMaximized(), fullscreen: w.isFullScreen() });
}
function bindWinState(w) {
  for (const evt of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'])
    w.on(evt, () => postWinState(w));
}

function clearCloseRequest() {
  clearTimeout(closeTimer);
  closeTimer = null;
  closePending = 0;
}

function closeForReal() {
  if (!win || win.isDestroyed()) return;
  clearCloseRequest();
  closeApproved = true;
  win.close();
}

function askRendererToClose() {
  if (!win || win.isDestroyed() || closePending) return;
  closePending = Date.now();
  const requestId = closePending;
  bus.post('closeRequested', { requestId });
  // The renderer owns the seat-aware decision, but never owns our ability to
  // exit. A crashed, hung, or not-yet-loaded renderer fails open.
  closeTimer = setTimeout(() => {
    if (closePending === requestId) closeForReal();
  }, 1500);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 400,
    frame: false,                 // we own every pixel — our own title bar
    backgroundColor: theme.load().bg,   // painted before load (no white flash)
    icon: findIcon(),
    show: false,                  // show only when ready — no unstyled flash
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  bus.addWindow(win);
  theme.register();
  monitors.register();
  seats.register();
  extensions.register({ seats: seats.extensionApi, usage: { claudeSnapshot: usage.claudeSnapshot },
    // A4: the served-file gate's registration seam (main/artifacts.js) — the
    // studio's main half registers a draft's mockups dir so the SEE step's
    // sandboxed iframe can load them through apex://.
    serve: { registerDir: artifacts.registerServedDir, revokeDir: artifacts.revokeServedDir } });
  tasks.register();   // after extensions — routes validate against live presets
  auditWatch.register();   // live-auditor watch manager (opt-in per seat)
  consult.register();      // Consult → : a disposable second opinion on the current chat
  skills.register();       // Claude Code skills surface (list / create / promote recipes)
  terminal.register({ cwd: seats.defaultCwd });
  liveUpdate.register(() => win);
  liveUpdate.consumeRestore();
  usage.register();
  mobile.register();   // the tailnet-only phone face (no Tailscale = no server)
  // The working view's ↗ — open an artifact with the system app. Absolute
  // local paths only; never URLs (no drive-by external opens from seat text).
  bus.on('openPath', (m) => {
    if (m.path && path.isAbsolute(m.path) && fs.existsSync(m.path)) shell.openPath(m.path);
  });
  // Assistant prose is untrusted. Rendering a URL never opens it; only this
  // explicit-click event crosses to the OS, and only for plain HTTP(S).
  bus.on('openUrl', (m) => {
    const url = normalizeExternalUrl(m && m.url);
    if (url) shell.openExternal(url).catch(() => {});
  });

  lifeLog('createWindow');
  // Navigation lock (module-scoped guardNav above): deny new windows outright;
  // allow ONLY the initial file:// load, block every other navigation.
  // External links still open via externalUrl.js (shell.openExternal).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', guardNav);
  win.webContents.on('will-redirect', guardNav);
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    lifeLog(`did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on('render-process-gone', (_e, details) =>
    lifeLog(`render-process-gone ${details.reason} exitCode=${details.exitCode}`));
  win.webContents.on('did-finish-load', () => lifeLog('did-finish-load'));

  // Alt+F4, taskbar close, and our caption ✕ all arrive here. The approved
  // re-close is the one pass through that does not ask the renderer again.
  win.on('close', (event) => {
    if (quitting || closeApproved) {
      closeApproved = false;
      return;
    }
    event.preventDefault();
    askRendererToClose();
  });

  // smoke eyes: #dock=<tab> opens a dock pane, #top=quarter|full opens the
  // tracker blind — screenshots can show real content, not just the stage
  const hashParts = [];
  if (process.env.APEX_SMOKE_DOCK) hashParts.push('dock=' + process.env.APEX_SMOKE_DOCK);
  if (process.env.APEX_SMOKE_TOP) hashParts.push('top=' + process.env.APEX_SMOKE_TOP);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'),
    hashParts.length ? { hash: hashParts.join('&') } : undefined);
  // open maximized (the operator) — maximize() also shows the window
  win.once('ready-to-show', () => { lifeLog('ready-to-show'); win.maximize(); });
  // backstop: never let a missed ready-to-show leave the window hidden forever
  // (2026-07-12: it stopped firing on this box entirely — the window loaded
  // and sat invisible; every desktop click looked dead)
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      lifeLog('BACKSTOP show (ready-to-show never fired)');
      win.maximize();
    }
  }, 1500);
  win.on('closed', () => {
    clearCloseRequest();
    closeApproved = false;
    win = null;
    // LIFECYCLE DECISION (Wave S S2, argued): when the MAIN window truly
    // closes, the app quits — so an open studio window must follow it down.
    // The studio is a companion surface, not a standalone app: the seats it
    // could still reach live in main-process state that the MAIN window's
    // seat-aware close gate guards, and by this line that gate has already
    // said yes (or failed open). A surviving headless studio would keep the
    // app alive with the gate's protected state and no gate — closing it
    // here lets window-all-closed fire and quit exactly as it always did.
    studioFollowsQuit = true;
    studioWindow.close();
  });

  bindWinState(win);
}

// A freshly (re)loaded renderer starts with the default glyphs — hand it the
// real state (the window opens maximized, so the button lied until the first
// toggle; the operator, 2026-07-14). Sender-aware since S2: each readying
// window gets ITS OWN truth (the ready dispatch already scopes bus.post to
// the readying window); an injected ready (smoke — no sender) falls back to
// the main window and broadcasts, which single-window smoke can't tell apart.
bus.on('ready', (m, ctx) => {
  const w = (ctx && ctx.sender && BrowserWindow.fromWebContents(ctx.sender)) || win;
  if (w && !w.isDestroyed())
    bus.post('winState', { maximized: w.isMaximized(), fullscreen: w.isFullScreen() });
});

// STUDIO v2 Wave S: the detached studio window — same preload, same
// webPreferences, same renderer as the main window; '#apexWindow=studio' is
// the boot flag renderer/shell.js reads for studio mode (S2). Opened by the
// toggle verb below or the persisted reopen preference — never by smoke.
// Bounds + the open-at-quit flag persist through studioWindow.loadState/
// saveState (state/studio-window.json): save normal bounds on close, restore
// on open — second-monitor placement sticks.
function createStudioWindow() {
  const saved = studioWindow.loadState();
  const sized = Number.isFinite(saved.width) && Number.isFinite(saved.height);
  const opts = {
    width: sized ? saved.width : 1280,
    height: sized ? saved.height : 860,
    minWidth: 640,
    minHeight: 400,
    frame: false,                 // we own every pixel — our own title bar
    backgroundColor: theme.load().bg,
    icon: findIcon(),
    show: false,
    webPreferences: {             // EXACTLY the main window's — one door, same locks
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  };
  // x may be negative (a monitor left of the primary) — Number.isFinite is the test
  if (sized && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { opts.x = saved.x; opts.y = saved.y; }
  opts.title = 'APEX STUDIO';   // pre-load taskbar identity; shell.js re-asserts it
  const sw = new BrowserWindow(opts);
  // the reopen preference (S2): open is recorded the moment the window
  // exists, cleared on a USER close (see the 'close' handler below)
  studioWindow.saveState({ open: true });
  bus.addWindow(sw);              // the bus's destroyed-hook unregisters it on close
  lifeLog('createStudioWindow');
  sw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  sw.webContents.on('will-navigate', guardNav);
  sw.webContents.on('will-redirect', guardNav);
  sw.webContents.on('did-fail-load', (_e, code, desc, url) =>
    lifeLog(`studio did-fail-load ${code} ${desc} ${url}`));
  sw.webContents.on('render-process-gone', (_e, details) =>
    lifeLog(`studio render-process-gone ${details.reason} exitCode=${details.exitCode}`));
  sw.webContents.on('did-finish-load', () => lifeLog('studio did-finish-load'));
  bindWinState(sw);   // per-window caption glyph truth (S2)
  sw.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { hash: 'apexWindow=studio' });
  sw.once('ready-to-show', () => { lifeLog('studio ready-to-show'); sw.show(); });
  // same backstop as the main window (2026-07-12: ready-to-show stopped
  // firing on this box entirely) — a studio window must never sit invisible
  setTimeout(() => {
    if (!sw.isDestroyed() && !sw.isVisible()) {
      lifeLog('BACKSTOP show (studio ready-to-show never fired)');
      sw.show();
    }
  }, 1500);
  // No close gate here: closing the detached studio is just closing a window
  // (the seat-aware quit handshake belongs to the main window alone).
  // The close-time write records bounds AND the reopen preference: a USER
  // close means "don't come back" (open:false); a close because the app is
  // going down (before-quit, or the main-closed cascade) keeps open:true so
  // the next launch restores the two-monitor arrangement.
  sw.on('close', () => {
    studioWindow.saveState(Object.assign(sw.getNormalBounds(),
      { open: quitting || studioFollowsQuit }));
  });
  return sw;
}

// The studioWindowState truth: one notifier, fed to every toggle() call, so
// open/closed both broadcast the same verb — the bus already dropped a dying
// window via its destroyed hook, so the closed post reaches only survivors.
const postStudioState = (open) => bus.post('studioWindowState', { open });

// renderer→main: open the detached studio if closed, focus it if open
// (studioWindow.js owns the drilled open-or-focus truth).
bus.on('studioWindowToggle', () => studioWindow.toggle(createStudioWindow, postStudioState));
// A late-registering renderer (the studio extension loads after 'ready'
// replies land) asks for the current affordance state; the answer broadcasts,
// which is harmless — every window holds the same truth.
bus.on('studioWindowGet', () => postStudioState(studioWindow.isOpen()));

// STUDIO v2 Wave B (B2): the app frame — the user's real dev-server app in a
// main-owned WebContentsView, one per host window, attached to whichever
// shell window the posting renderer lives in (the S2 fromWebContents idiom —
// docked and detached both host). Every drillable decision (the localhost
// URL wall, bounds sanitation, the per-window show/hide/destroy registry)
// lives in appFrame.js; this factory is the thin Electron shell: a fully
// sandboxed view (no preload — the hosted app gets NO door into Apex),
// window-open denied, and every navigation/redirect confined to the frame's
// own localhost origin via the registry's live allowedUrl accessor.
const appFrames = appFrame.register({
  bus,
  windowFor: (sender) => {
    try { return sender && !sender.isDestroyed() ? BrowserWindow.fromWebContents(sender) : null; }
    catch { return null; }
  },
  // CSS px → DIP: the renderer measures under its webFrame zoom (Ctrl+scroll)
  zoomOf: (sender) => { try { return sender.getZoomFactor(); } catch { return 1; } },
  createView: (win, allowedUrl, onEvent) => {
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const confine = (e, url) => {
      if (!appFrame.sameFrameOrigin(allowedUrl(), url)) {
        e.preventDefault();
        lifeLog('appFrame blocked navigation to ' + url);
      }
    };
    view.webContents.on('will-navigate', confine);
    view.webContents.on('will-redirect', confine);
    // B3/C2 instruments — LISTENERS ONLY (no debugger wire after all): every
    // console line flows raw into the registry with its level riding along;
    // the C2 pick-prefix filter and the B3 error-level chip gate BOTH live in
    // appFrame.js now (drilled — the prefix must provably run first, and the
    // C2 picker posts at plain log level, so the factory can no longer
    // pre-filter on 'error'). Modern console-message shape: the event object
    // itself carries level/message/sourceId (level is the string enum).
    view.webContents.on('console-message', (e) => {
      if (e) onEvent({ kind: 'console', text: e.message, url: e.sourceId, level: e.level });
    });
    view.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (code === -3) return;   // ERR_ABORTED — a navigate cancelled the load, not a failure
      onEvent({ kind: 'net',
        text: (desc || 'load failed') + ' (' + code + ')' + (isMainFrame ? '' : ' [subframe]'),
        url: failedUrl });
    });
    win.contentView.addChildView(view);
    return {
      loadURL: (u) => { view.webContents.loadURL(u).catch(() => { /* server died mid-load — the page shows its own error */ }); },
      setBounds: (b) => view.setBounds(b),
      setVisible: (v) => view.setVisible(v),
      // C2 — the inspect seam's one Electron line: run the registry-owned
      // picker script in the hosted page (rejects if the page is mid-navigate
      // — the registry already dropped its inspect flag at that trigger).
      runScript: (js) => { view.webContents.executeJavaScript(js).catch(() => { /* page went away under it */ }); },
      destroy: () => {
        try { win.contentView.removeChildView(view); } catch { /* window teardown already detached it */ }
        try { view.webContents.close(); } catch { /* already closed */ }
      },
    };
  },
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  else createWindow();   // lock held but window gone — relaunch INTO this instance
});

// Clipboard for the sandboxed renderer (terminal copy/paste rides these).
const { clipboard } = require('electron');
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.handle('clip:write', (_e, t) => { clipboard.writeText(String(t || '')); });

// Copy selected attachments into stable, Apex-owned storage for this seat.
ipcMain.handle('attachment:pick', async (_e, seatId) => {
  const picked = await dialog.showOpenDialog(win || undefined, {
    title: 'Attach photos or files', properties: ['openFile', 'multiSelections'],
  });
  if (picked.canceled) return [];
  const safeSeat = String(seatId || 'session').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(app.getPath('userData'), 'attachments', safeSeat);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const source of picked.filePaths) {
    // per-file guard (audit L2): one file deleted between dialog and stat, or an
    // unreadable one, must not reject the whole batch and drop every attachment.
    try {
      const stat = fs.statSync(source);
      if (!stat.isFile()) continue;
      const parsed = path.parse(source);
      let dest = path.join(dir, parsed.base), n = 2;
      while (fs.existsSync(dest)) dest = path.join(dir, `${parsed.name} (${n++})${parsed.ext}`);
      fs.copyFileSync(source, dest);
      const mediaTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp' };
      const mediaType = mediaTypes[parsed.ext.toLowerCase()] || '';
      const item = { name: path.basename(dest), path: dest, size: stat.size, mediaType };
      if (mediaType && stat.size <= 4 * 1024 * 1024)
        item.data = fs.readFileSync(dest).toString('base64');
      results.push(item);
    } catch (e) { console.error(`[attachment] skipped ${source}: ${e.message}`); }
  }
  return results;
});

// Window caption controls — plain ipc, not bus verbs (they exist pre-boot).
// Sender-aware since Wave S S2: both shell windows carry the same preload, so
// each caption button must drive the window it lives in — before this, the
// studio's ✕ closed the MAIN window. win:close stays gate-correct for free:
// closing the main window routes through its 'close' handler (the seat-aware
// gate); the studio window has no gate and just closes.
const senderWin = (e) => BrowserWindow.fromWebContents(e.sender);
ipcMain.on('win:minimize', (e) => { const w = senderWin(e); if (w) w.minimize(); });
ipcMain.on('win:maximize', (e) => {
  const w = senderWin(e);
  if (!w) return;
  w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('win:close', (e) => { const w = senderWin(e); if (w) w.close(); });
// Borderless fullscreen — covers the taskbar; our in-page title bar stays,
// so the menu (and the way back out) is never lost.
ipcMain.on('win:fullscreen', (e) => { const w = senderWin(e); if (w) w.setFullScreen(!w.isFullScreen()); });
// The close-decision handshake is main-window-only by construction: only the
// docked shell registers the closeRequested answerer (studio mode skips it).
ipcMain.on('win:close-decision', (_e, requestId, allow) => {
  if (!closePending || requestId !== closePending) return;
  clearCloseRequest();
  if (allow) closeForReal();
});
ipcMain.on('win:reload', (e) => liveUpdate.reload(senderWin(e) || win));

app.whenReady().then(() => {
  // apex://local/<encodeURIComponent(absolute path)> → that file, read-only.
  protocol.handle('apex', async (req) => {
    try {
      const u = new URL(req.url);
      if (u.host !== 'local') return new Response('not found', { status: 404 });
      const p = decodeURIComponent(u.pathname.replace(/^\//, ''));
      // CONFINEMENT (external audit C2): serve ONLY files that were legitimately
      // surfaced as artifacts — never an arbitrary absolute path an untrusted
      // artifact page requests (e.g. apex://local/<~/.ssh/id_rsa>).
      if (!artifacts.isServed(p)) return new Response('not an available artifact', { status: 403 });
      let st = null;
      try { st = fs.statSync(p); } catch { /* missing */ }
      if (!st) return new Response('not found', { status: 404 });
      if (st.isDirectory()) return new Response('that path is a folder, not a file', { status: 400 });
      const res = await net.fetch(pathToFileURL(p).toString());
      // EGRESS LOCK (external audit C2): the artifact iframe runs scripts; a
      // restrictive per-response CSP lets it render (inline JS/CSS, data:/apex:
      // images) but blocks ALL network — no default-src, no connect-src — so a
      // page can't fetch a secret and phone it home. Belt to the confinement's
      // suspenders: even a served file can't be exfiltrated.
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src data: apex:; font-src data:; media-src data:");
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      return new Response('bad request: ' + e.message, { status: 400 });
    }
  });
  // A throw anywhere in the boot sequence used to die as an unhandled
  // rejection: process alive, no window, nothing in the log — undiagnosable
  // from the outside (2026-07-17, a task-store assert). Boot failures must be
  // LOUD: log the stack, show it, and exit instead of idling as a zombie.
  try {
    createWindow();
  } catch (err) {
    try {
      fs.appendFileSync(path.join(__dirname, '..', 'state', 'logs',
        'main-' + new Date().toISOString().slice(0, 10) + '.log'),
        new Date().toISOString().slice(11, 19) + ' BOOT FAILED: ' + err.stack + '\n');
    } catch { /* the dialog still tells the story */ }
    dialog.showErrorBox('Apex failed to start',
      String(err.stack || err).slice(0, 1500) +
      '\n\nDetails: state/logs/main-<date>.log');
    app.exit(1);
    return;
  }
  // The reopen preference (S2): a studio window open at quit comes back on
  // launch — read AFTER the main window exists (it anchors the bus and the
  // close gate; the studio is its companion, never the first window). The
  // smoke guard lives inside shouldReopen: state/ is shared with real
  // installs, so a smoke run must ignore even a true flag.
  if (studioWindow.shouldReopen(studioWindow.loadState(), process.env))
    studioWindow.toggle(createStudioWindow, postStudioState);
  // Smoke-test hook: APEX_SMOKE=1 opens the window, then quits after 3s —
  // exit 0 only if the renderer logged no console errors.
  if (process.env.APEX_SMOKE === '1') {
    let consoleErrors = 0;
    // Modern console-message shape (the appFrame factory's idiom above):
    // the event object carries level (string enum) and message itself.
    win.webContents.on('console-message', (e) => {
      if (e && e.level === 'error') { consoleErrors++; console.error('[renderer error]', e.message); }
    });
    // APEX_SMOKE_PTY=1: also mount a real ConPTY terminal seat so xterm/CSP
    // regressions fail the smoke instead of waiting for a live click.
    if (process.env.APEX_SMOKE_PTY === '1') setTimeout(() => seats.debugCreatePty(), 1200);
    // APEX_SMOKE_SHOT=<file.png>: capture the window — eyes on rendering
    // questions (cursor visibility, tile clipping) without a human present.
    if (process.env.APEX_SMOKE_SHOT) setTimeout(() => {
      win.focus();
      win.webContents.focus();
      setTimeout(() => win.capturePage().then((img) =>
        fs.writeFileSync(process.env.APEX_SMOKE_SHOT, img.toPNG())), 700);
    }, 3200);
    // APEX_SMOKE_CFG=1: drive a config write through the bus's real routing
    // (bus.inject — the same code path a renderer post takes past ipc) and
    // assert the file changed. CSP blocks executeJavaScript, so the renderer
    // hop itself is covered by every other verb sharing the same plumbing.
    if (process.env.APEX_SMOKE_CFG === '1') setTimeout(() => {
      // (path fixed R32 — seatconfig moved to app/ when the VS Code-era
      // extension/ folder retired; the old resolve silently pointed at nothing)
      const cfgFile = path.resolve(__dirname, '..', 'seatconfig.json');
      const before = fs.readFileSync(cfgFile, 'utf8');
      bus.inject({ type: 'seatConfigSet', persona: 'Seat', key: 'effort', value: 'medium' });
      const changed = fs.readFileSync(cfgFile, 'utf8') !== before;
      bus.inject({ type: 'seatConfigSet', persona: 'Seat', key: 'effort', value: 'high' });   // restore
      fs.writeFileSync(path.join(app.getPath('temp'), 'apex-smoke-cfg.txt'),
        changed ? 'CONFIG-WRITE-OK' : 'CONFIG-WRITE-FAILED');
    }, 1500);
    setTimeout(() => { process.exitCode = consoleErrors ? 3 : 0; app.quit(); }, 4500);
  }
});

app.on('window-all-closed', () => {
  // a throwing dispose must never block quit (the 07-12 zombie: lock held,
  // no window, desktop clicks dead)
  try { usage.dispose(); } catch (e) { console.error('usage.dispose:', e.message); }
  try { mobile.dispose(); } catch (e) { console.error('mobile.dispose:', e.message); }
  try { liveUpdate.dispose(); } catch (e) { console.error('liveUpdate.dispose:', e.message); }
  try { monitors.dispose(); } catch (e) { console.error('monitors.dispose:', e.message); }
  try { tasks.dispose(); } catch (e) { console.error('tasks.dispose:', e.message); }
  try { auditWatch.dispose(); } catch (e) { console.error('audit.dispose:', e.message); }
  try { consult.dispose(); } catch (e) { console.error('consult.dispose:', e.message); }
  try { seats.dispose(); } catch (e) { console.error('seats.dispose:', e.message); }
  try { terminal.dispose(); } catch (e) { console.error('terminal.dispose:', e.message); }
  try { artifacts.dispose(); } catch (e) { console.error('artifacts.dispose:', e.message); }
  // each frame already died on its window's 'closed' hook — this is the backstop
  try { appFrames.destroyAll(); } catch (e) { console.error('appFrame.destroyAll:', e.message); }
  try { extensions.dispose(); } catch (e) { console.error('extensions.dispose:', e.message); }
  app.quit();
  // hard backstop: if anything (a wedged ConPTY child, a stray handle) keeps
  // the event loop alive, exit anyway — a zombie with the lock is worse
  setTimeout(() => process.exit(0), 3000).unref();
});

