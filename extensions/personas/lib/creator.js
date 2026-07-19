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

function assertUniqueDisplayName(workspace, displayName, exceptId) {
  const personasDir = path.join(workspace, 'personas');
  const wanted = displayName.trim().toLowerCase();
  for (const entry of fs.readdirSync(personasDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (exceptId && entry.name === exceptId) continue;   // the package being edited
    const existing = packageDisplayName(workspace, entry.name);
    if (existing && existing.toLowerCase() === wanted)
      throw new Error('A permanent persona already uses this display name: ' + existing);
  }
}

// Soft delete: move the whole package (identity + memory + scratchpad) into
// personas/.archive/ rather than removing it. Nothing is ever lost — the user
// can re-attach an archived persona by moving the folder back. Returns the
// archive path.
function archivePackage(workspace, personaId) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('Persona workspace must be an absolute path.');
  const root = path.resolve(workspace);
  const paths = packagePaths(root, personaId);
  regularDirectory(paths.personaDir, 'Persona package');
  const archiveRoot = path.join(paths.personasDir, '.archive');
  fs.mkdirSync(archiveRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(archiveRoot, personaId + '--' + stamp);
  fs.renameSync(paths.personaDir, dest);
  return dest;
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
  // An edit reopened from a package remembers the id it replaces; a fresh
  // persona has none. Replacing the SAME id is expected — don't treat the
  // still-present old package as a collision.
  const editsPersonaId = draft && typeof draft.editsPersonaId === 'string'
    ? draft.editsPersonaId : null;
  const paths = packagePaths(root, preview.personaId);
  regularDirectory(paths.personasDir, 'Personas folder');
  const replacingSameId = editsPersonaId === preview.personaId;
  if (!replacingSameId && fs.existsSync(paths.personaDir))
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
  assertUniqueDisplayName(root, canonicalName, editsPersonaId);

  const lock = path.join(paths.personasDir, `.${preview.personaId}.create.lock`);
  const stage = path.join(paths.personasDir,
    `.${preview.personaId}.creating-${crypto.randomUUID()}`);
  let committed = false;
  let archivedOld = null;   // { archivedAt, restoreTo } for restore-on-failure
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
    if (!replacingSameId && fs.existsSync(paths.personaDir))
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
    // Editing changes IDENTITY only — carry the persona's accumulated memory
    // and scratchpad forward from the old package (copied while it still
    // exists, before the archive below). A fresh persona keeps the defaults.
    if (editsPersonaId) {
      const oldPaths = packagePaths(root, editsPersonaId);
      if (fs.existsSync(oldPaths.personaDir)) {
        const oldMemory = path.join(oldPaths.personaDir, 'memory');
        if (fs.existsSync(oldMemory)) {
          fs.rmSync(path.join(stage, 'memory'), { recursive: true, force: true });
          fs.cpSync(oldMemory, path.join(stage, 'memory'), { recursive: true });
        }
        if (fs.existsSync(oldPaths.scratchpad))
          fs.copyFileSync(oldPaths.scratchpad, path.join(stage, 'scratchpad.md'));
      }
    }
    // Editing: archive the old package the instant before swapping the new one
    // in, so the live persona survives right up to the atomic commit. On a
    // rename-edit (new id != old), this retires the old id and creates the new.
    if (editsPersonaId) {
      const oldPaths = packagePaths(root, editsPersonaId);
      if (fs.existsSync(oldPaths.personaDir))
        archivedOld = { archivedAt: archivePackage(root, editsPersonaId),
                        restoreTo: oldPaths.personaDir };
    }
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
    // an edit that archived the old package but did not end with a good new one
    // must put the live persona back (its slot is free once cleanup ran)
    if (archivedOld) {
      try { if (!fs.existsSync(archivedOld.restoreTo)) fs.renameSync(archivedOld.archivedAt, archivedOld.restoreTo); }
      catch { /* archived copy remains recoverable under .archive */ }
    }
    throw err;
  } finally {
    try { if (lockFd !== null) fs.closeSync(lockFd); } catch { /* already closed */ }
    if (ownsLock) {
      try { fs.unlinkSync(lock); } catch { /* best effort */ }
    }
  }
}

function seatKickoff(personaId, workspaceRoot) {
  // ABSOLUTE paths: a persona's cwd is the PROJECT repo it works in, NOT its
  // own home — so workspace-relative paths resolved against the wrong root and
  // the seat burned ~20 tool calls hunting for its own files (observed live
  // 2026-07-17, incl. searching the deleted apex-personas). Forward slashes:
  // Node/tools accept them on Windows and they read cleanly.
  const root = String(workspaceRoot || '.').replace(/\\/g, '/').replace(/\/+$/, '');
  const home = `${root}/personas/${personaId}`;
  return [
    `[seat-launch] You are being seated as the portable persona “${personaId}”.`,
    'Your persona files are at the ABSOLUTE paths below. Your working directory is',
    'the PROJECT repo, NOT your persona home — do not look for these relative to cwd.',
    'Load and follow, in order:',
    `1. ${root}/foundation.md   (note the TIERED memory rules — do NOT bulk-read memory)`,
    `2. ${home}/${personaId}.md   (authoritative identity)`,
    `3. ${home}/scratchpad.md`,
    `4. ${home}/collaboration.json   (if it exists)`,
    'Then resolve your PROJECT slug — the repo folder name lowercased, runs of',
    'non-alphanumerics collapsed to single hyphens (ApexShell → apexshell; My Repo →',
    'my-repo) — and read ONLY these two to resume (page in notes on demand):',
    `  • ${home}/memory/projects/<project>/state.md   (working memory: where the work stands)`,
    `  • ${home}/memory/projects/<project>/MEMORY.md   (the index — one line per note)`,
    'Do NOT read the whole memory tree; pull a note file only when the task reaches it.',
    'If those files do not exist, the project is fresh. Never mix repos (foundation.md).',
    'Provider, model, credentials, and live permissions come from Apex runtime settings.',
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
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const displayName = packageDisplayName(root, entry.name);
    if (!displayName) continue;
    presets.push({
      name: displayName,
      title: 'New chat — ' + displayName,
      kickoff: seatKickoff(entry.name, root),
      cwd: root,
    });
  }
  presets.sort((a, b) => a.name.localeCompare(b.name));
  // Rail letters must be distinct — two personas that share a first initial
  // (Architect/Auditor) would otherwise both show 'A'. Pick each one's first
  // unused character from its own name so a same-initial pair naturally
  // separates (Architect -> A, Auditor -> U).
  const used = new Set();
  for (const preset of presets) {
    let letter = null;
    for (const ch of preset.name.toUpperCase()) {
      if (/[A-Z0-9]/.test(ch) && !used.has(ch)) { letter = ch; break; }
    }
    letter = letter || preset.name[0].toUpperCase();
    used.add(letter);
    preset.letter = letter;
  }
  return presets;
}

module.exports = {
  assertRegistrableDisplayName,
  assertUniqueDisplayName,
  archivePackage,
  createPackage,
  listPresets,
  packageDisplayName,
  seatKickoff,
};

