// App Builder (STUDIO / PROJECTS) — main-process half: the projects-workspace
// picker + persistence and the crash-safe interview draft store's bus verbs.
// Slice 3 scope: no blueprint review, no canonical write, no AI/disposable calls
// (Help-me-decide is a client-side heuristic). The studio *shell* renderer owns
// the pane and the registerBuilder seam; this module never touches Electron
// directly beyond the ctx.pickDirectory seam the loader injects.
//
// Discipline mirrored verbatim from extensions/personas/main.js: the workspace
// choice is written only after an explicit directory-picker action, schema-versioned,
// absolute-path, atomic (same-dir temp + rename with an exclusive flag).
'use strict';

const fs = require('fs');
const path = require('path');
const drafts = require('./lib/drafts');
const { CARDS } = require('./lib/interview');
const contract = require('./lib/contract');
const render = require('./lib/render');

const CONFIG_FILE = 'workspace.json';

function configPath(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir))
    throw new Error('App Builder state directory must be absolute.');
  return path.join(stateDir, CONFIG_FILE);
}

function readWorkspaceConfig(stateDir) {
  const file = configPath(stateDir);
  if (!fs.existsSync(file)) return { workspace: null, error: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schema !== 1)
      throw new Error('schema must be 1');
    if (typeof parsed.workspace !== 'string' || !path.isAbsolute(parsed.workspace))
      throw new Error('workspace must be an absolute path');
    return { workspace: path.resolve(parsed.workspace), error: null };
  } catch (err) {
    return { workspace: null, error: 'Saved workspace setting is invalid: ' + err.message };
  }
}

function writeWorkspaceConfig(stateDir, workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('Projects workspace must be an absolute path.');
  const resolved = path.resolve(workspace);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('Projects workspace must be a directory.');

  fs.mkdirSync(stateDir, { recursive: true });
  const destination = configPath(stateDir);
  const temporary = path.join(
    stateDir,
    `.${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(temporary, JSON.stringify({ schema: 1, workspace: resolved }, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    });
    fs.renameSync(temporary, destination);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
  return resolved;
}

// Existing projects in the workspace are the ones whose folder name is a safe
// project id — counted only for the picker's "N existing projects" note (their
// project-context.md feeds overlap detection in a later slice).
function workspaceStatus(stateDir) {
  const saved = readWorkspaceConfig(stateDir);
  const status = {
    configured: false,
    workspace: saved.workspace,
    exists: false,
    projectCount: 0,
    error: saved.error,
  };
  if (!saved.workspace) return status;
  try {
    if (!fs.existsSync(saved.workspace)) return status;
    status.exists = fs.statSync(saved.workspace).isDirectory();
    if (!status.exists) return status;
    status.configured = true;
    status.projectCount = fs.readdirSync(saved.workspace, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && contract.isSafeProjectId(entry.name) &&
        fs.existsSync(path.join(saved.workspace, entry.name, 'PROJECT.md'))).length;
  } catch (err) {
    status.error = 'Could not inspect the projects workspace: ' + err.message;
  }
  return status;
}

function selectedWorkspace(stateDir) {
  const saved = readWorkspaceConfig(stateDir);
  if (saved.error) throw new Error(saved.error);
  if (!saved.workspace) throw new Error('Choose a projects workspace first.');
  if (!fs.existsSync(saved.workspace) || !fs.statSync(saved.workspace).isDirectory())
    throw new Error('The saved projects workspace is unavailable.');
  return saved.workspace;
}

function register(ctx) {
  if (!ctx || !ctx.bus || typeof ctx.bus.on !== 'function' || typeof ctx.bus.post !== 'function')
    throw new Error('App Builder requires the extension bus.');
  if (typeof ctx.pickDirectory !== 'function')
    throw new Error('App Builder requires the directory-picker service.');
  configPath(ctx.stateDir); // validate once at load, before registering handlers

  const publishStatus = () =>
    ctx.bus.post('projectsWorkspaceStatus', workspaceStatus(ctx.stateDir));

  const publishDraftList = () => {
    try {
      const workspace = selectedWorkspace(ctx.stateDir);
      const listed = drafts.listDrafts(ctx.stateDir, workspace);
      ctx.bus.post('projectsDraftList', { workspace, cards: CARDS, ...listed, error: null });
    } catch (err) {
      ctx.bus.post('projectsDraftList', {
        workspace: null, cards: CARDS, drafts: [], warnings: [], error: err.message,
      });
    }
  };

  const draftFailure = (action, err) => {
    ctx.bus.post('projectsDraftResult', {
      ok: false,
      action,
      conflict: err.code === 'DRAFT_CONFLICT',
      error: err.message,
    });
    ctx.bus.post('toast', { text: 'Project draft was not changed: ' + err.message });
  };

  const postDraftStatus = (draft) => ctx.bus.post('projectsDraftStatus', {
    draft,
    cards: CARDS,
    suggestedProjectId: render.normalizeProjectId(draft.name),
  });

  // A draft only ever loads/saves against the currently selected workspace, so a
  // stale id from another workspace can never be edited in this one.
  const currentWorkspaceDraft = (id) => {
    const workspace = selectedWorkspace(ctx.stateDir);
    const draft = drafts.readDraft(ctx.stateDir, id);
    if (path.resolve(draft.workspace) !== path.resolve(workspace))
      throw new Error('Draft belongs to a different workspace.');
    return draft;
  };

  ctx.bus.on('projectsWorkspaceGet', publishStatus);
  ctx.bus.on('projectsDraftListGet', publishDraftList);

  ctx.bus.on('projectsWorkspaceChoose', async () => {
    try {
      const current = readWorkspaceConfig(ctx.stateDir).workspace;
      const selected = await ctx.pickDirectory({
        title: 'Choose a projects workspace',
        defaultPath: current || undefined,
      });
      if (selected) writeWorkspaceConfig(ctx.stateDir, selected);
      publishStatus();
    } catch (err) {
      ctx.bus.post('toast', { text: 'Projects workspace was not changed: ' + err.message });
      publishStatus();
    }
  });

  ctx.bus.on('projectsDraftCreate', (message) => {
    try {
      const workspace = selectedWorkspace(ctx.stateDir);
      const draft = drafts.createDraft(ctx.stateDir, workspace, {
        name: message && message.name,
        pitch: message && message.pitch,
      });
      ctx.bus.post('projectsDraftResult', { ok: true, action: 'created' });
      postDraftStatus(draft);
    } catch (err) { draftFailure('create', err); }
  });

  ctx.bus.on('projectsDraftOpen', (message) => {
    try {
      postDraftStatus(currentWorkspaceDraft(message && message.id));
    } catch (err) { draftFailure('open', err); }
  });

  ctx.bus.on('projectsDraftSave', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      const draft = drafts.updateDraft(
        ctx.stateDir, current.id,
        message && message.expectedRevision,
        message && message.changes
      );
      ctx.bus.post('projectsDraftResult', { ok: true, action: 'saved' });
      postDraftStatus(draft);
    } catch (err) { draftFailure('save', err); }
  });

  ctx.bus.on('projectsDraftDelete', (message) => {
    try {
      if (!message || message.confirmed !== true)
        throw new Error('Draft deletion requires explicit confirmation.');
      const workspace = selectedWorkspace(ctx.stateDir);
      drafts.deleteDraft(ctx.stateDir, message.id, workspace);
      ctx.bus.post('projectsDraftResult', { ok: true, action: 'deleted' });
      publishDraftList();
    } catch (err) { draftFailure('delete', err); }
  });
}

module.exports = {
  register,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  workspaceStatus,
  selectedWorkspace,
};
