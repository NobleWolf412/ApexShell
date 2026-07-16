// Persona Builder — headless drill for permanent-package management:
// create -> list -> reopen-as-draft (edit) -> replace (memory preserved) ->
// archive (soft delete). Run: node test/persona-manage-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const contract = require('../extensions/personas/lib/contract');
const render = require('../extensions/personas/lib/render');
const creator = require('../extensions/personas/lib/creator');
const manage = require('../extensions/personas/lib/manage');
const { KEYS } = require('../extensions/personas/lib/interview');

let passed = 0, failed = 0;
function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

const answersFor = (prefix) => Object.fromEntries(KEYS.map((k) => [k, `${prefix} answer for ${k}.`]));
const choicesFor = (personaId, access) => ({
  personaId, mode: 'operator',
  actions: Object.fromEntries([...contract.ACTION_CATEGORIES].map((k) => [k, 'ask'])),
  collaboration: access
    ? { enabled: true, default_access: access, capabilities: ['review'], accepts: ['packet'], emits: ['findings'] }
    : null,
});
function draftWithPreview(name, personaId, prefix, access) {
  const draft = { name, useCase: 'Use case for ' + name + '.', answers: answersFor(prefix || 'Complete') };
  draft.preview = render.renderBundle(draft, choicesFor(personaId, access));
  return draft;
}

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-manage-ws-'));
fs.mkdirSync(path.join(ws, 'personas'));
fs.writeFileSync(path.join(ws, 'foundation.md'), '# Foundation\n\n- house rule\n');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-manage-state-'));

gate('createPackage writes a package listPackages can see', () => {
  creator.createPackage(ws, draftWithPreview('Rowan', 'rowan', 'Rowan', 'read-only'));
  const list = manage.listPackages(ws);
  assert.equal(list.length, 1);
  assert.equal(list[0].personaId, 'rowan');
  assert.equal(list[0].displayName, 'Rowan');
  assert.equal(list[0].hasCollaboration, true);
});

gate('reopenAsDraft round-trips answers + tags the edit', () => {
  const d = manage.reopenAsDraft(ws, 'rowan', stateDir);
  assert.equal(d.name, 'Rowan');
  assert.equal(d.editsPersonaId, 'rowan');
  for (const k of KEYS) assert.ok(d.answers[k].includes('answer for ' + k), 'answer ' + k + ' restored');
  assert.ok(d.preview && d.preview.personaId === 'rowan');
  assert.equal(d.preview.canonicalDrift, false);
  assert.ok(d.preview.collaboration, 'collaboration contract survived the reopen');
  assert.equal(d.preview.collaboration.default_access, 'read-only');
});

gate('editing replaces the package and PRESERVES its memory', () => {
  // simulate accumulated memory on the live persona
  fs.writeFileSync(path.join(ws, 'personas', 'rowan', 'memory', 'MEMORY.md'),
    '# Rowan Memory\n\n- learned SOMETHING-DURABLE\n');
  const edited = draftWithPreview('Rowan', 'rowan', 'EDITED', 'read-write');
  edited.editsPersonaId = 'rowan';
  creator.createPackage(ws, edited);

  const list = manage.listPackages(ws);
  assert.equal(list.length, 1, 'still exactly one live persona');
  const bp = JSON.parse(fs.readFileSync(path.join(ws, 'personas', 'rowan', 'blueprint.json'), 'utf8'));
  assert.ok(bp.identity.response.includes('EDITED'), 'edited identity landed');
  const mem = fs.readFileSync(path.join(ws, 'personas', 'rowan', 'memory', 'MEMORY.md'), 'utf8');
  assert.ok(mem.includes('SOMETHING-DURABLE'), 'memory carried across the edit');
  const archived = fs.readdirSync(path.join(ws, 'personas', '.archive'));
  assert.ok(archived.some((d) => d.startsWith('rowan--')), 'old package archived');
});

gate('rename edit retires the old id, creates the new, keeps one live', () => {
  const renamed = draftWithPreview('Sage', 'sage', 'Sage', 'read-only');
  renamed.editsPersonaId = 'rowan';   // Rowan -> Sage
  creator.createPackage(ws, renamed);
  const ids = manage.listPackages(ws).map((p) => p.personaId);
  assert.deepEqual(ids, ['sage']);    // rowan retired, sage live
  const mem = fs.readFileSync(path.join(ws, 'personas', 'sage', 'memory', 'MEMORY.md'), 'utf8');
  assert.ok(mem.includes('SOMETHING-DURABLE'), 'memory followed the rename');
});

gate('archivePackage soft-deletes; memory survives under .archive', () => {
  const dest = creator.archivePackage(ws, 'sage');
  assert.equal(manage.listPackages(ws).length, 0);
  const mem = fs.readFileSync(path.join(dest, 'memory', 'MEMORY.md'), 'utf8');
  assert.ok(mem.includes('SOMETHING-DURABLE'), 'archived copy keeps the memory');
});

gate('a failed edit leaves the original package intact', () => {
  creator.createPackage(ws, draftWithPreview('Vale', 'vale', 'Vale'));
  const bad = draftWithPreview('Vale', 'vale', 'Vale');
  bad.editsPersonaId = 'vale';
  bad.preview.generatedCanonicalHash = 'f'.repeat(64);   // hash mismatch -> refuse early
  assert.throws(() => creator.createPackage(ws, bad), /hash/i);
  assert.ok(manage.listPackages(ws).some((p) => p.personaId === 'vale'), 'original survived');
});

gate('listPackages ignores the .archive folder and stray dotfiles', () => {
  const ids = manage.listPackages(ws).map((p) => p.personaId);
  assert.ok(!ids.includes('.archive'));
});

console.log('\nPERSONA MANAGE DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
