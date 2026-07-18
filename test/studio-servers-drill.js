// STUDIO — headless drill for Wave B slice B1 (the dev-server runner):
// lib/servers.js's config persistence (atomic, schema-versioned, machine-side),
// the lifecycle state machine driven through the injectable spawner seam (a
// stub here — zero real processes ever launch), ready detection (regex, port
// probe, fallback timeout), the bounded log ring, the containment guard, the
// args-array no-injection guarantee, and the main.js bus verbs + dispose path
// (every server dies with the extension). Harness idiom mirrors
// test/studio-liftoff-drill.js: fake bus, stubbed ctx, real studio.register.
// Run: node test/studio-servers-drill.js
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const servers = require('../extensions/studio/lib/servers');
const studio = require('../extensions/studio/main');
const drafts = require('../extensions/studio/lib/drafts');
const { CARDS } = require('../extensions/studio/lib/interview');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-servers-'));
let passed = 0, failed = 0;

async function gate(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the stub spawner: fake children, recorded spawns, recorded kills ------

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1000 + Math.floor(Math.random() * 9000);
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

function stubSpawner() {
  const calls = [];
  const killed = [];
  return {
    calls, killed,
    spawn(command, args, opts) {
      const child = fakeChild();
      calls.push({ command, args, opts, child });
      return child;
    },
    kill(child) { killed.push(child); child.exitCode = 0; },
  };
}

const feed = (stream, text) => stream.emit('data', Buffer.from(text, 'utf8'));

(async () => {

// ==========================================================================
// config persistence — atomic, schema-versioned, machine-side
// ==========================================================================

await gate('a launch config round-trips through servers.json (schema 1, both projects kept)', () => {
  const stateDir = fs.mkdtempSync(path.join(scratch, 'cfg-'));
  const written = servers.writeServerConfig(stateDir, 'my-app', {
    command: 'npm', args: ['run', 'dev'], cwd: null, port: 5173, readyRegex: 'ready in',
  });
  assert.deepEqual(written, { command: 'npm', args: ['run', 'dev'], cwd: null, port: 5173, readyRegex: 'ready in' });
  servers.writeServerConfig(stateDir, 'other-app', { command: 'node', args: ['server.js'] });
  const file = JSON.parse(fs.readFileSync(path.join(stateDir, 'servers.json'), 'utf8'));
  assert.equal(file.schema, 1);
  assert.deepEqual(servers.readServerConfig(stateDir, 'my-app'), written, 'first project survives the second write');
  assert.deepEqual(servers.readServerConfig(stateDir, 'other-app').args, ['server.js']);
  assert.equal(servers.readServerConfig(stateDir, 'never-saved'), null);
});

await gate('hostile/invalid configs are rejected with plain errors', () => {
  const stateDir = fs.mkdtempSync(path.join(scratch, 'cfg-bad-'));
  assert.throws(() => servers.writeServerConfig(stateDir, 'x-app', { command: '' }), /needs a command/);
  assert.throws(() => servers.writeServerConfig(stateDir, 'x-app', { command: 'npm', args: 'run dev' }),
    /array of strings — never one shell line/);
  assert.throws(() => servers.writeServerConfig(stateDir, 'x-app', { command: 'npm', args: [42] }), /must be a string/);
  assert.throws(() => servers.writeServerConfig(stateDir, 'x-app',
    { command: 'npm', args: new Array(40).fill('a') }), /at most 32/);
  assert.throws(() => servers.writeServerConfig(stateDir, 'x-app', { command: 'npm', cwd: 'relative/dir' }),
    /absolute path/);
  assert.throws(() => servers.writeServerConfig(stateDir, 'x-app', { command: 'npm', port: 0 }), /between 1 and 65535/);
  assert.throws(() => servers.writeServerConfig(stateDir, 'x-app', { command: 'npm', port: '3000' }), /whole number/);
  assert.throws(() => servers.writeServerConfig(stateDir, 'x-app', { command: 'npm', readyRegex: '(' }),
    /not a valid regular expression/);
  assert.throws(() => servers.writeServerConfig(stateDir, '../evil', { command: 'npm' }), /valid project id/);
  assert.ok(!fs.existsSync(path.join(stateDir, 'servers.json')), 'nothing was written');
});

await gate('a corrupt servers.json fails soft (empty + story) and the next write recovers it', () => {
  const stateDir = fs.mkdtempSync(path.join(scratch, 'cfg-corrupt-'));
  fs.writeFileSync(path.join(stateDir, 'servers.json'), '{ not json', 'utf8');
  const read = servers.readServerConfigs(stateDir);
  assert.deepEqual(read.servers, {});
  assert.match(read.error, /invalid/);
  servers.writeServerConfig(stateDir, 'my-app', { command: 'npm' });
  assert.equal(servers.readServerConfigs(stateDir).error, null, 'the atomic rewrite healed the file');
});

// ==========================================================================
// containment — cwd must sit inside an allowed root
// ==========================================================================

await gate('containment: roots and their children pass; siblings, prefix-twins, traversals, relatives refuse', () => {
  const rootA = fs.mkdtempSync(path.join(scratch, 'rootA-'));
  const rootB = fs.mkdtempSync(path.join(scratch, 'rootB-'));
  const roots = [rootA, rootB];
  assert.equal(servers.isCwdContained(rootA, roots), true, 'the root itself');
  assert.equal(servers.isCwdContained(path.join(rootA, 'app', 'web'), roots), true, 'a child');
  assert.equal(servers.isCwdContained(path.join(rootB, 'x'), roots), true, 'the second root works too');
  assert.equal(servers.isCwdContained(rootA + '-evil', roots), false, 'prefix twin (ws vs ws-evil)');
  assert.equal(servers.isCwdContained(path.join(rootA, '..', 'somewhere'), roots), false, 'dot-dot traversal');
  assert.equal(servers.isCwdContained(path.dirname(rootA), roots), false, 'the parent');
  assert.equal(servers.isCwdContained('relative/dir', roots), false, 'relative cwd');
  assert.equal(servers.isCwdContained(rootA, []), false, 'no roots = nothing allowed');
  assert.throws(() => servers.assertCwdContained(os.tmpdir(), [rootA]), /must be inside/);
});

// ==========================================================================
// the lifecycle machine — stubbed spawner, zero real processes
// ==========================================================================

function harnessManager(tuning = {}) {
  const spawner = stubSpawner();
  const states = [];
  const logs = [];
  const manager = servers.createServerManager({
    spawner,
    onState: (s) => states.push(s),
    onLog: (d) => logs.push(d),
    readyTimeoutMs: tuning.readyTimeoutMs || 60 * 1000,
    portPollMs: tuning.portPollMs || 60 * 1000,
    portProbe: tuning.portProbe,
  });
  return { spawner, states, logs, manager };
}

const projectRoot = fs.mkdtempSync(path.join(scratch, 'proj-'));
const baseStart = (overrides = {}) => ({
  projectId: 'my-app',
  config: { command: 'npm', args: ['run', 'dev'], readyRegex: 'ready in' },
  fallbackCwd: projectRoot,
  allowedRoots: [projectRoot],
  ...overrides,
});

await gate('stopped → starting → ready (regex on stdout) → stopped: the machine in order', () => {
  const h = harnessManager();
  assert.equal(h.manager.state('my-app').phase, 'stopped');
  h.manager.start(baseStart());
  assert.equal(h.manager.state('my-app').phase, 'starting');
  const child = h.spawner.calls[0].child;
  feed(child.stdout, 'vite v5 dev server\nready in 312ms\n');
  assert.equal(h.manager.state('my-app').phase, 'ready');
  h.manager.stop('my-app');
  assert.equal(h.manager.state('my-app').phase, 'stopped');
  assert.equal(h.spawner.killed.length, 1, 'stop went through the kill seam (the tree-kill in production)');
  assert.deepEqual(h.states.map((s) => s.phase), ['starting', 'ready', 'stopped']);
});

await gate('regex on stderr counts too; a restart after stop spawns a fresh child', () => {
  const h = harnessManager();
  h.manager.start(baseStart());
  feed(h.spawner.calls[0].child.stderr, 'ready in 45ms\n');
  assert.equal(h.manager.state('my-app').phase, 'ready');
  h.manager.stop('my-app');
  h.manager.start(baseStart());
  assert.equal(h.spawner.calls.length, 2, 'a second spawn, not a reuse');
  assert.equal(h.manager.state('my-app').phase, 'starting');
});

await gate('an exit during starting is failed (nonzero) or stopped (zero); a stopped stop() refuses', () => {
  const h = harnessManager();
  h.manager.start(baseStart());
  const child = h.spawner.calls[0].child;
  child.exitCode = 1;
  child.emit('exit', 1, null);
  assert.equal(h.manager.state('my-app').phase, 'failed');
  assert.ok(h.manager.state('my-app').logTail.some((l) => l.includes('code 1')), 'the exit tells its story in the log');
  assert.throws(() => h.manager.stop('my-app'), /not running/);

  h.manager.start(baseStart({ projectId: 'other-app' }));
  const child2 = h.spawner.calls[1].child;
  child2.exitCode = 0;
  child2.emit('exit', 0, null);
  assert.equal(h.manager.state('other-app').phase, 'stopped');
});

await gate('a second start while starting/ready refuses; containment refuses BEFORE any spawn', () => {
  const h = harnessManager();
  h.manager.start(baseStart());
  assert.throws(() => h.manager.start(baseStart()), /already running/);
  assert.throws(() => h.manager.start(baseStart({
    projectId: 'esc-app',
    config: { command: 'npm', cwd: os.tmpdir() },
  })), /must be inside/);
  assert.equal(h.spawner.calls.length, 1, 'the refused starts never reached the spawner');
});

// ==========================================================================
// ready detection — port-probe fallback + the hard timeout
// ==========================================================================

await gate('no regex match, but the port answers: the probe flips starting → ready', async () => {
  const h = harnessManager({ portPollMs: 5, portProbe: async () => true });
  h.manager.start(baseStart({ config: { command: 'npm', args: ['run', 'dev'], port: 5173 } }));
  assert.equal(h.manager.state('my-app').phase, 'starting');
  await sleep(40);
  assert.equal(h.manager.state('my-app').phase, 'ready');
  assert.equal(h.manager.state('my-app').port, 5173);
});

await gate('nothing ever signals ready: the fallback timeout assumes up, with an honest log note', async () => {
  const h = harnessManager({ readyTimeoutMs: 15 });
  h.manager.start(baseStart({ config: { command: 'npm', args: ['run', 'dev'] } }));
  await sleep(50);
  assert.equal(h.manager.state('my-app').phase, 'ready');
  assert.ok(h.manager.state('my-app').logTail.some((l) => l.includes('assuming the server is up')));
});

// ==========================================================================
// the log ring — bounded at LOG_RING_MAX lines
// ==========================================================================

await gate('the log ring keeps exactly the last 400 lines and posts every delta', () => {
  const h = harnessManager();
  h.manager.start(baseStart({ config: { command: 'npm' } }));
  const child = h.spawner.calls[0].child;
  for (let i = 1; i <= 450; i++) feed(child.stdout, 'line ' + i + '\n');
  const state = h.manager.state('my-app');
  assert.equal(state.logSize, servers.LOG_RING_MAX, 'ring capped at ' + servers.LOG_RING_MAX);
  assert.equal(state.logTail.length, servers.LOG_TAIL);
  assert.equal(state.logTail.at(-1), 'line 450', 'the tail is the newest');
  const delivered = h.logs.flatMap((d) => d.lines);
  assert.equal(delivered.length, 450, 'every line rode a projectsServerLog delta');
  // an over-long line is truncated, never allowed to eat the ring
  feed(child.stdout, 'x'.repeat(2000) + '\n');
  assert.ok(h.manager.state('my-app').logTail.at(-1).length <= 501);
});

// ==========================================================================
// no-injection — args ARRAY, shell:false, one executable token
// ==========================================================================

await gate('a hostile command string cannot smuggle a second command: one argv token, no shell', () => {
  const h = harnessManager();
  h.manager.start(baseStart({
    config: { command: 'npm run dev && del *.js', args: ['&&', 'evil.exe'] },
  }));
  const call = h.spawner.calls[0];
  assert.equal(call.command, 'npm run dev && del *.js',
    'the whole hostile string stays ONE executable token — nothing re-splits it');
  assert.deepEqual(call.args, ['&&', 'evil.exe'],
    'shell metacharacters in args are inert argv entries');
  assert.equal(call.opts.shell, false, 'spawned with shell:false, always');
  assert.equal(call.opts.env, undefined, 'plain env — the parent environment, nothing injected');
  assert.equal(call.opts.cwd, projectRoot, 'runs in the project cwd');
});

// ==========================================================================
// dispose — every server dies (manager stopAll + the extension dispose path)
// ==========================================================================

await gate('stopAll kills every live server and reports the count', () => {
  const h = harnessManager();
  h.manager.start(baseStart({ projectId: 'app-one' }));
  h.manager.start(baseStart({ projectId: 'app-two' }));
  feed(h.spawner.calls[1].child.stdout, 'ready in 1ms\n');   // one ready, one starting
  assert.equal(h.manager.stopAll(), 2);
  assert.equal(h.spawner.killed.length, 2);
  assert.equal(h.manager.state('app-one').phase, 'stopped');
  assert.equal(h.manager.state('app-two').phase, 'stopped');
  assert.equal(h.manager.stopAll(), 0, 'idempotent — nothing left to kill');
});

// ==========================================================================
// main.js bus wiring — the verbs, the guards, the dispose path
// ==========================================================================

function fakeBus() {
  const handlers = new Map();
  const posts = [];
  return {
    handlers, posts,
    on(type, fn) { handlers.set(type, fn); },
    post(type, payload) { posts.push({ type, payload }); },
    inject() {},
    last(type) { const hits = posts.filter((p) => p.type === type); return hits.at(-1); },
  };
}

function fullAnswers() {
  return Object.fromEntries(CARDS.map((c) => [c.key, c.key + ' answer '.repeat(20)]));
}

function freshHarness(tag, { seatconfig } = {}) {
  const stateDir = path.join(scratch, tag + '-state');
  const workspace = path.join(scratch, tag + '-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  studio.writeWorkspaceConfig(stateDir, workspace);

  const draft = drafts.createDraft(stateDir, workspace, { name: 'SniperSight', pitch: 'Scores entries.' });
  const withAnswers = drafts.updateDraft(stateDir, draft.id, draft.revision, { answers: fullAnswers() });

  const seatconfigFile = path.join(scratch, tag + '-seatconfig.json');
  fs.writeFileSync(seatconfigFile, JSON.stringify(seatconfig || {}), 'utf8');

  const bus = fakeBus();
  const spawner = stubSpawner();
  studio.register({
    bus, stateDir, seatconfigFile,
    serverSpawner: spawner,
    async pickDirectory() { return null; },
    seats: { presetNames() { return ['Architect']; }, registerWorkspace(a) { return { ok: true, ...a }; } },
  });

  // drive the real Create path so the project folder exists on disk
  bus.handlers.get('projectsPreviewGenerate')({
    id: withAnswers.id, expectedRevision: withAnswers.revision, projectId: 'snipersight',
  });
  const fresh = drafts.readDraft(stateDir, withAnswers.id);
  bus.handlers.get('projectsCreate')({ id: fresh.id, expectedRevision: fresh.revision, confirmed: true });
  const created = bus.last('projectsCreateResult').payload;
  assert.equal(created.ok, true, created.error);
  bus.posts.length = 0;
  return { stateDir, workspace, bus, spawner, projectDir: created.projectDir };
}

await gate('projectsServerConfigGet/Save round-trip over the bus; a bad config errors without a write', () => {
  const h = freshHarness('bus-config');
  h.bus.handlers.get('projectsServerConfigGet')({ projectId: 'snipersight' });
  assert.equal(h.bus.last('projectsServerConfig').payload.config, null, 'nothing saved yet');

  h.bus.handlers.get('projectsServerConfigSave')({
    projectId: 'snipersight',
    config: { command: 'npm', args: ['run', 'dev'], port: 5173, readyRegex: 'ready in' },
  });
  const saved = h.bus.last('projectsServerConfig').payload;
  assert.equal(saved.error, null);
  assert.deepEqual(saved.config.args, ['run', 'dev']);
  assert.ok(fs.existsSync(path.join(h.stateDir, 'servers.json')), 'persisted machine-side, in the state dir');

  h.bus.handlers.get('projectsServerConfigSave')({
    projectId: 'snipersight', config: { command: 'npm', args: 'run dev' },
  });
  const refused = h.bus.last('projectsServerConfig').payload;
  assert.match(refused.error, /never one shell line/);
  assert.deepEqual(refused.config.args, ['run', 'dev'], 'the last good config still stands');

  h.bus.handlers.get('projectsServerConfigGet')({ projectId: '../evil' });
  assert.match(h.bus.last('projectsServerConfig').payload.error, /valid project id/);
});

await gate('projectsServerStart/Stop over the bus: guards first, then the lifecycle posts', () => {
  const h = freshHarness('bus-lifecycle');
  // no config yet → refusal rides projectsServerState with the error attached
  h.bus.handlers.get('projectsServerStart')({ projectId: 'snipersight' });
  assert.match(h.bus.last('projectsServerState').payload.error, /Save a launch config first/);
  assert.equal(h.spawner.calls.length, 0);

  h.bus.handlers.get('projectsServerConfigSave')({
    projectId: 'snipersight', config: { command: 'npm', args: ['run', 'dev'], readyRegex: 'ready' },
  });
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsServerStart')({ projectId: 'snipersight' });
  assert.equal(h.bus.last('projectsServerState').payload.phase, 'starting');
  assert.equal(h.spawner.calls[0].opts.cwd, h.projectDir, 'empty cwd = the project folder');

  feed(h.spawner.calls[0].child.stdout, 'ready\n');
  assert.equal(h.bus.last('projectsServerState').payload.phase, 'ready');
  assert.ok(h.bus.posts.some((p) => p.type === 'projectsServerLog'), 'log deltas posted');

  h.bus.handlers.get('projectsServerStop')({ projectId: 'snipersight' });
  assert.equal(h.bus.last('projectsServerState').payload.phase, 'stopped');
  assert.equal(h.spawner.killed.length, 1);

  h.bus.handlers.get('projectsServerStop')({ projectId: 'snipersight' });
  assert.match(h.bus.last('projectsServerState').payload.error, /not running/);
});

await gate('containment over the bus: a cwd outside every root refuses; a registered workspace root admits', () => {
  const registered = fs.mkdtempSync(path.join(scratch, 'registered-ws-'));
  const h = freshHarness('bus-contain', {
    seatconfig: { _workspaces: [{ name: 'Elsewhere', path: registered }] },
  });
  const outside = fs.mkdtempSync(path.join(scratch, 'outside-'));
  h.bus.handlers.get('projectsServerConfigSave')({
    projectId: 'snipersight', config: { command: 'npm', cwd: outside },
  });
  h.bus.handlers.get('projectsServerStart')({ projectId: 'snipersight' });
  assert.match(h.bus.last('projectsServerState').payload.error, /must be inside/);
  assert.equal(h.spawner.calls.length, 0, 'the refusal came before any spawn');

  h.bus.handlers.get('projectsServerConfigSave')({
    projectId: 'snipersight', config: { command: 'npm', cwd: path.join(registered) },
  });
  h.bus.handlers.get('projectsServerStart')({ projectId: 'snipersight' });
  assert.equal(h.bus.last('projectsServerState').payload.phase, 'starting',
    'a registered workspace (seatconfig _workspaces) is an allowed root');
  assert.equal(h.spawner.calls[0].opts.cwd, registered);
});

await gate('the dispose path: studio.dispose() kills every live server across every register()', () => {
  const h1 = freshHarness('bus-dispose-one');
  const h2 = freshHarness('bus-dispose-two');
  for (const h of [h1, h2]) {
    h.bus.handlers.get('projectsServerConfigSave')({
      projectId: 'snipersight', config: { command: 'npm', args: ['run', 'dev'] },
    });
    h.bus.handlers.get('projectsServerStart')({ projectId: 'snipersight' });
    assert.equal(h.bus.last('projectsServerState').payload.phase, 'starting');
  }
  studio.dispose();
  assert.equal(h1.spawner.killed.length, 1, 'harness one\'s server died');
  assert.equal(h2.spawner.killed.length, 1, 'harness two\'s server died');
  assert.equal(h1.bus.last('projectsServerState').payload.phase, 'stopped');
  assert.equal(h2.bus.last('projectsServerState').payload.phase, 'stopped');
});

console.log('\nSTUDIO SERVERS DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);

})().catch((err) => { console.error(err); process.exit(1); });
