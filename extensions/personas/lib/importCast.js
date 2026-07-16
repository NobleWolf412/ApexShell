// Persona Builder — import a fully-specified persona (identity cards + posture
// + optional collaboration) into a portable package, and migrate an existing
// flat memory tree into the project-scoped layout. Generic: the caller supplies
// the authored spec; this turns it into a validated package + migrated memory.
'use strict';

const fs = require('fs');
const path = require('path');
const render = require('./render');
const creator = require('./creator');

/**
 * @param {string} workspace  absolute workspace root (has foundation.md + personas/)
 * @param {object} spec
 *   name, useCase, personaId, mode, actions, answers{6 cards},
 *   collaboration?: { default_access, capabilities, accepts, emits },
 *   memorySource?: absolute path to an existing memory/ tree to migrate,
 *   logSource?:    absolute path to an existing log/ tree to migrate,
 *   projectSlug?:  slug the migrated memory belongs to (default 'apex')
 * @returns the creator.createPackage report
 */
function importPersona(workspace, spec) {
  const draft = { name: spec.name, useCase: spec.useCase, answers: spec.answers };
  const choices = {
    personaId: spec.personaId,
    mode: spec.mode,
    actions: spec.actions,
    collaboration: spec.collaboration ? { enabled: true, ...spec.collaboration } : null,
  };
  draft.preview = render.renderBundle(draft, choices);
  const created = creator.createPackage(workspace, draft);
  if (spec.memorySource && fs.existsSync(spec.memorySource))
    migrateMemory(workspace, created.personaId, spec, spec.projectSlug || 'apex');
  return created;
}

// Move an existing flat memory tree wholesale into memory/projects/<slug>/ so
// its internal relative pointers stay valid (the subtree moves together), then
// write a thin top-level index that points at the project. Logs go to
// log/<slug>/. Nothing inside the user's memo files is rewritten.
function migrateMemory(workspace, personaId, spec, slug) {
  const pkgDir = path.join(workspace, 'personas', personaId);
  const pkgMem = path.join(pkgDir, 'memory');
  const projRoot = path.join(pkgMem, 'projects', slug);
  fs.mkdirSync(path.dirname(projRoot), { recursive: true });
  fs.cpSync(spec.memorySource, projRoot, { recursive: true });

  const hasProjIndex = fs.existsSync(path.join(projRoot, 'MEMORY.md'));
  const index = [
    '# ' + spec.name + ' Memory Index',
    '',
    'Persona-wide notes live here. Everything specific to a codebase is scoped',
    'under `projects/<repo>/` so memory never bleeds between repositories.',
    '',
    '## Projects',
    hasProjIndex
      ? '- [' + slug + '](projects/' + slug + '/MEMORY.md) — prior work, migrated from the flat memory tree'
      : '- (none yet)',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(pkgMem, 'MEMORY.md'), index);

  if (spec.logSource && fs.existsSync(spec.logSource)) {
    const logDest = path.join(pkgDir, 'log', slug);
    fs.mkdirSync(path.dirname(logDest), { recursive: true });
    fs.cpSync(spec.logSource, logDest, { recursive: true });
  }
}

module.exports = { importPersona, migrateMemory };
