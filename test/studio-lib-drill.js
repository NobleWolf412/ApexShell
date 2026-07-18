// App Builder Contract v1 (STUDIO, slice 2) — deterministic headless gate for
// extensions/studio/lib/. No Electron, no network. Static fixtures live under
// test/studio-fixtures/; the drill stages each into a temp workspace (mirroring
// how the persona drills use os.tmpdir) and asserts the contract's structured
// result. Zero LLM spend. Run: node test/studio-lib-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const contract = require('../extensions/studio/lib/contract');
const render = require('../extensions/studio/lib/render');

const FIXTURES = path.join(__dirname, 'studio-fixtures');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-lib-'));
const results = [];

function gate(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log('PASS  ' + name); }
  catch (err) { results.push({ name, ok: false }); console.error('FAIL  ' + name + ' — ' + err.message); }
}

// Stage a fixture folder into a fresh workspace under its own project id, so
// each check is isolated and nothing is read from or written to the repo tree.
function stage(fixture, projectId) {
  const workspace = fs.mkdtempSync(path.join(scratch, 'ws-'));
  const dir = path.join(workspace, projectId);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(path.join(FIXTURES, fixture)))
    fs.copyFileSync(path.join(FIXTURES, fixture, file), path.join(dir, file));
  return { workspace, dir };
}

// --- the eight required, discrete named checks ---

gate('minimal valid project', () => {
  const { workspace } = stage('valid', 'valid-project');
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [], JSON.stringify(result.warnings));
});

gate('invalid id', () => {
  const workspace = fs.mkdtempSync(path.join(scratch, 'ws-'));
  for (const id of ['', 'Bad_Id', 'two words', '-leading', 'trailing-']) {
    const result = contract.validateProjectPackage(workspace, id);
    assert.equal(result.valid, false, id);
    assert.equal(result.errors[0].code, 'unsafe-id', id);
  }
});

gate('path traversal', () => {
  const workspace = fs.mkdtempSync(path.join(scratch, 'ws-'));
  // Rejected at the id gate before any path is built...
  const result = contract.validateProjectPackage(workspace, '../escape');
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, 'unsafe-id');
  // ...and the low-level path primitive refuses to resolve outside the root.
  assert.throws(() => contract.resolveInside(workspace, '..', 'escape'), /escapes/);
  assert.equal(contract.isInside(workspace, path.join(workspace, 'inside')), true);
});

gate('overwrite collision', () => {
  const { workspace } = stage('valid', 'valid-project');
  const result = contract.validateProjectPackage(workspace, 'valid-project', { mode: 'create' });
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'would-overwrite'), JSON.stringify(result.errors));
  // A never-created id is a clean create target.
  const fresh = contract.validateProjectPackage(workspace, 'brand-new', { mode: 'create' });
  assert.equal(fresh.valid, true, JSON.stringify(fresh.errors));
});

gate('malformed frontmatter', () => {
  const { workspace } = stage('malformed-frontmatter', 'malformed-frontmatter');
  const result = contract.validateProjectPackage(workspace, 'malformed-frontmatter');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'frontmatter'), JSON.stringify(result.errors));
});

gate('malformed JSON', () => {
  const { workspace } = stage('malformed-json', 'malformed-json');
  const result = contract.validateProjectPackage(workspace, 'malformed-json');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'invalid-json'), JSON.stringify(result.errors));
});

gate('unsupported schema version', () => {
  const { workspace } = stage('unsupported-schema', 'unsupported-schema');
  const result = contract.validateProjectPackage(workspace, 'unsupported-schema');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'schema-version'), JSON.stringify(result.errors));
});

gate('hash drift', () => {
  const { workspace, dir } = stage('valid', 'valid-project');
  // A post-approval external edit must surface as a warning, never invalidate
  // and never be silently overwritten.
  fs.appendFileSync(path.join(dir, 'PROJECT.md'), '\nedited by hand after approval\n');
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert(result.warnings.some((w) => w.code === 'canonical-drift'), JSON.stringify(result.warnings));
  assert.match(fs.readFileSync(path.join(dir, 'PROJECT.md'), 'utf8'), /edited by hand/);
});

// --- rule-shape coverage beyond the eight (warnings, suggestions, render) ---

gate('import mode downgrades a missing blueprint to a warning', () => {
  const { workspace, dir } = stage('valid', 'valid-project');
  fs.rmSync(path.join(dir, 'blueprint.json'));
  const native = contract.validateProjectPackage(workspace, 'valid-project');
  const imported = contract.validateProjectPackage(workspace, 'valid-project', { mode: 'import' });
  assert.equal(native.valid, false);
  assert(native.errors.some((e) => e.code === 'missing-blueprint'));
  assert.equal(imported.valid, true, JSON.stringify(imported.errors));
  assert(imported.warnings.some((w) => w.code === 'missing-blueprint'));
});

gate('fluff tripwires warn on missing non-goals and verification', () => {
  const { workspace, dir } = stage('valid', 'valid-project');
  const blueprint = JSON.parse(fs.readFileSync(path.join(dir, 'blueprint.json'), 'utf8'));
  delete blueprint.scope.non_goals;
  blueprint.delivery.verification = '';
  fs.writeFileSync(path.join(dir, 'blueprint.json'), JSON.stringify(blueprint, null, 2));
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert(result.warnings.some((w) => w.code === 'scope-no-non-goals'), JSON.stringify(result.warnings));
  assert(result.warnings.some((w) => w.code === 'delivery-no-verification'), JSON.stringify(result.warnings));
});

gate('thin vision and orphan component surface as suggestions', () => {
  const { workspace, dir } = stage('valid', 'valid-project');
  const blueprint = JSON.parse(fs.readFileSync(path.join(dir, 'blueprint.json'), 'utf8'));
  blueprint.idea = { pitch: 'too short' };
  blueprint.architecture.components = ['orphan-service'];
  fs.writeFileSync(path.join(dir, 'blueprint.json'), JSON.stringify(blueprint, null, 2));
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert(result.suggestions.some((s) => s.code === 'thin-vision'), JSON.stringify(result.suggestions));
  assert(result.suggestions.some((s) => s.code === 'architecture-orphan'), JSON.stringify(result.suggestions));
});

gate('project overlap advises against a workspace neighbour', () => {
  const { workspace } = stage('valid', 'valid-project');
  const other = path.join(workspace, 'sibling-project');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'project-context.md'),
    'A kanban board for solo makers with drag reorder cards and momentum.');
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert(result.suggestions.some((s) => s.code === 'project-overlap'), JSON.stringify(result.suggestions));
});

gate('runtime/provider fields are rejected from the portable blueprint', () => {
  const { workspace, dir } = stage('valid', 'valid-project');
  const blueprint = JSON.parse(fs.readFileSync(path.join(dir, 'blueprint.json'), 'utf8'));
  blueprint.platform.provider = 'must-not-live-here';
  fs.writeFileSync(path.join(dir, 'blueprint.json'), JSON.stringify(blueprint, null, 2));
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'runtime-data'), JSON.stringify(result.errors));
});

gate('name mismatch between frontmatter and folder blocks', () => {
  const { workspace, dir } = stage('valid', 'valid-project');
  const md = fs.readFileSync(path.join(dir, 'PROJECT.md'), 'utf8').replace('name: valid-project', 'name: other-name');
  fs.writeFileSync(path.join(dir, 'PROJECT.md'), md);
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'name-mismatch'), JSON.stringify(result.errors));
});

gate('canonical hashes ignore CRLF versus LF line endings', () => {
  assert.equal(contract.hashCanonical('one\r\ntwo\r\n'), contract.hashCanonical('one\ntwo\n'));
});

gate('render primitive round-trips through parse and hash', () => {
  const canonical = render.renderCanonical({
    projectId: 'round-trip', displayName: 'Round Trip',
    description: 'Rendered then parsed.',
    sections: { vision: 'A clear vision.', scope: 'A tight scope.' },
  });
  const parsed = contract.parseFrontmatter(canonical);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.attributes.name, 'round-trip');
  assert.equal(parsed.attributes.schema_version, 1);
  // Every section identity is present via its marker; headings stay renameable.
  for (const key of render.SECTION_KEYS)
    assert.match(canonical, new RegExp('app-builder:' + key + ':start'));
  // Hashing is stable for identical input.
  assert.equal(contract.hashCanonical(canonical), contract.hashCanonical(canonical));
});

gate('render rejects an unsafe project id', () => {
  assert.throws(() => render.renderCanonical({ projectId: 'Bad Id', displayName: 'X' }), /kebab-case/);
});

fs.rmSync(scratch, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\nSTUDIO CONTRACT: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
