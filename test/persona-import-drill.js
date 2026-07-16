// Persona Builder — headless drill for lib/importCast.js: author a spec ->
// validated package + migrated project-scoped memory. Run: node test/persona-import-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const contract = require('../extensions/personas/lib/contract');
const manage = require('../extensions/personas/lib/manage');
const importCast = require('../extensions/personas/lib/importCast');
const { KEYS } = require('../extensions/personas/lib/interview');

let passed = 0, failed = 0;
function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

const answers = Object.fromEntries(KEYS.map((k) => [k, `A real, complete answer for the ${k} card.`]));
const actions = Object.fromEntries([...contract.ACTION_CATEGORIES].map((k) => [k, 'ask']));

// a fake existing flat memory tree (as apex-personas leaves it)
const oldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-oldmem-'));
const oldMem = path.join(oldRoot, 'memory');
fs.mkdirSync(path.join(oldMem, 'decisions'), { recursive: true });
fs.writeFileSync(path.join(oldMem, 'MEMORY.md'),
  '# Rowan memory\n\n## Decisions\n- [A decision](decisions/2026-07-15-thing.md) — a hook\n');
fs.writeFileSync(path.join(oldMem, 'decisions', '2026-07-15-thing.md'),
  '---\nname: A decision\nproject: apex\n---\n\nBody of the decision.\n');
const oldLog = path.join(oldRoot, 'log');
fs.mkdirSync(oldLog);
fs.writeFileSync(path.join(oldLog, '2026-07-15-session.md'), 'reflection\n');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-import-ws-'));
fs.mkdirSync(path.join(ws, 'personas'));
fs.writeFileSync(path.join(ws, 'foundation.md'), '# Foundation\n\n- rule\n');

let created;
gate('importPersona creates a contract-valid package', () => {
  created = importCast.importPersona(ws, {
    name: 'Rowan', useCase: 'Reviews things independently.', personaId: 'rowan',
    mode: 'advisor', actions, answers,
    collaboration: { default_access: 'read-only', capabilities: ['review'],
                     accepts: ['change for review'], emits: ['findings'] },
    memorySource: oldMem, logSource: oldLog, projectSlug: 'apex',
  });
  const report = contract.validatePersonaPackage(ws, 'rowan', { mode: 'native' });
  assert.equal(report.valid, true, JSON.stringify(report.errors));
  assert.ok(manage.listPackages(ws).some((p) => p.personaId === 'rowan'));
});

gate('existing memory migrates into projects/<slug>/ intact', () => {
  const proj = path.join(ws, 'personas', 'rowan', 'memory', 'projects', 'apex');
  assert.ok(fs.existsSync(path.join(proj, 'MEMORY.md')), 'project index moved');
  assert.ok(fs.existsSync(path.join(proj, 'decisions', '2026-07-15-thing.md')), 'decision memo moved');
  // the internal relative pointer still resolves under the new location
  const projIndex = fs.readFileSync(path.join(proj, 'MEMORY.md'), 'utf8');
  const target = projIndex.match(/\]\(([^)]+)\)/)[1];
  assert.ok(fs.existsSync(path.join(proj, target)), 'internal pointer resolves: ' + target);
});

gate('top-level index points at the migrated project; nothing lost', () => {
  const top = fs.readFileSync(path.join(ws, 'personas', 'rowan', 'memory', 'MEMORY.md'), 'utf8');
  assert.match(top, /## Projects/);
  assert.match(top, /projects\/apex\/MEMORY\.md/);
  // logs carried over
  assert.ok(fs.existsSync(path.join(ws, 'personas', 'rowan', 'log', 'apex', '2026-07-15-session.md')));
});

gate('collaboration contract lands and validates', () => {
  const collab = JSON.parse(fs.readFileSync(
    path.join(ws, 'personas', 'rowan', 'collaboration.json'), 'utf8'));
  assert.equal(collab.default_access, 'read-only');
  assert.deepEqual(collab.emits, ['findings']);
});

console.log('\nPERSONA IMPORT DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
