// Apex — LIVE full-loop drill with the REAL persona cast. Runs the real stack
// headless (no window) and drives a real 3-step auto-chain on the REAL dials:
//   Architect (plan) → Coder (build) → Auditor (verdict)
// on a genuine, tiny ApexShell task. The harness is the operator's proxy: it
// auto-answers permission cards (logging each — the toolset wall in action).
// Observed, not just asserted: plan checklist fill, packets, permissions asked,
// state.md rewrites (tiered-memory wrap discipline), final verdict quality.
// Run: park the electron stub, then `npx electron test/live-cast`.
'use strict';

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const WS = 'C:\\Users\\macca\\apex\\personas';
const HISTORY_FILE = path.join(REPO, 'state', 'history.json');
const TIMEOUT_MS = 25 * 60 * 1000;
const OUT = path.join(os.tmpdir(), 'apex-livecast.log');
fs.writeFileSync(OUT, '');
const log = (s) => fs.appendFileSync(OUT, new Date().toISOString().slice(11, 19) + ' ' + s + '\n');

app.setPath('userData', path.join(os.tmpdir(), 'apex-livecast-userdata'));

let restoreFns = [];
function backupFile(file) {
  const had = fs.existsSync(file);
  const body = had ? fs.readFileSync(file, 'utf8') : null;
  restoreFns.push(() => {
    try { if (had) fs.writeFileSync(file, body); else fs.rmSync(file, { force: true }); }
    catch { /* best effort */ }
  });
}
function restoreAll() { for (const fn of restoreFns.splice(0)) fn(); }

// tiered-memory observability: hash every state.md before the run
function stateSnapshot() {
  const snap = {};
  for (const id of ['architect', 'auditor', 'coder']) {
    const dir = path.join(WS, 'personas', id, 'memory', 'projects');
    try {
      for (const proj of fs.readdirSync(dir)) {
        const f = path.join(dir, proj, 'state.md');
        if (fs.existsSync(f))
          snap[id + '/' + proj] = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);
      }
    } catch { /* none */ }
  }
  return snap;
}

app.whenReady().then(() => {
  log('electron ready — loading the real stack');
  const seats = require('../../main/seats');
  const tasks = require('../../main/tasks');
  const creator = require('../../extensions/personas/lib/creator.js');

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-livecast-state-'));
  backupFile(HISTORY_FILE);
  process.on('exit', restoreAll);

  seats.register();
  // the REAL presets — real kickoffs (tiered memory), real persona home
  const presets = creator.listPresets(WS);
  for (const p of presets) seats.extensionApi.registerPreset(p, 'live-cast-drill');
  log('presets: ' + presets.map((p) => p.name).join(', ') + '  (real dials from seatconfig)');
  tasks.register({ stateDir });

  const stateBefore = stateSnapshot();
  log('state.md snapshot: ' + JSON.stringify(stateBefore));

  const perms = [];
  seats.observeSeats((m) => {
    if (m.type === 'seatNew') log('seat up: ' + m.id + ' "' + m.title + '"');
    if (m.type !== 'seatEvt') return;
    const ev = m.m;
    if (ev.type === 'init') log(m.id + ' init model=' + (ev.model || '?'));
    if (ev.type === 'dead') log(m.id + ' DEAD code=' + ev.code);
    if (ev.type === 'result') log(m.id + ' turn settled');
    if (ev.type === 'permission') {
      // the operator's proxy: allow + LOG (this is where the wall shows itself)
      perms.push(ev.tool);
      log(m.id + ' PERMISSION: ' + ev.tool + ' — ' + String(ev.detail || '').slice(0, 120) + ' → allow');
      seats.seatCommand({ type: 'seatPerm', id: m.id, requestId: ev.requestId,
                          allow: true, input: ev.input });
    }
  });

  require('../../main/bus').inject({
    type: 'taskCreate',
    title: 'Add an explainer tooltip (title attribute) to the TERMINAL dock tab in renderer/index.html — it is the only dock tab without one; match the voice and depth of the VIEWER/TODO/AUDIT/SKILLS tab tooltips beside it. One-line change; run npm test after.',
    cwd: REPO,
    route: ['Architect', 'Coder', 'Auditor'],
    auto: true,
    start: true,
  });

  const t0 = Date.now();
  let lastLine = '';
  const timer = setInterval(() => {
    const t = tasks._test.tasks[0];
    if (!t) { finish(1, 'task never appeared'); return; }
    const step = t.steps[t.currentStep] || t.steps[t.steps.length - 1];
    const line = 'status=' + t.status + ' step=' + (t.currentStep + 1) + '/' + t.steps.length +
      ' (' + step.persona + ':' + step.status + ')' +
      (step.waiting ? ' waiting=' + step.waiting : '') +
      (step.packetError ? ' packetError=' + step.packetError : '') +
      ' todos=' + (t.todos || []).filter((x) => x.done).length + '/' + (t.todos || []).length;
    if (line !== lastLine) { log(line); lastLine = line; }
    if (t.status === 'done' || (t.attention && t.attention.reason === 'complete')) {
      report(t, 0); return;
    }
    if (t.status === 'needs-attention' && t.attention && t.attention.reason !== 'complete') {
      log('GATE: ' + t.attention.reason + ' — ' + t.attention.detail);
      report(t, 1); return;
    }
    if (Date.now() - t0 > TIMEOUT_MS) { report(t, 1, 'TIMEOUT'); }
  }, 5000);

  function report(t, code, note) {
    log('===== REPORT ' + (note || '') + ' =====');
    log('duration: ' + Math.round((Date.now() - t0) / 1000) + 's');
    log('todos: ' + JSON.stringify(t.todos || []));
    t.steps.forEach((s, i) => log('step' + (i + 1) + ' ' + s.persona + ': status=' + s.status +
      ' packet=' + JSON.stringify(s.packet || null).slice(0, 800)));
    log('bounces: ' + (t.bounces || 0));
    log('permissions asked (' + perms.length + '): ' + JSON.stringify(perms));
    const stateAfter = stateSnapshot();
    for (const k of new Set([...Object.keys(stateBefore), ...Object.keys(stateAfter)]))
      log('state.md ' + k + ': ' + (stateBefore[k] || 'absent') + ' → ' + (stateAfter[k] || 'absent') +
          (stateBefore[k] !== stateAfter[k] ? '  CHANGED' : '  unchanged'));
    finish(code, code === 0 ? 'LIVE CAST: COMPLETE' : 'LIVE CAST: STOPPED (see above)');
  }

  function finish(code, msg) {
    clearInterval(timer);
    log(msg);
    try { tasks.dispose(); } catch { /* best effort */ }
    try { seats.dispose(); } catch { /* best effort */ }
    restoreAll();
    setTimeout(() => { process.exitCode = code; app.exit(code); }, 3000);
  }
}).catch((e) => { log('FATAL: ' + e.stack); restoreAll(); app.exit(1); });
