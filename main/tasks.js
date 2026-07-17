// Apex — the workflow layer (Task Board + delegation). A task is a per-repo
// work item that follows a ROUTE of personas (Architect → Auditor → Coder);
// each step runs in its own seat, launched with a composed kickoff, and
// signals completion with an apex-handoff packet (main/engine/handoff.js).
//
// CORE module, not an extension: it must observe every seat projection event,
// create seats and learn their ids, and drive seat verbs — none of which the
// extension ctx exposes. It rides the narrow seam seats.js exports for it.
//
// Memory stays SILOED per persona — handoffs carry structured packets, never
// shared context. The Auditor's independence is the point of the second
// opinion; a bounce resumes the previous step's session (the coder keeps its
// context) while every review step is always a fresh seat.
'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');
const handoff = require('./engine/handoff');

const DONE_CAP = 50;          // pruned done/failed tasks kept for the history
const TEXT_TAIL_CAP = 64 * 1024;   // per-turn text accumulator (keep the tail)
const WRAP_BACKSTOP_MS = 12000;    // close a wrapped seat even if no result lands
const MAX_ROUTE = 8;

// Gates — every reason the chain stops for the user.
// malformed-packet | no-packet | step-error | decision | bounce-limit | complete
//
// One quiet repair: on the FIRST no-packet of an auto step we re-ask the seat
// once (step.repairSent), only surfacing to the user if the second turn is
// still packet-less. The whole layer exists so the user isn't hand-carrying
// packets — asking them to type one is a last resort, not a first response.

let api = null;               // { bus, seats } — injected for the headless drill
let TASKS_FILE = null;
let ROUTES_FILE = null;
let tasks = [];
let routes = [];
const bindings = new Map();   // seatId -> { taskId, stepIndex, buf }
const wraps = new Map();      // seatId -> backstop timer (wrap sent, close pending)
let unobserve = null;

const now = () => Date.now();
const newId = () => 't-' + now() + '-' + Math.random().toString(36).slice(2, 6);
const byId = (id) => tasks.find((t) => t.id === id) || null;
const toast = (text) => api.bus.post('toast', { text });

// Invariant: fromRail is BINARY and set at creation. A task is either a rail
// task (task.fromRail === true, step 0 fromRail === true, task.fromRail drives
// keep-alive on the final step) or a normal chain task (task.fromRail === false,
// no step is fromRail). Silent drift here would flip seat lifecycle — a normal
// chain worker staying alive forever, or a rail chat closing under the user.
// The flag is never rewritten after creation; this check makes that explicit.
function assertFromRailInvariant(task) {
  const taskRail = task.fromRail === true;
  const step0Rail = !!(task.steps[0] && task.steps[0].fromRail === true);
  if (taskRail !== step0Rail) {
    throw new Error('fromRail drift on ' + task.id + ': task=' + task.fromRail +
      ' step0=' + (task.steps[0] && task.steps[0].fromRail));
  }
  if (!taskRail) {
    for (const s of task.steps) {
      if (s.fromRail === true || s.reused === true) {
        throw new Error('non-rail task ' + task.id + ' has rail step ' + s.index +
          ' (fromRail=' + s.fromRail + ' reused=' + s.reused + ')');
      }
    }
  }
}

function save() {
  for (const t of tasks) assertFromRailInvariant(t);
  store.writeJsonAtomic(TASKS_FILE, { schema: 1, tasks });
}
function publish() {
  save();
  api.bus.post('taskList', { tasks });
}
function publishRoutes() {
  store.writeJsonAtomic(ROUTES_FILE, { schema: 1, routes });
  api.bus.post('taskRoutes', { routes });
}

function attention(task, reason, detail) {
  task.status = 'needs-attention';
  task.attention = { reason, detail: String(detail || '') };
  task.updatedAt = now();
  toast('task "' + task.title + '" needs you — ' + reason +
        (detail ? ': ' + String(detail).slice(0, 120) : ''));
  publish();
}

// ---------- kickoff composition ----------
// The task body — the <apex-task>…</apex-task> block that carries the packet,
// route, and contract. Same content whether we're launching a fresh seat or
// posting into a reused live one; the outer [seat-launch] + persona kickoff
// only makes sense for fresh launches.
function composeTaskBody(task, stepIndex) {
  const step = task.steps[stepIndex];
  const total = task.steps.length;
  const preset = api.seats.presetInfo(step.persona) || {};
  const routeStr = task.steps.map((s) => s.persona).join(' → ');
  const prev = stepIndex > 0 ? task.steps[stepIndex - 1] : null;
  const lines = [
    '<apex-task id="' + task.id + '" step="' + (stepIndex + 1) + '/' + total + '">',
    'TASK: ' + task.title,
    'REPO (your working directory): ' + task.cwd,
  ];
  // Persona kickoffs may reference memory/ RELATIVELY — under a task-cwd
  // override that would orphan the persona's memory. Hand it home explicitly.
  if (preset.cwd && preset.cwd !== task.cwd)
    lines.push('PERSONA HOME (your memory/ and log/ live HERE — always use these absolute paths): ' + preset.cwd);
  lines.push('You are step ' + (stepIndex + 1) + ' of ' + total + ' on the route: ' + routeStr + '.');
  // reviewers see the bounce budget so they spend it on blockers, not polish
  if (stepIndex > 0)
    lines.push('Bounce budget: ' + (task.bounces || 0) + ' of ' + (task.maxBounces || 2) +
      ' used — when it runs out the task escalates to the user.');
  // the task's checklist (packet-carried plan): every step sees progress and
  // checks items off via planDone in its own packet
  if (Array.isArray(task.todos) && task.todos.length) {
    lines.push('', 'PLAN — the task\'s checklist (report finished item numbers in "planDone"):');
    task.todos.forEach((t, i) => lines.push('  ' + i + '. [' + (t.done ? 'x' : ' ') + '] ' + t.text));
  }
  if (prev && prev.packet) {
    lines.push('', handoff.renderPacket(prev.packet, prev.persona), '');
  }
  // A retried/fresh-relaunched step that was bounced carries the reviewer's
  // findings so the rework brief survives losing the original session.
  if (step.bounceFindings && step.bounceFindings.findings) {
    lines.push('', '--- REVIEW FINDINGS from ' + step.bounceFindings.from +
      ' (address these) ---', step.bounceFindings.findings, '--- END FINDINGS ---', '');
  }
  lines.push(handoff.contractText(stepIndex > 0));
  lines.push('</apex-task>');
  return lines.join('\n');
}
function composeKickoff(task, stepIndex) {
  const step = task.steps[stepIndex];
  const preset = api.seats.presetInfo(step.persona) || {};
  return '[seat-launch] ' + (preset.kickoff ? preset.kickoff + '\n\n' : '') + composeTaskBody(task, stepIndex);
}

// Find a live persona chat we could hijack as the target of a delegation.
//
// Reuse preconditions (all four must hold):
//   1. same persona name (strict === on s.persona)
//   2. same cwd — compared via path.resolve() on both sides so C:\repo and
//      C:/repo/ normalize equal; Windows case differences persist (NTFS is
//      case-insensitive but path.resolve preserves case), so a user manually
//      typing a differently-cased path could miss reuse — acceptable edge.
//   3. NOT task-bound — bindings.has(id) is the single source of truth for
//      "seat id owned by some task step" (populated in taskDelegateFromChat
//      and startStep, cleared in finishWrap/releaseWrap/taskRetry/taskDelete
//      and on seatGone).
//   4. NOT mid-wrap — wraps.has(id) means the seat sent seatWrap and hasn't
//      settled its wrap turn yet; still writing memory.
//
// Atomicity: Node's event loop is single-threaded and this function + the
// startStep bind are called synchronously (no await between them), so nothing
// can interleave. The defensive re-check at bind time (startStep) is for
// resilience against future refactors, not a current race.
function findReuseSeat(persona, cwd) {
  if (!api.seats.listSeats) return null;
  const wantCwd = cwd ? path.resolve(cwd) : null;
  const list = api.seats.listSeats();
  let match = null;
  for (const s of list) {
    if (!s || s.pty || s.local) continue;
    if (s.persona !== persona) continue;
    if (wantCwd && s.cwd && path.resolve(s.cwd) !== wantCwd) continue;
    if (bindings.has(s.id)) continue;   // task-bound → not available
    if (wraps.has(s.id)) continue;       // mid-wrap → still writing memory
    match = s;                            // last match wins (most recently created)
  }
  return match ? match.id : null;
}

// The wrap-up prompt posted into a rail chat when the user hits Delegate →.
// Factored out so taskRetry can re-post it into the SAME seat when the first
// attempt produced no packet (see taskRetry / repair path).
function delegateWrapText(task, target) {
  return [
    '<apex-task id="' + task.id + '" step="1/2">',
    'The user is delegating this chat\'s work to ' + target + '.',
    'Wrap up your CURRENT work product for handoff: what you concluded, where the',
    'artifacts live (absolute paths — your scratchpad/memory files count), and what',
    'the next persona needs to know. Do not start new work.',
    handoff.contractText(false),
    '</apex-task>',
  ].join('\n');
}

// The user clicked Delegate → before the seat produced its packet: ask the
// SEAT to wrap up and emit one, instead of making the user hand-type a summary
// (this layer's own law, header comment: typed packets are a last resort, not
// a first response — the manual lane was skipping straight to the last resort).
function packetAskText(task, canBounce) {
  return [
    '<apex-task id="' + task.id + '">',
    'The user wants to hand this step off NOW. Wrap up your current work',
    'product and emit the apex-handoff block — the fenced ```apex-handoff JSON,',
    'nothing else. Do not start new work.',
    handoff.contractText(canBounce),
    '</apex-task>',
  ].join('\n');
}

// Single quiet re-ask when a seat ends its turn without a packet. Terse on
// purpose — the seat already saw the full contract in its kickoff/wrap prompt.
function repairText(task, canBounce) {
  return [
    '<apex-task-repair id="' + task.id + '">',
    'Your previous message did not include the apex-handoff block. Emit it NOW,',
    'and ONLY it — the fenced ```apex-handoff JSON, nothing else.',
    handoff.contractText(canBounce),
    '</apex-task-repair>',
  ].join('\n');
}

function bounceText(task, fromPersona, packet, stepIndex) {
  return [
    '<apex-task-bounce id="' + task.id + '">',
    'The next step (' + fromPersona + ') returned this task to you for rework.',
    'FINDINGS (what must change):',
    packet.findings || '(none given)',
    packet.artifacts && packet.artifacts.length
      ? 'Artifacts:\n' + packet.artifacts.map((a) => '- ' + a).join('\n') : null,
    '',
    'Address the findings, then hand off again.',
    handoff.contractText(stepIndex > 0),
    '</apex-task-bounce>',
  ].filter((l) => l !== null).join('\n');
}

// ---------- step lifecycle ----------
function startStep(task) {
  const step = task.steps[task.currentStep];
  if (!api.seats.presetInfo(step.persona)) {
    step.status = 'failed';
    attention(task, 'step-error', 'persona "' + step.persona + '" is not registered');
    return;
  }
  // Reuse: for delegate-from-chat tasks, if the target persona already has a
  // live chat in this cwd (typically the one the user was talking to before),
  // hijack it instead of spawning a duplicate. The user's continuing thread
  // with that persona stays in one place.
  //
  // Defensive re-check at bind: findReuseSeat + bind is atomic under Node's
  // single-threaded loop (both synchronous, no await between), but a future
  // async refactor could break that. Re-validating bindings.has/wraps.has and
  // seatEntry() right before we bind means such a refactor would fall through
  // to createTaskSeat rather than double-bind.
  const reuseId = task.fromRail ? findReuseSeat(step.persona, task.cwd) : null;
  if (reuseId && !bindings.has(reuseId) && !wraps.has(reuseId)
      && api.seats.seatEntry(reuseId)) {
    const entry = api.seats.seatEntry(reuseId);
    bindings.set(reuseId, { taskId: task.id, stepIndex: task.currentStep, buf: '' });
    Object.assign(step, { status: 'running', seatId: reuseId,
                          sessionId: (entry && entry.sessionId) || null,
                          packet: null, packetError: null, repairSent: false, delegateWanted: false,
                          fromRail: true, reused: true,
                          startedAt: now(), endedAt: 0, waiting: null });
    const text = composeTaskBody(task, task.currentStep);
    api.seats.seatCommand({ type: 'seatSend', id: reuseId, text });
    api.bus.post('seatEvt', { id: reuseId, m: { type: 'user', text } });
    task.status = 'running';
    task.attention = null;
    task.updatedAt = now();
    publish();
    return;
  }
  let seatId;
  try {
    seatId = api.seats.createTaskSeat({
      persona: step.persona,
      title: step.persona + ' ⛓ ' + task.title.slice(0, 30),
      cwd: task.cwd,
      kickoff: composeKickoff(task, task.currentStep),
    });
  } catch (e) {
    step.status = 'failed';
    attention(task, 'step-error', 'seat launch failed: ' + e.message);
    return;
  }
  bindings.set(seatId, { taskId: task.id, stepIndex: task.currentStep, buf: '' });
  // NOTE: fromRail is deliberately not in this Object.assign — the flag is
  // creation-time and immutable. A fresh createTaskSeat step is never rail.
  Object.assign(step, { status: 'running', seatId, sessionId: null, packet: null,
                        packetError: null, repairSent: false, delegateWanted: false,
                        startedAt: now(), endedAt: 0, waiting: null });
  task.status = 'running';
  task.attention = null;
  task.updatedAt = now();
  publish();
}

/** Wrap-then-close a finished step's seat: the persona writes its memory and
 *  reflection, then the seat closes on its wrap turn's result (backstopped).
 *  Rail chats (delegate-from-chat step 0) use wrapAndRelease instead — they
 *  are live user conversations, not synthesized workers; killing them mid-chat
 *  is the surprise the user hit. Both paths still write memory on wrap. */
function wrapAndClose(seatId) {
  if (!api.seats.seatEntry(seatId)) return;
  api.seats.seatCommand({ type: 'seatWrap', id: seatId });
  wraps.set(seatId, { timer: setTimeout(() => finishWrap(seatId), WRAP_BACKSTOP_MS), close: true });
}
function wrapAndRelease(seatId) {
  if (!api.seats.seatEntry(seatId)) return;
  api.seats.seatCommand({ type: 'seatWrap', id: seatId });
  wraps.set(seatId, { timer: setTimeout(() => releaseWrap(seatId), WRAP_BACKSTOP_MS), close: false });
}
function finishWrap(seatId) {
  const w = wraps.get(seatId);
  if (w && w.timer) clearTimeout(w.timer);
  wraps.delete(seatId);
  bindings.delete(seatId);
  api.seats.closeSeat(seatId);
}
function releaseWrap(seatId) {
  const w = wraps.get(seatId);
  if (w && w.timer) clearTimeout(w.timer);
  wraps.delete(seatId);
  bindings.delete(seatId);
  // deliberately no closeSeat — the rail chat stays alive for the user.
}

function advance(task) {
  const step = task.steps[task.currentStep];
  step.status = 'done';
  step.endedAt = now();
  step.waiting = null;
  // Keep alive: (a) the source rail chat itself, (b) the FINAL seat of any
  // delegate-from-chat task — that seat is the user's continuing conversation
  // with the target persona, not a disposable chain worker.
  const isFinal = task.currentStep === task.steps.length - 1;
  if (step.seatId != null) {
    if (step.fromRail || (isFinal && task.fromRail)) wrapAndRelease(step.seatId);
    else wrapAndClose(step.seatId);
  }
  task.currentStep++;
  if (task.currentStep < task.steps.length) {
    startStep(task);
  } else {
    task.status = 'done';
    task.attention = { reason: 'complete', detail: 'chain complete — review the result' };
    task.updatedAt = now();
    toast('chain complete: ' + task.title);
    publish();
  }
}

function bounce(task, fromIndex, packet) {
  task.bounces++;
  if (task.bounces > task.maxBounces) {
    attention(task, 'bounce-limit',
      'bounced ' + task.bounces + ' times (max ' + task.maxBounces + ') — settle it by hand');
    return;
  }
  const from = task.steps[fromIndex];
  from.status = 'bounced';
  from.endedAt = now();
  if (from.seatId != null) wrapAndClose(from.seatId);
  task.currentStep = fromIndex - 1;
  const prev = task.steps[task.currentStep];
  prev.bounceFindings = { from: from.persona,
                          findings: packet.findings, artifacts: packet.artifacts };
  Object.assign(prev, { status: 'running', startedAt: now(), endedAt: 0,
                        packet: null, packetError: null, repairSent: false, delegateWanted: false,
                        waiting: null });
  // fromRail step 0 with a still-alive rail seat: re-bind and post the bounce
  // findings into the SAME chat rather than spawning a resumed duplicate.
  //
  // Fallback triggers — a SEAM QUERY (seatEntry) not a try/catch:
  //   api.seats.seatEntry(prev.seatId) returns null when the user manually
  //   closed the rail chat between advance and bounce (the ✕ button removes
  //   the seat from host.list()). When that happens we drop through to the
  //   resume path below (createTaskSeat with resume:sessionId), and if that
  //   throws too, we drop again to a fresh startStep. Each level is a strict
  //   downgrade: same-seat > resumed session > fresh persona seat.
  if (prev.fromRail && prev.seatId != null && api.seats.seatEntry(prev.seatId)) {
    bindings.set(prev.seatId, { taskId: task.id, stepIndex: task.currentStep, buf: '' });
    const text = bounceText(task, from.persona, packet, task.currentStep);
    api.seats.seatCommand({ type: 'seatSend', id: prev.seatId, text });
    api.bus.post('seatEvt', { id: prev.seatId, m: { type: 'user', text } });
    task.status = 'running';
    task.attention = null;
    task.updatedAt = now();
    publish();
    return;
  }
  // Resume the previous step's SESSION — the worker keeps its full context.
  // (Review steps are always fresh seats; independence is preserved because
  // only the WORKER's session round-trips.)
  if (prev.sessionId && api.seats.presetInfo(prev.persona)) {
    try {
      const seatId = api.seats.createTaskSeat({
        persona: prev.persona,
        title: prev.persona + ' ⛓ ' + task.title.slice(0, 30),
        cwd: task.cwd,
        resume: prev.sessionId,
      });
      prev.seatId = seatId;
      bindings.set(seatId, { taskId: task.id, stepIndex: task.currentStep, buf: '' });
      const text = bounceText(task, from.persona, packet, task.currentStep);
      api.seats.seatCommand({ type: 'seatSend', id: seatId, text });
      // seatSend never echoes (the view draws its own bubble at send time) —
      // same manual user-event post the engine's seatWrap does.
      api.bus.post('seatEvt', { id: seatId, m: { type: 'user', text } });
      task.status = 'running';
      task.attention = null;
      task.updatedAt = now();
      publish();
      return;
    } catch (e) { /* fall through to the fresh relaunch */ }
  }
  prev.sessionId = null;
  startStep(task);   // fresh seat — composeKickoff folds bounceFindings in
}

function onPacket(task, stepIndex, packet) {
  const step = task.steps[stepIndex];
  step.packet = packet;
  step.packetError = null;
  task.updatedAt = now();
  // fold the packet's plan into the task checklist (dedup, capped) and mark
  // what this step reports finished — the board renders it as the todo list
  if (!Array.isArray(task.todos)) task.todos = [];
  for (const text of packet.plan || []) {
    if (task.todos.length >= 30) break;
    if (!task.todos.some((t) => t.text.toLowerCase() === text.toLowerCase()))
      task.todos.push({ text, done: false });
  }
  for (const i of packet.planDone || [])
    if (task.todos[i]) task.todos[i].done = true;
  if (packet.status === 'needs-decision') {
    // seat stays open — the user answers in its chat; the chain resumes on
    // the next valid packet (the observer keeps parsing this seat's results).
    step.delegateWanted = false;   // a decision outranks the pending Delegate
    attention(task, 'decision', packet.decision);
    return;
  }
  if (task.status === 'paused') { publish(); return; }
  if (packet.status === 'bounce') {
    step.delegateWanted = false;   // a bounce outranks the pending Delegate
    if (task.auto) { bounce(task, stepIndex, packet); return; }
    attention(task, 'decision',
      step.persona + ' wants to bounce this back — findings: ' + packet.findings);
    return;
  }
  // done
  if (task.auto) { advance(task); return; }
  if (step.delegateWanted) {
    // the user already said Delegate — the packet was the only thing missing
    step.delegateWanted = false;
    toast('task "' + task.title + '": ' + step.persona + '\'s packet landed — handing off');
    advance(task);
    return;
  }
  toast('task "' + task.title + '": ' + step.persona + ' finished — ready to delegate');
  publish();
}

// ---------- the seat observer (the whole trick) ----------
function onSeatMessage(m) {
  // wrap handshake first: a wrapped seat's next result either closes it
  // (normal chain worker) or just releases the task binding (rail chat).
  if (m.type === 'seatEvt' && m.m && m.m.type === 'result' && wraps.has(m.id)) {
    if (wraps.get(m.id).close) finishWrap(m.id);
    else releaseWrap(m.id);
    return;
  }
  if (m.type === 'seatGone') { bindings.delete(m.id); return; }
  if (m.type !== 'seatEvt') return;
  const b = bindings.get(m.id);
  if (!b) return;
  const task = byId(b.taskId);
  if (!task) { bindings.delete(m.id); return; }
  const step = task.steps[b.stepIndex];
  if (!step || step.seatId !== m.id) return;
  const ev = m.m;

  if (ev.type === 'init' && ev.sessionId) {
    step.sessionId = ev.sessionId;
    save();
    return;
  }
  if (ev.type === 'text' && typeof ev.text === 'string') {
    b.buf += ev.text + '\n';
    if (b.buf.length > TEXT_TAIL_CAP) b.buf = b.buf.slice(-TEXT_TAIL_CAP);
    return;
  }
  if (ev.type === 'permission') {
    // informational — the chat card is answerable; the card + badge just say
    // WHY nothing is moving. Truly unattended chains want acceptEdits/dontAsk.
    step.waiting = 'permission';
    publish();
    return;
  }
  if (ev.type === 'dead') {
    if (step.status === 'running') {
      step.status = 'failed';
      step.endedAt = now();
      bindings.delete(m.id);
      attention(task, 'step-error', 'seat exited (code ' + ev.code + ') — Retry relaunches the step');
    }
    return;
  }
  if (ev.type === 'result') {
    const turnText = b.buf;
    b.buf = '';
    step.waiting = null;
    if (step.status !== 'running') return;
    const { raw, error } = handoff.extractPacket(turnText);
    if (error === 'no-packet') {
      step.packetError = 'no-packet';
      // Auto chain, mid-run, first miss: re-ask the SAME seat once before we
      // dump this on the user. Second miss falls through to the loud gate.
      if (task.auto && task.status === 'running' && !step.repairSent) {
        step.repairSent = true;
        const text = repairText(task, b.stepIndex > 0);
        api.seats.seatCommand({ type: 'seatSend', id: m.id, text });
        api.bus.post('seatEvt', { id: m.id, m: { type: 'user', text } });
        publish();
        return;
      }
      if (task.auto && task.status === 'running')
        attention(task, 'no-packet',
          'the seat finished two turns without a handoff packet — reply in its chat or Retry');
      else if (step.delegateWanted) {
        // manual lane: the user's Delegate is pending and the asked seat still
        // came back packet-less — NOW the hand-typed summary is genuinely the
        // last resort, so offer it unprompted.
        step.delegateWanted = false;
        api.bus.post('taskNeedSummary', { id: task.id, persona: step.persona,
          reason: 'it was asked to wrap up and still produced no packet' });
        publish();
      } else publish();
      return;
    }
    if (error) {
      step.packetError = error;
      attention(task, 'malformed-packet', error);
      return;
    }
    const v = handoff.validatePacket(raw, { canBounce: b.stepIndex > 0 });
    if (!v.packet) {
      step.packetError = v.error;
      attention(task, 'malformed-packet', v.error);
      return;
    }
    onPacket(task, b.stepIndex, v.packet);
  }
}

// ---------- verbs ----------
function normalizeRoute(input) {
  if (!Array.isArray(input)) return null;
  const steps = input
    .map((s) => typeof s === 'string' ? s : (s && s.persona))
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim());
  if (!steps.length || steps.length > MAX_ROUTE) return null;
  return steps;
}

function taskCreate(msg) {
  const title = (typeof msg.title === 'string' ? msg.title.trim() : '').slice(0, 200);
  if (!title) { toast('a task needs a title'); return; }
  const cwd = typeof msg.cwd === 'string' ? msg.cwd.trim() : '';
  if (!cwd || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) {
    toast('task repo folder must be an existing absolute path');
    return;
  }
  let routeSteps = null;
  if (msg.routeName) {
    const r = routes.find((x) => x.name === msg.routeName);
    if (r) routeSteps = normalizeRoute(r.steps);
  }
  if (!routeSteps) routeSteps = normalizeRoute(msg.route);
  if (!routeSteps) { toast('a task needs a route of 1–' + MAX_ROUTE + ' personas'); return; }
  const known = api.seats.presetNames();
  const unknown = routeSteps.filter((p) => !known.includes(p));
  if (unknown.length)
    toast('route names unregistered personas (they will fail to launch): ' + unknown.join(', '));
  const task = {
    id: newId(),
    title,
    cwd,
    status: 'open',
    auto: !!msg.auto,
    fromRail: false,               // explicit: non-rail chain (see assertFromRailInvariant)
    route: routeSteps.map((persona) => ({ persona })),
    currentStep: 0,
    bounces: 0,
    maxBounces: 2,
    steps: routeSteps.map((persona, index) => ({
      index, persona, status: 'pending', seatId: null, sessionId: null,
      packet: null, packetError: null, repairSent: false, delegateWanted: false, bounceFindings: null,
      fromRail: false, waiting: null,
      startedAt: 0, endedAt: 0,
    })),
    attention: null,
    todos: [],
    createdAt: now(),
    updatedAt: now(),
  };
  tasks.unshift(task);
  prune();
  if (msg.start) startStep(task);
  else publish();
}

function prune() {
  const settled = tasks.filter((t) => t.status === 'done' || t.status === 'failed');
  if (settled.length <= DONE_CAP) return;
  const drop = new Set(settled.slice(DONE_CAP).map((t) => t.id));
  tasks = tasks.filter((t) => !drop.has(t.id));
}

function taskStart(msg) {
  const task = byId(msg.id);
  if (!task) return;
  const step = task.steps[task.currentStep];
  if (!step || step.status === 'running') return;
  if (task.status === 'done') return;
  startStep(task);
}

function taskDelegate(msg) {
  const task = byId(msg.id);
  if (!task || task.status === 'done') return;
  const step = task.steps[task.currentStep];
  if (!step) return;
  if (step.status === 'pending') { startStep(task); return; }   // Delegate on a fresh task = start it
  let ok = step.packet && step.packet.status === 'done';
  if (!ok && typeof msg.summary === 'string' && msg.summary.trim()) {
    // the operator's own words stand in for a missing packet — manual fallback
    step.packet = { status: 'done', summary: msg.summary.trim().slice(0, handoff.TEXT_CAP),
                    findings: '', decision: '', artifacts: [] };
    ok = true;
  }
  if (!ok) {
    // Seat-first, user-last: a live seat gets asked for its packet (once per
    // Delegate wave — delegateWanted dedupes); the hand-typed summary box only
    // appears when the seat is gone or already failed a re-ask.
    const seatAlive = step.seatId != null && api.seats.seatEntry(step.seatId)
      && bindings.has(step.seatId);
    if (seatAlive && !step.delegateWanted) {
      step.delegateWanted = true;
      const text = packetAskText(task, task.currentStep > 0);
      api.seats.seatCommand({ type: 'seatSend', id: step.seatId, text });
      api.bus.post('seatEvt', { id: step.seatId, m: { type: 'user', text } });
      toast('asked ' + step.persona + ' to wrap up — handing off when its packet lands');
      publish();
      return;
    }
    api.bus.post('taskNeedSummary', { id: task.id, persona: step.persona,
      reason: seatAlive ? 'the seat was asked and still has not produced a packet'
                        : 'its seat is closed' });
    return;
  }
  advance(task);
}

function taskRetry(msg) {
  const task = byId(msg.id);
  if (!task || task.status === 'done') return;
  const step = task.steps[task.currentStep];
  if (!step) return;
  // Delegate-from-chat step 0 is a hijacked rail seat — no createTaskSeat ever
  // ran for it. Retry MUST re-ask the same seat (if still alive), not relaunch
  // a bare persona seat that would orphan the rail conversation.
  if (step.fromRail && step.seatId != null && api.seats.seatEntry(step.seatId)) {
    Object.assign(step, { status: 'running', packet: null, packetError: null,
                          repairSent: false, delegateWanted: false, waiting: null,
                          startedAt: now(), endedAt: 0 });
    task.status = 'running';
    task.attention = null;
    task.updatedAt = now();
    const text = delegateWrapText(task, step.delegateTarget || task.steps[1] && task.steps[1].persona);
    api.seats.seatCommand({ type: 'seatSend', id: step.seatId, text });
    api.bus.post('seatEvt', { id: step.seatId, m: { type: 'user', text } });
    publish();
    return;
  }
  if (step.seatId != null && api.seats.seatEntry(step.seatId)) {
    bindings.delete(step.seatId);
    api.seats.closeSeat(step.seatId);
  }
  Object.assign(step, { seatId: null, packet: null, packetError: null,
                        repairSent: false, delegateWanted: false, waiting: null });
  startStep(task);
}

function taskPause(msg) {
  const task = byId(msg.id);
  if (!task || task.status === 'done' || task.status === 'failed') return;
  task.status = 'paused';
  task.updatedAt = now();
  publish();
}

function taskResume(msg) {
  const task = byId(msg.id);
  if (!task || task.status !== 'paused') return;
  const step = task.steps[task.currentStep];
  task.status = step && step.status === 'running' ? 'running' : 'open';
  task.attention = null;
  task.updatedAt = now();
  // a done-packet that landed while paused advances now (auto chains)
  if (task.auto && step && step.packet && step.packet.status === 'done'
      && step.status === 'running') { advance(task); return; }
  publish();
}

function taskUpdate(msg) {
  const task = byId(msg.id);
  if (!task || !msg.patch || typeof msg.patch !== 'object') return;
  // allowlisted keys only — the bus is not a free write path into the store
  if (typeof msg.patch.title === 'string' && msg.patch.title.trim())
    task.title = msg.patch.title.trim().slice(0, 200);
  if (typeof msg.patch.auto === 'boolean') task.auto = msg.patch.auto;
  task.updatedAt = now();
  publish();
}

function taskDelete(msg) {
  const task = byId(msg.id);
  if (!task) return;
  for (const [seatId, b] of bindings) if (b.taskId === task.id) bindings.delete(seatId);
  tasks = tasks.filter((t) => t.id !== task.id);
  publish();
}

// Delegate-from-chat: a persona opened from the RAIL realizes its work should
// go to another persona. Instead of the user hand-carrying it (the exact
// failure this layer exists to kill), the live chat becomes step 1 of a fresh
// two-step task: we ask the seat to emit its handoff packet, and the normal
// auto machinery advances — wrap+close the source, open the target with the
// packet in its kickoff. Same contract, same gates, no pre-planned task needed.
function taskDelegateFromChat(msg) {
  const seatId = msg.id;
  const target = typeof msg.target === 'string' ? msg.target.trim() : '';
  const entry = api.seats.seatEntry(seatId);
  if (!entry || entry.pty || entry.local) { toast('only persona/Claude chats can delegate'); return; }
  if (bindings.has(seatId)) { toast('this chat is already part of a task'); return; }
  if (!api.seats.presetInfo(target)) { toast('unknown persona: ' + (target || '(none)')); return; }
  const source = entry.persona || 'Seat';
  const cwd = (entry.cwd && fs.existsSync(entry.cwd)) ? entry.cwd : null;
  if (!cwd) { toast('this chat has no usable working directory to delegate from'); return; }
  const title = (typeof msg.title === 'string' && msg.title.trim())
    ? msg.title.trim().slice(0, 200)
    : ('handoff: ' + String(entry.title || source).slice(0, 180));
  const task = {
    id: newId(), title, cwd,
    status: 'running',
    auto: true,                     // the whole point — advance without another click
    // fromRail on the task itself so advance() also keeps the TARGET seat alive
    // when the chain completes — delegating to Architect is the user opening a
    // new conversation with Architect, not spinning up a disposable worker.
    fromRail: true,
    route: [{ persona: source }, { persona: target }],
    currentStep: 0,
    bounces: 0, maxBounces: 2,
    steps: [
      { index: 0, persona: source, status: 'running', seatId, sessionId: entry.sessionId || null,
        packet: null, packetError: null, repairSent: false, delegateWanted: false, bounceFindings: null,
        // fromRail: this step 0 is a HIJACKED rail chat — no createTaskSeat
        // was ever called for it. Retry must re-ask the same seat, not launch
        // a fresh one (that would orphan the rail context).
        fromRail: true, delegateTarget: target,
        waiting: null, startedAt: now(), endedAt: 0 },
      { index: 1, persona: target, status: 'pending', seatId: null, sessionId: null,
        packet: null, packetError: null, repairSent: false, delegateWanted: false, bounceFindings: null,
        // fromRail:false at rest — startStep flips it true only if a live seat
        // of the target persona is found and hijacked (see findReuseSeat).
        fromRail: false, waiting: null, startedAt: 0, endedAt: 0 },
    ],
    attention: null,
    todos: [],
    createdAt: now(), updatedAt: now(),
  };
  tasks.unshift(task);
  prune();
  bindings.set(seatId, { taskId: task.id, stepIndex: 0, buf: '' });
  const text = delegateWrapText(task, target);
  api.seats.seatCommand({ type: 'seatSend', id: seatId, text });
  // seatSend never echoes — same manual user-event post the engine's wrap uses
  api.bus.post('seatEvt', { id: seatId, m: { type: 'user', text } });
  toast('delegating to ' + target + ' — the chat is writing its handoff packet');
  publish();
}

// user checkbox on the board — personas check items off via planDone instead
function taskTodoToggle(msg) {
  const task = byId(msg.id);
  if (!task || !Array.isArray(task.todos)) return;
  const t = task.todos[msg.index];
  if (!t) return;
  t.done = !t.done;
  task.updatedAt = now();
  publish();
}

function taskRouteSave(msg) {
  const name = (typeof msg.name === 'string' ? msg.name.trim() : '').slice(0, 60);
  const steps = normalizeRoute(msg.steps);
  if (!name || !steps) { toast('a route needs a name and 1–' + MAX_ROUTE + ' personas'); return; }
  routes = routes.filter((r) => r.name !== name);
  routes.push({ name, steps: steps.map((persona) => ({ persona })) });
  publishRoutes();
}

function taskRouteDelete(msg) {
  routes = routes.filter((r) => r.name !== msg.name);
  publishRoutes();
}

// ---------- registration ----------
function register(deps) {
  api = {
    bus: (deps && deps.bus) || require('./bus'),
    seats: (deps && deps.seats) || require('./seats'),
  };
  const stateDir = (deps && deps.stateDir) || path.join(__dirname, '..', 'state');
  TASKS_FILE = path.join(stateDir, 'tasks.json');
  ROUTES_FILE = path.join(stateDir, 'routes.json');

  const savedTasks = readState(TASKS_FILE);
  tasks = Array.isArray(savedTasks.tasks) ? savedTasks.tasks : [];
  const savedRoutes = readState(ROUTES_FILE);
  routes = Array.isArray(savedRoutes.routes) ? savedRoutes.routes : [];

  // MIGRATE, then assert: tasks persisted before the fromRail flags existed
  // (or mid-refactor) must be coerced into a valid shape — the invariant's job
  // is to catch RUNTIME drift, not to brick the boot on legacy data (which it
  // did: a pre-refactor delegation task in tasks.json threw inside register,
  // the whenReady chain died unhandled, and the app sat windowless, 2026-07-17).
  for (const task of tasks) {
    if (!Array.isArray(task.steps)) task.steps = [];
    if (!Array.isArray(task.todos)) task.todos = [];
    task.fromRail = task.fromRail === true ||
      !!(task.steps[0] && task.steps[0].fromRail === true);
    if (!task.fromRail) {
      for (const s of task.steps) { delete s.fromRail; delete s.reused; }
    }
  }

  // Boot reconciliation: a step left 'running' has no live seat anymore (seat
  // ids never survive a restart — only sessionIds do). Surface it, don't guess.
  for (const task of tasks) {
    let touched = false;
    for (const step of task.steps || []) {
      if (step.status === 'running') {
        step.status = 'failed';
        step.seatId = null;
        step.waiting = null;
        touched = true;
      }
    }
    if (touched && task.status !== 'done') {
      task.status = 'needs-attention';
      task.attention = { reason: 'step-error', detail: 'app restarted mid-step — Retry relaunches it' };
    }
  }
  save();

  unobserve = api.seats.observeSeats(onSeatMessage);

  const verbs = { taskCreate, taskStart, taskDelegate, taskDelegateFromChat,
                  taskPause, taskResume, taskRetry, taskUpdate, taskDelete,
                  taskTodoToggle, taskRouteSave, taskRouteDelete };
  for (const [type, fn] of Object.entries(verbs))
    api.bus.on(type, (msg) => { try { fn(msg || {}); } catch (e) { console.error('[tasks] ' + type + ':', e.message); } });

  // pull-based reads (a reloaded renderer asks) + the ready push
  api.bus.on('taskList', () => api.bus.post('taskList', { tasks }));
  api.bus.on('taskRoutes', () => api.bus.post('taskRoutes', { routes }));
  api.bus.on('taskPickCwd', async () => {
    let picked;
    try {
      // Electron resolved lazily — headless drills never touch it
      const { dialog } = require('electron');
      picked = await dialog.showOpenDialog({
        title: 'Choose the task\'s repo folder', properties: ['openDirectory'],
      });
    } catch (e) { toast('could not open the folder picker: ' + e.message); return; }
    if (!picked.canceled && picked.filePaths[0])
      api.bus.post('taskCwdPicked', { path: picked.filePaths[0] });
  });
  api.bus.on('ready', () => {
    api.bus.post('taskList', { tasks });
    api.bus.post('taskRoutes', { routes });
  });
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function dispose() {
  for (const timer of wraps.values()) clearTimeout(timer);
  wraps.clear();
  bindings.clear();
  if (unobserve) unobserve();
}

// Is this seat currently running a chain step? (the live auditor suppresses
// its own pass on chain seats — the chain has its own audit gate.)
function isChainSeat(id) { return bindings.has(id); }

// exposed for the headless drill only
const _test = { get tasks() { return tasks; }, byId, composeKickoff, onSeatMessage,
                assertFromRailInvariant, findReuseSeat };

module.exports = { register, dispose, isChainSeat, _test };
