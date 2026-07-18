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
  // The invariant is a diagnostic tripwire for a real bug — but THROWING here
  // froze the board silently: publish() calls save() first, so the throw
  // skipped the taskList push and only hit a console the GUI never shows.
  // Surface it to the operator and keep persisting/pushing.
  try {
    for (const t of tasks) assertFromRailInvariant(t);
  } catch (e) {
    console.error('[tasks] invariant tripped:', e.message);
    toast('task-state warning (a bug — see logs): ' + e.message);
  }
  store.writeJsonAtomic(TASKS_FILE, { schema: 1, tasks });
}
function publish() {
  save();
  // boundSeatIds: every rail chat with a live chatTasks binding (an apex-todo
  // task IT created, or one it was folded into at route-end) — Consult v1's
  // soft hierarchy reads this to accent Hand off → on chats that already have
  // a natural next step on the board (design/consult-v1.md §Button row semantics).
  api.bus.post('taskList', { tasks, boundSeatIds: [...chatTasks.keys()] });
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

// ---- apex-todo: any chat's road onto the TODO board (2026-07-17) ----------
// The board only showed TASKS, so a plain persona chat asked to "put this on
// the todo tab" had no move except writing a todo.md (which landed in the
// viewer — the operator's Architect did exactly that). Any seat may now emit
// a fenced ```apex-todo JSON block: {"title"?, "plan": ["...", ...],
// "done": [0-based indexes]}. A chain-step seat updates ITS task's checklist;
// a free rail chat gets a lightweight board task created (status open, one
// pending step of its own persona) and later blocks update it.
const chatBufs = new Map();    // unbound seatId -> text tail (apex-todo scan)
const chatTasks = new Map();   // rail seatId -> board task it created

function extractTodoBlock(text) {
  const re = /```apex-todo\s*\n([\s\S]*?)```/g;
  let m, last = null;
  while ((m = re.exec(text))) last = m[1];
  if (!last) return null;
  try {
    const j = JSON.parse(last);
    const plan = Array.isArray(j.plan)
      ? j.plan.filter((x) => typeof x === 'string' && x.trim())
          .map((x) => x.trim().slice(0, 200)).slice(0, 30) : [];
    if (!plan.length) return { error: 'apex-todo needs a non-empty "plan" array' };
    const done = Array.isArray(j.done)
      ? j.done.filter((i) => Number.isInteger(i) && i >= 0 && i < plan.length) : [];
    const title = (typeof j.title === 'string' && j.title.trim())
      ? j.title.trim().slice(0, 200) : '';
    return { title, plan, done };
  } catch (e) { return { error: 'apex-todo block is not valid JSON: ' + e.message }; }
}

// Rebuild a task's checklist from a plan, keeping done-flags of unchanged
// lines, then applying the block's explicit done indexes.
function applyTodoPlan(task, block) {
  const old = Array.isArray(task.todos) ? task.todos : [];
  task.todos = block.plan.map((text) => ({
    text,
    done: old.some((t) => t.done && t.text.toLowerCase() === text.toLowerCase()),
  }));
  for (const i of block.done) task.todos[i].done = true;
  task.updatedAt = now();
}

// Additive merge — for a CHAIN step, whose checklist is built across steps
// (onPacket appends each packet's plan). Replacing wholesale would erase
// earlier phases when a later persona lists only its own; instead add new
// items and mark done by text match. Free rail chats keep applyTodoPlan
// (replace): a single chat owns and re-emits its whole block.
function mergeTodoPlan(task, block) {
  if (!Array.isArray(task.todos)) task.todos = [];
  for (const text of block.plan) {
    if (task.todos.length >= 30) break;
    if (!task.todos.some((t) => t.text.toLowerCase() === text.toLowerCase()))
      task.todos.push({ text, done: false });
  }
  for (const i of block.done) {
    const text = block.plan[i];
    const hit = task.todos.find((t) => t.text.toLowerCase() === text.toLowerCase());
    if (hit) hit.done = true;
  }
  task.updatedAt = now();
}

// A free chat's first apex-todo → a lightweight board task in its repo.
function chatTodoTask(seatId, block) {
  const entry = api.seats.seatEntry(seatId);
  if (!entry) return;
  const linked = chatTasks.get(seatId);
  const existing = linked ? byId(linked.id) : null;
  if (existing && existing.status !== 'done') {
    // owned = the lightweight card this chat itself created — the chat owns
    // the whole block, so replace. A task linked at route-end (advance) is
    // shared across steps: merge, so a partial block can't erase items.
    if (linked.owned) applyTodoPlan(existing, block);
    else mergeTodoPlan(existing, block);
    if (block.title) existing.title = block.title;
    settleIfComplete(existing);
    save(); publish();
    toast('TODO board updated from ' + (entry.persona || 'chat') + ' — ' +
      existing.todos.filter((t) => t.done).length + '/' + existing.todos.length + ' done');
    return;
  }
  const persona = entry.persona || 'Seat';
  const task = {
    id: newId(),
    title: block.title || (entry.title || persona + ' plan').slice(0, 200),
    cwd: entry.cwd,
    status: 'open',
    auto: false,
    fromRail: false,
    route: [{ persona }],
    currentStep: 0,
    bounces: 0,
    maxBounces: 2,
    steps: [{ index: 0, persona, status: 'pending', seatId: null, sessionId: null,
              packet: null, packetError: null, repairSent: false, delegateWanted: false,
              bounceFindings: null, fromRail: false, waiting: null,
              startedAt: 0, endedAt: 0 }],
    attention: null,
    todos: [],
    createdAt: now(),
    updatedAt: now(),
  };
  applyTodoPlan(task, block);
  tasks.unshift(task);
  chatTasks.set(seatId, { id: task.id, owned: true });
  prune(); save(); publish();
  toast('"' + task.title + '" is on the TODO board (from the ' + persona + ' chat)');
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
    // Route over: link every released rail chat to this task so its later
    // apex-todo blocks keep updating THIS checklist (chatTodoTask consults
    // chatTasks) instead of forking a fresh board card. Route-end only —
    // linking mid-route would let a re-delegation fold up a still-running task.
    if (task.fromRail) {
      for (const s of task.steps) {
        if ((s.fromRail || s.index === task.steps.length - 1) && s.seatId != null)
          chatTasks.set(s.seatId, { id: task.id });
      }
    }
    const open = (task.todos || []).filter((t) => !t.done).length;
    if (open) {
      // Marking done here detached the task from its chats (done tasks are
      // skipped by chatTodoTask and taskDelegateFromChat's reconcile), which
      // is how a list got closed under the user and forked on the next
      // delegate (2026-07-17). Hold at the gate until the boxes settle.
      attention(task, 'complete', 'route finished — ' + open + ' checklist item' +
        (open === 1 ? '' : 's') + ' still unchecked');
    } else {
      task.status = 'done';
      task.attention = { reason: 'complete', detail: 'chain complete — review the result' };
      task.updatedAt = now();
      toast('chain complete: ' + task.title);
      publish();
    }
  }
}

// A route-finished task held open only by unchecked boxes (advance's gate)
// settles to done when the last box lands — by hand or by a linked chat.
function settleIfComplete(task) {
  if (task.status === 'done') return;
  if (task.currentStep < task.steps.length) return;
  if (!Array.isArray(task.todos) || task.todos.some((t) => !t.done)) return;
  task.status = 'done';
  task.attention = { reason: 'complete', detail: 'chain complete — checklist settled' };
  toast('chain complete: ' + task.title);
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
  // planDone binding: an index into the packet's own plan names THAT item —
  // resolved by text, since the seat can't know where its items landed in the
  // merged list (raw indexing let a seat numbering its re-emitted plan check
  // off the wrong task items, 2026-07-17). Indexes past the packet's plan
  // keep the kickoff checklist's numbering.
  const plan = packet.plan || [];
  for (const i of packet.planDone || []) {
    if (i < plan.length) {
      const hit = task.todos.find((t) => t.text.toLowerCase() === plan[i].toLowerCase());
      if (hit) hit.done = true;
    } else if (task.todos[i]) {
      task.todos[i].done = true;
    }
  }
  // A PAUSED task parks EVERY terminal packet uniformly — this guard must sit
  // above needs-decision/bounce/done, else a decision landing during a pause
  // flipped the task to needs-attention and taskResume (which only re-drives
  // done/bounce) then stranded it (external audit M5, 2026-07-18).
  if (task.status === 'paused') { publish(); return; }
  if (packet.status === 'needs-decision') {
    // seat stays open — the user answers in its chat; the chain resumes on
    // the next valid packet (the observer keeps parsing this seat's results).
    step.delegateWanted = false;   // a decision outranks the pending Delegate
    attention(task, 'decision', packet.decision);
    return;
  }
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
  if (m.type === 'seatGone') {
    // a seat dying mid-wrap kept its wraps entry + 12s timer, later firing
    // finishWrap on a corpse — clear it with the rest
    const w = wraps.get(m.id);
    const midWrap = !!w;
    if (w) { clearTimeout(w.timer); wraps.delete(m.id); }
    const b = bindings.get(m.id);
    bindings.delete(m.id); chatBufs.delete(m.id); chatTasks.delete(m.id);
    // A BOUND seat closing OUTSIDE the wrap handshake = the user closed the
    // chat (✕ / End Session) while it was still a live task step. Without this,
    // the task sat 'running' forever pointing at a dead seat — the user's
    // "closed the chat, the todo stays and Start does nothing" zombie
    // (2026-07-17). Surface a real state with a Retry/Delete path.
    if (b && !midWrap) {
      const task = byId(b.taskId);
      const step = task && task.steps[b.stepIndex];
      if (task && step && step.status === 'running' && step.seatId === m.id) {
        step.status = 'failed';
        step.endedAt = now();
        if (task.status !== 'done')
          attention(task, 'step-error', step.persona +
            "'s chat was closed before it handed off — Retry relaunches it, or ✕ removes the task.");
      }
    }
    return;
  }
  if (m.type !== 'seatEvt') return;
  const b = bindings.get(m.id);
  if (!b) {
    // Free rail chats: no task contract, but their turns may carry an
    // apex-todo block — the road onto the TODO board.
    const ev0 = m.m;
    if (ev0.type === 'text' && typeof ev0.text === 'string') {
      const cur = (chatBufs.get(m.id) || '') + ev0.text + '\n';
      chatBufs.set(m.id, cur.length > TEXT_TAIL_CAP ? cur.slice(-TEXT_TAIL_CAP) : cur);
    } else if (ev0.type === 'result') {
      const turn = chatBufs.get(m.id) || '';
      chatBufs.set(m.id, '');
      const block = extractTodoBlock(turn);
      if (block && block.error) toast('TODO board: ' + block.error);
      else if (block) chatTodoTask(m.id, block);
    } else if (ev0.type === 'dead') {
      chatBufs.delete(m.id); chatTasks.delete(m.id);
    }
    return;
  }
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
    // A chain step may refresh its task's checklist mid-step via apex-todo —
    // same block as free chats; the handoff packet's plan/planDone still rules
    // at hand-off (onPacket dedupes).
    const todoBlock = extractTodoBlock(turnText);
    if (todoBlock && !todoBlock.error) { mergeTodoPlan(task, todoBlock); publish(); }
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
      // Manual lane: do NOT auto-pop the summary box here. Clicking Delegate
      // mid-turn queues the wrap-up ask behind the in-flight turn, and THAT
      // turn's result lands here packet-less through no fault of the ask —
      // popping the box now is the premature-box bug. delegateWanted stays
      // set; a second Delegate click (taskDelegate) is the deliberate,
      // race-free path to the typed-summary box.
      else publish();
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
  // Every guard clause toasts — "clicked Start, nothing happened" is the bug
  // this replaces. Silent returns hid legitimate reasons the click did nothing.
  if (!task) { toast('Start: task not found (was it removed?)'); return; }
  const step = task.steps[task.currentStep];
  if (!step) { toast('Start: task "' + task.title + '" has no current step'); return; }
  if (step.status === 'running') {
    toast(step.persona + ' is already running for "' + task.title + '"');
    return;
  }
  if (task.status === 'done') { toast('"' + task.title + '" is already done'); return; }
  toast('starting ' + step.persona + ' for "' + task.title + '" in ' + task.cwd);
  startStep(task);
}

function taskDelegate(msg) {
  const task = byId(msg.id);
  if (!task) { toast('Delegate: task not found'); return; }
  if (task.status === 'done') { toast('"' + task.title + '" is already done'); return; }
  const step = task.steps[task.currentStep];
  // Route over but todos still open — the taskboard renders "Mark done" now,
  // but a stale renderer could still post the old verb. Point the operator at
  // the right move instead of silently no-op'ing.
  if (!step) {
    toast('"' + task.title + '" finished its route — check the remaining todos or use "Mark done"');
    return;
  }
  if (step.status === 'pending') { startStep(task); return; }   // Delegate on a fresh task = start it
  let ok = step.packet && step.packet.status === 'done';
  if (!ok && typeof msg.summary === 'string' && msg.summary.trim()) {
    const userText = msg.summary.trim().slice(0, handoff.TEXT_CAP);
    // If the seat paused with a needs-decision packet, keep its summary/artifacts
    // (the real work product) and fold the user's typed answer + the original
    // questions into findings — replacing wholesale would drop the seat's context.
    if (step.packet && step.packet.status === 'needs-decision') {
      const original = step.packet.decision || '';
      step.packet = Object.assign({}, step.packet, {
        status: 'done',
        findings: (step.packet.findings ? step.packet.findings + '\n\n' : '') +
          'User answer: ' + userText +
          (original ? '\n\nOriginal open questions: ' + original : ''),
        decision: '',
      });
    } else {
      // the operator's own words stand in for a missing packet — manual fallback
      step.packet = { status: 'done', summary: userText,
                      findings: '', decision: '', artifacts: [] };
    }
    ok = true;
  }
  // Explicit user override: the seat emitted a needs-decision packet and the
  // user clicked Delegate anyway — treat that click as "hand off now". Keep
  // the packet's summary/artifacts/plan (real work) and fold the open questions
  // into findings so the next persona sees them as context.
  if (!ok && step.packet && step.packet.status === 'needs-decision') {
    const original = step.packet.decision || '';
    step.packet = Object.assign({}, step.packet, {
      status: 'done',
      findings: (step.packet.findings ? step.packet.findings + '\n\n' : '') +
        (original ? 'Open questions (user delegated without answering): ' + original : ''),
      decision: '',
    });
    ok = true;
    toast('handing off with ' + step.persona + '\'s open questions folded into findings');
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
  if (!task) { toast('Retry: task not found'); return; }
  if (task.status === 'done') { toast('"' + task.title + '" is already done'); return; }
  const step = task.steps[task.currentStep];
  if (!step) {
    toast('"' + task.title + '" finished its route — nothing to retry');
    return;
  }
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
  // a packet that landed while paused was parked by onPacket (it returns early
  // when paused) — process it now that we're live again
  if (step && step.packet && step.status === 'running') {
    // a decision parked during pause re-surfaces on resume (not auto-only —
    // it needs the user regardless), so it isn't stranded (M5 follow-through)
    if (step.packet.status === 'needs-decision') {
      attention(task, 'decision', step.packet.decision); return;
    }
    if (task.auto) {
      if (step.packet.status === 'done') { advance(task); return; }
      if (step.packet.status === 'bounce') { bounce(task, task.currentStep, step.packet); return; }
    }
  }
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

// Force-settle a task whose route has finished but is held at the 'complete'
// gate by unchecked todos (advance()'s hold). The user's explicit "Mark done"
// click means the leftover todos are accepted as-is — settle the task without
// requiring them to click every checkbox.
function taskMarkDone(msg) {
  const task = byId(msg.id);
  if (!task) { toast('Mark done: task not found'); return; }
  if (task.status === 'done') { toast('"' + task.title + '" is already done'); return; }
  if (task.currentStep < task.steps.length) {
    toast('"' + task.title + '" is not finished — its route is still in progress');
    return;
  }
  task.status = 'done';
  task.attention = { reason: 'complete', detail: 'settled by hand — some todos left unchecked' };
  task.updatedAt = now();
  toast('"' + task.title + '" marked done');
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
  // Reconcile a board task this same chat already spawned via apex-todo: fold
  // its checklist into the delegation and drop the standalone card, else it
  // lingers forever (status 'open', prune only drops done/failed) as a zombie.
  const prior = chatTasks.get(seatId);
  const priorTask = prior ? byId(prior.id) : null;
  if (priorTask && priorTask.status !== 'done') {
    if (Array.isArray(priorTask.todos) && priorTask.todos.length) task.todos = priorTask.todos;
    tasks = tasks.filter((t) => t.id !== priorTask.id);
  }
  chatTasks.delete(seatId);
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
  settleIfComplete(task);
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

  // taskDelegateFromChat is deliberately NOT a bus verb anymore: the chat's
  // Hand off → button posts seatHandoff (instant, seats.js) since 15aed3b.
  // The function + fromRail machinery stay for LEGACY persisted rail tasks
  // and their drill coverage — reachable only via _test, never the wire.
  const verbs = { taskCreate, taskStart, taskDelegate,
                  taskPause, taskResume, taskRetry, taskUpdate, taskDelete,
                  taskMarkDone, taskTodoToggle, taskRouteSave, taskRouteDelete };
  for (const [type, fn] of Object.entries(verbs))
    api.bus.on(type, (msg) => { try { fn(msg || {}); } catch (e) { console.error('[tasks] ' + type + ':', e.message); } });

  // pull-based reads (a reloaded renderer asks) + the ready push
  api.bus.on('taskList', () => api.bus.post('taskList', { tasks, boundSeatIds: [...chatTasks.keys()] }));
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
    api.bus.post('taskList', { tasks, boundSeatIds: [...chatTasks.keys()] });
    api.bus.post('taskRoutes', { routes });
  });
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function dispose() {
  // wraps values are { timer, close } — clearTimeout(object) was a silent
  // no-op, so every 12s backstop survived dispose (leaked, firing at corpses)
  for (const w of wraps.values()) clearTimeout(w.timer);
  wraps.clear();
  bindings.clear();
  chatBufs.clear();
  chatTasks.clear();
  if (unobserve) unobserve();
}

// Is this seat currently running a chain step? (the live auditor suppresses
// its own pass on chain seats — the chain has its own audit gate.)
function isChainSeat(id) { return bindings.has(id); }

// exposed for the headless drill only
const _test = { get tasks() { return tasks; }, byId, composeKickoff, onSeatMessage,
                assertFromRailInvariant, findReuseSeat, taskDelegateFromChat };

module.exports = { register, dispose, isChainSeat, _test };
