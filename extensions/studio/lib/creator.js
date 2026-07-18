// App Builder — Create Project (slice 8): atomic same-directory temp + rename
// write of the full portable package, and archive-based removal. Pattern-
// matched from extensions/personas/lib/creator.js's createPackage/
// archivePackage: same lock-file + staging-dir + atomic-rename discipline,
// rollback-on-partial-failure, archive-not-delete. The shapes differ (a
// project package has no memory/scratchpad to carry forward on edit — v1 has
// no "edit an existing project" path, only Create) so this is a sibling
// module, not a shared import.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const contract = require('./contract');
const design = require('./design');

function regularDirectory(dir, label) {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(label + ' must be a regular directory, not a link.');
}

function writeNew(file, content) {
  fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
}

// project-context.md — the short digest other tools (and this builder's own
// overlap-detection suggest pass, contract.readSiblingContexts) read. Built
// only from the approved bundle; it never invents beyond what the interview
// already says.
function buildContextDigest(bundle) {
  const lines = [
    '# ' + bundle.displayName,
    '',
    bundle.description || '(no one-sentence pitch recorded)',
    '',
    '## Vision',
    contract.areaText(bundle.blueprint.idea) || '(not answered)',
    '',
    '## Scope',
    contract.areaText(bundle.blueprint.scope) || '(not answered)',
    '',
    // What the tokens compiler made of the look answer (slice A2). This line
    // is CREATE-time output about a compile, so it lives here and in
    // tokens.json's own summary — never in the canonical, which is generated
    // from approved answers only (the law). compileTokens is deterministic,
    // so compiling again here always matches the staged tokens file.
    '## Design',
    design.compileTokens(bundle.blueprint.look).tokens.summary,
  ];
  return lines.join('\n') + '\n';
}

// Write the full package for a NEW project — PROJECT.md, blueprint.json,
// project-context.md, design/tokens.json — atomically: stage every file in a
// same-directory temp folder, then one fs.renameSync into the final project folder. A reader
// therefore only ever sees the whole package or none of it. Reuses slice 2's
// contract.js for every safety check (safe id, workspace containment,
// would-overwrite) rather than re-deriving them: create mode validates BEFORE
// any lock/stage exists, so a collision or a traversal attempt in the id
// leaves zero stray files.
function createProjectPackage(workspaceRoot, bundle, options = {}) {
  // The approved SEE-step mockups (slice A4), as mockup.collectApprovedMockups
  // shapes them: [{ id, htmlFile, provenanceFile }]. The caller (main.js's
  // projectsCreate) collects them so this module stays draft-store-agnostic;
  // an absent/empty list simply writes no mockups/ folder — unapproved or
  // stale mockups stay behind in draft state by construction.
  const mockups = Array.isArray(options && options.mockups) ? options.mockups : [];
  // The X-ray diagram (slice D2), as xray.collectDiagram shapes it:
  // { mermaid, provenance } — the current AI-drawn source or the derived
  // fallback, provenance naming who drew it. The caller collects it (this
  // module stays draft-store-agnostic, the mockups precedent above); absent
  // = no diagram files at all.
  const diagram = options && options.diagram && typeof options.diagram === 'object'
    ? options.diagram : null;
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot))
    throw new Error('Projects workspace must be an absolute path.');
  const root = path.resolve(workspaceRoot);
  regularDirectory(root, 'Projects workspace');
  if (!bundle || !contract.isSafeProjectId(bundle.projectId))
    throw new Error('Generate and approve a canonical preview first.');
  if (contract.hashCanonical(bundle.canonical) !== bundle.generatedCanonicalHash ||
      bundle.blueprint.canonical_hash !== bundle.generatedCanonicalHash)
    throw new Error('Review and accept the canonical hash before creating the project.');

  // The create-mode gate: unsafe id / traversal / would-overwrite all surface
  // here, BEFORE the lock file or the staging directory ever exist.
  const pre = contract.validateProjectPackage(root, bundle.projectId, { mode: 'create' });
  if (!pre.valid)
    throw new Error(pre.errors.map((f) => f.message).join(' · ') || 'This project cannot be created.');
  const paths = pre.paths;

  const lock = path.join(root, `.${bundle.projectId}.create.lock`);
  const stage = path.join(root, `.${bundle.projectId}.creating-${crypto.randomUUID()}`);
  let committed = false;
  let lockFd = null;
  let ownsLock = false;
  try {
    try { lockFd = fs.openSync(lock, 'wx'); ownsLock = true; }
    catch (err) {
      if (err && err.code === 'EEXIST')
        throw new Error('Project creation is already in progress for this ID.');
      throw err;
    }
    fs.closeSync(lockFd);
    lockFd = null;
    if (fs.existsSync(paths.projectDir))
      throw new Error('A project with this ID already exists; create never overwrites.');
    fs.mkdirSync(stage);
    writeNew(path.join(stage, 'PROJECT.md'), bundle.canonical);
    writeNew(path.join(stage, 'blueprint.json'), JSON.stringify(bundle.blueprint, null, 2) + '\n');
    writeNew(path.join(stage, 'project-context.md'), buildContextDigest(bundle));
    // design/tokens.json (slice A2) — the look answer compiled through
    // lib/design.js's deterministic tables. Staged INSIDE the same temp folder
    // so the one atomic rename below commits the whole package, tokens
    // included; there is never a second write after the rename.
    const compiled = design.compileTokens(bundle.blueprint.look);
    fs.mkdirSync(path.join(stage, 'design'));
    writeNew(path.join(stage, 'design', 'tokens.json'), design.serializeTokens(compiled.tokens));
    // mockups/ (slice A4) — the approved screens' html plus their provenance
    // sidecars (the sidecar carries the generating canonical hash: the proof
    // of WHAT the mockups were built from). Copied INSIDE the same staging
    // dir, before the rename below — the package layout grew, the atomic
    // discipline did not: there is never a write after the rename.
    if (mockups.length) {
      fs.mkdirSync(path.join(stage, 'mockups'));
      for (const m of mockups) {
        fs.copyFileSync(m.htmlFile, path.join(stage, 'mockups', m.id + '.html'), fs.constants.COPYFILE_EXCL);
        fs.copyFileSync(m.provenanceFile, path.join(stage, 'mockups', m.id + '.json'), fs.constants.COPYFILE_EXCL);
      }
    }
    // architecture.mmd + its provenance sidecar (slice D2) — the ARCHITECTURE
    // step's diagram source, mermaid the package's tooling can read, with the
    // provenance proving WHO drew it (llm/derived) and from WHICH canonical.
    // Staged INSIDE the same temp dir, before the rename — the package layout
    // grew again, the atomic discipline did not. The sidecar is named
    // architecture.provenance.json, not architecture.json: a root-level
    // *.json beside blueprint.json must say what it is.
    if (diagram) {
      writeNew(path.join(stage, 'architecture.mmd'),
        diagram.mermaid + (diagram.mermaid.endsWith('\n') ? '' : '\n'));
      writeNew(path.join(stage, 'architecture.provenance.json'),
        JSON.stringify(diagram.provenance, null, 2) + '\n');
    }
    fs.renameSync(stage, paths.projectDir);   // the atomic commit
    committed = true;
    const report = contract.validateProjectPackage(root, bundle.projectId, { mode: 'native' });
    if (!report.valid)
      throw new Error('Created package failed validation: ' + report.errors.map((f) => f.message).join(' · '));
    return {
      projectId: bundle.projectId, projectDir: paths.projectDir, paths, report,
      design: { summary: compiled.tokens.summary, warnings: compiled.warnings.slice() },
    };
  } catch (err) {
    // Rollback-on-partial-failure: before the rename, only `stage` can exist;
    // after it, only `paths.projectDir` does (rename is atomic — never both,
    // never neither-plus-orphan). Either way the failed attempt leaves nothing.
    const cleanup = committed ? paths.projectDir : stage;
    try { fs.rmSync(cleanup, { recursive: true, force: true }); } catch { /* best effort */ }
    throw err;
  } finally {
    try { if (lockFd !== null) fs.closeSync(lockFd); } catch { /* already closed */ }
    if (ownsLock) {
      try { fs.unlinkSync(lock); } catch { /* best effort */ }
    }
  }
}

// Soft delete: move the whole project folder into <workspace>/.archive/
// rather than removing it — a SEPARATE explicit action from draft deletion
// (§ Write safety). Nothing is ever lost; the folder can be moved back by
// hand. `.archive` itself is never a valid project id (isSafeProjectId
// requires a leading letter), so it's naturally invisible to every project
// listing/overlap scan.
function archiveProject(workspaceRoot, projectId) {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot))
    throw new Error('Projects workspace must be an absolute path.');
  const root = path.resolve(workspaceRoot);
  const paths = contract.projectPaths(root, projectId);
  regularDirectory(paths.projectDir, 'Project folder');
  const archiveRoot = path.join(root, '.archive');
  fs.mkdirSync(archiveRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(archiveRoot, projectId + '--' + stamp);
  fs.renameSync(paths.projectDir, dest);
  return dest;
}

module.exports = { buildContextDigest, createProjectPackage, archiveProject };
