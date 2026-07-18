// App Builder drafts drill (STUDIO, slice 3) — the crash-safe interview draft
// store, the projects-workspace picker/persistence, the interview bus verbs, and
// the offline Help-me-decide heuristic. Headless: no Electron, no network, no LLM
// spend. Each named check is discrete. Run: node test/studio-drafts-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const drafts = require('../extensions/studio/lib/drafts');
const interview = require('../extensions/studio/lib/interview');
const studio = require('../extensions/studio/main');
const { stateDirFor, chooseDirectory } = require('../main/extensionServices');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-drafts-'));
const KEYS = interview.KEYS;
let passed = 0;
let failed = 0;
const pending = [];   // checks run in order; async ones settle before teardown

function check(name, fn) {
  const run = (async () => {
    try { await fn(); passed++; console.log('PASS  ' + name); }
    catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
  })();
  pending.push(run);
}

function freshState(tag) {
  const stateDir = path.join(scratch, tag + '-state');
  const workspace = path.join(scratch, tag + '-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  return { stateDir, workspace };
}

function fakeBus() {
  const handlers = new Map();
  const posts = [];
  return {
    handlers, posts,
    on(type, fn) { handlers.set(type, fn); },
    post(type, payload) { posts.push({ type, payload }); },
  };
}

// ---- the five required, discrete named checks ------------------------------

check('create — a new draft is atomic, complete, and runtime-local', () => {
  const { stateDir, workspace } = freshState('create');
  const draft = drafts.createDraft(stateDir, workspace, { name: '  SniperSight  ', pitch: '  Scores entries.  ' });
  assert.equal(draft.name, 'SniperSight');       // trimmed
  assert.equal(draft.pitch, 'Scores entries.');
  assert.equal(draft.revision, 1);
  assert.equal(draft.currentCard, 0);
  assert.deepEqual(Object.keys(draft.answers), KEYS);
  assert.equal(Object.values(draft.answers).every((a) => a === ''), true);
  // the store lives under state, never in the portable workspace
  assert.deepEqual(fs.readdirSync(path.join(stateDir, 'drafts')), [draft.id + '.json']);
  assert.equal(fs.existsSync(path.join(workspace, 'drafts')), false);
  // a working name is required; a multi-line name is refused
  assert.throws(() => drafts.createDraft(stateDir, workspace, { name: '   ', pitch: 'x' }), /required/);
  assert.throws(() => drafts.createDraft(stateDir, workspace, { name: 'Bad\nName' }), /single-line/);
  // pitch is optional to begin
  const noPitch = drafts.createDraft(stateDir, workspace, { name: 'NoPitch' });
  assert.equal(noPitch.pitch, '');
});

check('save — updates are revision-gated and persist answers + position', () => {
  const { stateDir, workspace } = freshState('save');
  const created = drafts.createDraft(stateDir, workspace, { name: 'App', pitch: 'A tool.' });
  const saved = drafts.updateDraft(stateDir, created.id, created.revision, {
    currentCard: 2,
    answers: { idea: 'A precise idea.', scope: 'v1 does one thing; non-goal: not two.' },
    pitch: 'A sharper tool.',
  });
  assert.equal(saved.revision, 2);
  assert.equal(saved.currentCard, 2);
  assert.equal(saved.answers.idea, 'A precise idea.');
  assert.equal(saved.pitch, 'A sharper tool.');
  // a stale expectedRevision is a tagged conflict, not a silent clobber
  assert.throws(() => drafts.updateDraft(stateDir, created.id, 1, { currentCard: 3 }),
    /changed since it was loaded/);
  try { drafts.updateDraft(stateDir, created.id, 1, {}); }
  catch (err) { assert.equal(err.code, 'DRAFT_CONFLICT'); }
  // an unknown answer key is refused
  assert.throws(() => drafts.updateDraft(stateDir, created.id, 2, { answers: { bogus: 'x' } }),
    /Unknown draft answer/);
});

check('reopen — a saved draft reloads the last good state and lists per workspace', () => {
  const { stateDir, workspace } = freshState('reopen');
  const other = path.join(scratch, 'reopen-other-workspace');
  fs.mkdirSync(other, { recursive: true });
  const a = drafts.createDraft(stateDir, workspace, { name: 'Alpha', pitch: 'One.' });
  drafts.updateDraft(stateDir, a.id, a.revision, { answers: { idea: 'Alpha idea.' } });
  drafts.createDraft(stateDir, other, { name: 'Beta', pitch: 'Two.' });

  const reopened = drafts.readDraft(stateDir, a.id);
  assert.equal(reopened.revision, 2);
  assert.equal(reopened.answers.idea, 'Alpha idea.');

  const listed = drafts.listDrafts(stateDir, workspace);
  assert.deepEqual(listed.drafts.map((d) => d.id), [a.id]);   // Beta belongs to another workspace
  assert.deepEqual(listed.warnings, []);
});

check('crash-recover — an interrupted write never corrupts the store', () => {
  const { stateDir, workspace } = freshState('crash');
  const good = drafts.createDraft(stateDir, workspace, { name: 'Durable', pitch: 'Survives.' });
  const saved = drafts.updateDraft(stateDir, good.id, good.revision, { answers: { idea: 'Last good state.' } });
  const dir = path.join(stateDir, 'drafts');

  // 1. Simulate a process killed mid-write: a half-written temp file the atomic
  //    write never got to rename. Readers key on '<uuid>.json', so it is inert.
  const orphanTmp = path.join(dir, `.${good.id}.json.${process.pid}.abcd.tmp`);
  fs.writeFileSync(orphanTmp, '{ "schema": 1, "id": "Durable', 'utf8');   // truncated garbage

  // 2. Simulate a wholly corrupt draft file from a bad past write.
  const corruptId = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(path.join(dir, corruptId + '.json'), '{ not json', 'utf8');

  // The last good draft still loads byte-for-byte; the corrupt file is quarantined
  // to a warning, never taking the list (or the good draft) down.
  const reloaded = drafts.readDraft(stateDir, good.id);
  assert.deepEqual(reloaded, saved);
  const listed = drafts.listDrafts(stateDir, workspace);
  assert.deepEqual(listed.drafts.map((d) => d.id), [good.id]);
  assert.equal(listed.warnings.length, 1);
  assert.match(listed.warnings[0], new RegExp(corruptId));

  // 3. A fresh atomic write over the good draft succeeds and leaves no temp behind,
  //    proving the store self-heals past the interrupted write.
  const afterCrash = drafts.updateDraft(stateDir, good.id, saved.revision, { answers: { scope: 'Recovered.' } });
  assert.equal(afterCrash.revision, 3);
  assert.equal(afterCrash.answers.idea, 'Last good state.');
  assert.equal(afterCrash.answers.scope, 'Recovered.');
  assert.equal(fs.readdirSync(dir).some((f) => f.endsWith('.tmp') && !f.startsWith(`.${good.id}.json.${process.pid}.abcd`)), false);
});

check('delete — removing a draft is explicit and workspace-scoped', () => {
  const { stateDir, workspace } = freshState('delete');
  const other = path.join(scratch, 'delete-other-workspace');
  fs.mkdirSync(other, { recursive: true });
  const draft = drafts.createDraft(stateDir, workspace, { name: 'Gone', pitch: 'Soon.' });
  // a draft cannot be deleted through the wrong workspace
  assert.throws(() => drafts.deleteDraft(stateDir, draft.id, other), /different workspace/);
  assert.equal(fs.existsSync(drafts.draftPath(stateDir, draft.id)), true);
  drafts.deleteDraft(stateDir, draft.id, workspace);
  assert.equal(fs.existsSync(drafts.draftPath(stateDir, draft.id)), false);
  assert.deepEqual(drafts.listDrafts(stateDir, workspace).drafts, []);
});

// ---- crash-safety of the link/size guards ----------------------------------

check('linked draft stores are refused before any read or write', () => {
  const { stateDir, workspace } = freshState('link');
  const outside = path.join(scratch, 'link-outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(stateDir, 'drafts'),
    process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => drafts.createDraft(stateDir, workspace, { name: 'Link', pitch: 'x' }),
    /regular directory, not a link/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

// ---- workspace picker + persistence (mirrors the persona discipline) --------

check('workspace config is atomic, schema-versioned, and round-trips', () => {
  const stateDir = path.join(scratch, 'ws-config-state');
  const workspace = path.join(scratch, 'ws-config-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  assert.equal(studio.writeWorkspaceConfig(stateDir, workspace), workspace);
  assert.deepEqual(studio.readWorkspaceConfig(stateDir), { workspace, error: null });
  assert.deepEqual(fs.readdirSync(stateDir), ['workspace.json']);
  const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, 'workspace.json'), 'utf8'));
  assert.equal(parsed.schema, 1);
  // a bad schema is recoverable, not fatal
  fs.writeFileSync(path.join(stateDir, 'workspace.json'), '{"schema":2}');
  assert.match(studio.readWorkspaceConfig(stateDir).error, /schema must be 1/);
});

check('workspace status counts only real project folders', () => {
  const stateDir = path.join(scratch, 'ws-status-state');
  const workspace = path.join(scratch, 'ws-status-workspace');
  fs.mkdirSync(path.join(workspace, 'snipersight'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'snipersight', 'PROJECT.md'), '# x\n');
  fs.mkdirSync(path.join(workspace, 'Not_A_Project'), { recursive: true });   // unsafe id
  fs.mkdirSync(path.join(workspace, 'no-manifest'), { recursive: true });     // no PROJECT.md
  studio.writeWorkspaceConfig(stateDir, workspace);
  const status = studio.workspaceStatus(stateDir);
  assert.equal(status.configured, true);
  assert.equal(status.projectCount, 1);
});

check('directory picker resolves a selection and cancellation is null', async () => {
  const selected = path.join(scratch, 'picked');
  let received;
  const dialog = { async showOpenDialog(opts) { received = opts; return { canceled: false, filePaths: [selected] }; } };
  assert.equal(await chooseDirectory(dialog, { title: ' Choose projects ', defaultPath: scratch }), selected);
  assert.deepEqual(received.properties, ['openDirectory', 'createDirectory']);
  const cancelDialog = { async showOpenDialog() { return { canceled: true, filePaths: [] }; } };
  assert.equal(await chooseDirectory(cancelDialog), null);
});

// ---- the interview bus verbs ------------------------------------------------

check('draft bus supports create, save, reopen, and confirmed delete', () => {
  const bus = fakeBus();
  const stateDir = path.join(scratch, 'draft-bus-state');
  const workspace = path.join(scratch, 'draft-bus-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  studio.writeWorkspaceConfig(stateDir, workspace);
  studio.register({ bus, stateDir, async pickDirectory() { return null; } });

  bus.handlers.get('projectsDraftCreate')({ name: 'SniperSight', pitch: 'Scores entries.' });
  assert.deepEqual(bus.posts.map((p) => p.type), ['projectsDraftResult', 'projectsDraftStatus']);
  const created = bus.posts[1].payload.draft;
  assert.equal(bus.posts[1].payload.cards.length, 7);
  assert.equal(bus.posts[1].payload.suggestedProjectId, 'snipersight');

  bus.posts.length = 0;
  bus.handlers.get('projectsDraftSave')({
    id: created.id, expectedRevision: created.revision,
    changes: { currentCard: 1, answers: { idea: 'A precise idea.' } },
  });
  assert.deepEqual(bus.posts.map((p) => p.type), ['projectsDraftResult', 'projectsDraftStatus']);
  assert.equal(bus.posts[1].payload.draft.answers.idea, 'A precise idea.');

  bus.posts.length = 0;
  bus.handlers.get('projectsDraftOpen')({ id: created.id });
  assert.equal(bus.posts[0].payload.draft.revision, 2);

  // delete without confirmation is refused (draft removal is an explicit action)
  bus.posts.length = 0;
  bus.handlers.get('projectsDraftDelete')({ id: created.id, confirmed: false });
  assert.deepEqual(bus.posts.map((p) => p.type), ['projectsDraftResult', 'toast']);
  assert.equal(fs.existsSync(drafts.draftPath(stateDir, created.id)), true);

  bus.posts.length = 0;
  bus.handlers.get('projectsDraftDelete')({ id: created.id, confirmed: true });
  assert.deepEqual(bus.posts.map((p) => p.type), ['projectsDraftResult', 'projectsDraftList']);
  assert.equal(fs.existsSync(drafts.draftPath(stateDir, created.id)), false);
});

check('draft verbs fail closed with no workspace chosen', () => {
  const bus = fakeBus();
  const stateDir = path.join(scratch, 'no-ws-state');
  studio.register({ bus, stateDir, async pickDirectory() { return null; } });
  bus.handlers.get('projectsDraftCreate')({ name: 'Nope' });
  assert.equal(bus.posts[0].type, 'projectsDraftResult');
  assert.equal(bus.posts[0].payload.ok, false);
  assert.match(bus.posts[0].payload.error, /Choose a projects workspace first/);
});

check('choosing a workspace persists and publishes ready status', async () => {
  const bus = fakeBus();
  const stateDir = path.join(scratch, 'choose-state');
  const workspace = path.join(scratch, 'choose-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  studio.register({ bus, stateDir, async pickDirectory() { return workspace; } });
  await bus.handlers.get('projectsWorkspaceChoose')();
  const post = bus.posts.at(-1);
  assert.equal(post.type, 'projectsWorkspaceStatus');
  assert.equal(post.payload.configured, true);
  assert.equal(studio.readWorkspaceConfig(stateDir).workspace, workspace);
});

// ---- Help-me-decide heuristic (pure, no AI) --------------------------------

check('helpForCard returns hints and computes live nudges — never calls out', () => {
  // seven cards, keys aligned with the blueprint areas (look joined in v2 A1)
  assert.deepEqual(KEYS, ['idea', 'users', 'scope', 'platform', 'architecture', 'delivery', 'look']);
  assert.equal(interview.CARDS.length, 7);
  for (const card of interview.CARDS) {
    assert.ok(card.question.length > 20, card.key + ' question thin');
    assert.ok(card.depth.length > 100, card.key + ' depth thin');
    assert.ok(card.example.length > 120, card.key + ' example thin');
    assert.ok((card.suggestions || []).length >= 3, card.key + ' suggestions thin');
    assert.ok((card.heuristics || []).length >= 2, card.key + ' heuristics thin');
    assert.ok(card.help.length > 40, card.key + ' help thin');
  }
  // empty answer → the "start from the example" nudge
  const empty = interview.helpForCard('idea', '');
  assert.ok(empty.hints.length >= 2);
  assert.match(empty.nudges.join(' '), /example above/);
  // scope with no non-goal → the fluff tripwire nudge
  const scopeThin = interview.helpForCard('scope', 'v1 scores entries and alerts on one channel end to end for me.');
  assert.match(scopeThin.nudges.join(' '), /non-goal/i);
  // scope WITH a non-goal and enough substance → no nudges
  const scopeOk = interview.helpForCard('scope',
    'v1 scores entries and alerts on one channel, end to end. Non-goals: no auto-execution, no backtester UI, no mobile app for the first cut.');
  assert.deepEqual(scopeOk.nudges, []);
  // delivery with no verification word → nudge
  assert.match(interview.helpForCard('delivery',
    'Ship it in a few weeks and see how it feels once it is running for a while.').nudges.join(' '), /evidence/i);
  // an unknown card key is a programming error
  assert.throws(() => interview.helpForCard('bogus', 'x'), /Unknown interview card/);
});

// ---- the Look card's heuristics (v2 slice A1) ------------------------------

check('look card nudges: thin answer, no palette words, no tone words', () => {
  // A thin answer with neither palette nor tone words trips all three rules.
  const bare = interview.helpForCard('look', 'Make it nice.');
  assert.match(bare.nudges.join(' '), /reads thin/i);
  assert.match(bare.nudges.join(' '), /palette leaning/i);
  assert.match(bare.nudges.join(' '), /tone words/i);
  // A full answer — palette leaning, type feel, density, tone — is quiet.
  const full = interview.helpForCard('look',
    'Dark, near-black surfaces with one amber accent. Type feels technical: monospace numbers, compact sans labels. Dense but calm; tone is focused, quiet, instrument-panel.');
  assert.deepEqual(full.nudges, []);
  // Palette words present but no tone words → only the tone nudge fires. The
  // filler suffix keeps it over the thin threshold without tone vocabulary.
  const noTone = interview.helpForCard('look',
    'Light surfaces with a neutral palette and one green accent color across every screen, applied to each of the primary navigation surfaces and secondary panels alike.');
  assert(!noTone.nudges.some((n) => /palette leaning/i.test(n)), JSON.stringify(noTone.nudges));
  assert(noTone.nudges.some((n) => /tone words/i.test(n)), JSON.stringify(noTone.nudges));
});

// ---- forward migration: drafts written before the look card ----------------

check('a six-answer draft from before schema 2 reads back with look defaulted, not refused', () => {
  const stateDir = path.join(scratch, 'migrate-state');
  const workspace = path.join(scratch, 'migrate-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const created = drafts.createDraft(stateDir, workspace, { name: 'Old Draft', pitch: 'Written before look existed.' });
  // Rewrite the stored file as a v1-era draft: six answers, no look key (and
  // no preview). This is exactly what sits on disk in a pre-A1 state dir.
  const file = drafts.draftPath(stateDir, created.id);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw.answers.look;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  const reread = drafts.readDraft(stateDir, created.id);
  assert.equal(reread.answers.look, '', 'the new card simply starts unanswered');
  // The migrated draft still lists (it is not skipped as unreadable).
  const listed = drafts.listDrafts(stateDir, workspace);
  assert.deepEqual(listed.warnings, []);
  assert.equal(listed.drafts.length, 1);
  // An updateDraft round-trip persists the filled-in key.
  const updated = drafts.updateDraft(stateDir, created.id, reread.revision, { answers: { look: 'Dark, one accent.' } });
  assert.equal(updated.answers.look, 'Dark, one accent.');
});

// ---- the X-ray diagram field (slice D2) -------------------------------------

check('diagram — the X-ray field is validated by the real grammar and revision-gated', () => {
  const xray = require('../extensions/studio/lib/xray');
  const { stateDir, workspace } = freshState('diagram');
  const created = drafts.createDraft(stateDir, workspace, { name: 'App', pitch: 'A tool.' });
  const source = 'flowchart TD\n  ui["Web UI"] --> api["API"]\n';
  const provenance = xray.buildProvenance('a'.repeat(64), 'llm', source);
  // a valid { mermaid, provenance } round-trips through the store
  const saved = drafts.updateDraft(stateDir, created.id, created.revision,
    { diagram: { mermaid: source, provenance } });
  const reread = drafts.readDraft(stateDir, created.id);
  assert.equal(reread.diagram.mermaid, source);
  assert.deepEqual(reread.diagram.provenance, provenance);
  // null clears it
  const cleared = drafts.updateDraft(stateDir, created.id, saved.revision, { diagram: null });
  assert.equal(cleared.diagram, null);
  // the field is held to lib/xray.js's OWN validator — the drilled grammar,
  // not a mirror: a forbidden keyword or off-grammar line refuses the write
  assert.throws(() => drafts.updateDraft(stateDir, created.id, cleared.revision,
    { diagram: { mermaid: 'flowchart TD\n  click a callback "x"', provenance } }),
    /studio allowlist/);
  assert.throws(() => drafts.updateDraft(stateDir, created.id, cleared.revision,
    { diagram: { mermaid: 'not mermaid at all', provenance } }),
    /studio allowlist/);
  // tampered provenance fails closed: wrong byte count, bad hash, bad source,
  // unknown fields at either level
  assert.throws(() => drafts.updateDraft(stateDir, created.id, cleared.revision,
    { diagram: { mermaid: source, provenance: { ...provenance, bytes: 1 } } }),
    /byte count/);
  assert.throws(() => drafts.updateDraft(stateDir, created.id, cleared.revision,
    { diagram: { mermaid: source, provenance: { ...provenance, canonicalHash: 'nope' } } }),
    /hash/);
  assert.throws(() => drafts.updateDraft(stateDir, created.id, cleared.revision,
    { diagram: { mermaid: source, provenance: { ...provenance, source: 'human' } } }),
    /source/);
  assert.throws(() => drafts.updateDraft(stateDir, created.id, cleared.revision,
    { diagram: { mermaid: source, provenance: { ...provenance, extra: true } } }),
    /unknown field/);
  assert.throws(() => drafts.updateDraft(stateDir, created.id, cleared.revision,
    { diagram: { mermaid: source, provenance, extra: true } }),
    /unknown field/);
  assert.throws(() => drafts.updateDraft(stateDir, created.id, cleared.revision,
    { diagram: [source] }), /invalid/);
});

// ---- state-dir containment (matches the loader's guarantee) -----------------

check('studio state directory stays one segment under its root', () => {
  const root = path.join(scratch, 'state-root');
  assert.equal(stateDirFor(root, 'studio'), path.join(root, 'studio'));
  assert.throws(() => stateDirFor(root, '..'), /one path segment/);
});

Promise.all(pending).then(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`\nSTUDIO DRAFTS: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
});
