// Persona Builder — atomic portable package creation and runtime preset data.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  hashCanonical,
  packagePaths,
  parseFrontmatter,
  validatePersonaPackage,
} = require('./contract');

function regularDirectory(dir, label) {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(label + ' must be a regular directory, not a link.');
}

function writeNew(file, content) {
  fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
}

function packageDisplayName(workspace, personaId) {
  try {
    const report = validatePersonaPackage(workspace, personaId, { mode: 'native' });
    if (!report.valid) return null;
    const canonical = fs.readFileSync(report.paths.canonical, 'utf8');
    const parsed = parseFrontmatter(canonical);
    return typeof parsed.attributes.display_name === 'string'
      ? parsed.attributes.display_name.trim() : null;
  } catch { return null; }
}

function assertUniqueDisplayName(workspace, displayName) {
  const personasDir = path.join(workspace, 'personas');
  const wanted = displayName.trim().toLowerCase();
  for (const entry of fs.readdirSync(personasDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const existing = packageDisplayName(workspace, entry.name);
    if (existing && existing.toLowerCase() === wanted)
      throw new Error('A permanent persona already uses this display name: ' + existing);
  }
}

function assertRegistrableDisplayName(displayName) {
  const name = String(displayName || '').trim();
  if (!name) throw new Error('Permanent persona display name is required.');
  if (name.toLowerCase() === 'seat')
    throw new Error('“Seat” is reserved by Apex and cannot be a permanent persona display name.');
  if (/[\u0000-\u001f\u007f]/.test(name))
    throw new Error('Permanent persona display name cannot contain control characters.');
  return name;
}

function createPackage(workspace, draft) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('Persona workspace must be an absolute path.');
  const root = path.resolve(workspace);
  regularDirectory(root, 'Persona workspace');
  const preview = draft && draft.preview;
  if (!preview) throw new Error('Generate and approve a persona preview first.');
  const paths = packagePaths(root, preview.personaId);
  regularDirectory(paths.personasDir, 'Personas folder');
  if (fs.existsSync(paths.personaDir))
    throw new Error('A persona package with this ID already exists.');
  if (hashCanonical(preview.canonical) !== preview.generatedCanonicalHash ||
      preview.blueprint.canonical_hash !== preview.generatedCanonicalHash)
    throw new Error('Review and accept the canonical hash before permanent creation.');
  const draftName = assertRegistrableDisplayName(draft.name);
  const parsedCanonical = parseFrontmatter(preview.canonical);
  const canonicalName = typeof parsedCanonical.attributes.display_name === 'string'
    ? parsedCanonical.attributes.display_name.trim() : '';
  if (!canonicalName || canonicalName !== draftName)
    throw new Error('Canonical display_name must exactly match the persona draft name before permanent creation.');
  assertRegistrableDisplayName(canonicalName);
  assertUniqueDisplayName(root, canonicalName);

  const lock = path.join(paths.personasDir, `.${preview.personaId}.create.lock`);
  const stage = path.join(paths.personasDir,
    `.${preview.personaId}.creating-${crypto.randomUUID()}`);
  let committed = false;
  let lockFd = null;
  let ownsLock = false;
  try {
    try { lockFd = fs.openSync(lock, 'wx'); ownsLock = true; }
    catch (err) {
      if (err && err.code === 'EEXIST')
        throw new Error('Persona creation is already in progress for this ID.');
      throw err;
    }
    fs.closeSync(lockFd);
    lockFd = null;
    if (fs.existsSync(paths.personaDir))
      throw new Error('A persona package with this ID already exists.');
    fs.mkdirSync(stage);
    fs.mkdirSync(path.join(stage, 'memory'));
    writeNew(path.join(stage, preview.personaId + '.md'), preview.canonical);
    writeNew(path.join(stage, 'blueprint.json'), JSON.stringify(preview.blueprint, null, 2) + '\n');
    if (preview.collaboration)
      writeNew(path.join(stage, 'collaboration.json'), JSON.stringify(preview.collaboration, null, 2) + '\n');
    writeNew(path.join(stage, 'memory', 'MEMORY.md'),
      `# ${canonicalName} Memory Index\n\nNo durable memories recorded yet.\n`);
    writeNew(path.join(stage, 'scratchpad.md'), `# ${canonicalName} Scratchpad\n\n`);
    fs.renameSync(stage, paths.personaDir);
    committed = true;
    const report = validatePersonaPackage(root, preview.personaId, { mode: 'native' });
    if (!report.valid)
      throw new Error('Created package failed validation: ' +
        report.errors.map((finding) => finding.message).join(' · '));
    return { personaId: preview.personaId, displayName: canonicalName, paths, report };
  } catch (err) {
    const cleanup = committed ? paths.personaDir : stage;
    try { fs.rmSync(cleanup, { recursive: true, force: true }); } catch { /* best effort */ }
    throw err;
  } finally {
    try { if (lockFd !== null) fs.closeSync(lockFd); } catch { /* already closed */ }
    if (ownsLock) {
      try { fs.unlinkSync(lock); } catch { /* best effort */ }
    }
  }
}

function seatKickoff(personaId) {
  return [
    `[seat-launch] You are being seated as the portable persona “${personaId}”.`,
    'Load and follow these workspace-relative files in order:',
    '1. foundation.md',
    `2. personas/${personaId}/${personaId}.md (authoritative identity)`,
    `3. personas/${personaId}/memory/MEMORY.md`,
    `4. personas/${personaId}/scratchpad.md`,
    `5. personas/${personaId}/collaboration.json if it exists`,
    'Provider, model, credentials, and live permissions come from Apex runtime settings, not the persona package.',
    'Confirm you are seated in one short line, then wait for the user’s actual work.',
  ].join('\n');
}

function listPresets(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) return [];
  const root = path.resolve(workspace);
  const personasDir = path.join(root, 'personas');
  try { regularDirectory(root, 'Persona workspace'); regularDirectory(personasDir, 'Personas folder'); }
  catch { return []; }
  const presets = [];
  for (const entry of fs.readdirSync(personasDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const displayName = packageDisplayName(root, entry.name);
    if (!displayName) continue;
    presets.push({
      name: displayName,
      letter: displayName[0].toUpperCase(),
      title: 'New chat — ' + displayName,
      kickoff: seatKickoff(entry.name),
      cwd: root,
    });
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  assertRegistrableDisplayName,
  assertUniqueDisplayName,
  createPackage,
  listPresets,
  packageDisplayName,
  seatKickoff,
};

