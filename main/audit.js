// Apex — the live-auditor watch manager (core module). Opt-in, per seat: while
// a seat is watched, each completed turn is fed (debounced) to a hidden haiku
// disposable seat that returns a short second opinion, rendered in the AUDIT
// pane. Off by default; cost is bounded by the toggle + debounce + a cheap
// model + a small rolling window. The auditor sees only the transcript, never
// the watched persona's memory.
'use strict';

const seats = require('./seats');
const bus = require('./bus');
const audit = require('./engine/audit');

const DEBOUNCE_MS = 4000;      // let a burst of turns settle before spending a pass
const MAX_TURNS = 6;           // rolling window
const TURN_CAP = 8 * 1024;     // per-turn byte cap (keep the tail)

const watched = new Map();     // seatId -> { turns, curAssistant, timer, running, count }
let unobserve = null;

function register() {
  unobserve = seats.observeSeats(onSeatMessage);
  bus.on('auditToggle', (m) => {
    if (!m || !m.id) return;
    if (m.on) startWatch(m.id); else stopWatch(m.id);
  });
  bus.on('auditOnce', (m) => { if (m && m.id) runAudit(m.id); });
  // a reloaded renderer rebuilds its view — tell it what's still watched
  bus.on('ready', () => {
    for (const [id, w] of watched) bus.post('auditState', { id, on: true, count: w.count });
  });
}

function startWatch(id) {
  if (!watched.has(id))
    watched.set(id, { turns: [], curAssistant: '', timer: null, running: false, count: 0 });
  bus.post('auditState', { id, on: true, count: watched.get(id).count });
}
function stopWatch(id) {
  const w = watched.get(id);
  if (w && w.timer) clearTimeout(w.timer);
  watched.delete(id);
  bus.post('auditState', { id, on: false });
}

function onSeatMessage(msg) {
  if (msg.type === 'seatGone') { stopWatch(msg.id); return; }
  // synthetic user tap (seats.js): a normal seatSend the view doesn't echo
  if (msg.type === 'seatUserSend') {
    const wu = watched.get(msg.id);
    if (wu && msg.text) pushTurn(wu, 'user', msg.text);
    return;
  }
  if (msg.type !== 'seatEvt') return;
  const w = watched.get(msg.id);
  if (!w) return;
  const ev = msg.m;
  if (ev.type === 'user' && ev.text) pushTurn(w, 'user', ev.text);   // wrap/kickoff/image echoes
  else if (ev.type === 'text' && ev.text)
    w.curAssistant += (w.curAssistant ? '\n' : '') + ev.text;
  else if (ev.type === 'result') {
    if (w.curAssistant) { pushTurn(w, 'assistant', w.curAssistant); w.curAssistant = ''; }
    if (w.turns.length) scheduleAudit(msg.id, w);
  }
}

function pushTurn(w, role, text) {
  w.turns.push({ role, text: String(text).slice(-TURN_CAP) });
  while (w.turns.length > MAX_TURNS) w.turns.shift();
}

function scheduleAudit(id, w) {
  if (w.timer) clearTimeout(w.timer);
  w.timer = setTimeout(() => runAudit(id), DEBOUNCE_MS);
}

function runAudit(id) {
  const w = watched.get(id);
  if (!w || w.running || !w.turns.length) return;
  w.running = true;
  w.count++;
  bus.post('auditRunning', { id, count: w.count });
  let out = '';
  let controller = null;
  const finish = (findings, error) => {
    if (!w.running) return;
    w.running = false;
    try { if (controller) controller.close(); } catch { /* already closed */ }
    bus.post('auditFindings', { id, findings: findings || [], error: error || null, count: w.count });
  };
  try {
    controller = seats.startDisposable({
      kickoff: audit.auditPrompt(w.turns),
      model: 'haiku',
      effort: 'low',
      onEvent: (ev) => {
        if (ev.type === 'text') out += (out ? '\n' : '') + (ev.text || '');
        else if (ev.type === 'result') {
          const { raw, error } = audit.extractAudit(out);
          if (error === 'no-audit') finish([], null);        // clean pass
          else if (error) finish([], error);
          else finish(audit.validateAudit(raw).findings, null);
        } else if (ev.type === 'dead') finish([], 'the auditor seat exited');
      },
    });
  } catch (e) { finish([], e.message); }
}

function dispose() {
  if (unobserve) unobserve();
  for (const id of [...watched.keys()]) stopWatch(id);
}

module.exports = { register, dispose };
