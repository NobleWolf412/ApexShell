// Apex — Consult v1 (core module). A hidden, tool-less disposable seat gives
// the OPERATOR a second opinion on the current chat: pick a persona (or a
// bare model), ask a question, get a streamed reply in a consult card. The
// consultant never touches the chat's transcript, the board, or memory — it
// reads a bounded digest and (for a persona) its own tiered memory, and its
// reply lands only in the operator's composer if THEY send it. See
// design/consult-v1.md for the full spec; the pure contract (digest bounds,
// kickoff composition, turn cap, project-slug rule) lives in engine/consult.js.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const seats = require('./seats');
const bus = require('./bus');
const CE = require('./engine/consult');
const { backfill } = require('./engine/transcripts');

const BACKSTOP_MS = 120000;   // the relationship pass's 120s backstop pattern
const PERSONAS_WORKSPACE = path.join(__dirname, '..', 'state', 'extensions', 'personas', 'workspace.json');

const consults = new Map();   // source seatId -> consult state
let unobserve = null;

function register() {
  unobserve = seats.observeSeats(onSeatMessage);
  bus.on('consultStart', onStart);
  bus.on('consultSend', onSend);
  bus.on('consultClose', (m) => { if (m && m.id) closeConsult(m.id, false); });
}

function dispose() {
  if (unobserve) unobserve();
  for (const id of [...consults.keys()]) closeConsult(id, false);
}

// ---- persona identity (tier 1) — same workspace lookup as the live auditor's
// borrowed voice (main/audit.js resolveBrief), but this reads the FULL
// foundation + canonical text (a consultant needs the whole identity, not a
// three-field excerpt), and returns the persona's own folder for tier 2.
function personaWorkspace() {
  try {
    const c = JSON.parse(fs.readFileSync(PERSONAS_WORKSPACE, 'utf8'));
    if (c && typeof c.workspace === 'string' && fs.existsSync(c.workspace)) return c.workspace;
  } catch { /* not configured */ }
  return null;
}

function resolvePersona(name) {
  if (!name) return null;
  const ws = personaWorkspace();
  if (!ws) return null;
  const personasDir = path.join(ws, 'personas');
  let entries;
  try { entries = fs.readdirSync(personasDir, { withFileTypes: true }); } catch { return null; }
  for (const d of entries) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    let bp;
    try { bp = JSON.parse(fs.readFileSync(path.join(personasDir, d.name, 'blueprint.json'), 'utf8')); }
    catch { continue; }
    if (bp.display_name && bp.display_name.toLowerCase() === name.toLowerCase()) {
      const personaDir = path.join(personasDir, d.name);
      let canonicalText = '';
      try { canonicalText = fs.readFileSync(path.join(personaDir, d.name + '.md'), 'utf8'); } catch { /* missing */ }
      let foundationText = '';
      try { foundationText = fs.readFileSync(path.join(ws, 'foundation.md'), 'utf8'); } catch { /* missing */ }
      return { personaId: d.name, personaDir, name: bp.display_name, canonicalText, foundationText };
    }
  }
  return null;
}

// ---- the chat digest: reuses the Claude-lane transcript backfill (same
// source the live auditor seeds a fresh watch from). Codex threads live
// outside the transcript store and local/pty seats keep no session — those
// consult with an empty digest rather than failing (the button is gated to
// live Claude/codex chats the same way Hand off → is; a codex chat simply
// gets no digest yet).
function chatTurns(seatId) {
  try {
    if (typeof seats.seatEntry !== 'function') return [];
    const entry = seats.seatEntry(seatId);
    if (!entry || !entry.sessionId || String(entry.sessionId).startsWith('codex:')) return [];
    const { messages } = backfill(entry.sessionId, path.join(os.homedir(), '.claude', 'projects'));
    const turns = [];
    for (const m of messages || []) {
      if (m.type === 'user' && m.text) turns.push({ role: 'user', text: m.text });
      else if (m.type === 'text' && m.text) turns.push({ role: 'assistant', text: m.text });
    }
    return turns;
  } catch { return []; }
}

function isChainSeat(id) {
  try { const tasks = require('./tasks'); return typeof tasks.isChainSeat === 'function' && tasks.isChainSeat(id); }
  catch { return false; }
}

function refuseReason(id) {
  if (!seats.seatEntry(id)) return 'that chat is gone.';
  if (isChainSeat(id)) return 'this seat is running a task-board chain step — consult isn\'t available mid-step.';
  return null;
}

function onStart(m) {
  if (!m || !m.id) return;
  const id = m.id;
  if (consults.has(id)) {
    bus.post('consultWarn', { id, message: 'a consult is already open on this chat — close it before starting another.' });
    return;
  }
  const reason = refuseReason(id);
  if (reason) { bus.post('consultError', { id, error: reason }); return; }
  const question = String(m.question || '').trim();
  if (!question) { bus.post('consultError', { id, error: 'ask something first.' }); return; }

  const personaName = (typeof m.persona === 'string' && m.persona) ? m.persona : null;
  let personaInfo = null;
  if (personaName) {
    personaInfo = resolvePersona(personaName);
    if (!personaInfo) {
      bus.post('consultError', { id, error: 'could not load "' + personaName + '" — its package may be missing or archived.' });
      return;
    }
  }
  const entry = seats.seatEntry(id);
  const freshEyes = !!m.freshEyes;
  let projectTier = null;
  if (personaInfo && !freshEyes)
    projectTier = CE.readProjectTier(personaInfo.personaDir, CE.projectSlug((entry && entry.cwd) || ''));

  const turns = chatTurns(id);
  const kickoff = CE.buildKickoff({
    persona: personaInfo ? { name: personaInfo.name, foundationText: personaInfo.foundationText,
                              canonicalText: personaInfo.canonicalText } : null,
    projectTier, freshEyes, digestText: CE.renderDigest(CE.windowDigest(turns)), question,
  });

  // Slice 2: the disposable launch override (App Builder slice 5) — a picker
  // model/effort choice steers this ONE consult's seat; omitted (the default)
  // is byte-identical to slice 1, the default lane model. A bad tier is the
  // engine's own validation gate (createDisposable) to reject, not ours to
  // pre-guess — it surfaces as a clean consultError via startTurn's catch.
  const launch = (m.launch && typeof m.launch === 'object' &&
    (typeof m.launch.model === 'string' || typeof m.launch.effort === 'string'))
    ? { model: typeof m.launch.model === 'string' ? m.launch.model : undefined,
        effort: typeof m.launch.effort === 'string' ? m.launch.effort : undefined }
    : undefined;

  const state = {
    persona: personaName, freshEyes, turnsUsed: 0, maxTurns: CE.CONSULT_MAX_TURNS,
    seenTurnCount: turns.length, curText: '', running: true, controller: null, backstop: null,
  };
  consults.set(id, state);
  bus.post('consultState', { id, open: true, persona: personaName, turnsUsed: 0, maxTurns: state.maxTurns });
  startTurn(id, state, kickoff, true, launch);
}

function onSend(m) {
  if (!m || !m.id) return;
  const id = m.id;
  const state = consults.get(id);
  if (!state) { bus.post('consultError', { id, error: 'no consult is open on this chat.' }); return; }
  if (state.running) { bus.post('consultWarn', { id, message: 'the consultant is still answering — wait for its reply.' }); return; }
  if (state.turnsUsed >= state.maxTurns) { bus.post('consultWarn', { id, message: CE.turnCapNotice() }); return; }
  const question = String(m.text || '').trim();
  if (!question) return;

  const turns = chatTurns(id);
  const delta = CE.windowDigest(turns.slice(Math.max(0, state.seenTurnCount)));
  state.seenTurnCount = turns.length;
  const followup = CE.buildFollowup({
    digestDeltaText: delta.length ? CE.renderDigest(delta) : '', question,
  });
  state.running = true;
  startTurn(id, state, followup, false);
}

// `first`: true = create the disposable (its kickoff IS this text); false =
// send() on the SAME controller (design/consult-v1.md §4: follow-ups ride the
// same controller). Either way a hung/quota-stalled pass must not wedge the
// consult forever (the relationship pass's 120s backstop pattern). `launch`
// only applies to the first turn — it steers what gets spawned, not a
// follow-up on an already-running seat.
function startTurn(id, state, text, first, launch) {
  state.curText = '';
  state.backstop = setTimeout(() => finishTurn(id, state, null, 'consult pass timed out'), BACKSTOP_MS);
  const onEvent = (ev) => {
    if (ev.type === 'delta' && ev.text) {
      state.curText += ev.text;
      bus.post('consultDelta', { id, text: ev.text });
    } else if (ev.type === 'text' && ev.text) {
      state.curText = ev.text;                 // authoritative block replace (deltas may lag/misorder)
      bus.post('consultText', { id, text: ev.text });
    } else if (ev.type === 'result') {
      finishTurn(id, state, state.curText, null);
    } else if (ev.type === 'dead') {
      finishTurn(id, state, null, 'the consult seat exited.');
    }
  };
  try {
    if (first) state.controller = seats.startDisposable({ kickoff: text, onEvent, launch });
    else state.controller.send(text);
  } catch (e) { finishTurn(id, state, null, e.message); }
}

function finishTurn(id, state, text, error) {
  if (!consults.has(id) || consults.get(id) !== state) return;
  if (state.backstop) { clearTimeout(state.backstop); state.backstop = null; }
  state.running = false;
  if (error) {
    // dead/timeout/error: say so plainly and close — the disposable seat is
    // gone or wedged either way, so a further send() would just fail the same
    // way. "Retry" is a fresh Consult → click, not a resend on a corpse; the
    // chat itself is untouched by every one of these failure modes. Silent
    // close (no consultState) — the card stays up showing the error until the
    // operator acts; a redundant open:false would race consultError in the
    // renderer and blank the message it just showed.
    closeConsult(id, true);
    bus.post('consultError', { id, error });
    return;
  }
  state.turnsUsed++;
  bus.post('consultTurn', { id, text: text || '', turnsUsed: state.turnsUsed, maxTurns: state.maxTurns });
}

function closeConsult(id, silent) {
  const state = consults.get(id);
  if (!state) return;
  if (state.backstop) clearTimeout(state.backstop);
  if (state.controller) { try { state.controller.close(); } catch { /* already gone */ } }
  consults.delete(id);
  if (!silent) bus.post('consultState', { id, open: false });
}

// A consult never survives its chat (design/consult-v1.md §6).
function onSeatMessage(msg) {
  if (msg.type === 'seatGone' && consults.has(msg.id)) closeConsult(msg.id, true);
}

module.exports = { register, dispose };
