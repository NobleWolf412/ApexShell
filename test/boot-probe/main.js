// Boot probe — replays main.js's startup sequence step by step, logging each
// step to a file, so a silent hang/throw in the real boot names its culprit.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const OUT = path.join(os.tmpdir(), 'apex-boot-probe.log');
fs.writeFileSync(OUT, 'probe start\n');
const log = (s) => fs.appendFileSync(OUT, new Date().toISOString().slice(11, 19) + ' ' + s + '\n');
process.on('uncaughtException', (e) => { log('UNCAUGHT: ' + e.stack); });
process.on('unhandledRejection', (e) => { log('UNHANDLED REJECTION: ' + (e && e.stack || e)); });

const { app, BrowserWindow, protocol } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), 'apex-bootprobe-userdata'));
log('requiring app modules…');
const R = 'C:/Users/macca/ApexShell/main/';
const step = (name, fn) => {
  try { const t = Date.now(); const v = fn(); log('OK   ' + name + ' (' + (Date.now() - t) + 'ms)'); return v; }
  catch (e) { log('FAIL ' + name + ': ' + e.stack); throw e; }
};
const bus = step('require bus', () => require(R + 'bus'));
const theme = step('require theme', () => require(R + 'theme'));
const monitors = step('require monitors', () => require(R + 'monitors'));
const seats = step('require seats', () => require(R + 'seats'));
const tasks = step('require tasks', () => require(R + 'tasks'));
const auditWatch = step('require audit', () => require(R + 'audit'));
const skills = step('require skills', () => require(R + 'skills'));
const terminal = step('require terminal', () => require(R + 'terminal'));
const extensions = step('require extensions', () => require(R + 'extensions'));
const liveUpdate = step('require liveUpdate', () => require(R + 'liveUpdate'));
const usage = step('require usage', () => require(R + 'usage'));
log('all requires done');

app.whenReady().then(() => {
  log('whenReady');
  const win = step('BrowserWindow', () => new BrowserWindow({ show: false,
    webPreferences: { preload: 'C:/Users/macca/ApexShell/preload.js',
      contextIsolation: true, nodeIntegration: false, sandbox: true } }));
  step('bus.addWindow', () => bus.addWindow(win));
  step('theme.register', () => theme.register());
  step('monitors.register', () => monitors.register());
  step('seats.register', () => seats.register());
  step('extensions.register', () => extensions.register({ seats: seats.extensionApi,
    usage: { claudeSnapshot: usage.claudeSnapshot } }));
  step('tasks.register', () => tasks.register());
  step('audit.register', () => auditWatch.register());
  step('skills.register', () => skills.register());
  step('terminal.register', () => terminal.register({ cwd: seats.defaultCwd }));
  step('liveUpdate.register', () => liveUpdate.register(() => win));
  step('liveUpdate.consumeRestore', () => liveUpdate.consumeRestore());
  step('usage.register', () => usage.register());
  log('ALL STEPS PASSED — boot sequence is healthy');
  setTimeout(() => { try { seats.dispose(); } catch {} app.exit(0); }, 1500);
}).catch((e) => { log('BOOT THREW: ' + e.stack); setTimeout(() => app.exit(1), 500); });
setTimeout(() => { log('PROBE TIMEOUT — something above never returned'); app.exit(2); }, 30000);
