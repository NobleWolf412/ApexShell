// App Builder — headless drill for slice 8 (Create Project + Lift-off):
// lib/creator.js's atomic package write + archive-based removal, lib/liftoff.js's
// pure route/preset decision logic, and the main.js bus wiring for
// projectsCreate/projectsRemove/projectsLiftoff* — driven with a fake bus
// (including a fake .inject, the same seam main/main.js's own smoke code and
// test/live-chain use to call another module's bus verb in-process) and a
// stubbed ctx.seats, exactly like test/studio-codesigner-drill.js drives
// ctx.seats.startDisposable. Zero real seat/task ever launches; zero LLM spend.
// A separate section drills main/tasks.js's own `brief` addition (the step-0
// kickoff carrying PROJECT.md verbatim) against the REAL tasks.js module,
// mirroring test/taskboard-drill.js's own stub-seats harness.
// Slice F2 (§ Wave F): the delegate brief grows the contract addendum —
// composed in lib/liftoff.js (PROJECT.md first, pinned separator, the
// addendum truncated with an honest marker when the tasks.js cap looms) and
// fed from the created package's spine files fail-soft in main.js. The
// separator, marker, and cap number are pinned on THIS side so a drift over
// there fails the gate.
// Run: node test/studio-liftoff-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const creator = require('../extensions/studio/lib/creator');
const liftoff = require('../extensions/studio/lib/liftoff');
const spines = require('../extensions/studio/lib/spines');
const contract = require('../extensions/studio/lib/contract');
const studio = require('../extensions/studio/main');
const drafts = require('../extensions/studio/lib/drafts');
const blueprint = require('../extensions/studio/lib/blueprint');
const { CARDS } = require('../extensions/studio/lib/interview');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-liftoff-'));
let passed = 0, failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
}

function fullDraft(name) {
  const d = { name, pitch: 'Scores entries.', answers: {} };
  for (const c of CARDS) d.answers[c.key] = c.key + ' answer '.repeat(20);
  return d;
}

// ==========================================================================
// lib/creator.js — atomic package write + archive-based removal
// ==========================================================================

gate('a minimal valid project writes atomically and round-trips through validateProjectPackage', () => {
  const ws = fs.mkdtempSync(path.join(scratch, 'ws1-'));
  const bundle = blueprint.buildBundle(fullDraft('SniperSight'), 'snipersight');
  const created = creator.createProjectPackage(ws, bundle);
  assert.equal(created.projectId, 'snipersight');
  assert.ok(fs.existsSync(path.join(created.projectDir, 'PROJECT.md')));
  assert.ok(fs.existsSync(path.join(created.projectDir, 'blueprint.json')));
  assert.ok(fs.existsSync(path.join(created.projectDir, 'project-context.md')));
  const report = contract.validateProjectPackage(ws, 'snipersight');
  assert.equal(report.valid, true, report.errors.map((f) => f.message).join(' · '));
});

gate('a project-id collision is rejected with NO partial write', () => {
  const ws = fs.mkdtempSync(path.join(scratch, 'ws2-'));
  const bundle = blueprint.buildBundle(fullDraft('SniperSight'), 'snipersight');
  creator.createProjectPackage(ws, bundle);
  const before = fs.readdirSync(ws).sort();
  assert.throws(() => creator.createProjectPackage(ws, bundle), /already exists/);
  const after = fs.readdirSync(ws).sort();
  assert.deepEqual(after, before, 'no stray temp/partial files after a rejected collision');
  assert.ok(!after.some((n) => n.includes('.creating-') || n.includes('.create.lock')));
});

gate('path traversal in the project id is rejected before any write', () => {
  const ws = fs.mkdtempSync(path.join(scratch, 'ws3-'));
  const bundle = blueprint.buildBundle(fullDraft('Evil'), 'evil');
  bundle.projectId = '../../evil-escape';
  bundle.blueprint.canonical_hash = bundle.generatedCanonicalHash;   // keep the hash gate happy
  assert.throws(() => creator.createProjectPackage(ws, bundle), /Generate and approve|invalid project id/);
  assert.deepEqual(fs.readdirSync(ws), []);
});

gate('archiving a project moves it under .archive/ and does not delete it', () => {
  const ws = fs.mkdtempSync(path.join(scratch, 'ws4-'));
  const bundle = blueprint.buildBundle(fullDraft('SniperSight'), 'snipersight');
  const created = creator.createProjectPackage(ws, bundle);
  const dest = creator.archiveProject(ws, 'snipersight');
  assert.ok(dest.startsWith(path.join(ws, '.archive')));
  assert.ok(fs.existsSync(path.join(dest, 'PROJECT.md')), 'the package survives the move, nothing deleted');
  assert.ok(!fs.existsSync(created.projectDir), 'the live project folder is gone from its original slot');
});

// ==========================================================================
// lib/liftoff.js — pure route/preset decision logic
// ==========================================================================

gate('findArchitectPreset: exact match wins, then substring, then null', () => {
  assert.equal(liftoff.findArchitectPreset(['Auditor', 'Architect', 'Coder']), 'Architect');
  assert.equal(liftoff.findArchitectPreset(['Auditor', 'Chief Architect']), 'Chief Architect');
  assert.equal(liftoff.findArchitectPreset(['Auditor', 'Coder']), null);
  assert.equal(liftoff.findArchitectPreset([]), null);
});

gate('planDelegateRoute: known route ok; unknown preset warns without ok', () => {
  const known = ['Architect', 'Auditor'];
  assert.equal(liftoff.planDelegateRoute({ presetNames: known, route: ['Architect'] }).ok, true);
  const bad = liftoff.planDelegateRoute({ presetNames: known, route: ['Architect', 'Ghost'] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unknownPresets, ['Ghost']);
  const empty = liftoff.planDelegateRoute({ presetNames: known, route: [] });
  assert.equal(empty.ok, false);
  assert.ok(empty.error);
});

// F2: separator, marker, and cap pinned VERBATIM on this side — a wording or
// number drift in lib/liftoff.js must fail here, not surprise a Coder seat.
const SEP = '\n\n===== CONTRACT ADDENDUM (rides the kickoff; not part of PROJECT.md) =====\n\n';
const MARKER = '\n[addendum truncated]';

gate('composeKickoffBrief: pinned separator/marker/cap; under the cap the addendum rides verbatim', () => {
  assert.equal(liftoff.ADDENDUM_SEPARATOR, SEP);
  assert.equal(liftoff.ADDENDUM_TRUNCATED_MARKER, MARKER);
  assert.equal(liftoff.BRIEF_CAP, 20000, 'mirrors main/tasks.js taskCreate\'s own brief cap');
  assert.equal(liftoff.composeKickoffBrief('project text', 'addendum text'),
    'project text' + SEP + 'addendum text', 'verbatim, no marker when nothing was cut');
  assert.equal(liftoff.composeKickoffBrief('project text', ''), 'project text',
    'no addendum = the brief is PROJECT.md alone, no dangling separator');
  assert.equal(liftoff.composeKickoffBrief('project text', undefined), 'project text');
});

gate('composeKickoffBrief: over the cap PROJECT.md wins whole — the addendum absorbs the overflow with the honest marker', () => {
  const project = 'P'.repeat(19000);
  const addendum = 'A'.repeat(5000);
  const brief = liftoff.composeKickoffBrief(project, addendum);
  assert.equal(brief.length, liftoff.BRIEF_CAP, 'composed to exactly the cap — tasks.js\'s slice has nothing left to cut');
  assert.ok(brief.startsWith(project), 'PROJECT.md is never truncated');
  assert.equal(brief.indexOf(SEP), project.length, 'the separator sits right after the intact PROJECT.md');
  assert.ok(brief.endsWith(MARKER), 'the cut addendum says so');
  const kept = brief.slice(project.length + SEP.length, brief.length - MARKER.length);
  assert.ok(kept.length < addendum.length && /^A+$/.test(kept),
    'only the addendum tail was cut — truncation order is addendum-first, PROJECT.md last');
});

gate('composeKickoffBrief: a PROJECT.md leaving no room drops the addendum whole — never a partial separator or an eaten marker', () => {
  const project = 'P'.repeat(19995);
  assert.equal(liftoff.composeKickoffBrief(project, 'A'.repeat(500)), project);
});

// ==========================================================================
// main.js bus wiring — projectsCreate / projectsRemove / Lift-off
// ==========================================================================

function fakeBus() {
  const handlers = new Map();
  const posts = [];
  const injected = [];
  return {
    handlers, posts, injected,
    on(type, fn) { handlers.set(type, fn); },
    post(type, payload) { posts.push({ type, payload }); },
    inject(msg) { injected.push(msg); },
  };
}

function freshHarness(tag, { presets = ['Architect', 'Auditor'], registerResult } = {}) {
  const stateDir = path.join(scratch, tag + '-state');
  const workspace = path.join(scratch, tag + '-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  studio.writeWorkspaceConfig(stateDir, workspace);

  const draft = drafts.createDraft(stateDir, workspace, { name: 'SniperSight', pitch: 'Scores entries.' });
  const withAnswers = drafts.updateDraft(stateDir, draft.id, draft.revision, {
    answers: Object.fromEntries(CARDS.map((c) => [c.key, c.key + ' answer '.repeat(20)])),
  });

  const bus = fakeBus();
  const registerCalls = [];
  studio.register({
    bus, stateDir,
    async pickDirectory() { return null; },
    seats: {
      presetNames() { return presets; },
      registerWorkspace(args) {
        registerCalls.push(args);
        return registerResult || { ok: true, name: args.name, path: args.path };
      },
    },
  });
  return { stateDir, workspace, bus, registerCalls, draftId: withAnswers.id, revision: withAnswers.revision };
}

function createdProject(h) {
  h.bus.handlers.get('projectsPreviewGenerate')({
    id: h.draftId, expectedRevision: h.revision, projectId: 'snipersight',
  });
  const status = h.bus.posts.filter((p) => p.type === 'projectsPreviewResult').at(-1);
  assert.equal(status.payload.ok, true, status.payload.error);
  const draft = drafts.readDraft(h.stateDir, h.draftId);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsCreate')({ id: h.draftId, expectedRevision: draft.revision, confirmed: true });
  const result = h.bus.posts.find((p) => p.type === 'projectsCreateResult');
  assert.equal(result.payload.ok, true, result.payload.error);
  return result.payload;
}

gate('projectsCreate writes the package and reports the project dir', () => {
  const h = freshHarness('create-ok');
  const created = createdProject(h);
  assert.equal(created.projectId, 'snipersight');
  assert.ok(fs.existsSync(path.join(created.projectDir, 'PROJECT.md')));
});

gate('projectsCreate refuses without explicit confirmation', () => {
  const h = freshHarness('create-noconfirm');
  h.bus.handlers.get('projectsPreviewGenerate')({ id: h.draftId, expectedRevision: h.revision, projectId: 'snipersight' });
  const draft = drafts.readDraft(h.stateDir, h.draftId);
  h.bus.handlers.get('projectsCreate')({ id: h.draftId, expectedRevision: draft.revision, confirmed: false });
  const result = h.bus.posts.find((p) => p.type === 'projectsCreateResult');
  assert.equal(result.payload.ok, false);
  assert.ok(!fs.existsSync(path.join(h.workspace, 'snipersight')));
});

gate('projectsRemove archives the created project (separate from draft deletion)', () => {
  const h = freshHarness('remove-ok');
  const created = createdProject(h);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsRemove')({ projectId: created.projectId, confirmed: true });
  const result = h.bus.posts.find((p) => p.type === 'projectsRemoveResult');
  assert.equal(result.payload.ok, true);
  assert.ok(!fs.existsSync(created.projectDir));
  // the draft itself is untouched — draft deletion is a distinct action
  assert.doesNotThrow(() => drafts.readDraft(h.stateDir, h.draftId));
});

gate('Lift-off (a): register workspace calls ctx.seats.registerWorkspace with the project path', () => {
  const h = freshHarness('lift-register');
  const created = createdProject(h);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsLiftoffRegisterWorkspace')({ projectId: created.projectId, name: 'Sniper' });
  assert.equal(h.registerCalls.length, 1);
  assert.equal(h.registerCalls[0].name, 'Sniper');
  assert.equal(path.resolve(h.registerCalls[0].path), path.resolve(created.projectDir));
  const result = h.bus.posts.find((p) => p.type === 'projectsLiftoffRegisterResult');
  assert.equal(result.payload.ok, true);
});

gate('Lift-off (a): a collision from ctx.seats.registerWorkspace surfaces as a warning, not a crash', () => {
  const h = freshHarness('lift-register-collide', {
    registerResult: { ok: false, warning: true, error: 'A workspace already uses this name: Sniper' },
  });
  const created = createdProject(h);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsLiftoffRegisterWorkspace')({ projectId: created.projectId, name: 'Sniper' });
  const result = h.bus.posts.find((p) => p.type === 'projectsLiftoffRegisterResult');
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.warning, true);
});

gate('Lift-off (b): with a live Architect preset, delegate injects taskCreate with the route and the verbatim PROJECT.md + addendum', () => {
  const h = freshHarness('lift-delegate-ok');
  const created = createdProject(h);
  const canonical = fs.readFileSync(path.join(created.projectDir, 'PROJECT.md'), 'utf8');
  h.bus.posts.length = 0; h.bus.injected.length = 0;
  h.bus.handlers.get('projectsLiftoffDelegate')({ projectId: created.projectId });
  const taskCreateCall = h.bus.injected.find((m) => m.type === 'taskCreate');
  assert.ok(taskCreateCall, 'taskCreate was injected');
  assert.deepEqual(taskCreateCall.route, ['Architect']);
  assert.equal(taskCreateCall.cwd, created.projectDir);
  // F2: the brief opens with the PROJECT.md text verbatim (never a summary),
  // then the pinned separator, then the contract addendum byte-for-byte —
  // the package carries tokens.json (Create wrote it) and neither other
  // spine, so the expected addendum is renderContractAddendum(tokens) alone.
  const tokens = JSON.parse(fs.readFileSync(path.join(created.projectDir, 'design', 'tokens.json'), 'utf8'));
  assert.ok(taskCreateCall.brief.startsWith(canonical), 'PROJECT.md rides first, verbatim');
  assert.equal(taskCreateCall.brief, canonical + SEP + spines.renderContractAddendum(tokens),
    'the addendum rides the brief verbatim, right after PROJECT.md behind the pinned separator');
  assert.equal(taskCreateCall.start, true);
  const result = h.bus.posts.find((p) => p.type === 'projectsLiftoffDelegateResult');
  assert.equal(result.payload.ok, true);
  assert.ok(!h.bus.injected.some((m) => m.type === 'taskRouteSave'), 'no template save unless requested');
});

gate('Lift-off (b): absent spines are stated honestly in the addendum — tokens EXISTS, the other two do-not-exist-yet', () => {
  const h = freshHarness('lift-delegate-absent');
  const created = createdProject(h);
  h.bus.injected.length = 0;
  h.bus.handlers.get('projectsLiftoffDelegate')({ projectId: created.projectId });
  const brief = h.bus.injected.find((m) => m.type === 'taskCreate').brief;
  assert.ok(brief.includes('`design/tokens.json` — EXISTS.'), 'Create wrote tokens.json, and the addendum says so');
  assert.ok(brief.includes('`design/components.json` — does not exist yet.'),
    'an absent component library is stated, never invented');
  assert.ok(brief.includes('`design/manifest.json` — does not exist yet.'),
    'an absent manifest is stated, never invented');
  assert.ok(brief.includes('No hard-coded colors or fonts — tokens only.'), 'the one law rides every kickoff');
});

gate('Lift-off (b): a malformed spine reads present-but-unusable in the addendum — never a crash, never silently absent', () => {
  const h = freshHarness('lift-delegate-malformed');
  const created = createdProject(h);
  // components.json: not even JSON. manifest.json: parses but is not a usable
  // schema-1 manifest. Both must fail SOFT into honest addendum lines.
  fs.writeFileSync(path.join(created.projectDir, 'design', 'components.json'), '{ this is not json', 'utf8');
  fs.writeFileSync(path.join(created.projectDir, 'design', 'manifest.json'), JSON.stringify({ schema: 1 }), 'utf8');
  h.bus.posts.length = 0; h.bus.injected.length = 0;
  h.bus.handlers.get('projectsLiftoffDelegate')({ projectId: created.projectId });
  const result = h.bus.posts.find((p) => p.type === 'projectsLiftoffDelegateResult');
  assert.equal(result.payload.ok, true, 'a broken spine never costs the kickoff itself');
  const brief = h.bus.injected.find((m) => m.type === 'taskCreate').brief;
  assert.ok(brief.includes('`design/components.json` — present but not a usable schema-1 library.'));
  assert.ok(brief.includes('`design/manifest.json` — present but not a usable schema-1 manifest.'));
});

gate('Lift-off (b): a valid component library is inventoried by name in the addendum', () => {
  const h = freshHarness('lift-delegate-spined');
  const created = createdProject(h);
  fs.writeFileSync(path.join(created.projectDir, 'design', 'components.json'), JSON.stringify({
    schema: 1,
    components: [{ name: 'button', variants: ['primary'], tokens: { background: 'color.accent' } }],
  }), 'utf8');
  h.bus.injected.length = 0;
  h.bus.handlers.get('projectsLiftoffDelegate')({ projectId: created.projectId });
  const brief = h.bus.injected.find((m) => m.type === 'taskCreate').brief;
  assert.ok(brief.includes('`design/components.json` — EXISTS with 1 component: button.'));
});

gate('Lift-off (b): an unknown preset in the route warns instead of creating a task', () => {
  const h = freshHarness('lift-delegate-unknown');
  const created = createdProject(h);
  h.bus.posts.length = 0; h.bus.injected.length = 0;
  h.bus.handlers.get('projectsLiftoffDelegate')({ projectId: created.projectId, route: ['Architect', 'Ghost'] });
  assert.ok(!h.bus.injected.some((m) => m.type === 'taskCreate'), 'taskCreate was never fired');
  const result = h.bus.posts.find((p) => p.type === 'projectsLiftoffDelegateResult');
  assert.equal(result.payload.ok, false);
  assert.deepEqual(result.payload.unknownPresets, ['Ghost']);
});

gate('Lift-off (b): no Architect-shaped preset explains itself instead of creating a task', () => {
  const h = freshHarness('lift-delegate-noarch', { presets: ['Auditor', 'Coder'] });
  const created = createdProject(h);
  h.bus.posts.length = 0; h.bus.injected.length = 0;
  h.bus.handlers.get('projectsLiftoffDelegate')({ projectId: created.projectId });
  assert.ok(!h.bus.injected.some((m) => m.type === 'taskCreate'));
  const result = h.bus.posts.find((p) => p.type === 'projectsLiftoffDelegateResult');
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.noArchitect, true);
  assert.match(result.payload.error, /PERSONAS/);
});

gate('Lift-off (b): an accepted route saves as a template via taskRouteSave', () => {
  const h = freshHarness('lift-delegate-template');
  const created = createdProject(h);
  h.bus.injected.length = 0;
  h.bus.handlers.get('projectsLiftoffDelegate')({
    projectId: created.projectId, route: ['Architect', 'Auditor'],
    saveAsTemplate: true, templateName: 'Ship it',
  });
  const saved = h.bus.injected.find((m) => m.type === 'taskRouteSave');
  assert.ok(saved, 'taskRouteSave was injected');
  assert.equal(saved.name, 'Ship it');
  assert.deepEqual(saved.steps, ['Architect', 'Auditor']);
});

gate('Lift-off (c): open a chat here starts exactly one bare seat, no task/route at all', () => {
  const h = freshHarness('lift-chat');
  const created = createdProject(h);
  h.bus.posts.length = 0; h.bus.injected.length = 0;
  h.bus.handlers.get('projectsLiftoffChat')({ projectId: created.projectId });
  assert.equal(h.bus.injected.length, 1);
  assert.equal(h.bus.injected[0].type, 'seatCreate');
  assert.equal(h.bus.injected[0].cwd, created.projectDir);
  assert.ok(!h.bus.injected.some((m) => m.type === 'taskCreate' || m.type === 'taskStart'),
    'no taskCreate/taskStart ever fired for the plain-chat path');
  const result = h.bus.posts.find((p) => p.type === 'projectsLiftoffChatResult');
  assert.equal(result.payload.ok, true);
});

// ==========================================================================
// main/tasks.js — the `brief` field rides step 0's kickoff only, verbatim
// ==========================================================================
{
  const tasks = require('../main/tasks');
  const PRESETS = { Architect: { name: 'Architect', cwd: null, kickoff: 'You are Architect.' },
                    Auditor: { name: 'Auditor', cwd: null, kickoff: 'You are Auditor.' } };
  const taskBus = (() => {
    const handlers = new Map();
    const posts = [];
    return {
      handlers, posts,
      on(t, fn) { handlers.set(t, fn); },
      post(t, m) { posts.push({ type: t, m }); },
      lastList() { const hits = posts.filter((p) => p.type === 'taskList'); return hits[hits.length - 1].m.tasks; },
    };
  })();
  const taskSeats = {
    observeSeats() { return () => {}; },
    createTaskSeat(opts) { return 'seat-' + Math.random(); },
    presetInfo: (name) => PRESETS[name] || null,
    presetNames: () => Object.keys(PRESETS),
    seatCommand() {},
    seatEntry() { return null; },
    listSeats() { return []; },
    closeSeat() {},
  };
  const taskStateDir = fs.mkdtempSync(path.join(scratch, 'tasks-state-'));
  const repo = fs.mkdtempSync(path.join(scratch, 'tasks-repo-'));
  tasks.register({ bus: taskBus, seats: taskSeats, stateDir: taskStateDir });

  gate('taskCreate\'s optional brief rides step 0\'s kickoff verbatim, and only step 0\'s', () => {
    taskBus.handlers.get('taskCreate')({
      title: 'delegate test', cwd: repo, route: ['Architect', 'Auditor'],
      brief: '# PROJECT.md\n\nThe real canonical text.', start: false,
    });
    const t = taskBus.lastList()[0];
    const kickoff0 = tasks._test.composeKickoff(t, 0);
    assert.ok(kickoff0.includes('The real canonical text.'), 'step 0 kickoff carries the brief verbatim');
    assert.ok(kickoff0.includes('BEGIN PROJECT.md'));
    const kickoff1 = tasks._test.composeKickoff(t, 1);
    assert.ok(!kickoff1.includes('The real canonical text.'), 'later steps do not repeat the brief');
  });

  gate('a taskCreate without brief behaves exactly as before (no PROJECT BRIEF block at all)', () => {
    taskBus.handlers.get('taskCreate')({
      title: 'no brief', cwd: repo, route: ['Architect'], start: false,
    });
    const t = taskBus.lastList()[0];
    const kickoff0 = tasks._test.composeKickoff(t, 0);
    assert.ok(!kickoff0.includes('PROJECT BRIEF'));
  });

  gate('F2: a cap-length composed brief survives the REAL tasks.js trim+slice intact — PROJECT.md whole, marker not eaten', () => {
    // Compose right at the 20000 edge: if lib/liftoff.js's cap ever drifted
    // above tasks.js's own `.trim().slice(0, 20000)`, that slice would eat
    // the marker mid-addendum and this gate would catch it.
    const project = 'The canonical text. ' + 'P'.repeat(18500);
    const brief = liftoff.composeKickoffBrief(project, 'A'.repeat(9000));
    assert.ok(brief.endsWith(MARKER), 'the composed brief was truncated with the marker');
    taskBus.handlers.get('taskCreate')({
      title: 'cap test', cwd: repo, route: ['Architect'], brief, start: false,
    });
    const t = taskBus.lastList()[0];
    const kickoff0 = tasks._test.composeKickoff(t, 0);
    assert.ok(kickoff0.includes(project), 'PROJECT.md rides whole through the real tasks.js cap');
    assert.ok(kickoff0.includes(MARKER), 'the honest marker rides too — tasks.js had nothing left to cut');
  });
}

console.log('\nSTUDIO LIFTOFF DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
