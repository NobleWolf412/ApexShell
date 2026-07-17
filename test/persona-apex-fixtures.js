// Persona Builder Slice 10 — read-only audit of the seven private Apex fixtures.
// The fixture content is never copied into this repository. Public checkouts
// without the sibling apex-personas tree skip this opt-in integration gate.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const importer = require('../extensions/personas/lib/importer');
const creator = require('../extensions/personas/lib/creator');

const PERSONAS = ['clio', 'doc', 'drafty', 'iris', 'jinx', 'mox', 'sable'];
const configuredFixtureRoot = process.env.APEX_PERSONA_FIXTURES;
const fixtureRoot = path.resolve(configuredFixtureRoot ||
  path.join(__dirname, '..', '..', '..', 'apex-personas'));

function regularDirectory(dir, label) {
  const stat = fs.lstatSync(dir);
  assert.equal(stat.isSymbolicLink(), false, label + ' must not be a link');
  assert.equal(stat.isDirectory(), true, label + ' must be a directory');
}

function treeSnapshot(root) {
  const snapshot = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).replace(/\\/g, '/');
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        snapshot.push([relative, 'link', fs.readlinkSync(full)]);
      } else if (stat.isDirectory()) {
        snapshot.push([relative, 'dir']);
        visit(full);
      } else if (stat.isFile()) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        snapshot.push([relative, 'file', stat.size, hash]);
      } else {
        snapshot.push([relative, 'other']);
      }
    }
  };
  visit(root);
  return snapshot;
}

function assertLaunchOrder(personaId) {
  // ABSOLUTE-path kickoff (2026-07-17): the seat's cwd is the project repo, not
  // the persona home, so the kickoff hands absolute paths to the workspace.
  const root = 'C:/ws';
  const home = `${root}/personas/${personaId}`;
  const kickoff = creator.seatKickoff(personaId, root);
  const ordered = [
    `${root}/foundation.md`,
    `${home}/${personaId}.md`,
    `${home}/scratchpad.md`,
    `${home}/collaboration.json`,
    `${home}/memory/projects/<project>/state.md`,
    `${home}/memory/projects/<project>/MEMORY.md`,
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const index = kickoff.indexOf(marker);
    assert(index > cursor, `${personaId} launch order is wrong at ${marker}`);
    cursor = index;
  }
  assert.match(kickoff, /runtime settings, not the persona package/);
}

if (!fs.existsSync(fixtureRoot)) {
  if (configuredFixtureRoot)
    throw new Error('Configured APEX_PERSONA_FIXTURES path does not exist: ' + fixtureRoot);
  console.log('APEX FIXTURE AUDIT: SKIP — set APEX_PERSONA_FIXTURES to the private apex-personas root.');
  process.exit(0);
}

regularDirectory(fixtureRoot, 'Fixture root');
const before = treeSnapshot(fixtureRoot);
const rows = [];

for (const personaId of PERSONAS) {
  const sourceDir = path.join(fixtureRoot, personaId);
  regularDirectory(sourceDir, personaId + ' fixture');
  const canonicalFile = path.join(sourceDir, personaId + '.md');
  const sourceCanonical = fs.readFileSync(canonicalFile, 'utf8');
  const audit = importer.auditImportFolder(sourceDir);

  assert.equal(path.resolve(audit.canonicalFile), path.resolve(canonicalFile));
  assert.equal(audit.canonical, sourceCanonical, personaId + ' canonical changed during audit');
  assert.deepEqual(audit.errors, [], personaId + ' must enter import review without blocking errors');
  assert(audit.sections.length > 0, personaId + ' must retain reviewable sections');
  assert.equal(audit.warnings.every((finding) => finding.code === 'missing-display-name'), true,
    personaId + ' has an unexpected import warning');

  let headingCursor = -1;
  for (const section of audit.sections.filter((item) => item.heading !== 'Preamble')) {
    const marker = '## ' + section.heading;
    const index = sourceCanonical.indexOf(marker);
    assert(index > headingCursor, personaId + ' section order was flattened or reordered');
    headingCursor = index;
  }

  const suggestedMapping = Object.fromEntries(audit.sections
    .filter((section) => section.suggestedKey)
    .map((section) => [String(section.index), section.suggestedKey]));
  const answers = importer.answersFromMapping(audit, suggestedMapping);
  const mappedText = Object.values(answers).join('\n');
  for (const runtimeField of ['tier:', 'class:', 'delegates:', 'enabled:'])
    assert.equal(mappedText.split('\n').some((line) => line.startsWith(runtimeField)), false,
      `${personaId} leaked legacy runtime frontmatter into portable identity answers`);

  if (personaId === 'drafty') {
    assert.match(sourceCanonical, /Status: SKELETON/);
    assert.match(sourceCanonical, /remaining sections are stubbed/);
  }

  assertLaunchOrder(personaId);
  const rootEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
  rows.push({
    persona: personaId,
    bytes: Buffer.byteLength(sourceCanonical),
    sections: audit.sections.length,
    files: rootEntries.filter((entry) => entry.isFile()).length,
    directories: rootEntries.filter((entry) => entry.isDirectory()).length,
    warning: audit.warnings.map((finding) => finding.code).join(',') || 'none',
  });
}

const after = treeSnapshot(fixtureRoot);
assert.deepEqual(after, before, 'fixture tree changed during the read-only audit');
assert.deepEqual(rows.map((row) => row.persona), PERSONAS);

console.table(rows);
console.log(`APEX FIXTURE AUDIT: ${PERSONAS.length}/${PERSONAS.length} passed · source tree unchanged`);

