// Apex — the live-auditor watch manager (core module). Opt-in, per seat: while
// a seat is watched, each completed turn is fed (debounced) to a hidden haiku
// disposable seat that returns a short second opinion, rendered in the AUDIT
// pane. Off by default; cost is bounded by the toggle + debounce + a cheap
// model + a small rolling window. The auditor sees only the transcript, never
// the watched persona's memory.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const seats = require('./seats');
const bus = require('./bus');
const audit = require('./engine/audit');
const { backfill } = require('./engine/transcripts');

const DEBOUNCE_MS = 4000;      // let a burst of turns settle before spending a pass
const AUDIT_BACKSTOP_MS = 90000;   // a hung/quota-stalled pass must not wedge the watch forever
const MAX_TURNS = 6;           // rolling window
const TURN_CAP = 8 * 1024;     // per-turn byte cap (keep the tail)
const PERSONAS_WORKSPACE = path.join(__dirname, '..', 'state', 'extensions', 'personas', 'workspace.json');

// session config (set from the AUDIT pane): auto-off ceiling + whose voice.
const cfg = { autoOff: false, budget: 50000, borrow: 'Auditor' };

const watched = new Map();     // seatId -> { turns, curAssistant, timer, running, count, estTokens }
let unobserve = null;

function register() {
  unobserve = seats.observeSeats(onSeatMessage);
  bus.on('auditToggle', (m) => {
    if (!m || !m.id) return;
    if (m.on) startWatch(m.id); else stopWatch(m.id, 'user');
  });
  bus.on('auditOnce', (m) => { if (m && m.id) runAudit(m.id); });
  bus.on('auditConfig', (m) => {
    if (m) {
      if (typeof m.autoOff === 'boolean') cfg.autoOff = m.autoOff;
      if (Number.isFinite(m.budget) && m.budget > 0) cfg.budget = Math.round(m.budget);
      if (Object.prototype.hasOwnProperty.call(m, 'borrow')) { cfg.borrow = m.borrow || null; briefCache.name = undefined; }
    }
    bus.post('auditConfig', { autoOff: cfg.autoOff, budget: cfg.budget, borrow: cfg.borrow });
  });
  // a reloaded renderer rebuilds its view — tell it what's still watched
  bus.on('ready', () => {
    bus.post('auditConfig', { autoOff: cfg.autoOff, budget: cfg.budget, borrow: cfg.borrow });
    for (const [id, w] of watched) bus.post('auditState', { id, on: true, count: w.count, estTokens: w.estTokens });
  });
}

// ---- borrow a persona's voice (identity only — never its memory) ----
let briefCache = { name: undefined, text: null };
function personaWorkspace() {
  try {
    const c = JSON.parse(fs.readFileSync(PERSONAS_WORKSPACE, 'utf8'));
    if (c && typeof c.workspace === 'string' && fs.existsSync(c.workspace)) return c.workspace;
  } catch { /* not configured */ }
  return null;
}
function resolveBrief() {
  if (!cfg.borrow) return null;
  if (briefCache.name === cfg.borrow) return briefCache.text;
  let text = null;
  try {
    const ws = personaWorkspace();
    if (ws) {
      const personasDir = path.join(ws, 'personas');
      for (const d of fs.readdirSync(personasDir, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        let bp;
        try { bp = JSON.parse(fs.readFileSync(path.join(personasDir, d.name, 'blueprint.json'), 'utf8')); }
        catch { continue; }
        if (bp.display_name && bp.display_name.toLowerCase() === cfg.borrow.toLowerCase()) {
          text = [bp.identity && bp.identity.response, bp.mission && bp.mission.response,
                  bp.communication && bp.communication.response].filter(Boolean).join('\n\n') || null;
          break;
        }
      }
    }
  } catch { text = null; }
  briefCache = { name: cfg.borrow, text };
  return text;
}
function isChainSeat(id) {
  try { const tasks = require('./tasks'); return typeof tasks.isChainSeat === 'function' && tasks.isChainSeat(id); }
  catch { return false; }
}

const seatTitle = (id) => {
  try {
    const e = typeof seats.seatEntry === 'function' && seats.seatEntry(id);
    return (e && e.title) || 'this chat';
  } catch { return 'this chat'; }
};

function startWatch(id) {
  if (!watched.has(id)) {
    const w = { turns: [], curAssistant: '', timer: null, running: false,
                controller: null, count: 0, estTokens: 0 };
    watched.set(id, w);
    seedFromTranscript(id, w);   // prior turns count too — "audit now" covers them
    bus.post('toast', { text: 'live audit ON for "' + seatTitle(id) +
      '" — a haiku pass reviews each turn. Stop it with the same toggle, or click the 👁 on its tab.' });
  }
  bus.post('auditState', { id, on: true, count: watched.get(id).count });
}

// Seed a fresh watch from the seat's on-disk transcript so the auditor sees
// what happened BEFORE the watch was flipped on (the same backfill a resume
// uses; kickoffs are already filtered out). Claude lane only — codex threads
// live outside the transcript store, and local seats keep no session.
function seedFromTranscript(id, w) {
  try {
    if (typeof seats.seatEntry !== 'function') return;
    const entry = seats.seatEntry(id);
    if (!entry || !entry.sessionId || String(entry.sessionId).startsWith('codex:')) return;
    const { messages } = backfill(entry.sessionId,
      path.join(os.homedir(), '.claude', 'projects'));
    for (const m of messages || []) {
      if (m.type === 'user' && m.text) pushTurn(w, 'user', m.text);
      else if (m.type === 'text' && m.text) pushTurn(w, 'assistant', m.text);
    }
  } catch { /* no transcript yet — the watch simply starts fresh */ }
}
/** Stop a watch. `reason`: 'user' (toggle / 👁 click — toast the spend
 *  summary), 'ceiling' (auto-off has its own toast), 'gone' (seat closed —
 *  silent). An in-flight pass is CANCELLED, not left to finish on your dime. */
function stopWatch(id, reason) {
  const w = watched.get(id);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  if (w.backstop) { clearTimeout(w.backstop); w.backstop = null; }
  if (w.controller) { try { w.controller.close(); } catch { /* already gone */ } w.controller = null; }
  const wasMidPass = w.running;
  w.running = false;
  watched.delete(id);
  if (reason === 'user') {
    bus.post('toast', { text: 'live audit OFF for "' + seatTitle(id) + '" — ' +
      w.count + ' pass' + (w.count === 1 ? '' : 'es') + ', ~' +
      Math.round((w.estTokens || 0) / 1000) + 'k tokens' +
      (wasMidPass ? ' (in-flight pass cancelled)' : '') + '.' });
  }
  bus.post('auditState', { id, on: false });
}

function onSeatMessage(msg) {
  if (msg.type === 'seatGone') { stopWatch(msg.id, 'gone'); return; }
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
  // suppress on chain steps — the Task Board chain has its own audit gate, no
  // point double-billing the same work.
  if (isChainSeat(id)) {
    bus.post('auditFindings', { id, findings: [], error: null, count: w.count,
      estTokens: w.estTokens || 0, suppressed: true });
    return;
  }
  w.running = true;
  w.count++;
  const brief = resolveBrief();
  const prompt = audit.auditPrompt(w.turns, brief);
  // estimated spend for the ceiling (~4 chars/token in + a small reply)
  w.estTokens = (w.estTokens || 0) + Math.ceil(prompt.length / 4) + 250;
  bus.post('auditRunning', { id, count: w.count, estTokens: w.estTokens });
  let out = '';
  const finish = (findings, error) => {
    if (!w.running) return;
    w.running = false;
    if (w.backstop) { clearTimeout(w.backstop); w.backstop = null; }
    try { if (w.controller) w.controller.close(); } catch { /* already closed */ }
    w.controller = null;
    bus.post('auditFindings', { id, findings: findings || [], error: error || null,
      count: w.count, estTokens: w.estTokens });
    // ceiling: auto-stop this watch once it crosses the configured budget
    if (cfg.autoOff && w.estTokens >= cfg.budget && watched.has(id)) {
      stopWatch(id, 'ceiling');
      bus.post('toast', { text: 'Live audit auto-stopped — this seat hit the ~' +
        cfg.budget.toLocaleString() + '-token ceiling.' });
    }
  };
  // a disposable seat that never emits result/dead (hung, quota-stalled) would
  // leave w.running true forever — the watch would never audit again. Backstop it.
  w.backstop = setTimeout(() => finish([], 'audit pass timed out'), AUDIT_BACKSTOP_MS);
  try {
    // stored on the watch so stopWatch can CANCEL a pass mid-flight
    w.controller = seats.startDisposable({
      kickoff: prompt,
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
  for (const id of [...watched.keys()]) stopWatch(id, 'gone');
}

module.exports = { register, dispose };
