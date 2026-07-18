// App Builder — headless drill for slice C2 (the boom loop's landing half):
// lib/boom.js's apply-time re-wall (traversal/absolute/outside-project refuse
// even when handed a "validated" result directly — belt and braces over
// parseReply), the exists/not-exists kind rules, the complete-content hunks
// requirement, atomic apply + backup-FIRST ordering, the ledger
// (append/cap/persist, git vs backup mode selection), git via the injectable
// execFile seam (args ARRAY, never a shell string — commit scoped to the
// boom's files, revert refused on a dirty tree), backup revert (restore +
// remove-created), and the main.js verb wiring end-to-end with a stubbed
// disposable seat (the studio-codesigner-drill harness pattern) — including
// demote → no writes + the delegate prefill riding the F2 brief composition.
// Zero Electron, zero real git, zero LLM spend.
// Run: node test/studio-boom-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const boom = require('../extensions/studio/lib/boom');
const surgeon = require('../extensions/studio/lib/surgeon');
const liftoff = require('../extensions/studio/lib/liftoff');
const studio = require('../extensions/studio/main');
const drafts = require('../extensions/studio/lib/drafts');
const { CARDS } = require('../extensions/studio/lib/interview');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-boom-'));
let passed = 0, failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
}
async function agate(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
}
// The verb layer's landing is async (the git seam); a couple of microtask
// turns settles a stubbed run completely.
const settle = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

function freshProject(tag) {
  const dir = path.join(scratch, tag);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<!doctype html><html><body><div class="hero">Hello</div></body></html>\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'app.css'), '.hero { color: blue; }\n', 'utf8');
  return dir;
}

// ==========================================================================
// the apply-time re-wall (belt and braces over parseReply)
// ==========================================================================

gate('planApply refuses traversal/absolute/outside paths even in a hand-built "validated" result', () => {
  const proj = freshProject('wall');
  const hostile = [
    'C:\\evil.css', '/etc/passwd', '\\\\server\\share\\x', '..\\..\\escape.css',
    'a/../../b.css', '~home.css', 'a:stream.css', '..',
  ];
  for (const file of hostile) {
    const plan = boom.planApply(proj, { summary: 's', edits: [{ file, kind: 'created', hunks: 'x' }] });
    assert.equal(plan.ok, false, 'must refuse: ' + file);
  }
  assert.throws(() => boom.resolveApplyPath(proj, '../out.css'), /refused|escapes/);
  // and the honest positive: a nested relative path resolves INSIDE the root
  const ok = boom.resolveApplyPath(proj, 'src\\app.css');
  assert.equal(ok.rel, 'src/app.css');
  assert.equal(path.relative(proj, ok.abs), path.join('src', 'app.css'));
});

gate('the kind rules: modified needs the file, created refuses an existing one, links refuse', () => {
  const proj = freshProject('kinds');
  const miss = boom.planApply(proj, { summary: 's',
    edits: [{ file: 'ghost.css', kind: 'modified', hunks: 'x' }] });
  assert.equal(miss.ok, false);
  assert.match(miss.error, /does not exist/);
  const clobber = boom.planApply(proj, { summary: 's',
    edits: [{ file: 'index.html', kind: 'created', hunks: 'x' }] });
  assert.equal(clobber.ok, false);
  assert.match(clobber.error, /already exists/);
  const dupe = boom.planApply(proj, { summary: 's', edits: [
    { file: 'index.html', kind: 'modified', hunks: 'x' },
    { file: 'index.html', kind: 'modified', hunks: 'y' },
  ] });
  assert.equal(dupe.ok, false, 'the same file twice is one confused report');
  const good = boom.planApply(proj, { summary: 's', edits: [
    { file: 'src/app.css', kind: 'modified', hunks: '.hero { color: orange; }\n' },
    { file: 'src/new.css', kind: 'created', hunks: 'body {}\n' },
  ] });
  assert.equal(good.ok, true, good.error);
  assert.equal(good.files.length, 2);
});

gate('v1 apply discipline: an edit without complete-content hunks refuses whole', () => {
  const proj = freshProject('hunks');
  for (const edits of [
    [{ file: 'index.html', kind: 'modified' }],
    [{ file: 'index.html', kind: 'modified', hunks: '' }],
    [{ file: 'index.html', kind: 'modified', hunks: 'ok' }, { file: 'src/new.css', kind: 'created' }],
  ]) {
    const plan = boom.planApply(proj, { summary: 's', edits });
    assert.equal(plan.ok, false);
    assert.match(plan.error, /content|complete-file/i);
  }
});

// ==========================================================================
// atomic apply + backup-first ordering
// ==========================================================================

gate('backup-first: originals land in the ledger store BEFORE any byte changes; apply is atomic', () => {
  const proj = freshProject('backup');
  const stateDir = path.join(scratch, 'backup-state');
  fs.mkdirSync(stateDir, { recursive: true });
  const original = fs.readFileSync(path.join(proj, 'src', 'app.css'), 'utf8');
  const plan = boom.planApply(proj, { summary: 's', edits: [
    { file: 'src/app.css', kind: 'modified', hunks: '.hero { color: orange; }\n' },
    { file: 'src/extra.css', kind: 'created', hunks: 'body {}\n' },
  ] });
  assert.equal(plan.ok, true, plan.error);
  const token = '1234567890123';
  assert.equal(boom.backupFiles(stateDir, 'boomproj', plan.files, token), 1,
    'only modified files have originals to copy');
  const copy = path.join(boom.backupRoot(stateDir, 'boomproj', token), 'src', 'app.css');
  assert.equal(fs.readFileSync(copy, 'utf8'), original, 'the copy is the pre-boom bytes');
  boom.applyEdits(plan.files);
  assert.equal(fs.readFileSync(path.join(proj, 'src', 'app.css'), 'utf8'), '.hero { color: orange; }\n');
  assert.equal(fs.readFileSync(path.join(proj, 'src', 'extra.css'), 'utf8'), 'body {}\n');
  assert.ok(!fs.readdirSync(path.join(proj, 'src')).some((n) => n.includes('.tmp')),
    'no temp debris — atomic same-dir temp + rename');
});

gate('a refused apply leaves the project untouched (parents staged before any write)', () => {
  const proj = freshProject('atomic');
  const before = fs.readFileSync(path.join(proj, 'index.html'), 'utf8');
  const plan = boom.planApply(proj, { summary: 's', edits: [
    { file: 'index.html', kind: 'modified', hunks: 'CHANGED' },
    // parent is a FILE — the mkdir pass throws before a single write lands
    { file: 'index.html/sub.js', kind: 'created', hunks: 'x' },
  ] });
  assert.equal(plan.ok, true, 'lstat on index.html/sub.js reads as missing — the plan cannot see it');
  assert.throws(() => boom.applyEdits(plan.files));
  assert.equal(fs.readFileSync(path.join(proj, 'index.html'), 'utf8'), before,
    'the modified file never changed — parents staged first');
});

// ==========================================================================
// the ledger: append / cap / persist / mode selection
// ==========================================================================

gate('ledger append/cap/persist: atomic JSON, capped 100, oldest dropped, junk cleaned', () => {
  const stateDir = path.join(scratch, 'ledger-state');
  fs.mkdirSync(stateDir, { recursive: true });
  for (let i = 1; i <= 105; i++) {
    boom.appendLedgerEntry(stateDir, 'ledgerproj', {
      ts: 'T' + i, intent: 'intent ' + i + ' ' + 'x'.repeat(300),
      files: [{ file: 'f' + i + '.css', kind: 'modified' }], mode: 'backup', token: String(1e12 + i),
    });
  }
  const entries = boom.readLedger(stateDir, 'ledgerproj');
  assert.equal(entries.length, 100, 'capped at 100');
  assert.equal(entries[0].ts, 'T6', 'oldest dropped');
  assert.equal(entries[99].ts, 'T105');
  assert.equal(entries[0].intent.length, boom.MAX_LEDGER_INTENT, 'intent sliced to 200');
  const parsed = JSON.parse(fs.readFileSync(boom.ledgerFile(stateDir, 'ledgerproj'), 'utf8'));
  assert.equal(parsed.schema, boom.LEDGER_SCHEMA);
  // junk shapes read fail-soft and rebuilt
  fs.writeFileSync(boom.ledgerFile(stateDir, 'junkproj'), JSON.stringify({
    schema: 1, entries: [{ ts: 'T1', intent: 'ok', mode: 'evil', token: 42,
      files: [{ file: 'a.css', kind: 'modified' }, { file: 42, kind: 'modified' }, { file: 'b', kind: 'evil' }],
      extra: 'dropped' }],
  }), 'utf8');
  const cleaned = boom.readLedger(stateDir, 'junkproj');
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].mode, 'backup', 'unknown mode rebuilds to backup');
  assert.equal(cleaned[0].token, null, 'non-string token drops');
  assert.deepEqual(cleaned[0].files, [{ file: 'a.css', kind: 'modified' }]);
  assert.equal(cleaned[0].extra, undefined);
  assert.throws(() => boom.ledgerFile(stateDir, '../evil'), /valid project id/);
  assert.deepEqual(boom.readLedger(stateDir, 'neverproj'), [], 'missing ledger reads empty');
});

gate('git vs backup mode selection: a .git dir is the whole test', () => {
  const proj = freshProject('modesel');
  assert.equal(boom.isGitRepo(proj), false);
  fs.mkdirSync(path.join(proj, '.git'));
  assert.equal(boom.isGitRepo(proj), true);
});

// ==========================================================================
// git through the execFile seam — args array, never a shell
// ==========================================================================

function stubGit(responses) {
  const rig = { calls: [], responses: { ...responses } };
  rig.fn = (cmd, args, opts, cb) => {
    rig.calls.push({ cmd, args: args.slice(), cwd: opts && opts.cwd });
    const r = rig.responses[args[0]];
    if (r instanceof Error) cb(r);
    else cb(null, r || '');
  };
  return rig;
}

void (async () => {

await agate('gitCommitBoom: add -- <files> then commit then rev-parse, argv arrays, boom-sliced message', async () => {
  const git = stubGit({ 'rev-parse': 'deadbeef42\n' });
  const hash = await boom.gitCommitBoom(git.fn, 'C:\\proj', ['src/app.css', 'src/new.css'],
    'make it orange ' + 'y'.repeat(300));
  assert.equal(hash, 'deadbeef42');
  assert.equal(git.calls.length, 3);
  assert.equal(git.calls.every((c) => c.cmd === 'git' && Array.isArray(c.args) && c.cwd === 'C:\\proj'), true);
  assert.deepEqual(git.calls[0].args, ['add', '--', 'src/app.css', 'src/new.css'],
    'scoped add — the boom\'s files alone, never -A');
  assert.equal(git.calls[1].args[0], 'commit');
  assert.equal(git.calls[1].args[1], '-m');
  assert.ok(git.calls[1].args[2].startsWith('boom: make it orange'));
  assert.ok(git.calls[1].args[2].length <= 'boom: '.length + boom.MAX_LEDGER_INTENT);
  assert.deepEqual(git.calls[2].args, ['rev-parse', 'HEAD']);
});

await agate('gitRevertBoom: dirty tree refuses honestly BEFORE any revert; clean tree reverts by hash', async () => {
  const dirty = stubGit({ status: ' M src/app.css\n?? junk.txt\n' });
  await assert.rejects(() => boom.gitRevertBoom(dirty.fn, 'C:\\proj', 'deadbeef42'), /dirty/);
  assert.equal(dirty.calls.some((c) => c.args[0] === 'revert'), false, 'no revert call on a dirty tree');
  const clean = stubGit({ status: '' });
  await boom.gitRevertBoom(clean.fn, 'C:\\proj', 'deadbeef42');
  assert.deepEqual(clean.calls.at(-1).args, ['revert', '--no-edit', 'deadbeef42']);
  // a hostile token (flag injection, shell debris) refuses before ANY git call
  for (const token of ['--exec=evil', 'abc; rm -rf', '', null, 'HEAD~1']) {
    const rig = stubGit({ status: '' });
    await assert.rejects(() => boom.gitRevertBoom(rig.fn, 'C:\\proj', token), /token/);
    assert.equal(rig.calls.length, 0);
  }
});

gate('backup revert: restores the copies atomically, removes what the boom created, refuses half-reverts', () => {
  const proj = freshProject('revert');
  const stateDir = path.join(scratch, 'revert-state');
  fs.mkdirSync(stateDir, { recursive: true });
  const original = fs.readFileSync(path.join(proj, 'src', 'app.css'), 'utf8');
  const plan = boom.planApply(proj, { summary: 's', edits: [
    { file: 'src/app.css', kind: 'modified', hunks: '.hero { color: orange; }\n' },
    { file: 'src/extra.css', kind: 'created', hunks: 'body {}\n' },
  ] });
  const token = String(Date.now());
  boom.backupFiles(stateDir, 'revproj', plan.files, token);
  boom.applyEdits(plan.files);
  const entry = { ts: 'T1', intent: 'orange', mode: 'backup', token,
    files: plan.files.map((f) => ({ file: f.file, kind: f.kind })) };
  const out = boom.revertBackup(stateDir, 'revproj', proj, entry);
  assert.deepEqual(out, { restored: 1, removed: 1 });
  assert.equal(fs.readFileSync(path.join(proj, 'src', 'app.css'), 'utf8'), original);
  assert.ok(!fs.existsSync(path.join(proj, 'src', 'extra.css')), 'the created file\'s restore is absence');
  // a missing copy refuses WHOLE, before any restore
  const ghost = { ts: 'T2', intent: 'x', mode: 'backup', token,
    files: [{ file: 'index.html', kind: 'modified' }] };
  const before = fs.readFileSync(path.join(proj, 'index.html'), 'utf8');
  assert.throws(() => boom.revertBackup(stateDir, 'revproj', proj, ghost), /Backup copy missing/);
  assert.equal(fs.readFileSync(path.join(proj, 'index.html'), 'utf8'), before);
});

// ==========================================================================
// the kickoff excerpts (the tool-less surgeon's view of the code)
// ==========================================================================

gate('composeBoomKickoff: C1 kickoff + bounded current-content excerpts; over-cap files named delegate-sized', () => {
  const proj = freshProject('kickoff');
  fs.writeFileSync(path.join(proj, 'big.css'), 'x'.repeat(surgeon.HUNKS_CAP + 1), 'utf8');
  const kickoff = boom.composeBoomKickoff({
    displayName: 'Fixture App',
    intent: 'Make the hero orange.',
    context: { selector: '.hero', classes: ['hero'], text: 'Hello', tag: 'div' },
    candidates: [
      { file: 'src/app.css', line: 1, tier: 'search', confidence: 'medium' },
      { file: 'big.css', line: null, tier: 'search', confidence: 'medium' },
      { file: '../outside.css', line: null, tier: 'search', confidence: 'medium' },
      { file: null, line: null, tier: 'context', confidence: 'low', descriptor: 'x' },
    ],
    projectRoot: proj,
  });
  assert.match(kickoff, /ONE surgical strike/, 'the C1 kickoff rides first, verbatim');
  assert.match(kickoff, /CURRENT FILE CONTENT/);
  assert.ok(kickoff.includes('.hero { color: blue; }'), 'the candidate\'s bytes ride along');
  assert.match(kickoff, /big\.css: \d+ bytes — over the 16 KB boom cap/);
  assert.ok(!kickoff.includes('x'.repeat(200)), 'over-cap content never rides — named, not truncated');
  assert.ok(!kickoff.includes('outside.css (current content'), 'an escaping candidate never reads');
  assert.match(kickoff, /COMPLETE new content/, 'the C2 contract line reached the prompt');
});

// ==========================================================================
// the verb layer — stubbed seat, stubbed git, real fs (liftoff-drill harness)
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
    last(type) { const hit = posts.filter((p) => p.type === type).at(-1); return hit && hit.payload; },
  };
}

function fullDraft(name) {
  const d = { name, pitch: 'Scores entries.', answers: {} };
  for (const c of CARDS) d.answers[c.key] = c.key + ' answer '.repeat(20);
  return d;
}

function freshHarness(tag, { git } = {}) {
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
  const seats = { calls: [], controller: null };
  studio.register({
    bus, stateDir,
    async pickDirectory() { return null; },
    gitExecFile: git ? git.fn : (cmd, args, opts, cb) => cb(new Error('no git in this drill')),
    seats: {
      presetNames() { return ['Architect']; },
      registerWorkspace(args) { return { ok: true, name: args.name, path: args.path }; },
      startDisposable(options) {
        seats.calls.push(options);
        seats.controller = { closes: 0, close() { this.closes++; } };
        return seats.controller;
      },
    },
  });
  return { stateDir, workspace, bus, seats, draftId: withAnswers.id, revision: withAnswers.revision };
}

function createdProject(h) {
  h.bus.handlers.get('projectsPreviewGenerate')({
    id: h.draftId, expectedRevision: h.revision, projectId: 'snipersight',
  });
  assert.equal(h.bus.last('projectsPreviewResult').ok, true);
  const draft = drafts.readDraft(h.stateDir, h.draftId);
  h.bus.handlers.get('projectsCreate')({ id: h.draftId, expectedRevision: draft.revision, confirmed: true });
  const result = h.bus.last('projectsCreateResult');
  assert.equal(result.ok, true, result.error);
  // give the project something pickable
  fs.writeFileSync(path.join(result.projectDir, 'index.html'),
    '<!doctype html><html><body><div class="hero">Hello</div></body></html>\n', 'utf8');
  return result;
}

const surgeonReply = (edits, followup) => 'Done.\n```apex-surgeon\n' +
  JSON.stringify({ summary: 'One surgical strike.', edits, ...(followup ? { followup } : {}) }) +
  '\n```\n';

const heroContext = () => ({ selector: '.hero', classes: ['hero'], text: 'Hello', tag: 'div', html: '' });

await agate('the boom flow end-to-end (backup mode): GO → resolver → seat → apply → ledger → revert', async () => {
  const h = freshHarness('flow');
  const p = createdProject(h);
  // the card open posts usage + the (empty) ledger
  h.bus.handlers.get('projectsBoomOpen')({ projectId: p.projectId });
  assert.equal(h.bus.last('projectsBoomCard').requiresApproval, true);
  assert.deepEqual(h.bus.last('projectsBoomLedger').entries, []);
  // GO without the approval never launches
  h.bus.handlers.get('projectsBoomGo')({ projectId: p.projectId, context: heroContext(), intent: 'x' });
  assert.match(h.bus.last('projectsBoomResult').error, /approval/);
  assert.equal(h.seats.calls.length, 0);
  // GO — the card IS the approval
  h.bus.handlers.get('projectsBoomGo')({
    projectId: p.projectId, context: heroContext(), intent: 'Make the hero orange.', approved: true,
  });
  const status = h.bus.last('projectsBoomStatus');
  assert.equal(status.phase, 'running');
  assert.ok(status.candidates.length >= 2, 'search hit + the tier-c fallback');
  assert.equal(status.candidates.at(-1).tier, 'context', 'the honest fallback is always last');
  assert.ok(status.candidates.every((c) => c.tier && c.confidence), 'tier/confidence ride to the card');
  assert.equal(h.seats.calls.length, 1);
  const kickoff = h.seats.calls[0].kickoff;
  assert.match(kickoff, /ONE surgical strike/);
  assert.match(kickoff, /CURRENT FILE CONTENT/, 'the excerpts rode the kickoff');
  // single-flight while the seat runs
  h.bus.handlers.get('projectsBoomGo')({
    projectId: p.projectId, context: heroContext(), intent: 'another', approved: true,
  });
  assert.match(h.bus.last('projectsBoomResult').error, /already in flight/);
  // the seat answers with a landable report
  const newHtml = '<!doctype html><html><body><div class="hero orange">Hello</div></body></html>\n';
  h.seats.calls[0].onEvent({ type: 'text',
    text: surgeonReply([{ file: 'index.html', kind: 'modified', hunks: newHtml }]) });
  h.seats.calls[0].onEvent({ type: 'result', ok: true });
  await settle();
  const result = h.bus.last('projectsBoomResult');
  assert.equal(result.ok, true, result.error);
  assert.equal(result.mode, 'backup', 'no .git = backup mode');
  assert.match(result.token, /^[0-9]+$/);
  assert.equal(fs.readFileSync(path.join(p.projectDir, 'index.html'), 'utf8'), newHtml);
  const entries = h.bus.last('projectsBoomLedger').entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].files, [{ file: 'index.html', kind: 'modified' }]);
  assert.equal(h.seats.controller.closes, 1, 'the disposable died with its one strike');
  // the backup copy holds the ORIGINAL bytes — backup-first, end to end
  const copy = path.join(boom.backupRoot(h.stateDir, p.projectId, result.token), 'index.html');
  assert.ok(fs.readFileSync(copy, 'utf8').includes('class="hero"'), 'pre-boom bytes in the copy');
  // REVERT restores them
  h.bus.handlers.get('projectsBoomRevert')({
    projectId: p.projectId, ts: entries[0].ts, token: entries[0].token,
  });
  await settle();
  const reverted = h.bus.last('projectsBoomRevertResult');
  assert.equal(reverted.ok, true, reverted.error);
  assert.equal(reverted.mode, 'backup');
  assert.ok(fs.readFileSync(path.join(p.projectDir, 'index.html'), 'utf8').includes('class="hero"'));
});

await agate('git mode: dirty snapshot before apply, scoped add+commit, hash token, dirty revert refused', async () => {
  const git = stubGit({ status: '', 'rev-parse': 'cafebabe99\n' });
  const h = freshHarness('gitmode', { git });
  const p = createdProject(h);
  fs.mkdirSync(path.join(p.projectDir, '.git'));
  h.bus.handlers.get('projectsBoomGo')({
    projectId: p.projectId, context: heroContext(), intent: 'Make the hero orange.', approved: true,
  });
  h.seats.calls[0].onEvent({ type: 'text',
    text: surgeonReply([{ file: 'index.html', kind: 'modified', hunks: '<!doctype html><html><body>orange</body></html>' }]) });
  h.seats.calls[0].onEvent({ type: 'result', ok: true });
  await settle();
  const result = h.bus.last('projectsBoomResult');
  assert.equal(result.ok, true, result.error);
  assert.equal(result.mode, 'git');
  assert.equal(result.token, 'cafebabe99', 'the commit hash is the revert token');
  const ops = git.calls.map((c) => c.args[0]);
  assert.deepEqual(ops, ['status', 'add', 'commit', 'rev-parse'],
    'dirty snapshot FIRST, then the scoped add/commit');
  assert.ok(git.calls.every((c) => c.cmd === 'git' && c.cwd === p.projectDir),
    'every call in the PROJECT cwd, argv arrays only');
  assert.deepEqual(git.calls[1].args, ['add', '--', 'index.html']);
  assert.equal(git.calls[2].args[2], 'boom: Make the hero orange.');
  // dirty tree → revert refused with the honest story
  git.responses.status = ' M index.html\n';
  h.bus.handlers.get('projectsBoomRevert')({
    projectId: p.projectId,
    ts: h.bus.last('projectsBoomLedger').entries[0].ts, token: 'cafebabe99',
  });
  await settle();
  assert.match(h.bus.last('projectsBoomRevertResult').error, /dirty/);
  assert.equal(git.calls.some((c) => c.args[0] === 'revert'), false);
  // clean tree → the revert lands
  git.responses.status = '';
  h.bus.handlers.get('projectsBoomRevert')({
    projectId: p.projectId,
    ts: h.bus.last('projectsBoomLedger').entries[0].ts, token: 'cafebabe99',
  });
  await settle();
  assert.equal(h.bus.last('projectsBoomRevertResult').ok, true);
  assert.deepEqual(git.calls.at(-1).args, ['revert', '--no-edit', 'cafebabe99']);
});

await agate('demote: no writes, an honest ledger entry, and the delegate prefill rides the F2 brief', async () => {
  const h = freshHarness('demote');
  const p = createdProject(h);
  const before = fs.readFileSync(path.join(p.projectDir, 'index.html'), 'utf8');
  h.bus.handlers.get('projectsBoomGo')({
    projectId: p.projectId, context: heroContext(),
    intent: 'Rebuild the whole layout as a dashboard.', approved: true,
  });
  h.seats.calls[0].onEvent({ type: 'text',
    text: surgeonReply([{ file: 'index.html', kind: 'modified', hunks: 'x' }], 'delegate') });
  h.seats.calls[0].onEvent({ type: 'result', ok: true });
  await settle();
  const result = h.bus.last('projectsBoomResult');
  assert.equal(result.ok, false);
  assert.equal(result.demoted, true);
  assert.ok(result.reasons.some((r) => /delegate/.test(r)), 'the surgeon\'s own ask is quoted');
  assert.equal(fs.readFileSync(path.join(p.projectDir, 'index.html'), 'utf8'), before, 'NO writes on a demote');
  const entry = h.bus.last('projectsBoomLedger').entries.at(-1);
  assert.equal(entry.demoted, true);
  assert.equal(entry.token, null);
  // the DELEGATE prefill: the intent rides the kickoff brief via the F2 composition
  h.bus.handlers.get('projectsLiftoffDelegate')({
    projectId: p.projectId, boomIntent: 'Rebuild the whole layout as a dashboard.',
  });
  const task = h.bus.injected.find((m) => m.type === 'taskCreate');
  assert.ok(task, 'the existing delegate flow fired — no new machinery');
  assert.ok(task.brief.includes(liftoff.ADDENDUM_SEPARATOR.trim().split('\n')[0] || 'CONTRACT ADDENDUM'),
    'PROJECT.md first, addendum behind the pinned separator');
  assert.match(task.brief, /BOOM-CHANGE HANDOFF/);
  assert.match(task.brief, /Rebuild the whole layout as a dashboard\./);
  assert.ok(task.brief.indexOf('BOOM-CHANGE HANDOFF') > task.brief.indexOf('# '),
    'the handoff rides the tail, never the front of PROJECT.md');
});

await agate('a hostile or contract-breaking reply lands NOTHING (fail closed at the verb layer)', async () => {
  const h = freshHarness('hostile');
  const p = createdProject(h);
  const before = fs.readFileSync(path.join(p.projectDir, 'index.html'), 'utf8');
  const replies = [
    'no fence at all',
    '```apex-surgeon\nnot json\n```',
    surgeonReply([{ file: '../escape.css', kind: 'created', hunks: 'x' }]),   // parseReply wall
    surgeonReply([{ file: 'index.html', kind: 'created', hunks: 'x' }]),      // exists rule
    surgeonReply([{ file: 'index.html', kind: 'modified' }]),                 // no content
  ];
  for (const reply of replies) {
    h.bus.handlers.get('projectsBoomGo')({
      projectId: p.projectId, context: heroContext(), intent: 'x', approved: true,
    });
    const call = h.seats.calls.at(-1);
    call.onEvent({ type: 'text', text: reply });
    call.onEvent({ type: 'result', ok: true });
    await settle();
    const result = h.bus.last('projectsBoomResult');
    assert.equal(result.ok, false, 'must refuse: ' + reply.slice(0, 40));
    assert.ok(result.error, 'the refusal tells its story');
  }
  assert.equal(fs.readFileSync(path.join(p.projectDir, 'index.html'), 'utf8'), before);
  assert.deepEqual(boom.readLedger(h.stateDir, p.projectId), [], 'nothing entered the ledger');
});

try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\nSTUDIO BOOM: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
})();
