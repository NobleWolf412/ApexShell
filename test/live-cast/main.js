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
  // the REAL wrap prompt too — the personas extension's main half is not
  // loaded here, so without this the seats wrap on the generic engine default
  // and the state.md-rewrite discipline is never actually drilled
  seats.extensionApi.setWrapPrompt(require('../../extensions/personas/lib/wrap.js').WRAP_PROMPT);
  log('presets: ' + presets.map((p) => p.name).join(', ') + '  (real dials from seatconfig, persona wrap prompt set)');
  tasks.register({ stateDir });

  const stateBefore = stateSnapshot();
  log('state.md snapshot: ' + JSON.stringify(stateBefore));

  const perms = [];
  const chainSeats = new Set();   // every seat the chain opened — wrap-settle tracking
  seats.observeSeats((m) => {
    if (m.type === 'seatNew') { chainSeats.add(m.id); log('seat up: ' + m.id + ' "' + m.title + '"'); }
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
    title: 'In renderer/index.html, the blank-seat + rail button’s title tooltip reads "New chat - blank seat — double-click" with a plain hyphen after "New chat"; every other tooltip in the file uses an em dash. Fix that one character to match the house style. One-line change; run npm test after.',
    cwd: REPO,
    route: ['Architect', 'Coder', 'Auditor'],
    auto: true,
    start: true,
  });

  const t0 = Date.now();
  const WRAP_WAIT_MS = 180000;   // > tasks.js WRAP_BACKSTOP_MS (120s) + margin
  let doneSeen = null;
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
      // Chain done ≠ drill done: advance() fires each seat's WRAP turn (the
      // state.md rewrite) and closes the seat on its result — reporting here
      // would snapshot before the memory writes land and dispose() would kill
      // them mid-write (the first run of this drill did exactly that). Wait
      // until every chain seat has closed (wrap settled), backstopped past
      // tasks.js's own WRAP_BACKSTOP_MS.
      if (!doneSeen) { doneSeen = Date.now(); log('chain done — waiting for wrap turns to settle (memory writes)'); }
      const open = [...chainSeats].filter((id) => seats.seatEntry(id));
      if (!open.length || Date.now() - doneSeen > WRAP_WAIT_MS) {
        if (open.length) log('wrap-wait backstop hit — still open: ' + open.join(', '));
        report(t, 0); return;
      }
      const wline = 'wrapping: ' + open.join(', ') + ' still writing memory';
      if (wline !== lastLine) { log(wline); lastLine = wline; }
      return;
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
