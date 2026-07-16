// Apex — main process. Window lifecycle + module registration, no business
// logic: theme owns colors, monitors owns the data plane, bus owns messaging.
// Renderer is sandboxed; the preload contextBridge is the only door (plan §3).
'use strict';

const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const bus = require('./bus');
const theme = require('./theme');
const monitors = require('./monitors');
const seats = require('./seats');
const terminal = require('./terminal');
const artifacts = require('./artifacts');
const extensions = require('./extensions');
const liveUpdate = require('./liveUpdate');
const usage = require('./usage');
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

  bus.init(win);
  theme.register();
  monitors.register();
  seats.register();
  extensions.register({ seats: seats.extensionApi });
  terminal.register({ cwd: seats.defaultCwd });
  liveUpdate.register(() => win);
  liveUpdate.consumeRestore();
  usage.register();
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

  // Lifecycle log — GUI launches have no visible console; a window that
  // never appears must leave a trail (2026-07-12: process alive, no window).
  const logDir = path.join(__dirname, '..', 'state', 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* exists */ }
  const lifeLog = (line) => {
    try {
      fs.appendFileSync(path.join(logDir, 'main-' + new Date().toISOString().slice(0, 10) + '.log'),
        new Date().toISOString().slice(11, 19) + ' ' + line + '\n');
    } catch { /* never block on logging */ }
  };
  lifeLog('createWindow');
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
  });

  // Keep the renderer's window controls truthful whichever side changes state
  // (drag-to-top maximize, F11-class fullscreen, our own buttons).
  const postWinState = () => {
    if (!win || win.isDestroyed()) return;
    bus.post('winState', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  };
  win.on('maximize', postWinState);
  win.on('unmaximize', postWinState);
  win.on('enter-full-screen', postWinState);
  win.on('leave-full-screen', postWinState);
}

// A freshly (re)loaded renderer starts with the default glyphs — hand it the
// real state (the window opens maximized, so the button lied until the first
// toggle; the operator, 2026-07-14).
bus.on('ready', () => {
  if (win && !win.isDestroyed())
    bus.post('winState', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
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
  }
  return results;
});

// Window caption controls — plain ipc, not bus verbs (they exist pre-boot).
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('win:close', () => win && win.close());
// Borderless fullscreen — covers the taskbar; our in-page title bar stays,
// so the menu (and the way back out) is never lost.
ipcMain.on('win:fullscreen', () => win && win.setFullScreen(!win.isFullScreen()));
ipcMain.on('win:close-decision', (_e, requestId, allow) => {
  if (!closePending || requestId !== closePending) return;
  clearCloseRequest();
  if (allow) closeForReal();
});
ipcMain.on('win:reload', () => liveUpdate.reload(win));

app.whenReady().then(() => {
  // apex://local/<encodeURIComponent(absolute path)> → that file, read-only.
  protocol.handle('apex', (req) => {
    try {
      const u = new URL(req.url);
      if (u.host !== 'local') return new Response('not found', { status: 404 });
      const p = decodeURIComponent(u.pathname.replace(/^\//, ''));
      return net.fetch(pathToFileURL(p).toString());
    } catch (e) {
      return new Response('bad request: ' + e.message, { status: 400 });
    }
  });
  createWindow();
  // Smoke-test hook: APEX_SMOKE=1 opens the window, then quits after 3s —
  // exit 0 only if the renderer logged no console errors.
  if (process.env.APEX_SMOKE === '1') {
    let consoleErrors = 0;
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 3) { consoleErrors++; console.error('[renderer error]', message); }
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
  try { liveUpdate.dispose(); } catch (e) { console.error('liveUpdate.dispose:', e.message); }
  try { monitors.dispose(); } catch (e) { console.error('monitors.dispose:', e.message); }
  try { seats.dispose(); } catch (e) { console.error('seats.dispose:', e.message); }
  try { terminal.dispose(); } catch (e) { console.error('terminal.dispose:', e.message); }
  try { artifacts.dispose(); } catch (e) { console.error('artifacts.dispose:', e.message); }
  try { extensions.dispose(); } catch (e) { console.error('extensions.dispose:', e.message); }
  app.quit();
  // hard backstop: if anything (a wedged ConPTY child, a stray handle) keeps
  // the event loop alive, exit anyway — a zombie with the lock is worse
  setTimeout(() => process.exit(0), 3000).unref();
});
