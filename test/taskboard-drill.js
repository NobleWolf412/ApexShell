// Apex — headless drill for the workflow layer: main/engine/handoff.js (pure
// packet contract) + main/tasks.js (chain state machine) against a stubbed
// seats seam and a fake bus. No Electron, no real CLI. Run: node test/taskboard-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handoff = require('../main/engine/handoff');
const tasks = require('../main/tasks');

let passed = 0, failed = 0;
function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

const block = (obj) => '```apex-handoff\n' + JSON.stringify(obj) + '\n```';

// ---------------- handoff.js — the pure contract ----------------
gate('valid done packet extracts and validates', () => {
  const text = 'work is finished.\n' + block({ status: 'done', summary: 'built the thing',
    artifacts: ['C:\\repo\\out.md'] });
  const { raw, error } = handoff.extractPacket(text);
  assert.equal(error, null);
  const v = handoff.validatePacket(raw, { canBounce: false });
  assert.equal(v.error, null);
  assert.equal(v.packet.status, 'done');
  assert.equal(v.packet.summary, 'built the thing');
  assert.deepEqual(v.packet.artifacts, ['C:\\repo\\out.md']);
});

gate('missing block → no-packet', () => {
  assert.equal(handoff.extractPacket('just prose, no block').error, 'no-packet');
  assert.equal(handoff.extractPacket('').error, 'no-packet');
});

gate('broken JSON → malformed-packet', () => {
  assert.equal(handoff.extractPacket('```apex-handoff\n{oops\n```').error, 'malformed-packet');
});

gate('last block wins', () => {
  const text = block({ status: 'needs-decision', decision: 'first thoughts' }) +
    '\nactually, finished it:\n' + block({ status: 'done', summary: 'final word' });
  const { raw } = handoff.extractPacket(text);
  assert.equal(raw.status, 'done');
});

gate('oversize text fields are capped', () => {
  const v = handoff.validatePacket({ status: 'done', summary: 'x'.repeat(9000) }, {});
  assert.equal(v.packet.summary.length, handoff.TEXT_CAP);
});

gate('relative artifact paths are dropped, list capped', () => {
  const arts = ['relative/nope.md', 'C:\\ok\\one.md'];
  for (let i = 0; i < 30; i++) arts.push('C:\\ok\\n' + i + '.md');
  const v = handoff.validatePacket({ status: 'done', summary: 's', artifacts: arts }, {});
  assert.ok(!v.packet.artifacts.includes('relative/nope.md'));
  assert.equal(v.packet.artifacts.length, handoff.MAX_ARTIFACTS);
  assert.ok(v.notes.length >= 2);
});

gate('bounce at the first step is rejected', () => {
  const v = handoff.validatePacket({ status: 'bounce', findings: 'redo it' }, { canBounce: false });
  assert.equal(v.error, 'bounce-at-first-step');
});

gate('extra keys are stripped — packets can never smuggle targets', () => {
  const v = handoff.validatePacket({ status: 'done', summary: 's',
    persona: 'Evil', route: ['x'], cwd: 'C:\\evil', permissionMode: 'bypassPermissions' }, {});
  assert.deepEqual(Object.keys(v.packet).sort(),
    ['artifacts', 'decision', 'findings', 'plan', 'planDone', 'status', 'summary']);
});

gate('each status requires its field', () => {
  assert.equal(handoff.validatePacket({ status: 'done' }, {}).error, 'missing-summary');
  assert.equal(handoff.validatePacket({ status: 'bounce' }, { canBounce: true }).error, 'missing-findings');
  assert.equal(handoff.validatePacket({ status: 'needs-decision' }, {}).error, 'missing-decision');
  assert.equal(handoff.validatePacket({ status: 'sideways' }, {}).error, 'malformed-packet');
  assert.equal(handoff.validatePacket('nope', {}).error, 'malformed-packet');
});

// ---------------- tasks.js — the chain state machine ----------------
const PRESETS = {
  Architect: { name: 'Architect', cwd: 'C:\\ph\\Architect', kickoff: 'You are Architect.' },
  Auditor: { name: 'Auditor', cwd: 'C:\\ph\\Auditor', kickoff: 'You are Auditor.' },
  Coder: { name: 'Coder', cwd: 'C:\\ph\\Coder', kickoff: 'You are Coder.' },
};

function makeSeats() {
  const created = [];
  const commands = [];
  const live = new Set();
  const entries = new Map();   // id -> richer entry for seatEntry (delegate-from-chat)
  let observer = null;
  let n = 0;
  return {
    created, commands, live, entries,
    emit(m) { if (observer) observer(m); },
    observeSeats(fn) { observer = fn; return () => { observer = null; }; },
    createTaskSeat(opts) {
      const id = 's' + (++n);
      created.push({ id, opts });
      live.add(id);
      // richer entry so reuse-lookup can match by persona + cwd, mirroring real seats.js
      entries.set(id, { id, persona: opts.persona, cwd: opts.cwd, sessionId: null });
      return id;
    },
    presetInfo: (name) => PRESETS[name] || null,
    presetNames: () => Object.keys(PRESETS),
    seatCommand(msg) { commands.push(msg); },
    seatEntry(id) { return entries.get(id) || (live.has(id) ? { id } : null); },
    listSeats() {
      const out = [];
      for (const id of live) out.push(entries.get(id) || { id });
      return out;
    },
    closeSeat(id) { live.delete(id); commands.push({ type: 'closeSeat', id }); },
  };
}
function makeBus() {
  const handlers = new Map();
  const posts = [];
  return {
    handlers, posts,
    on(t, fn) { handlers.set(t, fn); },
    post(t, m) { posts.push({ type: t, m }); },
    send(t, m) { const fn = handlers.get(t); assert.ok(fn, 'no handler for ' + t); return fn(m); },
    lastList() { const hits = posts.filter((p) => p.type === 'taskList'); return hits[hits.length - 1].m.tasks; },
    toasts() { return posts.filter((p) => p.type === 'toast').map((p) => p.m.text); },
  };
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-taskdrill-'));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-taskrepo-'));
let seats = makeSeats();
let bus = makeBus();
tasks.register({ bus, seats, stateDir });

const turn = (id, packet) => {
  if (packet) seats.emit({ type: 'seatEvt', id, m: { type: 'text', text: 'work…\n' + block(packet) } });
  seats.emit({ type: 'seatEvt', id, m: { type: 'result', ok: true } });
};

let manualId = null;
gate('taskCreate validates cwd and route', () => {
  bus.send('taskCreate', { title: 'bad', cwd: 'not-absolute', route: ['Architect'] });
  assert.ok(bus.toasts().some((t) => /absolute path/.test(t)));
  bus.send('taskCreate', { title: 'bad2', cwd: repo, route: [] });
  assert.ok(bus.toasts().some((t) => /route of 1/.test(t)));
  assert.equal(seats.created.length, 0);
});

gate('create+start launches step 1 with a composed kickoff', () => {
  bus.send('taskCreate', { title: 'design the widget', cwd: repo,
    route: ['Architect', 'Auditor'], start: true });
  assert.equal(seats.created.length, 1);
  const { opts } = seats.created[0];
  assert.equal(opts.persona, 'Architect');
  assert.equal(opts.cwd, repo);
  assert.ok(opts.kickoff.startsWith('[seat-launch] You are Architect.'));
  assert.ok(opts.kickoff.includes('PERSONA HOME'));             // memory-path fix
  assert.ok(opts.kickoff.includes('apex-handoff'));             // the contract
  assert.ok(!opts.kickoff.includes('"bounce"'));                // step 1 can't bounce
  const t = bus.lastList()[0];
  manualId = t.id;
  assert.equal(t.status, 'running');
  assert.equal(t.steps[0].status, 'running');
});

gate('init captures the sessionId; done packet lands without auto-advance (manual)', () => {
  seats.emit({ type: 'seatEvt', id: 's1', m: { type: 'init', sessionId: 'sess-arch' } });
  turn('s1', { status: 'done', summary: 'design is ready', artifacts: ['C:\\repo\\design.md'] });
  const t = bus.lastList().find((x) => x.id === manualId);
  assert.equal(t.steps[0].sessionId, 'sess-arch');
  assert.equal(t.steps[0].packet.status, 'done');
  assert.equal(t.currentStep, 0);                                // no auto-advance
  assert.ok(bus.toasts().some((x) => /ready to delegate/.test(x)));
});

gate('taskDelegate advances: wrap the finished seat, launch the next persona with the packet', () => {
  bus.send('taskDelegate', { id: manualId });
  assert.ok(seats.commands.some((c) => c.type === 'seatWrap' && c.id === 's1'));
  assert.equal(seats.created.length, 2);
  const { opts } = seats.created[1];
  assert.equal(opts.persona, 'Auditor');
  assert.ok(opts.kickoff.includes('HANDOFF PACKET from Architect'));
  assert.ok(opts.kickoff.includes('design is ready'));
  assert.ok(opts.kickoff.includes('"bounce"'));                  // step 2 may bounce
  turn('s1');                                                    // the wrap turn settles
  assert.ok(seats.commands.some((c) => c.type === 'closeSeat' && c.id === 's1'));
});

gate('final step + delegate completes the chain (gate: complete)', () => {
  seats.emit({ type: 'seatEvt', id: 's2', m: { type: 'init', sessionId: 'sess-aud' } });
  turn('s2', { status: 'done', summary: 'audit passed' });
  bus.send('taskDelegate', { id: manualId });
  const t = bus.lastList().find((x) => x.id === manualId);
  assert.equal(t.status, 'done');
  assert.equal(t.attention.reason, 'complete');
  assert.ok(bus.toasts().some((x) => /chain complete/.test(x)));
});

let autoId = null;
gate('auto chain advances on its own', () => {
  bus.send('taskCreate', { title: 'build the widget', cwd: repo,
    route: ['Coder', 'Auditor'], auto: true, start: true });
  autoId = bus.lastList()[0].id;
  const coder = seats.created[2];                                // s3
  assert.equal(coder.opts.persona, 'Coder');
  seats.emit({ type: 'seatEvt', id: 's3', m: { type: 'init', sessionId: 'sess-coder' } });
  turn('s3', { status: 'done', summary: 'implemented', artifacts: ['C:\\repo\\x.js'] });
  assert.equal(seats.created.length, 4);                         // auditor launched unasked
  assert.equal(seats.created[3].opts.persona, 'Auditor');
  const t = bus.lastList().find((x) => x.id === autoId);
  assert.equal(t.currentStep, 1);
});

gate('auto bounce resumes the previous session and sends the findings', () => {
  seats.emit({ type: 'seatEvt', id: 's4', m: { type: 'init', sessionId: 'sess-aud2' } });
  turn('s4', { status: 'bounce', findings: 'null check missing in x.js' });
  const t = bus.lastList().find((x) => x.id === autoId);
  assert.equal(t.bounces, 1);
  assert.equal(t.currentStep, 0);
  assert.equal(t.steps[1].status, 'bounced');
  const resumed = seats.created[4];                              // s5 = coder resumed
  assert.equal(resumed.opts.persona, 'Coder');
  assert.equal(resumed.opts.resume, 'sess-coder');
  const sent = seats.commands.find((c) => c.type === 'seatSend' && c.id === 's5');
  assert.ok(sent && sent.text.includes('null check missing'));
  assert.ok(sent.text.includes('apex-handoff'));                 // re-states the contract
});

gate('rework done → fresh review seat (independence preserved)', () => {
  seats.emit({ type: 'seatEvt', id: 's5', m: { type: 'init', sessionId: 'sess-coder' } });
  turn('s5', { status: 'done', summary: 'fixed the null check' });
  const review2 = seats.created[5];                              // s6 = fresh auditor
  assert.equal(review2.opts.persona, 'Auditor');
  assert.ok(!review2.opts.resume);                               // never resumed
  assert.ok(review2.opts.kickoff.includes('fixed the null check'));
});

gate('bounce limit trips the gate', () => {
  tasks._test.byId(autoId).bounces = 2;                          // at the max already
  seats.emit({ type: 'seatEvt', id: 's6', m: { type: 'init', sessionId: 'sess-aud3' } });
  turn('s6', { status: 'bounce', findings: 'still wrong' });
  const t = bus.lastList().find((x) => x.id === autoId);
  assert.equal(t.status, 'needs-attention');
  assert.equal(t.attention.reason, 'bounce-limit');
});

gate('needs-decision pauses; the next valid packet resumes the chain', () => {
  bus.send('taskCreate', { title: 'decide things', cwd: repo,
    route: ['Architect'], auto: true, start: true });
  const id = bus.lastList()[0].id;
  const seatId = seats.created[seats.created.length - 1].id;
  turn(seatId, { status: 'needs-decision', decision: 'REST or GraphQL?' });
  let t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.attention.reason, 'decision');
  assert.ok(t.attention.detail.includes('REST or GraphQL'));
  turn(seatId, { status: 'done', summary: 'went with REST per your answer' });
  t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.status, 'done');                                // single-step chain completed
});

gate('needs-decision + Delegate click overrides: chain advances, questions fold into findings', () => {
  bus.send('taskCreate', { title: 'ratify or go', cwd: repo,
    route: ['Architect', 'Coder'], auto: true, start: true });
  const id = bus.lastList()[0].id;
  const arch = seats.created[seats.created.length - 1].id;
  turn(arch, { status: 'needs-decision',
    summary: 'drafted the plan',
    artifacts: ['C:\\repo\\plan.md'],
    decision: 'Approve the plan A/B/C?' });
  let t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.attention.reason, 'decision');
  assert.equal(t.currentStep, 0);                                // paused, no Coder yet
  const createdBefore = seats.created.length;
  bus.send('taskDelegate', { id });                              // user overrides
  t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.currentStep, 1);                                // advanced
  assert.equal(seats.created.length, createdBefore + 1);         // Coder seat launched
  const coder = seats.created[seats.created.length - 1];
  assert.equal(coder.opts.persona, 'Coder');
  assert.ok(coder.opts.kickoff.includes('drafted the plan'));    // summary preserved
  assert.ok(coder.opts.kickoff.includes('C:\\repo\\plan.md'));   // artifacts preserved
  assert.ok(coder.opts.kickoff.includes('Approve the plan A/B/C?')); // questions in findings
  assert.ok(coder.opts.kickoff.includes('user delegated without answering'));
});

gate('route-over held by unchecked todos: Delegate/Retry toast, taskMarkDone settles', () => {
  bus.send('taskCreate', { title: 'held-open task', cwd: repo,
    route: ['Coder'], auto: true, start: true });
  const id = bus.lastList()[0].id;
  const seatId = seats.created[seats.created.length - 1].id;
  turn(seatId, { status: 'done', summary: 'built it',
    plan: ['Do the thing', 'Verify the thing'], planDone: [0] });
  let t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.status, 'needs-attention');
  assert.equal(t.attention.reason, 'complete');
  assert.equal(t.currentStep, 1);                                // past the last step
  const toastsBefore = bus.toasts().length;
  bus.send('taskDelegate', { id });                              // was a silent no-op
  const delegateToasts = bus.toasts().slice(toastsBefore);
  assert.ok(delegateToasts.some((s) => /finished its route/.test(s)),
    'Delegate on a route-over task must toast, not no-op');
  bus.send('taskRetry', { id });                                 // same silent no-op
  assert.ok(bus.toasts().some((s) => /nothing to retry/.test(s)));
  bus.send('taskMarkDone', { id });
  t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.status, 'done');
  assert.ok(bus.toasts().some((s) => /marked done/.test(s)));
});

gate('taskMarkDone refuses to settle a task whose route is still in progress', () => {
  bus.send('taskCreate', { title: 'mid-route', cwd: repo,
    route: ['Coder', 'Auditor'], auto: false, start: true });
  const id = bus.lastList()[0].id;
  bus.send('taskMarkDone', { id });
  const t = bus.lastList().find((x) => x.id === id);
  assert.notEqual(t.status, 'done');
  assert.ok(bus.toasts().some((s) => /still in progress/.test(s)));
});

gate('malformed packet trips the gate; a later good packet recovers', () => {
  bus.send('taskCreate', { title: 'flaky seat', cwd: repo,
    route: ['Coder'], auto: true, start: true });
  const id = bus.lastList()[0].id;
  const seatId = seats.created[seats.created.length - 1].id;
  seats.emit({ type: 'seatEvt', id: seatId, m: { type: 'text', text: '```apex-handoff\n{broken\n```' } });
  seats.emit({ type: 'seatEvt', id: seatId, m: { type: 'result', ok: true } });
  let t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.attention.reason, 'malformed-packet');
  turn(seatId, { status: 'done', summary: 'second try clean' });
  t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.status, 'done');
});

gate('no packet on an auto chain: one quiet re-ask, then the gate on the second miss', () => {
  bus.send('taskCreate', { title: 'silent seat', cwd: repo,
    route: ['Coder'], auto: true, start: true });
  const id = bus.lastList()[0].id;
  const seatId = seats.created[seats.created.length - 1].id;
  const beforeCmds = seats.commands.length;
  turn(seatId);                                                  // first miss → repair
  let t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.status, 'running', 'first miss must NOT trip the gate');
  assert.equal(t.steps[0].repairSent, true);
  const repair = seats.commands.slice(beforeCmds).find(
    (c) => c.type === 'seatSend' && c.id === seatId);
  assert.ok(repair, 're-ask was sent to the same seat');
  assert.ok(/apex-task-repair/.test(repair.text));
  assert.ok(repair.text.includes('apex-handoff'));
  turn(seatId);                                                  // second miss → gate
  t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.attention.reason, 'no-packet');
  assert.ok(/two turns/.test(t.attention.detail));
});

gate('no packet on an auto chain: repair recovers when the seat then emits a packet', () => {
  bus.send('taskCreate', { title: 'forgetful seat', cwd: repo,
    route: ['Coder'], auto: true, start: true });
  const id = bus.lastList()[0].id;
  const seatId = seats.created[seats.created.length - 1].id;
  turn(seatId);                                                  // first miss → repair
  let t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.status, 'running');
  turn(seatId, { status: 'done', summary: 'oops, here you go' });
  t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.status, 'done');                                // single-step chain completed
});

let deadId = null;
gate('seat death fails the step; Retry relaunches fresh', () => {
  bus.send('taskCreate', { title: 'dying seat', cwd: repo,
    route: ['Coder'], start: true });
  deadId = bus.lastList()[0].id;
  const seatId = seats.created[seats.created.length - 1].id;
  seats.emit({ type: 'seatEvt', id: seatId, m: { type: 'dead', code: 1 } });
  let t = bus.lastList().find((x) => x.id === deadId);
  assert.equal(t.status, 'needs-attention');
  assert.equal(t.attention.reason, 'step-error');
  assert.equal(t.steps[0].status, 'failed');
  const before = seats.created.length;
  bus.send('taskRetry', { id: deadId });
  assert.equal(seats.created.length, before + 1);
  t = bus.lastList().find((x) => x.id === deadId);
  assert.equal(t.steps[0].status, 'running');
});

gate('delegate-from-chat: a live rail chat becomes step 1 and hands off on its packet', () => {
  // a rail-launched Architect chat, mid-work, never part of any task
  seats.entries.set('chat1', { id: 'chat1', persona: 'Architect', title: 'Architect — big design',
    cwd: repo, sessionId: 'sess-rail', pty: false, local: false });
  const before = seats.created.length;
  bus.send('taskDelegateFromChat', { id: 'chat1', target: 'Auditor' });
  const t = bus.lastList()[0];
  assert.equal(t.status, 'running');
  assert.equal(t.auto, true);
  assert.deepEqual(t.steps.map((s) => s.persona), ['Architect', 'Auditor']);
  assert.equal(t.steps[0].seatId, 'chat1');
  // the chat was ASKED for its packet (contract text sent to it)
  const ask = seats.commands.find((c) => c.type === 'seatSend' && c.id === 'chat1');
  assert.ok(ask && ask.text.includes('apex-handoff'), 'handoff contract sent to the chat');
  assert.ok(ask.text.includes('Auditor'));
  // chat emits its packet → auto machinery advances: wrap source, open target
  turn('chat1', { status: 'done', summary: 'design finished — see scratchpad',
    artifacts: ['C:\\repo\\design.md'] });
  assert.ok(seats.commands.some((c) => c.type === 'seatWrap' && c.id === 'chat1'), 'source chat wraps');
  assert.equal(seats.created.length, before + 1, 'target seat launched');
  const auditor = seats.created[seats.created.length - 1];
  assert.equal(auditor.opts.persona, 'Auditor');
  assert.ok(auditor.opts.kickoff.includes('design finished'), 'packet crossed to the Auditor');
  assert.equal(auditor.opts.cwd, repo, 'target inherits the chat\'s repo');
});

gate('delegate-from-chat REUSES an existing live persona seat (no duplicate spawn)', () => {
  // The classic loop: user is in an Architect chat, delegates to Auditor,
  // Auditor then delegates back to Architect — that should return to the SAME
  // Architect session, not launch a fresh one.
  seats.entries.set('chatA', { id: 'chatA', persona: 'Architect', title: 'Architect — plan',
    cwd: repo, sessionId: 'sess-A', pty: false, local: false });
  seats.live.add('chatA');
  bus.send('taskDelegateFromChat', { id: 'chatA', target: 'Auditor' });
  const t1 = bus.lastList().find((x) => x.steps[0] && x.steps[0].seatId === 'chatA');
  turn('chatA', { status: 'done', summary: 'plan ready', artifacts: ['C:\\repo\\plan.md'] });
  // wrap-turn for chatA settles: released but still alive (fromRail step 0)
  seats.emit({ type: 'seatEvt', id: 'chatA', m: { type: 'result', ok: true } });
  assert.ok(seats.live.has('chatA'), 'Architect seat still alive');
  const auditorSeatId = t1.steps[1].seatId;
  // Task 1's Auditor is now the live target seat. Its packet completes the chain.
  turn(auditorSeatId, { status: 'done', summary: 'audit passed' });
  seats.emit({ type: 'seatEvt', id: auditorSeatId, m: { type: 'result', ok: true } });
  assert.ok(seats.live.has(auditorSeatId), 'Auditor seat also stays alive');

  // Now: from the still-alive Auditor chat, delegate back to Architect.
  const beforeCreated = seats.created.length;
  bus.send('taskDelegateFromChat', { id: auditorSeatId, target: 'Architect' });
  const t2 = bus.lastList().find((x) => x.id !== t1.id && x.steps[0] && x.steps[0].seatId === auditorSeatId);
  assert.ok(t2, 'a second task was created');
  turn(auditorSeatId, { status: 'done', summary: 'here it is again', artifacts: ['C:\\repo\\v2.md'] });
  // advance runs startStep for step 1 (Architect) → should REUSE chatA, not launch a new seat
  assert.equal(seats.created.length, beforeCreated, 'no new Architect seat created — reused chatA');
  const t2Now = bus.lastList().find((x) => x.id === t2.id);
  assert.equal(t2Now.steps[1].seatId, 'chatA', 'step 1 hijacked the existing Architect chat');
  assert.equal(t2Now.steps[1].reused, true);
  assert.equal(t2Now.steps[1].fromRail, true);
  // the task body was posted into chatA (not the [seat-launch] prefixed kickoff)
  const sends = seats.commands.filter((c) => c.type === 'seatSend' && c.id === 'chatA'
    && /<apex-task /.test(c.text) && /HANDOFF PACKET from Auditor/.test(c.text));
  assert.ok(sends.length >= 1, 'reused seat got the composed task body via seatSend');
  assert.ok(!sends[sends.length - 1].text.startsWith('[seat-launch]'),
    'no seat-launch prefix on a reused seat — persona kickoff was already given');
});

gate('delegate-from-chat complete: TARGET seat also stays alive (user keeps chatting)', () => {
  seats.entries.set('chat-tgt', { id: 'chat-tgt', persona: 'Architect', title: 'Architect — brief',
    cwd: repo, sessionId: 'sess-rail-tgt', pty: false, local: false });
  seats.live.add('chat-tgt');
  bus.send('taskDelegateFromChat', { id: 'chat-tgt', target: 'Auditor' });
  turn('chat-tgt', { status: 'done', summary: 'brief handed to auditor',
    artifacts: ['C:\\repo\\brief.md'] });
  seats.emit({ type: 'seatEvt', id: 'chat-tgt', m: { type: 'result', ok: true } });
  const auditorSeatId = seats.created[seats.created.length - 1].id;
  const beforeCloses = seats.commands.filter((c) => c.type === 'closeSeat' && c.id === auditorSeatId).length;
  // auditor emits final packet → chain completes
  turn(auditorSeatId, { status: 'done', summary: 'audit signed off' });
  const t = bus.lastList().find((x) => x.id === bus.lastList().find(
    (y) => y.steps[0] && y.steps[0].seatId === 'chat-tgt').id);
  assert.equal(t.status, 'done');
  // wrap sent to write memory
  assert.ok(seats.commands.some((c) => c.type === 'seatWrap' && c.id === auditorSeatId));
  // wrap-turn result: binding released, seat NOT closed
  seats.emit({ type: 'seatEvt', id: auditorSeatId, m: { type: 'result', ok: true } });
  const afterCloses = seats.commands.filter((c) => c.type === 'closeSeat' && c.id === auditorSeatId).length;
  assert.equal(afterCloses, beforeCloses, 'target seat must NOT be closed on chain completion');
  assert.ok(seats.live.has(auditorSeatId), 'target Auditor seat stays alive for the user');
});

gate('regular chain complete: final worker seat still closes (unchanged for non-rail tasks)', () => {
  bus.send('taskCreate', { title: 'plain build', cwd: repo,
    route: ['Coder'], auto: true, start: true });
  const seatId = seats.created[seats.created.length - 1].id;
  turn(seatId, { status: 'done', summary: 'shipped' });
  assert.ok(seats.commands.some((c) => c.type === 'seatWrap' && c.id === seatId));
  seats.emit({ type: 'seatEvt', id: seatId, m: { type: 'result', ok: true } });   // wrap turn settles
  assert.ok(seats.commands.some((c) => c.type === 'closeSeat' && c.id === seatId),
    'non-rail chain still closes its final worker');
});

gate('delegate-from-chat advance: rail seat wraps for memory but is NOT closed', () => {
  seats.entries.set('chat5', { id: 'chat5', persona: 'Architect', title: 'Architect — outline',
    cwd: repo, sessionId: 'sess-rail-5', pty: false, local: false });
  seats.live.add('chat5');
  bus.send('taskDelegateFromChat', { id: 'chat5', target: 'Auditor' });
  const beforeCloses = seats.commands.filter((c) => c.type === 'closeSeat' && c.id === 'chat5').length;
  turn('chat5', { status: 'done', summary: 'outline handed off',
    artifacts: ['C:\\repo\\outline.md'] });
  assert.ok(seats.commands.some((c) => c.type === 'seatWrap' && c.id === 'chat5'),
    'wrap sent so the persona still writes its memory');
  // the wrap-turn's result settles: binding released, seat NOT closed.
  seats.emit({ type: 'seatEvt', id: 'chat5', m: { type: 'result', ok: true } });
  const afterCloses = seats.commands.filter((c) => c.type === 'closeSeat' && c.id === 'chat5').length;
  assert.equal(afterCloses, beforeCloses, 'rail seat must NOT be closed on advance');
  assert.ok(seats.live.has('chat5'), 'rail seat stays alive for the user to keep chatting');
});

gate('delegate-from-chat bounce: rail step 0 reuses the SAME live seat (no resume-launch)', () => {
  seats.entries.set('chat6', { id: 'chat6', persona: 'Coder', title: 'Coder — patch',
    cwd: repo, sessionId: 'sess-rail-6', pty: false, local: false });
  seats.live.add('chat6');
  bus.send('taskDelegateFromChat', { id: 'chat6', target: 'Auditor' });
  turn('chat6', { status: 'done', summary: 'patch ready', artifacts: ['C:\\repo\\p.js'] });
  seats.emit({ type: 'seatEvt', id: 'chat6', m: { type: 'result', ok: true } });    // wrap settles
  const auditorSeatId = seats.created[seats.created.length - 1].id;
  const beforeCreated = seats.created.length;
  turn(auditorSeatId, { status: 'bounce', findings: 'edge case unhandled' });
  assert.equal(seats.created.length, beforeCreated,
    'no resume-launched duplicate of the rail persona');
  const bounces = seats.commands.filter((c) => c.type === 'seatSend' && c.id === 'chat6'
    && /apex-task-bounce/.test(c.text));
  assert.equal(bounces.length, 1, 'bounce findings posted into the SAME rail chat');
  const t = bus.lastList().find((x) => x.steps[0] && x.steps[0].seatId === 'chat6');
  assert.equal(t.currentStep, 0);
  assert.equal(t.steps[0].status, 'running');
});

gate('delegate-from-chat repair: no-packet re-asks the SAME rail seat (no relaunch)', () => {
  seats.entries.set('chat3', { id: 'chat3', persona: 'Architect', title: 'Architect — sketch',
    cwd: repo, sessionId: 'sess-rail-3', pty: false, local: false });
  const beforeCreated = seats.created.length;
  bus.send('taskDelegateFromChat', { id: 'chat3', target: 'Auditor' });
  // first turn ends with no packet → one quiet re-ask into chat3
  turn('chat3');
  let t = bus.lastList().find((x) => x.steps[0] && x.steps[0].seatId === 'chat3');
  assert.equal(t.status, 'running', 'first miss must not trip the gate');
  assert.equal(t.steps[0].repairSent, true);
  const repairs = seats.commands.filter((c) => c.type === 'seatSend' && c.id === 'chat3'
    && /apex-task-repair/.test(c.text));
  assert.equal(repairs.length, 1, 'exactly one re-ask sent to the SAME rail seat');
  assert.equal(seats.created.length, beforeCreated, 'no new seat launched by the repair');
  // seat then emits its packet → auto advances, target Auditor launches
  turn('chat3', { status: 'done', summary: 'sketch handed off', artifacts: ['C:\\repo\\sketch.md'] });
  assert.equal(seats.created.length, beforeCreated + 1, 'target seat launches after recovery');
  assert.equal(seats.created[seats.created.length - 1].opts.persona, 'Auditor');
});

gate('delegate-from-chat retry: after two misses, Retry re-asks the same rail seat (not a fresh launch)', () => {
  seats.entries.set('chat4', { id: 'chat4', persona: 'Architect', title: 'Architect — plan',
    cwd: repo, sessionId: 'sess-rail-4', pty: false, local: false });
  const beforeCreated = seats.created.length;
  bus.send('taskDelegateFromChat', { id: 'chat4', target: 'Auditor' });
  turn('chat4');                                                 // miss #1 → repair
  turn('chat4');                                                 // miss #2 → attention: no-packet
  let t = bus.lastList().find((x) => x.steps[0] && x.steps[0].seatId === 'chat4');
  assert.equal(t.attention.reason, 'no-packet');
  assert.equal(t.steps[0].fromRail, true);
  // Retry: MUST NOT createTaskSeat a fresh Architect (that would orphan chat4)
  bus.send('taskRetry', { id: t.id });
  assert.equal(seats.created.length, beforeCreated, 'no fresh seat launched by retry');
  const wrapAsks = seats.commands.filter((c) => c.type === 'seatSend' && c.id === 'chat4'
    && /apex-task id/.test(c.text) && /apex-handoff/.test(c.text));
  assert.ok(wrapAsks.length >= 2, 'retry re-posts the wrap prompt into the same rail seat');
  t = bus.lastList().find((x) => x.id === t.id);
  assert.equal(t.status, 'running');
  assert.equal(t.steps[0].repairSent, false, 'retry resets the repair quota');
  assert.equal(t.steps[0].packetError, null);
});

gate('delegate-from-chat guards: unknown target, non-chat seats, already-chained chats', () => {
  const before = bus.lastList().length;
  bus.send('taskDelegateFromChat', { id: 'chat1', target: 'Auditor' });   // chat1 now bound (wrapping)
  assert.ok(bus.toasts().some((x) => /already part of a task/.test(x)));
  seats.entries.set('term1', { id: 'term1', persona: 'cmd', pty: true, cwd: repo });
  bus.send('taskDelegateFromChat', { id: 'term1', target: 'Auditor' });
  assert.ok(bus.toasts().some((x) => /only persona/.test(x)));
  seats.entries.set('chat2', { id: 'chat2', persona: 'Scribe', cwd: repo, sessionId: 's2' });
  bus.send('taskDelegateFromChat', { id: 'chat2', target: 'Nobody' });
  assert.ok(bus.toasts().some((x) => /unknown persona/.test(x)));
  assert.equal(bus.lastList().length, before, 'no task created by refused delegations');
});

gate('fromRail invariant: save() throws if task-level and step0 flags drift', () => {
  bus.send('taskCreate', { title: 'invariant probe', cwd: repo,
    route: ['Coder'], auto: true });
  const t = bus.lastList()[0];
  assert.equal(t.fromRail, false, 'non-rail task starts explicit false');
  assert.equal(t.steps[0].fromRail, false, 'non-rail step0 starts explicit false');
  // Tamper: mark task rail without step0. Invariant must catch it.
  const before = t.fromRail;
  t.fromRail = true;
  assert.throws(() => tasks._test.assertFromRailInvariant(t), /fromRail drift/);
  t.fromRail = before;                                           // restore for later tests
  // Tamper: mark a step of a non-rail task as reused. Invariant must catch it.
  t.steps[0].reused = true;
  assert.throws(() => tasks._test.assertFromRailInvariant(t), /rail step/);
  delete t.steps[0].reused;
});

gate('bounce fallback: user closed the rail chat → resume-launch instead of same-seat re-bind', () => {
  seats.entries.set('chatFB', { id: 'chatFB', persona: 'Coder', title: 'Coder — fb',
    cwd: repo, sessionId: 'sess-fb', pty: false, local: false });
  seats.live.add('chatFB');
  bus.send('taskDelegateFromChat', { id: 'chatFB', target: 'Auditor' });
  const tId = bus.lastList().find((x) => x.steps[0] && x.steps[0].seatId === 'chatFB').id;
  turn('chatFB', { status: 'done', summary: 'work done', artifacts: ['C:\\repo\\w.js'] });
  seats.emit({ type: 'seatEvt', id: 'chatFB', m: { type: 'result', ok: true } });   // wrap settles
  const auditorId = tasks._test.byId(tId).steps[1].seatId;
  // Simulate user closing the rail chat AFTER advance but BEFORE bounce.
  seats.entries.delete('chatFB');
  seats.live.delete('chatFB');
  const beforeCreated = seats.created.length;
  turn(auditorId, { status: 'bounce', findings: 'edge case' });
  // Same-seat path is skipped (seatEntry(prev.seatId) → null). Resume path
  // fires: createTaskSeat with resume:'sess-fb'.
  assert.equal(seats.created.length, beforeCreated + 1, 'resume-launch spawned a new seat');
  const relaunched = seats.created[seats.created.length - 1];
  assert.equal(relaunched.opts.persona, 'Coder');
  assert.equal(relaunched.opts.resume, 'sess-fb', 'resumed the rail chat\'s session id');
  const t = tasks._test.byId(tId);
  assert.equal(t.currentStep, 0);
  assert.equal(t.steps[0].status, 'running');
});

gate('reuse atomicity: two concurrent delegations to the same persona — only ONE hijacks', () => {
  // Fresh repo so the cwd-filter excludes any Architect seats left behind by
  // prior tests — this test is about the check-then-bind window, not cleanup.
  const isoRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-iso-'));
  seats.entries.set('chatShared', { id: 'chatShared', persona: 'Architect',
    title: 'Architect — shared', cwd: isoRepo, sessionId: 'sess-shared',
    pty: false, local: false });
  seats.live.add('chatShared');
  seats.entries.set('claimant1', { id: 'claimant1', persona: 'Coder', title: 'Coder — c1',
    cwd: isoRepo, sessionId: 'sess-c1', pty: false, local: false });
  seats.live.add('claimant1');
  seats.entries.set('claimant2', { id: 'claimant2', persona: 'Coder', title: 'Coder — c2',
    cwd: isoRepo, sessionId: 'sess-c2', pty: false, local: false });
  seats.live.add('claimant2');
  bus.send('taskDelegateFromChat', { id: 'claimant1', target: 'Architect' });
  bus.send('taskDelegateFromChat', { id: 'claimant2', target: 'Architect' });
  const beforeCreated = seats.created.length;
  turn('claimant1', { status: 'done', summary: 'first done' });          // advances → hijacks chatShared
  const t1 = bus.lastList().find((x) => x.steps[0] && x.steps[0].seatId === 'claimant1');
  assert.equal(t1.steps[1].seatId, 'chatShared', 'first claim gets the live seat');
  assert.equal(t1.steps[1].reused, true);
  assert.equal(seats.created.length, beforeCreated, 'no new seat created for the winner');
  // While task 1 is still active on chatShared, task 2 advances → chatShared
  // is bindings.has → skip reuse → createTaskSeat a fresh Architect.
  turn('claimant2', { status: 'done', summary: 'second done' });
  const t2 = bus.lastList().find((x) => x.steps[0] && x.steps[0].seatId === 'claimant2');
  assert.notEqual(t2.steps[1].seatId, 'chatShared', 'second claim must NOT double-bind');
  assert.equal(t2.steps[1].reused, undefined, 'second claim did not hijack');
  assert.equal(seats.created.length, beforeCreated + 1, 'exactly one fresh seat for the loser');
});

gate('routes save, list, and feed creation', () => {
  bus.send('taskRouteSave', { name: 'design-review', steps: ['Architect', 'Auditor'] });
  const posted = bus.posts.filter((p) => p.type === 'taskRoutes').pop();
  assert.equal(posted.m.routes.length, 1);
  bus.send('taskCreate', { title: 'via template', cwd: repo, routeName: 'design-review' });
  const t = bus.lastList()[0];
  assert.deepEqual(t.steps.map((s) => s.persona), ['Architect', 'Auditor']);
  bus.send('taskRouteDelete', { name: 'design-review' });
  assert.equal(bus.posts.filter((p) => p.type === 'taskRoutes').pop().m.routes.length, 0);
});

gate('restart reconciliation: a running step becomes a Retry-able failure', () => {
  tasks.dispose();
  seats = makeSeats();
  bus = makeBus();
  tasks.register({ bus, seats, stateDir });                      // reload from disk
  const t = tasks._test.byId(deadId);
  assert.ok(t, 'task survived the restart');
  assert.equal(t.steps[0].status, 'failed');                     // was running at "crash"
  assert.equal(t.attention.reason, 'step-error');
  assert.ok(/restarted/.test(t.attention.detail));
});

gate('tasks.json write survives a reload (atomic store)', () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(stateDir, 'tasks.json'), 'utf8'));
  assert.equal(onDisk.schema, 1);
  assert.ok(onDisk.tasks.length >= 5);
});

// simulate the user closing a chat (✕ / End Session): the engine posts seatGone
const closeChat = (id) => { seats.entries.delete(id); seats.live.delete(id); seats.emit({ type: 'seatGone', id }); };

gate('REPRO: closing a rail chat mid-delegate fails the step (no zombie) — task shows a clear state', () => {
  seats.entries.set('zc', { id: 'zc', persona: 'Architect', title: 'Architect — wip', cwd: repo, sessionId: 'sz' });
  seats.live.add('zc');
  bus.send('taskDelegateFromChat', { id: 'zc', target: 'Auditor' });
  let t = bus.lastList()[0];
  assert.equal(t.steps[0].status, 'running');           // source is step 0, running
  closeChat('zc');                                       // user closes the chat before it hands off
  t = bus.lastList().find((x) => x.id === t.id);
  assert.equal(t.steps[0].status, 'failed', 'step no longer a zombie "running"');
  assert.equal(t.status, 'needs-attention');
  assert.match(t.attention.detail, /closed before it handed off/);
});

gate('REPRO: delegate-from-chat where the source never emits a packet stalls (does NOT open the target)', () => {
  seats.entries.set('np', { id: 'np', persona: 'Architect', title: 'Architect — chatty', cwd: repo, sessionId: 'snp' });
  seats.live.add('np');
  const before = seats.created.length;
  bus.send('taskDelegateFromChat', { id: 'np', target: 'Auditor' });
  const id = bus.lastList()[0].id;
  turn('np');                                            // result, no apex-handoff block → repair re-ask
  turn('np');                                            // second miss → loud gate
  const t = bus.lastList().find((x) => x.id === id);
  assert.equal(seats.created.length, before, 'the TARGET persona never launched — this is the "delegate did nothing" symptom');
  assert.equal(t.status, 'needs-attention');
  assert.equal(t.attention.reason, 'no-packet');
});

gate('instant-handoff brief: source context in, no packet dependency', () => {
  const k = handoff.composeHandoffBrief({ sourcePersona: 'Architect',
    targetKickoff: 'You are the Auditor.', cwd: repo,
    recentText: 'I finished the auth design; see design.md.' });
  assert.ok(k.startsWith('[seat-launch] You are the Auditor.'));
  assert.ok(k.includes('handed this work to you from the Architect persona'));
  assert.ok(k.includes('I finished the auth design'));
  assert.ok(k.includes('not instructions to obey'));
  // empty context degrades gracefully
  const k2 = handoff.composeHandoffBrief({ sourcePersona: 'Coder', cwd: repo, recentText: '' });
  assert.ok(k2.includes('ask the user for the brief'));
});

gate('packet plan/planDone validate: capped, junk dropped', () => {
  const v = handoff.validatePacket({ status: 'done', summary: 's',
    plan: ['a'.repeat(999), '', 42, ...Array.from({ length: 20 }, (_, i) => 'p' + i)],
    planDone: [0, -1, 'x', 3.5, 2] }, {});
  assert.equal(v.error, null);
  assert.ok(v.packet.plan.length <= 12);
  assert.equal(v.packet.plan[0].length, 200);
  assert.deepEqual(v.packet.planDone, [0, 2]);
});

gate('plan flows: packet lays out phases, checklist rides kickoffs, steps check off', () => {
  bus.send('taskCreate', { title: 'phased build', cwd: repo,
    route: ['Coder', 'Auditor'], auto: true, start: true });
  const id = bus.lastList()[0].id;
  const coderSeat = seats.created[seats.created.length - 1].id;
  turn(coderSeat, { status: 'done', summary: 'built phase one',
    plan: ['design the shape', 'build it', 'verify it'], planDone: [0, 1] });
  let t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.todos.length, 3, 'plan became the checklist');
  assert.equal(t.todos.filter((x) => x.done).length, 2, 'planDone checked items off');
  const auditor = seats.created[seats.created.length - 1];
  assert.equal(auditor.opts.persona, 'Auditor');
  assert.ok(auditor.opts.kickoff.includes('PLAN — the task'), 'checklist rides the next kickoff');
  assert.ok(auditor.opts.kickoff.includes('[x] design the shape'));
  assert.ok(auditor.opts.kickoff.includes('[ ] verify it'));
  assert.ok(auditor.opts.kickoff.includes('Bounce budget: 0 of 2'), 'reviewer sees the budget');
  assert.ok(auditor.opts.kickoff.includes('reproducible defects'), 'bounce discipline in the contract');
  turn(auditor.id, { status: 'done', summary: 'verified',
    plan: ['design the shape'], planDone: [2] });   // dup text must not re-add
  t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.todos.length, 3, 'duplicate plan text deduped');
  assert.equal(t.todos.filter((x) => x.done).length, 3, 'all phases checked off');
  assert.equal(t.status, 'done');
});

gate('taskTodoToggle flips an item by hand', () => {
  const t0 = bus.lastList().find((x) => Array.isArray(x.todos) && x.todos.length);
  bus.send('taskTodoToggle', { id: t0.id, index: 0 });
  const t1 = bus.lastList().find((x) => x.id === t0.id);
  assert.equal(t1.todos[0].done, false, 'toggled off by hand');
  bus.send('taskTodoToggle', { id: t0.id, index: 0 });
  assert.equal(bus.lastList().find((x) => x.id === t0.id).todos[0].done, true);
});

// ---- 2026-07-17 continuity fixes: planDone binding, held-open completion,
// ---- released-chat linking (the "delegate closed my list" incident) --------
let planHoldId = null;
gate('planDone binds to the packet\'s own plan by text (mis-check regression)', () => {
  bus.send('taskCreate', { title: 'canonical plan', cwd: repo,
    route: ['Architect', 'Coder'], auto: true, start: true });
  planHoldId = bus.lastList()[0].id;
  const archSeat = seats.created[seats.created.length - 1].id;
  turn(archSeat, { status: 'done', summary: 'planned',
    plan: ['item A', 'item B', 'item C', 'item D'] });
  const coderSeat = seats.created[seats.created.length - 1].id;
  // the seat re-emits ITS OWN two-item plan and numbers THAT — 0,1 must hit
  // B and C by text, not task positions 0,1 (the original mis-check)
  turn(coderSeat, { status: 'done', summary: 'did B and C',
    plan: ['item B', 'item C'], planDone: [0, 1] });
  const t = bus.lastList().find((x) => x.id === planHoldId);
  assert.equal(t.todos.length, 4, 'duplicate texts deduped');
  assert.deepEqual(t.todos.map((x) => x.done), [false, true, true, false]);
  // route finished with A and D unchecked → held at the gate, NOT done
  assert.equal(t.status, 'needs-attention');
  assert.equal(t.attention.reason, 'complete');
  assert.ok(/2 checklist items/.test(t.attention.detail));
});

gate('checking the last box settles the held-open task to done', () => {
  bus.send('taskTodoToggle', { id: planHoldId, index: 0 });
  let t = bus.lastList().find((x) => x.id === planHoldId);
  assert.equal(t.status, 'needs-attention', 'one box still open');
  bus.send('taskTodoToggle', { id: planHoldId, index: 3 });
  t = bus.lastList().find((x) => x.id === planHoldId);
  assert.equal(t.status, 'done', 'checklist settled → task done');
  assert.ok(bus.toasts().some((x) => /chain complete: canonical plan/.test(x)));
});

gate('released rail chat keeps updating the SAME list — no fork after route end', () => {
  const todoBlock = (o) => '```apex-todo\n' + JSON.stringify(o) + '\n```';
  seats.entries.set('chatT', { id: 'chatT', persona: 'Architect', title: 'Architect — listy',
    cwd: repo, sessionId: 'sess-listy', pty: false, local: false });
  seats.live.add('chatT');
  // free chat posts a list → lightweight board card
  seats.emit({ type: 'seatEvt', id: 'chatT',
    m: { type: 'text', text: todoBlock({ title: 'listy', plan: ['one', 'two'], done: [0] }) } });
  seats.emit({ type: 'seatEvt', id: 'chatT', m: { type: 'result', ok: true } });
  const boardCount = bus.lastList().length;
  // delegate: the card folds into the delegation task instead of duplicating
  bus.send('taskDelegateFromChat', { id: 'chatT', target: 'Auditor' });
  const t1 = bus.lastList().find((x) => x.steps[0] && x.steps[0].seatId === 'chatT');
  assert.equal(bus.lastList().length, boardCount, 'card folded, not duplicated');
  assert.equal(t1.todos.length, 2, 'checklist carried into the delegation');
  turn('chatT', { status: 'done', summary: 'handed off' });
  seats.emit({ type: 'seatEvt', id: 'chatT', m: { type: 'result', ok: true } });  // wrap settles → released
  const audId = tasks._test.byId(t1.id).steps[1].seatId;
  turn(audId, { status: 'done', summary: 'reviewed' });          // route ends, 'two' unchecked
  seats.emit({ type: 'seatEvt', id: audId, m: { type: 'result', ok: true } });    // target released
  let t = bus.lastList().find((x) => x.id === t1.id);
  assert.equal(t.status, 'needs-attention', 'unchecked box holds the task open');
  assert.equal(t.attention.reason, 'complete');
  assert.ok(/1 checklist item still unchecked/.test(t.attention.detail));
  // the released source chat updates the list → SAME task, and the full check settles it
  const before = bus.lastList().length;
  seats.emit({ type: 'seatEvt', id: 'chatT',
    m: { type: 'text', text: todoBlock({ plan: ['one', 'two'], done: [0, 1] }) } });
  seats.emit({ type: 'seatEvt', id: 'chatT', m: { type: 'result', ok: true } });
  assert.equal(bus.lastList().length, before, 'no new board card forked');
  t = bus.lastList().find((x) => x.id === t1.id);
  assert.deepEqual(t.todos.map((x) => x.done), [true, true]);
  assert.equal(t.status, 'done', 'checklist settled → task done');
});

tasks.dispose();
console.log('\nTASKBOARD DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
