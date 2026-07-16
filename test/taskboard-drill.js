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
    ['artifacts', 'decision', 'findings', 'status', 'summary']);
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
  let observer = null;
  let n = 0;
  return {
    created, commands, live,
    emit(m) { if (observer) observer(m); },
    observeSeats(fn) { observer = fn; return () => { observer = null; }; },
    createTaskSeat(opts) { const id = 's' + (++n); created.push({ id, opts }); live.add(id); return id; },
    presetInfo: (name) => PRESETS[name] || null,
    presetNames: () => Object.keys(PRESETS),
    seatCommand(msg) { commands.push(msg); },
    seatEntry(id) { return live.has(id) ? { id } : null; },
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

gate('no packet on an auto chain trips the gate', () => {
  bus.send('taskCreate', { title: 'silent seat', cwd: repo,
    route: ['Coder'], auto: true, start: true });
  const id = bus.lastList()[0].id;
  const seatId = seats.created[seats.created.length - 1].id;
  turn(seatId);                                                  // result, no packet
  const t = bus.lastList().find((x) => x.id === id);
  assert.equal(t.attention.reason, 'no-packet');
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

tasks.dispose();
console.log('\nTASKBOARD DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
