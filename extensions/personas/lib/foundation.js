// Persona Builder — portable shared-foundation template and safe file store.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_FOUNDATION_BYTES = 128 * 1024;

const DEFAULT_FOUNDATION = `# Shared Foundation

These rules apply to every persona in this workspace.

- The user alone creates or permanently changes a persona.
- Load the canonical, memory index, and scratchpad when seated.
- State uncertainty honestly and verify checkable claims.
- Explain actions and their state changes.
- Protect secrets and sensitive information.
- Ask before destructive or externally visible actions.
- Keep provider and model binding outside persona identity.
- Preserve independent contexts during peer review.
- Send structured evidence packets, not entire conversations, across handoffs.
- Treat generated identity prose as a draft until the user accepts it.
`;

function normalizeContent(content) {
  if (typeof content !== 'string') throw new Error('Foundation content must be text.');
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) throw new Error('Foundation content cannot be empty.');
  if (Buffer.byteLength(normalized, 'utf8') > MAX_FOUNDATION_BYTES)
    throw new Error('Foundation content exceeds the 128 KB limit.');
  return normalized.endsWith('\n') ? normalized : normalized + '\n';
}

function revisionOf(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function workspacePaths(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('Persona workspace must be an absolute path.');
  const root = path.resolve(workspace);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error('Persona workspace must be a directory.');
  return {
    root,
    foundation: path.join(root, 'foundation.md'),
    personas: path.join(root, 'personas'),
  };
}

function rejectLink(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  if (stat.isSymbolicLink())
    throw new Error(label + ' cannot be a symbolic link.');
  return stat;
}

function inspectFoundation(workspace) {
  const paths = workspacePaths(workspace);
  const stat = rejectLink(paths.foundation, 'foundation.md');
  if (!stat) {
    return {
      workspace: paths.root,
      exists: false,
      content: DEFAULT_FOUNDATION,
      revision: null,
    };
  }
  if (!stat.isFile()) throw new Error('foundation.md must be a regular file.');
  if (stat.size > MAX_FOUNDATION_BYTES)
    throw new Error('foundation.md exceeds the 128 KB limit.');
  const content = fs.readFileSync(paths.foundation, 'utf8');
  return {
    workspace: paths.root,
    exists: true,
    content,
    revision: revisionOf(content),
  };
}

function ensurePersonasDirectory(paths) {
  const stat = rejectLink(paths.personas, 'personas directory');
  if (stat && !stat.isDirectory())
    throw new Error('personas must be a directory.');
  if (!stat) fs.mkdirSync(paths.personas);
}

function createFoundation(workspace, content) {
  const paths = workspacePaths(workspace);
  if (rejectLink(paths.foundation, 'foundation.md'))
    throw new Error('foundation.md already exists; creation will not overwrite it.');
  const normalized = normalizeContent(content);
  ensurePersonasDirectory(paths);

  let handle;
  try {
    handle = fs.openSync(paths.foundation, 'wx');
    fs.writeFileSync(handle, normalized, 'utf8');
    fs.fsyncSync(handle);
  } catch (err) {
    if (handle !== undefined) {
      try { fs.closeSync(handle); } catch { /* best effort */ }
      handle = undefined;
      try { fs.unlinkSync(paths.foundation); } catch { /* best effort */ }
    }
    throw err;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  return inspectFoundation(paths.root);
}

function saveFoundation(workspace, content, expectedRevision) {
  const paths = workspacePaths(workspace);
  const current = inspectFoundation(paths.root);
  if (!current.exists) throw new Error('foundation.md does not exist; create it first.');
  if (typeof expectedRevision !== 'string' || expectedRevision !== current.revision) {
    const conflict = new Error('foundation.md changed since it was loaded; your edit was not saved.');
    conflict.code = 'FOUNDATION_CONFLICT';
    throw conflict;
  }

  const normalized = normalizeContent(content);
  const temporary = path.join(paths.root, `.foundation.md.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, normalized, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, paths.foundation);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
  return inspectFoundation(paths.root);
}

module.exports = {
  DEFAULT_FOUNDATION,
  MAX_FOUNDATION_BYTES,
  normalizeContent,
  revisionOf,
  inspectFoundation,
  createFoundation,
  saveFoundation,
};

