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
const os = require('os');
const path = require('path');
const drafts = require('./lib/drafts');
const { CARDS } = require('./lib/interview');
const contract = require('./lib/contract');
const render = require('./lib/render');
const blueprint = require('./lib/blueprint');

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

// Project the slice-2 validator onto an in-memory preview bundle WITHOUT
// re-implementing a line of it: stage the bundle into an ephemeral temp workspace
// (never the projects workspace — slice 4 writes no package) and run the same
// deterministic contract.validateProjectPackage the on-disk drill exercises. The
// staged blueprint carries the approved hash, so a manual edit surfaces as the
// contract's own canonical-drift warning too. The temp tree is always removed.
function validateBundleReport(bundle) {
  if (!bundle || typeof bundle !== 'object' || !contract.isSafeProjectId(bundle.projectId))
    throw new Error('Generate a canonical preview first.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-review-'));
  try {
    const dir = path.join(tmp, bundle.projectId);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'PROJECT.md'), bundle.canonical, 'utf8');
    fs.writeFileSync(path.join(dir, 'blueprint.json'), JSON.stringify(bundle.blueprint, null, 2), 'utf8');
    const report = contract.validateProjectPackage(tmp, bundle.projectId);
    // The staged paths are ephemeral; never leak them back to the renderer.
    const strip = (finding) => ({ code: finding.code, message: finding.message });
    return {
      valid: report.valid,
      errors: report.errors.map(strip),
      warnings: report.warnings.map(strip),
      suggestions: report.suggestions.map(strip),
    };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
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

  const previewFailure = (action, err, extra = {}) => {
    ctx.bus.post('projectsPreviewResult', {
      ok: false,
      action,
      conflict: err.code === 'DRAFT_CONFLICT',
      error: err.message,
      ...extra,
    });
  };

  const postPreviewStatus = (draft) => ctx.bus.post('projectsPreviewStatus', {
    draft,
    cards: CARDS,
    bundle: draft.preview,
    stale: Boolean(draft.preview) &&
      draft.preview.sourceHash !== blueprint.draftSourceHash(draft),
  });

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

  // ---- Blueprint Review + Canonical Draft (slice 4) -----------------------
  // Everything is a preview on the draft: no package is written to the workspace
  // (slice 8). Each verb mutates the persisted preview under the revision gate and
  // republishes it; the renderer is a pure view over the returned bundle.

  // Generate (or fully regenerate) the canonical from APPROVED answers only. A
  // regenerate that would discard a manual edit or newer interview work is refused
  // until the renderer echoes confirmedOverwrite — never a silent overwrite.
  ctx.bus.on('projectsPreviewGenerate', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      const projectId = (message && message.projectId) || render.normalizeProjectId(current.name);
      const stale = current.preview &&
        current.preview.sourceHash !== blueprint.draftSourceHash(current);
      const bundle = blueprint.buildBundle(current, projectId);
      const replacesCanonical = current.preview && bundle.canonical !== current.preview.canonical;
      if (current.preview && (current.preview.canonicalDrift || stale || replacesCanonical) &&
          (!message || message.confirmedOverwrite !== true)) {
        previewFailure('generate',
          new Error('Regenerating from answers replaces manual canonical edits or newer interview work.'),
          { needsConfirmation: true });
        return;
      }
      const draft = drafts.updateDraft(ctx.stateDir, current.id,
        message && message.expectedRevision, { preview: bundle });
      ctx.bus.post('projectsPreviewResult', { ok: true, action: 'generated' });
      postPreviewStatus(draft);
    } catch (err) { previewFailure('generate', err); }
  });

  ctx.bus.on('projectsPreviewOpen', (message) => {
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      if (!draft.preview) throw new Error('Generate a canonical preview first.');
      postPreviewStatus(draft);
    } catch (err) { previewFailure('open', err); }
  });

  // A manual canonical edit. Persisted with its drift bit; the renderer surfaces
  // the review prompt — this verb never re-approves.
  ctx.bus.on('projectsPreviewSaveCanonical', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      if (!current.preview) throw new Error('Generate a canonical preview first.');
      const bundle = blueprint.withCanonicalEdit(current.preview, message && message.canonical);
      const draft = drafts.updateDraft(ctx.stateDir, current.id,
        message && message.expectedRevision, { preview: bundle });
      ctx.bus.post('projectsPreviewResult', { ok: true, action: 'canonical-saved' });
      postPreviewStatus(draft);
    } catch (err) { previewFailure('canonical-save', err); }
  });

  // Regenerate one section from its approved answer, leaving the others (and any
  // manual edits elsewhere) intact.
  ctx.bus.on('projectsPreviewRegenerateSection', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      if (!current.preview) throw new Error('Generate a canonical preview first.');
      const bundle = blueprint.regenerateSection(current.preview, message && message.key);
      const draft = drafts.updateDraft(ctx.stateDir, current.id,
        message && message.expectedRevision, { preview: bundle });
      ctx.bus.post('projectsPreviewResult', { ok: true, action: 'section-regenerated' });
      postPreviewStatus(draft);
    } catch (err) { previewFailure('section-regenerate', err); }
  });

  // Adopt a manually-edited canonical as the approved baseline (the re-approve arm
  // of the drift review prompt).
  ctx.bus.on('projectsPreviewAcceptCanonical', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      if (!current.preview) throw new Error('Generate a canonical preview first.');
      const bundle = blueprint.acceptCanonical(current.preview);
      const draft = drafts.updateDraft(ctx.stateDir, current.id,
        message && message.expectedRevision, { preview: bundle });
      ctx.bus.post('projectsPreviewResult', { ok: true, action: 'canonical-accepted' });
      postPreviewStatus(draft);
    } catch (err) { previewFailure('canonical-accept', err); }
  });

  // The validation report — the slice-2 rules, projected, never re-implemented.
  ctx.bus.on('projectsPreviewValidate', (message) => {
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      if (!draft.preview) throw new Error('Generate a canonical preview first.');
      ctx.bus.post('projectsValidationStatus', {
        draftId: draft.id,
        report: validateBundleReport(draft.preview),
      });
    } catch (err) {
      ctx.bus.post('projectsValidationStatus', {
        draftId: null,
        report: { valid: false, errors: [{ code: 'validation', message: err.message }], warnings: [], suggestions: [] },
      });
    }
  });
}

module.exports = {
  register,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  workspaceStatus,
  selectedWorkspace,
  validateBundleReport,
};
