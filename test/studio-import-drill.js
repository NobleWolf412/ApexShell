// App Builder — import/audit mode drill (STUDIO, slice 9). Deterministic,
// headless, zero LLM spend, no real seat/disposable call. Exercises the pure
// audit/mapping core (extensions/studio/lib/importer.js) and the import bus
// verbs end to end. Run: node test/studio-import-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const importer = require('../extensions/studio/lib/importer');
const studio = require('../extensions/studio/main');
const drafts = require('../extensions/studio/lib/drafts');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-import-drill-'));
let passed = 0;
let failed = 0;
const pending = []; // checks run via their own async IIFE; awaited before teardown

function gate(name, fn) {
  const run = (async () => {
    try { await fn(); passed++; console.log('PASS  ' + name); }
    catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
  })();
  pending.push(run);
}

// A source project folder, headings named after the interview cards so
// suggestedKey maps each one onto a distinct blueprint area with no ambiguity
// — the "clean" shape a careful legacy PROJECT.md would already have.
function writeCleanSource(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PROJECT.md'), [
    '---',
    'name: legacy-board',
    'display_name: Legacy Board',
    'description: A board that already existed before the builder did.',
    '---',
    '',
    '# Legacy Board',
    '',
    '## The idea',
    '',
    'A lightweight kanban for solo makers, built by hand before the App Builder existed.',
    '',
    '## Users and jobs',
    '',
    'Solo makers who want to capture an idea and act on it without ceremony.',
    '',
    '## Scope and non-goals',
    '',
    'v1 ships one board. Non-goals: no accounts, no sync, no sharing.',
    '',
    '## Platform and stack',
    '',
    'Desktop web, a small vanilla renderer, no framework lock-in.',
    '',
    '## Architecture and data',
    '',
    'A renderer owns the board DOM; an engine module owns persistence.',
    '',
    '## Delivery',
    '',
    'Milestone one lands the board. Lift-off means a card survives a reload.',
    '',
  ].join('\n'));
}

// A source missing two whole sections (scope, delivery) — those areas must
// come back empty (a gap), never invented from neighbouring prose.
function writeIncompleteSource(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PROJECT.md'), [
    '---',
    'name: half-built',
    'display_name: Half Built',
    'description: Missing two whole sections on purpose.',
    '---',
    '',
    '# Half Built',
    '',
    '## The idea',
    '',
    'An idea worth capturing, imported with real gaps left in place.',
    '',
    '## Users and jobs',
    '',
    'Whoever needs a board without ceremony.',
    '',
    '## Platform and stack',
    '',
    'Desktop web.',
    '',
    '## Architecture and data',
    '',
    'One renderer, one engine module.',
    '',
  ].join('\n'));
}

// A fresh, isolated bus + workspace + state dir for one bus-level check, so
// concurrent checks (each `gate` starts running immediately) never share
// mutable state. Mirrors studio-drafts-drill.js's per-check isolation.
function freshBus(tag) {
  const ws = fs.mkdtempSync(path.join(scratch, tag + '-ws-'));
  const stateDir = fs.mkdtempSync(path.join(scratch, tag + '-state-'));
  studio.writeWorkspaceConfig(stateDir, ws);
  const handlers = new Map();
  const posts = [];
  const bus = { on: (t, fn) => handlers.set(t, fn), post: (t, p) => posts.push({ type: t, payload: p }) };
  let picked = null;
  studio.register({ bus, stateDir, async pickDirectory() { return picked; } });
  return { ws, stateDir, handlers, posts, setPicked: (p) => { picked = p; } };
}

// --- lib-level checks (importer.js in isolation) ----------------------------

gate('clean import: well-formed source maps cleanly, no ambiguity', () => {
  const dir = path.join(scratch, 'clean-lib');
  writeCleanSource(dir);
  const audit = importer.auditImportFolder(dir);
  assert.deepEqual(audit.errors, [], JSON.stringify(audit.errors));
  assert.equal(audit.sections.length, 6);
  const byHeading = Object.fromEntries(audit.sections.map((s) => [s.heading, s.suggestedKey]));
  assert.equal(byHeading['The idea'], 'idea');
  assert.equal(byHeading['Users and jobs'], 'users');
  assert.equal(byHeading['Scope and non-goals'], 'scope');
  assert.equal(byHeading['Platform and stack'], 'platform');
  assert.equal(byHeading['Architecture and data'], 'architecture');
  assert.equal(byHeading['Delivery'], 'delivery');
});

gate('clean import: a v1-shaped source maps its six areas and reports look as the gap', () => {
  const dir = path.join(scratch, 'clean-lib-2');
  writeCleanSource(dir);
  const audit = importer.auditImportFolder(dir);
  const mapping = Object.fromEntries(audit.sections.map((s) => [String(s.index), s.suggestedKey]));
  // A pre-schema-2 doc has no design section: `look` is the one unmapped area
  // — a reported gap, never a block and never invented (§ Wave A).
  assert.deepEqual(importer.mappingGaps(mapping), ['look']);
  const answers = importer.answersFromMapping(audit, mapping);
  for (const key of ['idea', 'users', 'scope', 'platform', 'architecture', 'delivery'])
    assert(answers[key] && answers[key].trim().length > 0, key + ' has mapped content');
  assert.equal(answers.look, '', 'look was never mapped, so it is empty, not guessed');
});

gate('schema-2 source: a Design Language heading suggests look and closes the gap', () => {
  const dir = path.join(scratch, 'clean-lib-look');
  writeCleanSource(dir);
  fs.appendFileSync(path.join(dir, 'PROJECT.md'), [
    '## Design Language',
    '',
    'Light surfaces, one calm blue accent, roomy sans type, airy density. Tone: calm and unhurried.',
    '',
  ].join('\n'));
  const audit = importer.auditImportFolder(dir);
  const byHeading = Object.fromEntries(audit.sections.map((s) => [s.heading, s.suggestedKey]));
  assert.equal(byHeading['Design Language'], 'look');
  const mapping = Object.fromEntries(audit.sections.map((s) => [String(s.index), s.suggestedKey]));
  assert.deepEqual(importer.mappingGaps(mapping), []); // all seven areas targeted
  const answers = importer.answersFromMapping(audit, mapping);
  assert(answers.look.includes('calm blue accent'), 'look carries its mapped content');
});

gate('a source declaring schema_version 1 audits cleanly with the upgrade note', () => {
  const dir = path.join(scratch, 'declared-v1');
  writeCleanSource(dir);
  const md = fs.readFileSync(path.join(dir, 'PROJECT.md'), 'utf8')
    .replace('---\nname:', '---\nschema_version: 1\nname:');
  fs.writeFileSync(path.join(dir, 'PROJECT.md'), md);
  const audit = importer.auditImportFolder(dir);
  assert.deepEqual(audit.errors, [], JSON.stringify(audit.errors));
  assert(audit.warnings.some((w) => w.code === 'schema-version' && /older schema 1/.test(w.message)),
    JSON.stringify(audit.warnings));
});

gate('missing areas: unmapped areas stay empty, nothing invented', () => {
  const dir = path.join(scratch, 'incomplete-lib');
  writeIncompleteSource(dir);
  const audit = importer.auditImportFolder(dir);
  const mapping = Object.fromEntries(audit.sections.map((s) => [String(s.index), s.suggestedKey]).filter(([, k]) => k));
  const gaps = importer.mappingGaps(mapping);
  assert.deepEqual(gaps.sort(), ['delivery', 'look', 'scope']);
  const answers = importer.answersFromMapping(audit, mapping);
  assert.equal(answers.scope, '', 'scope was never mapped, so it is empty, not guessed');
  assert.equal(answers.delivery, '', 'delivery was never mapped, so it is empty, not guessed');
  assert(answers.idea.includes('imported with real gaps'), 'idea still carries its own mapped content');
  assert(!answers.scope.includes('imported with real gaps'), 'the gap did not borrow idea prose');
});

gate('hostile paths: a raw ".." segment is rejected before any read', () => {
  // Built by hand, NOT via path.join/path.resolve — those would normalize the
  // ".." away before the check ever saw it, defeating the point of the test.
  const hostile = scratch + path.sep + '..' + path.sep + 'escape';
  assert.throws(() => importer.auditImportFolder(hostile), /\.\./);
});

gate('hostile paths: relative path is rejected', () => {
  assert.throws(() => importer.auditImportFolder('relative/legacy'), /absolute path/);
});

gate('hostile paths: non-existent path is rejected cleanly, no exception type leaks', () => {
  assert.throws(() => importer.auditImportFolder(path.join(scratch, 'does-not-exist-' + Date.now())),
    /does not exist|not reachable/);
});

gate('hostile paths: a malformed/non-project folder is rejected cleanly', () => {
  const dir = path.join(scratch, 'no-markdown');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not markdown');
  assert.throws(() => importer.auditImportFolder(dir), /no Markdown file/);

  const dirTwo = path.join(scratch, 'two-markdown');
  fs.mkdirSync(dirTwo, { recursive: true });
  fs.writeFileSync(path.join(dirTwo, 'a.md'), '# A\n');
  fs.writeFileSync(path.join(dirTwo, 'b.md'), '# B\n');
  assert.throws(() => importer.auditImportFolder(dirTwo), /more than one Markdown file/);
});

gate('hostile paths: a source outside the projects workspace is a normal, accepted import', () => {
  // The whole point of import is bringing a project in from OUTSIDE the
  // workspace — auditImportFolder places no restriction on where the source
  // lives, only that reading it is safe (absolute, no traversal, no symlink).
  // See the final report §12 for why "outside the workspace" is not itself a
  // rejection condition in this design.
  const dir = path.join(scratch, 'anywhere-else', 'legacy-project');
  writeCleanSource(dir);
  const audit = importer.auditImportFolder(dir); // never inside any studio workspace
  assert.deepEqual(audit.errors, []);
});

if (process.platform !== 'win32') {
  gate('hostile paths: a symlinked source is refused, not followed', () => {
    const real = path.join(scratch, 'real-target');
    writeCleanSource(real);
    const link = path.join(scratch, 'link-to-target');
    fs.symlinkSync(real, link, 'dir');
    assert.throws(() => importer.auditImportFolder(link), /not a link/);
  });
}

gate('unknown mapping target is rejected before any answer is built', () => {
  const dir = path.join(scratch, 'unknown-target');
  writeCleanSource(dir);
  const audit = importer.auditImportFolder(dir);
  assert.throws(() => importer.answersFromMapping(audit, { '0': 'not-a-real-area' }), /area the builder does not have/);
});

// --- bus-level checks (main.js's projectsImport* verbs) ---------------------

gate('projectsImportChoose audits and seeds a mapping from suggestions', async () => {
  const { handlers, posts, setPicked } = freshBus('choose');
  const dir = path.join(scratch, 'bus-clean');
  writeCleanSource(dir);
  setPicked(dir);
  await handlers.get('projectsImportChoose')();
  const audit = posts.at(-1).payload;
  assert.equal(posts.at(-1).type, 'projectsImportAudit');
  assert.equal(audit.sections.length, 6);
  assert.equal(Object.keys(audit.mapping).length, 6);
  assert.deepEqual(audit.gaps, ['look']); // the v1-shaped source has no design section
});

gate('projectsImportBuild creates a draft whose answers came from the approved mapping only', async () => {
  const { handlers, posts, setPicked, stateDir } = freshBus('build');
  const dir = path.join(scratch, 'bus-clean-2');
  writeCleanSource(dir);
  setPicked(dir);
  await handlers.get('projectsImportChoose')();
  posts.length = 0;
  handlers.get('projectsImportBuild')({ sourceFolder: dir });
  assert.equal(posts[0].type, 'projectsImportResult');
  assert.equal(posts[0].payload.ok, true, posts[0].payload.error);
  // Two canonical gaps: look (a v1-shaped source has no design section — the
  // import-with-look-gap story) and risks (no interview card feeds it).
  assert.deepEqual(posts[0].payload.gaps, ['look', 'risks']);
  const draftId = posts[0].payload.draftId;
  const draft = drafts.readDraft(stateDir, draftId);
  assert(draft.answers.idea.includes('lightweight kanban'));
  assert(draft.answers.scope.includes('Non-goals'));
  assert.ok(draft.preview, 'a blueprint preview was built from the approved mapping');
});

gate('targeted revision: re-mapping ONE area updates the same draft, not a new one', async () => {
  const { handlers, posts, setPicked, stateDir } = freshBus('targeted');
  const dir = path.join(scratch, 'bus-targeted');
  writeIncompleteSource(dir); // scope + delivery start unmapped (look always is: v1-shaped source)
  setPicked(dir);
  await handlers.get('projectsImportChoose')();
  const firstAudit = posts.at(-1).payload;
  assert.deepEqual(firstAudit.gaps.sort(), ['delivery', 'look', 'scope']);

  posts.length = 0;
  handlers.get('projectsImportBuild')({ sourceFolder: dir, name: 'Half Built', pitch: 'A partial import.' });
  const firstDraftId = posts[0].payload.draftId;
  assert(posts[0].payload.gaps.includes('scope'), 'scope still a canonical gap before the targeted fix');

  // Targeted revision: point the "Architecture and data" section's content at
  // delivery too — a plausible one-row fix — WITHOUT re-picking or re-reading
  // the source folder (setPicked is never called again below).
  const archIndex = firstAudit.sections.find((s) => s.heading === 'Architecture and data').index;
  posts.length = 0;
  handlers.get('projectsImportSetMapping')({ sourceFolder: dir, index: archIndex, key: 'delivery' });
  assert.equal(posts[0].type, 'projectsImportAudit');
  assert(!posts[0].payload.gaps.includes('delivery'), 'delivery is no longer an unmapped gap after the one-row fix');
  assert(posts[0].payload.gaps.includes('scope'), 'scope is untouched by the targeted edit');

  posts.length = 0;
  handlers.get('projectsImportBuild')({ sourceFolder: dir });
  assert.equal(posts[0].payload.ok, true, posts[0].payload.error);
  assert.equal(posts[0].payload.draftId, firstDraftId, 'the SAME draft was updated, not a second one created');
  const updated = drafts.readDraft(stateDir, firstDraftId);
  assert(updated.answers.delivery.includes('renderer, one engine module'), 'delivery now carries the remapped section');
  assert.equal(updated.answers.scope, '', 'scope is still empty — the targeted fix did not touch it');
});

gate('read-only proof: a full import flow never writes to the source folder', async () => {
  const { handlers, posts, setPicked } = freshBus('readonly');
  const dir = path.join(scratch, 'read-only-source');
  writeCleanSource(dir);
  const before = fs.readFileSync(path.join(dir, 'PROJECT.md'), 'utf8');
  const beforeMtime = fs.statSync(path.join(dir, 'PROJECT.md')).mtimeMs;
  const beforeEntries = fs.readdirSync(dir).sort();

  setPicked(dir);
  await handlers.get('projectsImportChoose')();
  const audit = posts.at(-1).payload;
  // Exercise a targeted revision too, then a full build/approve — the whole
  // flow, not just the read.
  handlers.get('projectsImportSetMapping')({ sourceFolder: dir, index: audit.sections[0].index, key: 'idea' });
  posts.length = 0;
  handlers.get('projectsImportBuild')({ sourceFolder: dir, name: 'Read Only Check' });
  // projectsImportBuild posts the result FIRST, then a draft-status refresh —
  // find the result explicitly rather than assuming post order.
  const result = posts.find((p) => p.type === 'projectsImportResult').payload;
  assert.equal(result.ok, true, result.error);

  const after = fs.readFileSync(path.join(dir, 'PROJECT.md'), 'utf8');
  const afterMtime = fs.statSync(path.join(dir, 'PROJECT.md')).mtimeMs;
  const afterEntries = fs.readdirSync(dir).sort();
  assert.equal(after, before, 'source file bytes are unchanged');
  assert.equal(afterMtime, beforeMtime, 'source file mtime is unchanged');
  assert.deepEqual(afterEntries, beforeEntries, 'no file was added to or removed from the source folder');
});

gate('projectsImportBuild refuses a structurally broken source instead of guessing', async () => {
  const { handlers, posts, setPicked } = freshBus('malformed');
  const dir = path.join(scratch, 'bus-malformed');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PROJECT.md'), '---\nschema_version: 9\n---\n\n## Only section\nbody\n');
  setPicked(dir);
  await handlers.get('projectsImportChoose')();
  posts.length = 0;
  handlers.get('projectsImportBuild')({ sourceFolder: dir });
  assert.equal(posts[0].payload.ok, false);
  assert.match(posts[0].payload.error, /structural problems/);
});

gate('projectsImportChoose surfaces nothing when the picker is cancelled', async () => {
  const { handlers, posts, setPicked } = freshBus('cancel');
  setPicked(null); // user cancelled the picker
  await handlers.get('projectsImportChoose')();
  assert.equal(posts.length, 0, 'a cancelled picker changes nothing and posts nothing');
});

Promise.all(pending).then(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`\nSTUDIO IMPORT: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
});
