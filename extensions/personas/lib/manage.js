// Persona Builder — permanent-package management: enumerate, and reopen a
// package as an editable draft. Delete (archive) lives in creator.js next to
// the rest of the package file store. This layer is where the create-only
// Builder gains edit; it composes drafts + render to round-trip a package
// back into the interview/preview/test flow.
'use strict';

const fs = require('fs');
const path = require('path');
const { packagePaths, parseFrontmatter, validatePersonaPackage, BLUEPRINT_AREAS } = require('./contract');
const drafts = require('./drafts');
const render = require('./render');
const creator = require('./creator');

/** Every permanent persona in the workspace: id (folder), display name, and
 *  whether it carries a collaboration contract. Archived packages (.archive)
 *  and anything that fails validation are skipped. */
function listPackages(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) return [];
  const root = path.resolve(workspace);
  const personasDir = path.join(root, 'personas');
  let entries;
  try { entries = fs.readdirSync(personasDir, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const displayName = creator.packageDisplayName(root, entry.name);
    if (!displayName) continue;
    let hasCollaboration = false;
    try { hasCollaboration = fs.existsSync(path.join(personasDir, entry.name, 'collaboration.json')); }
    catch { /* treat as none */ }
    out.push({ personaId: entry.name, displayName, hasCollaboration });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Read a permanent package back into a fresh draft the interview/preview flow
 *  can edit. The draft is tagged editsPersonaId, so permanent creation replaces
 *  the source package instead of colliding. Returns the new draft. */
function reopenAsDraft(workspace, personaId, stateDir) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('Choose a persona workspace first.');
  const root = path.resolve(workspace);
  const report = validatePersonaPackage(root, personaId, { mode: 'native' });
  if (!report.valid)
    throw new Error('This package fails validation and cannot be edited safely: ' +
      report.errors.map((e) => e.message).join(' · '));
  const paths = packagePaths(root, personaId);
  const canonical = fs.readFileSync(paths.canonical, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(paths.blueprint, 'utf8'));
  let collaboration = null;
  if (fs.existsSync(paths.collaboration))
    collaboration = JSON.parse(fs.readFileSync(paths.collaboration, 'utf8'));

  const attrs = parseFrontmatter(canonical).attributes;
  const name = (typeof blueprint.display_name === 'string' && blueprint.display_name.trim())
    || (typeof attrs.display_name === 'string' && attrs.display_name.trim());
  if (!name) throw new Error('Package has no display name; cannot reopen.');
  const useCase = (typeof blueprint.description === 'string' && blueprint.description.trim())
    || (typeof attrs.description === 'string' && attrs.description.trim())
    || 'Reopened from an existing persona for editing.';

  // Fresh draft tagged as an edit of this package.
  let draft = drafts.createDraft(stateDir, root, { name, useCase, editsPersonaId: personaId });
  // Interview answers come straight from the blueprint area responses.
  const answers = {};
  for (const area of BLUEPRINT_AREAS)
    answers[area] = (blueprint[area] && typeof blueprint[area].response === 'string')
      ? blueprint[area].response : '';
  draft = drafts.updateDraft(stateDir, draft.id, draft.revision, { answers });

  // Rebuild a self-consistent preview bundle from the stored structured
  // choices, so the user lands on a fully-populated draft ready to edit.
  const posture = blueprint.action_posture || {};
  const choices = {
    personaId,
    mode: posture.mode,
    actions: posture.actions,
    collaboration: collaboration ? {
      enabled: true,   // renderBundle drops the contract without this flag
      default_access: collaboration.default_access,
      capabilities: collaboration.capabilities,
      accepts: collaboration.accepts,
      emits: collaboration.emits,
    } : null,
  };
  const bundle = render.renderBundle(draft, choices);
  draft = drafts.updateDraft(stateDir, draft.id, draft.revision, { preview: bundle });
  return draft;
}

module.exports = { listPackages, reopenAsDraft };
