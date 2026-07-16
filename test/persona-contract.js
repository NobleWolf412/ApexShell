// Persona Contract v1 — deterministic headless gate.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const contract = require('../extensions/personas/lib/contract');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-persona-contract-'));
const results = [];

function gate(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS  ' + name);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.error('FAIL  ' + name + ' — ' + err.message);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function canonical(id, modules = []) {
  const moduleLines = modules.length ? '\n' + modules.map((m) => '  - ' + m).join('\n') : ' []';
  return [
    '---',
    'schema_version: 1',
    'name: ' + id,
    'display_name: Test Persona',
    'description: A complete contract test fixture.',
    'aliases: []',
    'modules:' + moduleLines,
    '---',
    '',
    '# Test Persona',
    '',
    'Fixture body.',
  ].join('\n');
}

function blueprint(text, overrides = {}) {
  return {
    schema_version: 1,
    canonical_hash: contract.hashCanonical(text),
    identity: { background: 'fixture' },
    mission: { owns: 'contract tests' },
    communication: { tone: 'plain' },
    boundaries: { approval_required: ['destructive actions'] },
    working_method: { verification: 'run gates' },
    action_posture: { mode: 'operator' },
    ...overrides,
  };
}

function makePackage(id, options = {}) {
  const dir = path.join(scratch, 'personas', id);
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const text = options.canonical || canonical(id, options.modules || []);
  fs.writeFileSync(path.join(dir, id + '.md'), text);
  if (!options.noBlueprint)
    writeJson(path.join(dir, 'blueprint.json'), options.blueprint || blueprint(text));
  fs.writeFileSync(path.join(dir, 'memory', 'MEMORY.md'), '# Memory\n');
  fs.writeFileSync(path.join(dir, 'scratchpad.md'), '# Scratchpad\n');
  if (options.collaboration)
    writeJson(path.join(dir, 'collaboration.json'), options.collaboration);
  return { dir, text };
}

fs.mkdirSync(path.join(scratch, 'personas'), { recursive: true });

gate('safe persona IDs accept lowercase kebab-case', () => {
  assert.equal(contract.isSafePersonaId('code-reviewer'), true);
  assert.equal(contract.isSafePersonaId('reviewer2'), true);
});

gate('unsafe persona IDs are rejected', () => {
  for (const id of ['', 'Mox', '../escape', 'two words', '-leading', 'trailing-'])
    assert.equal(contract.isSafePersonaId(id), false, id);
});

gate('workspace path containment rejects traversal', () => {
  assert.throws(() => contract.resolveInside(scratch, '..', 'escape'), /escapes/);
  assert.equal(contract.resolveInside(scratch, 'personas').startsWith(scratch), true);
});

gate('canonical hashes ignore CRLF versus LF-only line endings', () => {
  assert.equal(contract.hashCanonical('one\r\ntwo\r\n'), contract.hashCanonical('one\ntwo\n'));
});

gate('frontmatter parser handles scalars and block lists', () => {
  const parsed = contract.parseFrontmatter(canonical('parser-test', ['collaboration', 'visual-identity']));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.attributes.schema_version, 1);
  assert.deepEqual(parsed.attributes.modules, ['collaboration', 'visual-identity']);
  assert.match(parsed.body, /# Test Persona/);
});

gate('frontmatter parser reports duplicate and nested fields', () => {
  const parsed = contract.parseFrontmatter('---\nname: one\nname: two\n  nested: no\n---\n');
  assert.equal(parsed.errors.length, 2);
});

makePackage('valid-persona');
gate('minimal native persona package validates', () => {
  const result = contract.validatePersonaPackage(scratch, 'valid-persona');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.warnings, []);
});

makePackage('hash-drift');
fs.appendFileSync(path.join(scratch, 'personas', 'hash-drift', 'hash-drift.md'), '\nmanual edit\n');
gate('manual canonical edits warn and never invalidate or overwrite', () => {
  const result = contract.validatePersonaPackage(scratch, 'hash-drift');
  assert.equal(result.valid, true);
  assert(result.warnings.some((w) => w.code === 'canonical-drift'));
  assert.match(fs.readFileSync(path.join(scratch, 'personas', 'hash-drift', 'hash-drift.md'), 'utf8'), /manual edit/);
});

makePackage('missing-blueprint', { noBlueprint: true });
gate('missing blueprint blocks native packages but only warns on import', () => {
  const native = contract.validatePersonaPackage(scratch, 'missing-blueprint');
  const imported = contract.validatePersonaPackage(scratch, 'missing-blueprint', { mode: 'import' });
  assert.equal(native.valid, false);
  assert(native.errors.some((e) => e.code === 'missing-blueprint'));
  assert.equal(imported.valid, true);
  assert(imported.warnings.some((w) => w.code === 'missing-blueprint'));
});

const legacyText = [
  '---',
  'name: legacy-persona',
  'tier: 2',
  'class: user-facing',
  'enabled: true',
  'description: A legacy Apex-shaped canonical.',
  '---',
  '',
  '# Legacy Persona',
].join('\n');
makePackage('legacy-persona', { canonical: legacyText, noBlueprint: true });
gate('legacy Apex-shaped frontmatter enters import audit without destructive failure', () => {
  const result = contract.validatePersonaPackage(scratch, 'legacy-persona', { mode: 'import' });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert(result.warnings.some((w) => w.code === 'missing-blueprint'));
  assert(result.warnings.some((w) => w.message.includes('schema_version')));
  assert(result.warnings.some((w) => w.message.includes('display_name')));
});

const noNameLegacy = [
  '---',
  'description: A legacy canonical with no portable name field.',
  '---',
  '',
  '# Unmapped Legacy Persona',
].join('\n');
makePackage('legacy-no-name', { canonical: noNameLegacy, noBlueprint: true });
gate('import audit warns instead of failing when a legacy name needs mapping', () => {
  const result = contract.validatePersonaPackage(scratch, 'legacy-no-name', { mode: 'import' });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert(result.warnings.some((w) => w.message.includes('name')));
});

const mismatchedName = [
  '---',
  'name: different-persona',
  'description: A legacy canonical whose declared identity conflicts with its folder.',
  '---',
  '',
  '# Different Persona',
].join('\n');
makePackage('present-name-mismatch', { canonical: mismatchedName, noBlueprint: true });
gate('a present mismatched name remains blocking during import audit', () => {
  const result = contract.validatePersonaPackage(scratch, 'present-name-mismatch', { mode: 'import' });
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'name-mismatch'));
});

const unsupportedSchema = [
  '---',
  'schema_version: 2',
  'name: unsupported-schema',
  'display_name: Unsupported Schema',
  'description: An explicitly unsupported portable contract.',
  '---',
  '',
  '# Unsupported Schema',
].join('\n');
makePackage('unsupported-schema', { canonical: unsupportedSchema, noBlueprint: true });
gate('an explicit unsupported schema remains blocking during import audit', () => {
  const result = contract.validatePersonaPackage(scratch, 'unsupported-schema', { mode: 'import' });
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'schema-version'));
});

const booleanSchema = makePackage('boolean-schema');
writeJson(path.join(booleanSchema.dir, 'blueprint.json'), blueprint(booleanSchema.text, {
  schema_version: true,
}));
gate('Boolean true is not accepted as schema version 1', () => {
  const result = contract.validatePersonaPackage(scratch, 'boolean-schema');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'schema-version'));
});

const runtimeFixture = makePackage('runtime-contamination');
writeJson(path.join(runtimeFixture.dir, 'blueprint.json'), blueprint(runtimeFixture.text, {
  action_posture: { mode: 'operator', provider: 'must-not-live-here' },
}));
gate('runtime/provider fields are rejected from the portable blueprint', () => {
  const result = contract.validatePersonaPackage(scratch, 'runtime-contamination');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'runtime-data'));
});

makePackage('reviewer', {
  modules: ['collaboration'],
  collaboration: {
    schema_version: 1,
    capabilities: ['code-review', 'debugging'],
    accepts: ['review-request'],
    emits: ['review-findings'],
    default_access: 'read-only',
  },
});
gate('read-only reviewer collaboration contract validates', () => {
  const result = contract.validatePersonaPackage(scratch, 'reviewer');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

const conflict = makePackage('reviewer-write-conflict', {
  modules: ['collaboration'],
  collaboration: {
    schema_version: 1,
    capabilities: ['code-review'],
    accepts: ['review-request'],
    emits: ['review-findings'],
    default_access: 'read-only',
  },
});
writeJson(path.join(conflict.dir, 'blueprint.json'), blueprint(conflict.text, {
  action_posture: {
    mode: 'operator',
    actions: { read_files: 'allowed', edit_files: 'allowed', delete_data: 'ask' },
  },
}));
gate('read-only collaboration warns on explicitly allowed routine writes', () => {
  const result = contract.validatePersonaPackage(scratch, 'reviewer-write-conflict');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert(result.warnings.some((w) => w.code === 'access-conflict'));
});

makePackage('bad-collaboration', {
  modules: ['collaboration'],
  collaboration: {
    schema_version: 1,
    capabilities: ['review'], accepts: [], emits: [], default_access: 'public',
  },
});
gate('invalid collaboration access is rejected', () => {
  const result = contract.validatePersonaPackage(scratch, 'bad-collaboration');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'collaboration-access'));
});

const malformed = makePackage('malformed-json');
fs.writeFileSync(path.join(malformed.dir, 'blueprint.json'), '{broken');
gate('malformed JSON is reported without crashing validation', () => {
  const result = contract.validatePersonaPackage(scratch, 'malformed-json');
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === 'invalid-json'));
});

gate('invalid IDs return a finding without touching outside paths', () => {
  const result = contract.validatePersonaPackage(scratch, '../escape');
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, 'unsafe-id');
});

const failed = results.filter((r) => !r.ok);
console.log(`\nPERSONA CONTRACT: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;

