// App Builder Blueprint Review + Canonical Draft drill (STUDIO, slice 4) —
// deterministic, headless, zero LLM spend. Exercises the pure preview core
// (extensions/studio/lib/blueprint.js), the draft store's approved-snapshot
// persistence, the validation PROJECTION (main.validateBundleReport, which stages
// a temp package and runs the slice-2 contract — never re-implements it), and the
// preview bus verbs end to end. Each named check is discrete.
// Run: node test/studio-review-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const blueprint = require('../extensions/studio/lib/blueprint');
const drafts = require('../extensions/studio/lib/drafts');
const contract = require('../extensions/studio/lib/contract');
const studio = require('../extensions/studio/main');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-review-drill-'));
let passed = 0;
let failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
}

// A full, answered draft — long answers so the thin-* suggestions stay quiet and
// the happy path validates.
function fullDraft(over = {}) {
  const answers = {
    idea: 'A lightweight kanban for solo makers who abandon heavyweight trackers, turning a vague weekend idea into one scannable board so momentum never dies between sessions.',
    users: 'Solo makers and indie hackers, pre-launch: they want to capture an idea and see the next action without ceremony. Success is acting on the board instead of re-deriving it each morning.',
    scope: 'v1 ships a single board with drag-to-reorder cards, a one-line quick-add, and local-first persistence. Non-goals: no accounts, no server sync, and no sharing in the first cut.',
    platform: 'Desktop web first, packaged later; a Node data plane and a small vanilla renderer with no framework lock-in. It must coexist with the ApexShell workspace layout on disk.',
    architecture: 'A renderer owns the board DOM; an engine module owns persistence and card ordering. The risky seam is offline write ordering, treated as a validated packet from day one.',
    delivery: 'Milestone one lands the renderer board; milestone two lands engine persistence. Lift-off means npm test is green and a card survives a reload. Risk parked for the Architect: ordering under concurrent edits.',
  };
  return {
    schema: 1,
    id: '11111111-1111-4111-8111-111111111111',
    workspace: scratch,
    name: 'SniperSight',
    pitch: 'A scannable board that keeps solo-maker momentum alive between sessions.',
    revision: 1,
    currentCard: 0,
    answers: { ...answers, ...(over.answers || {}) },
    preview: null,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...over,
  };
}

// --- the three REQUIRED, discrete named checks ------------------------------

gate('gap rendering — a missing area is visibly incomplete and NEVER invented', () => {
  const draft = fullDraft({ answers: { scope: '' } });   // scope card left blank
  const bundle = blueprint.buildBundle(draft, 'snipersight');

  // The scope section is a gap, marked with the explicit incomplete placeholder.
  assert(bundle.gaps.includes('scope'), 'scope reported as a gap');
  const scopeBlock = bundle.canonical.slice(
    bundle.canonical.indexOf('<!-- app-builder:scope:start -->'),
    bundle.canonical.indexOf('<!-- app-builder:scope:end -->'));
  assert(scopeBlock.includes(blueprint.INCOMPLETE_PLACEHOLDER), 'scope shows the incomplete placeholder');
  // Never invented: the gap body carries none of the other areas' answer prose.
  assert(!scopeBlock.includes('drag-to-reorder'), 'gap did not borrow another area');
  assert(!scopeBlock.includes('renderer owns the board'), 'gap did not borrow architecture');

  // risks has no source card in v1, so it is always a visible gap, never invented.
  assert(bundle.gaps.includes('risks'), 'risks is a structural gap');

  // Validation (projected slice-2 rules) flags the empty area as a WARNING, not
  // an error — it does not block, but it demands review.
  const report = studio.validateBundleReport(bundle);
  assert(report.warnings.some((w) => w.code === 'incomplete-area'),
    'incomplete-area warning: ' + JSON.stringify(report.warnings));
  assert(!report.errors.some((e) => e.code === 'incomplete-area'), 'a gap never blocks');
});

gate('drift — an edit whose hash != approved hash is detected and prompts review', () => {
  const draft = fullDraft();
  const approved = blueprint.buildBundle(draft, 'snipersight');
  assert.equal(approved.canonicalDrift, false);
  assert.equal(approved.blueprint.canonical_hash, approved.generatedCanonicalHash);

  // A manual edit: drift DETECTED, and neither the approved hash nor the blueprint
  // hash silently moves — regeneration is never automatic.
  const edited = blueprint.withCanonicalEdit(approved, approved.canonical + '\nhand-written line\n');
  assert.equal(edited.canonicalDrift, true, 'drift detected');
  assert.equal(edited.generatedCanonicalHash, approved.generatedCanonicalHash, 'approved hash unchanged');
  assert.equal(edited.blueprint.canonical_hash, approved.generatedCanonicalHash, 'blueprint hash unchanged (no silent regen)');
  // The projected validator surfaces the same drift as a warning.
  assert(studio.validateBundleReport(edited).warnings.some((w) => w.code === 'canonical-drift'),
    'validation reports canonical-drift');

  // Review arm 1 — RE-APPROVE: adopt the edit and rehash.
  const reapproved = blueprint.acceptCanonical(edited);
  assert.equal(reapproved.canonicalDrift, false);
  assert.equal(reapproved.generatedCanonicalHash, contract.hashCanonical(edited.canonical), 'rehashed to the edit');
  assert.equal(reapproved.blueprint.canonical_hash, reapproved.generatedCanonicalHash);
  assert.match(reapproved.canonical, /hand-written line/);

  // Review arm 2 — REGENERATE from answers: discard the manual edit.
  const regenerated = blueprint.buildBundle(draft, 'snipersight');
  assert.equal(regenerated.canonicalDrift, false);
  assert(!/hand-written line/.test(regenerated.canonical), 'manual edit discarded');
  assert.equal(regenerated.canonical, approved.canonical, 'back to the generated canonical');
});

gate('section regen — one section regenerates without disturbing others or manual edits', () => {
  const draft = fullDraft();
  const base = blueprint.buildBundle(draft, 'snipersight');

  // The user hand-edits the PLATFORM section.
  const editedCanonical = base.canonical.replace(
    /(<!-- app-builder:platform:start -->\n## Platform and Stack\n\n)([\s\S]*?)(\n<!-- app-builder:platform:end -->)/,
    '$1HAND EDITED PLATFORM PROSE that must survive a scope regen.$3');
  assert.match(editedCanonical, /HAND EDITED PLATFORM PROSE/);
  const edited = blueprint.withCanonicalEdit(base, editedCanonical);
  assert.equal(edited.canonicalDrift, true);

  // Regenerate ONLY the scope section from its approved answer.
  const regen = blueprint.regenerateSection(edited, 'scope');

  // The manual platform edit is untouched...
  assert.match(regen.canonical, /HAND EDITED PLATFORM PROSE/, 'platform manual edit preserved');
  // ...the scope section now reflects its approved answer...
  const scopeBlock = regen.canonical.slice(
    regen.canonical.indexOf('<!-- app-builder:scope:start -->'),
    regen.canonical.indexOf('<!-- app-builder:scope:end -->'));
  assert(scopeBlock.includes('drag-to-reorder cards'), 'scope regenerated from its answer');
  // ...and the other generated sections are still present unchanged.
  assert(regen.canonical.includes('A renderer owns the board DOM'), 'architecture untouched');
  assert(regen.canonical.includes('Solo makers and indie hackers'), 'vision (users) untouched');
  // A regen under an existing manual drift keeps the review pending — never a
  // silent re-approval of the whole document.
  assert.equal(regen.canonicalDrift, true, 'drift review still pending');
  assert.equal(regen.generatedCanonicalHash, base.generatedCanonicalHash, 'no silent rehash while drifted');
});

// --- projection + persistence coverage beyond the three ---------------------

gate('buildBundle uses approved answers only, mapped to the six sections', () => {
  const draft = fullDraft();
  const bundle = blueprint.buildBundle(draft, 'snipersight');
  assert.equal(bundle.gaps.length, 1);          // only risks (no card) is a gap
  assert.deepEqual(bundle.gaps, ['risks']);
  // vision merges idea + users; each section carries its own approved prose.
  const visionBlock = bundle.canonical.slice(
    bundle.canonical.indexOf('<!-- app-builder:vision:start -->'),
    bundle.canonical.indexOf('<!-- app-builder:vision:end -->'));
  assert(visionBlock.includes('lightweight kanban'), 'vision has the idea answer');
  assert(visionBlock.includes('Solo makers and indie hackers'), 'vision has the users answer');
  // The frontmatter name matches the requested id; the parse round-trips clean.
  const parsed = contract.parseFrontmatter(bundle.canonical);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.attributes.name, 'snipersight');
  // An unsafe id is refused before any rendering.
  assert.throws(() => blueprint.buildBundle(draft, 'Bad Id'), /kebab-case/);
});

gate('validation report projects the slice-2 rules (errors block, warnings review)', () => {
  const bundle = blueprint.buildBundle(fullDraft(), 'snipersight');
  const report = studio.validateBundleReport(bundle);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
  // The free-text interview captures no structured non-goals/verification list, so
  // those tripwires fire as review WARNINGS (never errors) — projected verbatim.
  assert(report.warnings.some((w) => w.code === 'scope-no-non-goals'));
  assert(report.warnings.some((w) => w.code === 'delivery-no-verification'));
  // An empty pitch → empty description → the required-frontmatter rule BLOCKS.
  const noPitch = blueprint.buildBundle(fullDraft({ pitch: '' }), 'snipersight');
  const blocked = studio.validateBundleReport(noPitch);
  assert.equal(blocked.valid, false);
  assert(blocked.errors.some((e) => e.code === 'missing-frontmatter'), JSON.stringify(blocked.errors));
});

gate('the approved snapshot persists on the draft (hash-drift via the draft store)', () => {
  const stateDir = path.join(scratch, 'store-state');
  const workspace = path.join(scratch, 'store-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const created = drafts.createDraft(stateDir, workspace, { name: 'SniperSight', pitch: 'A scannable board.' });
  const filled = drafts.updateDraft(stateDir, created.id, created.revision, {
    answers: fullDraft().answers,
  });
  const bundle = blueprint.buildBundle(filled, 'snipersight');
  const saved = drafts.updateDraft(stateDir, filled.id, filled.revision, { preview: bundle });
  // Round-trips byte-for-byte through the crash-safe store.
  const reloaded = drafts.readDraft(stateDir, created.id);
  assert.deepEqual(reloaded.preview, saved.preview);
  assert.equal(reloaded.preview.canonicalDrift, false);
  // A tampered file that lies about its drift bit is refused on read.
  assert.throws(() => drafts.validatePreview({ ...bundle, canonicalDrift: true }),
    /drift state is invalid/);
  // A runtime/provider field can never ride into the persisted blueprint.
  assert.throws(() => drafts.validatePreview({
    ...bundle, blueprint: { ...bundle.blueprint, platform: { response: 'x', provider: 'no' } },
  }), /runtime-only fields/);
});

gate('preview bus verbs generate, edit-with-drift, regen, and validate', () => {
  const stateDir = path.join(scratch, 'bus-state');
  const workspace = path.join(scratch, 'bus-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  studio.writeWorkspaceConfig(stateDir, workspace);

  const handlers = new Map();
  const posts = [];
  const bus = { on: (t, fn) => handlers.set(t, fn), post: (t, p) => posts.push({ type: t, payload: p }) };
  studio.register({ bus, stateDir, async pickDirectory() { return null; } });

  handlers.get('projectsDraftCreate')({ name: 'SniperSight', pitch: 'A scannable board.' });
  const draftId = posts.at(-1).payload.draft.id;
  const answers = fullDraft().answers;
  let rev = posts.at(-1).payload.draft.revision;
  handlers.get('projectsDraftSave')({ id: draftId, expectedRevision: rev, changes: { answers } });
  const draft = posts.at(-1).payload.draft;

  // GENERATE → a preview status carrying a fresh bundle.
  posts.length = 0;
  handlers.get('projectsPreviewGenerate')({ id: draftId, expectedRevision: draft.revision, projectId: 'snipersight' });
  assert.deepEqual(posts.map((p) => p.type), ['projectsPreviewResult', 'projectsPreviewStatus']);
  let bundle = posts.at(-1).payload.bundle;
  assert.equal(bundle.canonicalDrift, false);

  // MANUAL EDIT → drift surfaces; regenerating over it needs confirmation.
  let curRev = posts.at(-1).payload.draft.revision;
  posts.length = 0;
  handlers.get('projectsPreviewSaveCanonical')({
    id: draftId, expectedRevision: curRev, canonical: bundle.canonical + '\nedited\n',
  });
  bundle = posts.at(-1).payload.bundle;
  assert.equal(bundle.canonicalDrift, true);
  curRev = posts.at(-1).payload.draft.revision;

  posts.length = 0;
  handlers.get('projectsPreviewGenerate')({ id: draftId, expectedRevision: curRev, projectId: 'snipersight' });
  assert.equal(posts[0].type, 'projectsPreviewResult');
  assert.equal(posts[0].payload.ok, false);
  assert.equal(posts[0].payload.needsConfirmation, true, 'regen over a manual edit must confirm');

  // VALIDATE → a projected report (drift is a warning, still valid overall).
  posts.length = 0;
  handlers.get('projectsPreviewValidate')({ id: draftId });
  assert.equal(posts[0].type, 'projectsValidationStatus');
  assert(posts[0].payload.report.warnings.some((w) => w.code === 'canonical-drift'));

  // ACCEPT → drift cleared, hash re-baselined.
  posts.length = 0;
  handlers.get('projectsPreviewAcceptCanonical')({ id: draftId, expectedRevision: curRev });
  assert.equal(posts.at(-1).payload.bundle.canonicalDrift, false);
  assert.match(posts.at(-1).payload.bundle.canonical, /edited/);
});

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\nSTUDIO REVIEW: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
