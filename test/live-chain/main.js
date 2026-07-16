// Apex — LIVE end-to-end drill for the workflow layer. Runs the REAL stack
// (bus + seats + engine + tasks) under a headless Electron main — no window —
// and drives a real 2-step auto-chain on cheap dials:
//   DrillWorker (haiku/low/acceptEdits)  writes a proof file, hands off
//   DrillReviewer (haiku/low/acceptEdits) verifies it, completes the chain
// Asserts: both seats launch, the packet crosses, the file exists, the task
// lands 'done'. Costs two short haiku sessions. Run: npx electron test/live-chain-main.js
'use strict';

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CFG_FILE = path.resolve(__dirname, '..', '..', 'seatconfig.json');
const HISTORY_FILE = path.resolve(__dirname, '..', '..', 'state', 'history.json');
const TIMEOUT_MS = 6 * 60 * 1000;
// Electron main stdout is DETACHED on Windows GUI launches (the same reason
// main.js keeps lifeLog) — everything goes to a file the runner tails.
const OUT = path.join(os.tmpdir(), 'apex-livechain.log');
fs.writeFileSync(OUT, '');
const log = (s) => fs.appendFileSync(OUT, new Date().toISOString().slice(11, 19) + ' ' + s + '\n');

// live drills must not contend with a running Apex instance's userData
app.setPath('userData', path.join(os.tmpdir(), 'apex-livechain-userdata'));

let restoreFns = [];
function backupFile(file) {
  const had = fs.existsSync(file);
  const body = had ? fs.readFileSync(file, 'utf8') : null;
  restoreFns.push(() => {
    try {
      if (had) fs.writeFileSync(file, body);
      else fs.rmSync(file, { force: true });
    } catch { /* best effort */ }
  });
}
function restoreAll() { for (const fn of restoreFns.splice(0)) fn(); }

app.whenReady().then(() => {
  log('electron ready — loading the stack');
  const seats = require('../../main/seats');
  const tasks = require('../../main/tasks');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-livechain-'));
  const proof = path.join(scratch, 'chain-proof.txt');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-livechain-state-'));

  // cheap dials for the drill personas — injected, then restored
  backupFile(CFG_FILE);
  backupFile(HISTORY_FILE);   // recordChat would leave drill entries in the rail
  const cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  cfg.DrillWorker = { default: { model: 'haiku', effort: 'low', permissions: 'acceptEdits' } };
  cfg.DrillReviewer = { default: { model: 'haiku', effort: 'low', permissions: 'acceptEdits' } };
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
  process.on('exit', restoreAll);

  seats.register();
  seats.extensionApi.registerPreset({
    name: 'DrillWorker', letter: 'W', cwd: scratch,
    kickoff: 'You are a minimal test worker. Do exactly what the task block says, nothing more.',
  }, 'live-chain-drill');
  seats.extensionApi.registerPreset({
    name: 'DrillReviewer', letter: 'R', cwd: scratch,
    kickoff: 'You are a minimal test reviewer. Verify exactly what the task block says, change nothing.',
  }, 'live-chain-drill');
  tasks.register({ stateDir });

  seats.observeSeats((m) => {
    if (m.type === 'seatNew') log('seat up: ' + m.id + ' "' + m.title + '"');
    if (m.type === 'seatEvt' && m.m.type === 'init') log(m.id + ' session ' + m.m.sessionId);
    if (m.type === 'seatEvt' && m.m.type === 'dead') log(m.id + ' DEAD code=' + m.m.code);
    if (m.type === 'seatEvt' && m.m.type === 'result') log(m.id + ' turn settled');
  });

  require('../../main/bus').inject({
    type: 'taskCreate',
    title: 'Create a file named chain-proof.txt in your working directory containing exactly the single line HELLO-CHAIN. The reviewer step must read the file and confirm the content matches.',
    cwd: scratch,
    route: ['DrillWorker', 'DrillReviewer'],
    auto: true,
    start: true,
  });

  const t0 = Date.now();
  const timer = setInterval(() => {
    const t = tasks._test.tasks[0];
    if (!t) { finish(1, 'task never appeared'); return; }
    const step = t.steps[t.currentStep] || t.steps[t.steps.length - 1];
    log('status=' + t.status + ' step=' + (t.currentStep + 1) + '/' + t.steps.length +
        ' (' + step.persona + ':' + step.status + ')' +
        (step.packetError ? ' packetError=' + step.packetError : ''));
    if (t.status === 'done') {
      const fileOk = fs.existsSync(proof) &&
        fs.readFileSync(proof, 'utf8').trim() === 'HELLO-CHAIN';
      const packetOk = t.steps[0].packet && t.steps[0].packet.status === 'done' &&
        t.steps[1].packet && t.steps[1].packet.status === 'done';
      log('proof file: ' + (fileOk ? 'OK — HELLO-CHAIN' : 'MISSING/WRONG'));
      log('packets: ' + (packetOk ? 'both steps handed off cleanly' : 'incomplete'));
      log('worker packet: ' + JSON.stringify(t.steps[0].packet));
      log('reviewer packet: ' + JSON.stringify(t.steps[1].packet));
      finish(fileOk && packetOk ? 0 : 1,
        fileOk && packetOk ? 'LIVE CHAIN: PASS' : 'LIVE CHAIN: FAIL (see above)');
      return;
    }
    if (t.status === 'needs-attention' && t.attention && t.attention.reason !== 'complete') {
      finish(1, 'LIVE CHAIN: FAIL — gate tripped: ' + t.attention.reason +
        ' (' + t.attention.detail + ')');
      return;
    }
    if (Date.now() - t0 > TIMEOUT_MS) finish(1, 'LIVE CHAIN: FAIL — timeout');
  }, 5000);

  function finish(code, msg) {
    clearInterval(timer);
    log(msg);
    try { tasks.dispose(); } catch { /* best effort */ }
    try { seats.dispose(); } catch { /* best effort */ }
    restoreAll();
    setTimeout(() => { process.exitCode = code; app.exit(code); }, 3000);
  }
}).catch((e) => { log('FATAL: ' + e.stack); restoreAll(); app.exit(1); });
