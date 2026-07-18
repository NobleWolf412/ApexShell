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
const modelPicker = require('./lib/modelPicker');
const suggest = require('./lib/suggest');
const mockup = require('./lib/mockup');
const codesigner = require('./lib/codesigner');
const packageCreator = require('./lib/creator');
const design = require('./lib/design');
const spines = require('./lib/spines');
const liftoff = require('./lib/liftoff');
const importer = require('./lib/importer');
const servers = require('./lib/servers');

const CONFIG_FILE = 'workspace.json';

// Slice B1: every dev-server manager any register() call created (drills
// register several harnesses in one process) — dispose() must reach them all,
// so no orphan survives extension dispose or app quit.
const liveServerManagers = new Set();

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
function validateBundleReport(bundle, approvedMockups = []) {
  if (!bundle || typeof bundle !== 'object' || !contract.isSafeProjectId(bundle.projectId))
    throw new Error('Generate a canonical preview first.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-review-'));
  try {
    const dir = path.join(tmp, bundle.projectId);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'PROJECT.md'), bundle.canonical, 'utf8');
    fs.writeFileSync(path.join(dir, 'blueprint.json'), JSON.stringify(bundle.blueprint, null, 2), 'utf8');
    // Stage the tokens exactly as Create will write them (slice A2), so the
    // review report validates the package-to-be — not a bogus "tokens.json is
    // missing" warning about a file Create hasn't had its chance to write yet.
    fs.mkdirSync(path.join(dir, 'design'));
    fs.writeFileSync(path.join(dir, 'design', 'tokens.json'),
      design.serializeTokens(design.compileTokens(bundle.blueprint.look).tokens), 'utf8');
    // Stage the approved mockups the same way (slice A4): with a CURRENT
    // approval the package-to-be carries mockups/, so contract.js's
    // missing-mockups warning fires exactly when Create would really produce
    // a package without them — the "no approval yet" warning the spec asks
    // validation to surface, stated once, in contract.js, not twice.
    if (Array.isArray(approvedMockups) && approvedMockups.length) {
      fs.mkdirSync(path.join(dir, 'mockups'));
      for (const m of approvedMockups) {
        fs.copyFileSync(m.htmlFile, path.join(dir, 'mockups', m.id + '.html'));
        fs.copyFileSync(m.provenanceFile, path.join(dir, 'mockups', m.id + '.json'));
      }
    }
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
      // The draft's mockup files (slice A3) die with it — they are derived
      // artifacts of a draft that no longer exists. Best-effort AFTER the
      // draft delete succeeded: a cleanup hiccup surfaces as a toast, never
      // as a phantom "draft was not deleted" error.
      try { mockup.deleteDraftMockups(ctx.stateDir, message.id); }
      catch (err) {
        ctx.bus.post('toast', { text: 'Draft deleted, but its mockup files were not cleaned up: ' + err.message });
      }
      // The served-dir registration (A4) dies with the draft too — nothing
      // keeps serving a dir whose owner is gone.
      if (ctx.serve && typeof ctx.serve.revokeDir === 'function')
        ctx.serve.revokeDir(serveToken(message.id));
      ctx.bus.post('projectsDraftResult', { ok: true, action: 'deleted' });
      publishDraftList();
    } catch (err) { draftFailure('delete', err); }
  });

  // ---- Import / audit mode (slice 9, § Import) -----------------------------
  // Read-only inspection of an existing project folder (or the folder holding
  // a bare PROJECT.md) -> a user-reviewed mapping onto the blueprint areas
  // -> a NEW draft whose answers come from the approved mapping ONLY, then the
  // same blueprint.buildBundle every other draft uses to report gaps (never
  // invented content). One active import audit at a time, held in memory —
  // same "one at a time, in-process state" shape as activeSuggestSeat/
  // activeCodesigner above. Nothing here ever writes to the source folder;
  // ctx.pickDirectory is the only Electron-touching call, exactly like the
  // workspace picker.
  let activeImport = null; // { sourceFolder, audit, mapping, draftId }

  const importGaps = () => importer.mappingGaps(activeImport ? activeImport.mapping : {});

  const postImportAudit = () => ctx.bus.post('projectsImportAudit', {
    sourceFolder: activeImport.audit.sourceFolder,
    canonicalFile: activeImport.audit.canonicalFile,
    displayName: activeImport.audit.displayName,
    description: activeImport.audit.description,
    sections: activeImport.audit.sections,
    errors: activeImport.audit.errors,
    warnings: activeImport.audit.warnings,
    mapping: { ...activeImport.mapping },
    gaps: importGaps(),
    cards: CARDS,
    draftId: activeImport.draftId,
  });

  ctx.bus.on('projectsImportChoose', async () => {
    try {
      const selected = await ctx.pickDirectory({ title: 'Choose a project folder to import' });
      if (!selected) return;
      const audit = importer.auditImportFolder(selected);
      const mapping = {};
      for (const section of audit.sections) {
        if (section.suggestedKey) mapping[String(section.index)] = section.suggestedKey;
      }
      activeImport = { sourceFolder: audit.sourceFolder, audit, mapping, draftId: null };
      postImportAudit();
    } catch (err) {
      activeImport = null;
      ctx.bus.post('projectsImportResult', { ok: false, action: 'audit', error: err.message });
    }
  });

  // The targeted-revision primitive: retarget ONE section's mapped area (or
  // clear it with key: null) without re-picking or re-reading the source —
  // the audit's sections are already cached on activeImport. Works both
  // during the initial review and again later, after a draft already exists,
  // so fixing one gap never means redoing the whole import.
  ctx.bus.on('projectsImportSetMapping', (message) => {
    try {
      if (!activeImport || !message || path.resolve(message.sourceFolder || '') !== path.resolve(activeImport.sourceFolder))
        throw new Error('Choose a project folder to import first.');
      const index = Number(message.index);
      const section = activeImport.audit.sections.find((s) => s.index === index);
      if (!section) throw new Error('That import section no longer exists.');
      const key = message.key === null || message.key === undefined || message.key === '' ? null : message.key;
      if (key !== null && !CARDS.some((c) => c.key === key))
        throw new Error('That is not one of the blueprint areas.');
      if (key === null) delete activeImport.mapping[String(index)];
      else activeImport.mapping[String(index)] = key;
      postImportAudit();
    } catch (err) {
      ctx.bus.post('projectsImportResult', { ok: false, action: 'map', error: err.message });
    }
  });

  // Build (or rebuild) the draft from the CURRENTLY approved mapping only.
  // First call creates a new draft; every later call — including a targeted
  // revision that only touched one row — updates that SAME draft instead of
  // creating a second one. Then it runs the mapped answers through the exact
  // slice-4 buildBundle every other draft uses, so gap reporting is never a
  // second implementation of "never invent" — it is the same one.
  ctx.bus.on('projectsImportBuild', (message) => {
    try {
      if (!activeImport || !message || path.resolve(message.sourceFolder || '') !== path.resolve(activeImport.sourceFolder))
        throw new Error('Choose a project folder to import first.');
      if (activeImport.audit.errors.length)
        throw new Error('Fix the structural problems in the source doc before importing it.');
      const answers = importer.answersFromMapping(activeImport.audit, activeImport.mapping);
      const workspace = selectedWorkspace(ctx.stateDir);

      let draft;
      if (activeImport.draftId) {
        const current = currentWorkspaceDraft(activeImport.draftId);
        draft = drafts.updateDraft(ctx.stateDir, current.id, current.revision, { answers });
      } else {
        const created = drafts.createDraft(ctx.stateDir, workspace, {
          name: (message.name && String(message.name).trim()) || activeImport.audit.displayName || 'Imported project',
          pitch: (message.pitch !== undefined ? message.pitch : activeImport.audit.description) || '',
        });
        draft = drafts.updateDraft(ctx.stateDir, created.id, created.revision, { answers });
      }

      const projectId = (message.projectId && String(message.projectId).trim()) || render.normalizeProjectId(draft.name);
      const bundle = blueprint.buildBundle(draft, projectId);
      draft = drafts.updateDraft(ctx.stateDir, draft.id, draft.revision, { preview: bundle });
      activeImport.draftId = draft.id;

      ctx.bus.post('projectsImportResult', {
        ok: true, action: 'build', draftId: draft.id, gaps: bundle.gaps,
      });
      postDraftStatus(draft);
    } catch (err) {
      ctx.bus.post('projectsImportResult', { ok: false, action: 'build', error: err.message });
    }
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
        report: validateBundleReport(draft.preview,
          mockup.collectApprovedMockups(ctx.stateDir, draft)),
      });
    } catch (err) {
      ctx.bus.post('projectsValidationStatus', {
        draftId: null,
        report: { valid: false, errors: [{ code: 'validation', message: err.message }], warnings: [], suggestions: [] },
      });
    }
  });

  // The STUDIO header model picker (slice 5): one persisted choice, shared
  // across builders. No AI call reads it yet — slices 6/7 pass it through as
  // launch.model/launch.effort to a disposable, where the same Claude-lane
  // gate (main/engine/seatHost.js) is the authority; this is a UI convenience,
  // not a second validator.
  const publishModelPick = () => {
    const pick = modelPicker.readModelPick(ctx.stateDir);
    ctx.bus.post('studioModelPick', pick);
  };
  ctx.bus.on('studioModelGet', () => publishModelPick());
  ctx.bus.on('studioModelSet', (message) => {
    try {
      modelPicker.writeModelPick(ctx.stateDir, {
        model: message && message.model,
        effort: message && message.effort,
      });
      publishModelPick();
    } catch (err) {
      ctx.bus.post('toast', { text: 'Model pick was not saved: ' + err.message });
      publishModelPick();
    }
  });

  // ---- per-card AI suggest pass (slice 6, § AI integration Level 1) --------
  // Opt-in: the pass never runs without an explicit approved:true on the RUN
  // verb. Usage preflight + a TTL on the prepared-but-unapproved state mirror
  // extensions/personas/main.js's personaTestPrepare/personaTestStart exactly;
  // the disposable call shape (prompt → onEvent accumulate text → parse on
  // 'result' → backstop timeout → done() that always posts) mirrors that
  // module's personaRelSuggestLlm. One pass runs at a time.
  const SUGGEST_PREPARE_TTL_MS = 5 * 60 * 1000;   // == personas' TEST_PREPARE_TTL_MS
  const SUGGEST_BACKSTOP_MS = 120000;             // == personaRelSuggestLlm's backstop
  let preparedSuggest = null;    // { draftId, card, revision, preparedAt }
  let activeSuggestSeat = null;  // { controller, backstop } — one pass at a time

  const findInterviewCard = (key) => CARDS.find((c) => c.key === key);

  ctx.bus.on('projectsCardSuggestPrepare', (message) => {
    try {
      const card = findInterviewCard(message && message.card);
      if (!card) throw new Error('Unknown interview card.');
      const draft = currentWorkspaceDraft(message && message.id);
      const usage = ctx.usage && typeof ctx.usage.claudeSnapshot === 'function'
        ? ctx.usage.claudeSnapshot() : null;
      const usageFresh = Boolean(usage && usage.asOf && !usage.stale &&
        Date.now() - usage.asOf <= 5 * 60 * 1000);
      preparedSuggest = {
        draftId: draft.id,
        card: card.key,
        revision: draft.revision,
        preparedAt: Date.now(),
      };
      ctx.bus.post('projectsCardSuggestPrepared', {
        draftId: draft.id,
        card: card.key,
        revision: draft.revision,
        usage: usage ? {
          session: usage.session || null,
          weekly: usage.weekly || null,
          asOf: usage.asOf || null,
          stale: !usageFresh,
        } : null,
        requiresApproval: true,
      });
    } catch (err) {
      preparedSuggest = null;
      ctx.bus.post('projectsCardSuggestStatus', { phase: 'error', error: err.message });
    }
  });

  ctx.bus.on('projectsCardSuggestRun', (message) => {
    try {
      if (!message || message.approved !== true)
        throw new Error('The AI suggestion pass runs a hidden Claude session — it needs explicit approval.');
      if (!preparedSuggest || message.id !== preparedSuggest.draftId ||
          message.card !== preparedSuggest.card ||
          message.expectedRevision !== preparedSuggest.revision)
        throw new Error('Prepare the AI suggestion pass again from the current draft.');
      if (Date.now() - preparedSuggest.preparedAt > SUGGEST_PREPARE_TTL_MS)
        throw new Error('The usage check expired; prepare the AI suggestion pass again.');
      if (activeSuggestSeat) throw new Error('An AI suggestion pass is already running.');
      if (!ctx.seats || typeof ctx.seats.startDisposable !== 'function')
        throw new Error('Disposable seat service is unavailable.');

      const card = findInterviewCard(preparedSuggest.card);
      const draft = currentWorkspaceDraft(preparedSuggest.draftId);
      if (draft.revision !== preparedSuggest.revision)
        throw new Error('The draft changed; prepare the AI suggestion pass again.');

      const workspace = selectedWorkspace(ctx.stateDir);
      // '' can never match a real project folder (isSafeProjectId requires a
      // non-empty kebab-case name), so this reads every existing project's
      // digest — there is no "self" yet, this card's project isn't created.
      const contexts = contract.readSiblingContexts(workspace, '');
      const answer = draft.answers[card.key] || '';
      const prompt = suggest.buildPrompt(card, answer, contexts);

      // Slice 5's launch override: pass launch.{model,effort} only when the
      // STUDIO picker actually holds a pick, so an unset picker is byte-
      // identical to the legacy (no-launch) disposable call.
      const pick = modelPicker.readModelPick(ctx.stateDir);
      const launch = (pick.model || pick.effort)
        ? { model: pick.model || undefined, effort: pick.effort || undefined }
        : null;

      let finalText = '';
      const done = (payload) => {
        if (!activeSuggestSeat) return;
        const seat = activeSuggestSeat;
        activeSuggestSeat = null;
        clearTimeout(seat.backstop);
        try { seat.controller.close(); } catch { /* already gone */ }
        ctx.bus.post('projectsCardSuggestResult', {
          draftId: draft.id, card: card.key, suggestions: [], error: null,
          ...payload,
        });
      };
      const controller = ctx.seats.startDisposable({
        kickoff: prompt,
        ...(launch ? { launch } : {}),
        onEvent: (event) => {
          if (!activeSuggestSeat) return;
          if (event.type === 'text') finalText += (finalText ? '\n\n' : '') + (event.text || '');
          else if (event.type === 'result') {
            const parsed = suggest.parseLlmReply(finalText);
            done(parsed.error ? { error: parsed.error } : { suggestions: parsed.suggestions });
          } else if (event.type === 'dead') {
            done({ error: 'the suggestion seat exited before answering' });
          }
        },
      });
      activeSuggestSeat = {
        controller,
        backstop: setTimeout(() => done({ error: 'the suggestion pass timed out' }), SUGGEST_BACKSTOP_MS),
      };
      preparedSuggest = null;
      ctx.bus.post('projectsCardSuggestStatus', { phase: 'running' });
    } catch (err) {
      ctx.bus.post('projectsCardSuggestResult', {
        draftId: message && message.id, card: message && message.card,
        suggestions: [], error: err.message,
      });
    }
  });

  ctx.bus.on('projectsCardSuggestStop', () => {
    if (!activeSuggestSeat) return;
    const seat = activeSuggestSeat;
    activeSuggestSeat = null;
    clearTimeout(seat.backstop);
    try { seat.controller.close(); } catch { /* already gone */ }
    ctx.bus.post('projectsCardSuggestStatus', { phase: 'stopped' });
  });

  // ---- the mockup pass (slice A3, § Wave A) --------------------------------
  // Verb-for-verb the suggest pass's state machine: prepare (usage snapshot +
  // TTL) → run (approved:true, one disposable turn, launch override) →
  // result; backstop timer; one pass in flight. What differs is the payload
  // (one screen, not one card), the contract (lib/mockup.js's one-HTML-
  // document discipline), and the landing zone: a validated reply becomes a
  // FILE under the draft's own mockup store + a provenance sidecar carrying
  // the generating canonical hash — never a draft field, never a package
  // write (no package exists yet). Any contract violation is an error + NO
  // file. The backstop is longer than suggest's because a whole HTML document
  // is a far longer generation than a chip list.
  const MOCKUP_PREPARE_TTL_MS = 5 * 60 * 1000;   // == SUGGEST_PREPARE_TTL_MS
  const MOCKUP_BACKSTOP_MS = 5 * 60 * 1000;      // one full document, not chips
  let preparedMockup = null;   // { draftId, screen, revision, preparedAt }
  let activeMockupSeat = null; // { controller, backstop } — one pass at a time

  // The proposed + generated screen lists for the Canonical step's minimal
  // UI (A4 owns the real preview surface). Derivation prefers the APPROVED
  // blueprint (the preview bundle) and falls back to a deterministic build
  // from the current answers, so the list renders even before first generate.
  // The A4 serving seam: register EXACTLY this draft's mockups dir with the
  // apex:// served-file gate (ctx.serve → main/artifacts.js registerServedDir)
  // and hand each generated screen its served URI for the SEE step's sandboxed
  // iframe. The gate itself only admits direct-child .html files of the
  // registered dir, so the sidecars and everything else on this machine stay
  // unreachable. ctx.serve is optional on purpose — headless drills register
  // without it and simply get no URIs.
  const serveToken = (draftId) => 'studio-mockups:' + draftId;
  const registerMockupServe = (draft) => {
    if (!ctx.serve || typeof ctx.serve.registerDir !== 'function') return false;
    try {
      ctx.serve.registerDir(serveToken(draft.id), mockup.draftMockupsDir(ctx.stateDir, draft.id));
      return true;
    } catch { return false; }
  };

  const postMockupScreens = (draft) => {
    const source = draft.preview ? draft.preview.blueprint : blueprint.blueprintFromDraft(draft);
    const derived = mockup.deriveScreens(source);
    const served = registerMockupServe(draft);
    const generated = mockup.listMockups(ctx.stateDir, draft).map((g) => {
      // A5: the derived .annotate.html (pristine bytes + the injected picker
      // script) is REFRESHED on every serve and rides the same served dir —
      // the gate admits any direct-child .html, so no core change. The stored
      // mockup is never touched; the derivative is disposable (no sidecar,
      // never listed, never packaged, dies with the mockups dir). Fail-soft:
      // a derivation hiccup only means annotate mode is unavailable.
      let annotateUri = null;
      if (served) {
        try {
          annotateUri = 'apex://local/' + encodeURIComponent(
            mockup.writeAnnotateMockup(ctx.stateDir, draft.id, g.screen.id));
        } catch { /* pristine preview still works */ }
      }
      return {
        ...g,
        uri: served
          ? 'apex://local/' + encodeURIComponent(
              path.join(mockup.draftMockupsDir(ctx.stateDir, draft.id), g.screen.id + '.html'))
          : null,
        annotateUri,
      };
    });
    ctx.bus.post('projectsMockupScreens', {
      draftId: draft.id,
      kind: derived.kind,
      proposed: derived.screens,
      generated,
      hasPreview: Boolean(draft.preview),
      approval: draft.mockupApproval || null,
      approvalCurrent: mockup.isApprovalCurrent(draft),
      error: null,
    });
  };

  ctx.bus.on('projectsMockupList', (message) => {
    try {
      postMockupScreens(currentWorkspaceDraft(message && message.id));
    } catch (err) {
      ctx.bus.post('projectsMockupScreens', {
        draftId: message && message.id, kind: null, proposed: [], generated: [],
        hasPreview: false, error: err.message,
      });
    }
  });

  ctx.bus.on('projectsMockupPrepare', (message) => {
    try {
      const screen = mockup.cleanScreen(message && message.screen);
      const draft = currentWorkspaceDraft(message && message.id);
      if (!draft.preview)
        throw new Error('Generate the canonical preview first — mockups are generated FROM the approved blueprint.');
      const usage = ctx.usage && typeof ctx.usage.claudeSnapshot === 'function'
        ? ctx.usage.claudeSnapshot() : null;
      const usageFresh = Boolean(usage && usage.asOf && !usage.stale &&
        Date.now() - usage.asOf <= 5 * 60 * 1000);
      preparedMockup = {
        draftId: draft.id,
        screen,
        revision: draft.revision,
        preparedAt: Date.now(),
      };
      ctx.bus.post('projectsMockupPrepared', {
        draftId: draft.id,
        screen,
        revision: draft.revision,
        usage: usage ? {
          session: usage.session || null,
          weekly: usage.weekly || null,
          asOf: usage.asOf || null,
          stale: !usageFresh,
        } : null,
        requiresApproval: true,
      });
    } catch (err) {
      preparedMockup = null;
      ctx.bus.post('projectsMockupStatus', { phase: 'error', error: err.message });
    }
  });

  ctx.bus.on('projectsMockupRun', (message) => {
    try {
      if (!message || message.approved !== true)
        throw new Error('The mockup pass runs a hidden Claude session — it needs explicit approval.');
      if (!preparedMockup || message.id !== preparedMockup.draftId ||
          !message.screen || message.screen.id !== preparedMockup.screen.id ||
          message.expectedRevision !== preparedMockup.revision)
        throw new Error('Prepare the mockup pass again from the current draft.');
      if (Date.now() - preparedMockup.preparedAt > MOCKUP_PREPARE_TTL_MS)
        throw new Error('The usage check expired; prepare the mockup pass again.');
      if (activeMockupSeat) throw new Error('A mockup pass is already running.');
      if (!ctx.seats || typeof ctx.seats.startDisposable !== 'function')
        throw new Error('Disposable seat service is unavailable.');

      const screen = preparedMockup.screen;
      const draft = currentWorkspaceDraft(preparedMockup.draftId);
      if (draft.revision !== preparedMockup.revision)
        throw new Error('The draft changed; prepare the mockup pass again.');
      if (!draft.preview)
        throw new Error('Generate the canonical preview first — mockups are generated FROM the approved blueprint.');
      const bundle = draft.preview;
      // The provenance anchor: the approved canonical hash this mockup is
      // generated FROM. A later blueprint change flips the STALE badge.
      const canonicalHash = bundle.generatedCanonicalHash;
      const derived = mockup.deriveScreens(bundle.blueprint);
      // The A2 tokens summary — compiled, never re-implemented (lib/design.js
      // is deterministic and total, so this costs nothing).
      const tokensSummary = design.compileTokens(bundle.blueprint.look).tokens.summary;
      // A5: a regen-with-notes IS this same verb — when the draft carries
      // note chips for this screen they ride the prompt pinned to their
      // elements' selector/text context; no notes, byte-identical to A3.
      const screenNotes = (draft.mockupNotes && draft.mockupNotes[screen.id]) || null;
      const prompt = mockup.buildPrompt({
        displayName: bundle.displayName,
        blueprint: bundle.blueprint,
        tokensSummary,
        kind: derived.kind,
        screen,
        notes: screenNotes,
      });

      // Slice 5's launch override, same passthrough as the suggest pass:
      // omitted entirely when the STUDIO picker holds no pick.
      const pick = modelPicker.readModelPick(ctx.stateDir);
      const launch = (pick.model || pick.effort)
        ? { model: pick.model || undefined, effort: pick.effort || undefined }
        : null;

      let finalText = '';
      const done = (payload) => {
        if (!activeMockupSeat) return;
        const seat = activeMockupSeat;
        activeMockupSeat = null;
        clearTimeout(seat.backstop);
        try { seat.controller.close(); } catch { /* already gone */ }
        ctx.bus.post('projectsMockupResult', {
          draftId: draft.id, screen, ok: false, error: null,
          ...payload,
        });
      };
      const controller = ctx.seats.startDisposable({
        kickoff: prompt,
        ...(launch ? { launch } : {}),
        onEvent: (event) => {
          if (!activeMockupSeat) return;
          if (event.type === 'text') finalText += (finalText ? '\n\n' : '') + (event.text || '');
          else if (event.type === 'result') {
            const parsed = mockup.parseLlmReply(finalText);
            if (parsed.error) { done({ error: parsed.error }); return; }
            // Only a fully validated document ever reaches disk — and the
            // store re-checks the contract's caps itself, so no ordering bug
            // can smuggle a violation into a file.
            try {
              const written = mockup.writeMockup(ctx.stateDir, draft.id, screen, parsed.html, canonicalHash);
              // A4: regenerating ANY screen invalidates a recorded approval
              // outright — the eyes signed off on the old pixels. Cleared on
              // the draft (not just flagged), so a fresh APPROVE is the only
              // way back; the drift/hash arm of invalidation lives in
              // mockup.isApprovalCurrent.
              // A5: the screen's note chips clear here too — they were
              // CONSUMED by the turn that just landed. On success ONLY, and
              // deliberately: a failed regen (hostile reply, timeout) leaves
              // the notes on the draft so the user retries without retyping.
              let refreshed = currentWorkspaceDraft(draft.id);
              const invalidations = {};
              if (refreshed.mockupApproval) invalidations.mockupApproval = null;
              if (refreshed.mockupNotes && refreshed.mockupNotes[screen.id]) {
                const remaining = { ...refreshed.mockupNotes };
                delete remaining[screen.id];
                invalidations.mockupNotes = Object.keys(remaining).length ? remaining : null;
              }
              if (Object.keys(invalidations).length) {
                refreshed = drafts.updateDraft(ctx.stateDir, refreshed.id, refreshed.revision, invalidations);
                ctx.bus.post('projectsDraftPatched', { draft: refreshed, cards: CARDS });
              }
              done({ ok: true, file: written.file });
              postMockupScreens(refreshed);
            } catch (err) {
              done({ error: err.message });
            }
          } else if (event.type === 'dead') {
            done({ error: 'the mockup seat exited before answering' });
          }
        },
      });
      activeMockupSeat = {
        controller,
        backstop: setTimeout(() => done({ error: 'the mockup pass timed out' }), MOCKUP_BACKSTOP_MS),
      };
      preparedMockup = null;
      ctx.bus.post('projectsMockupStatus', { phase: 'running' });
    } catch (err) {
      ctx.bus.post('projectsMockupResult', {
        draftId: message && message.id, screen: message && message.screen,
        ok: false, error: err.message,
      });
    }
  });

  ctx.bus.on('projectsMockupStop', () => {
    if (!activeMockupSeat) return;
    const seat = activeMockupSeat;
    activeMockupSeat = null;
    clearTimeout(seat.backstop);
    try { seat.controller.close(); } catch { /* already gone */ }
    ctx.bus.post('projectsMockupStatus', { phase: 'stopped' });
  });

  // ---- APPROVE MOCKUPS (slice A4) ------------------------------------------
  // Records the sign-off on the DRAFT (drafts.js's validated mockupApproval
  // field): the up-to-date generated screens + the canonical hash they were
  // built from. Stale screens never enter an approval — approving them would
  // record sight of pixels the blueprint has already left behind. Invalidation
  // is elsewhere by design: a canonical move makes isApprovalCurrent false
  // (re-approve), a screen regen clears the field (projectsMockupRun).
  ctx.bus.on('projectsMockupApprove', (message) => {
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      if (!draft.preview)
        throw new Error('Generate the canonical preview first — approval covers mockups of the approved blueprint.');
      const upToDate = mockup.listMockups(ctx.stateDir, draft).filter((g) => !g.stale);
      if (!upToDate.length)
        throw new Error('There is no up-to-date mockup to approve yet — generate (or regenerate) the screens first.');
      const approval = {
        screens: upToDate.map((g) => g.screen.id).sort(),
        canonicalHash: draft.preview.generatedCanonicalHash,
        approvedAt: new Date().toISOString(),
      };
      const updated = drafts.updateDraft(ctx.stateDir, draft.id,
        message && message.expectedRevision, { mockupApproval: approval });
      ctx.bus.post('projectsMockupApproveResult', { ok: true, draftId: updated.id, approval });
      // Same no-navigation refresh contract as a co-designer patch: the draft
      // (and its new revision) lands without yanking the user off the step.
      ctx.bus.post('projectsDraftPatched', { draft: updated, cards: CARDS });
      postMockupScreens(updated);
    } catch (err) {
      ctx.bus.post('projectsMockupApproveResult', {
        ok: false, draftId: message && message.id,
        conflict: err.code === 'DRAFT_CONFLICT', error: err.message,
      });
    }
  });

  // ---- note chips (slice A5) -----------------------------------------------
  // One verb replaces ONE screen's whole note list on the draft (add = list +
  // one, remove = list − one — the renderer sends the result, main rebuilds it
  // clean). Mutation flows through drafts.updateDraft's revision gate like
  // every other draft edit; drafts.validateMockupNotes is the fail-closed
  // authority on shape/caps (an over-cap note or a 13th chip is an error, not
  // a truncation). Notes are rebuilt field by field from the known keys only —
  // never a spread of renderer input — mirroring the bridge's own discipline.
  // The refresh rides projectsDraftPatched (no-navigation, same as approval).
  ctx.bus.on('projectsMockupNoteSave', (message) => {
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      const screenId = message && message.screenId;
      if (typeof screenId !== 'string' || screenId.length > mockup.MAX_SCREEN_ID ||
          !mockup.SCREEN_ID_RE.test(screenId))
        throw new Error('Screen name must be lowercase kebab-case, at most ' + mockup.MAX_SCREEN_ID + ' characters.');
      if (!Array.isArray(message.notes))
        throw new Error('Mockup notes must be a list.');
      const cleaned = message.notes.map((n) => ({
        selector: String((n && n.selector) || ''),
        text: String((n && n.text) || ''),
        note: String((n && n.note) || '').trim(),
      }));
      const next = { ...(draft.mockupNotes || {}) };
      if (cleaned.length) next[screenId] = cleaned;
      else delete next[screenId];
      const updated = drafts.updateDraft(ctx.stateDir, draft.id,
        message && message.expectedRevision,
        { mockupNotes: Object.keys(next).length ? next : null });
      ctx.bus.post('projectsMockupNoteResult', { ok: true, draftId: updated.id, screenId });
      ctx.bus.post('projectsDraftPatched', { draft: updated, cards: CARDS });
    } catch (err) {
      ctx.bus.post('projectsMockupNoteResult', {
        ok: false, draftId: message && message.id, screenId: message && message.screenId,
        conflict: err.code === 'DRAFT_CONFLICT', error: err.message,
      });
    }
  });

  // ---- the co-designer panel (slice 7, § AI integration Level 2) ----------
  // ONE long-lived disposable controller per open panel session — NOT a fresh
  // one per turn. `codesignerOpen` starts it (its kickoff already sends turn
  // one, exactly like createDisposable's own kickoff-on-construct contract);
  // `codesignerSend` reuses the SAME controller.send() for every later turn;
  // `codesignerClose` (explicit, or an implicit re-open) tears it down. A
  // closed panel is a closed seat: reopening always starts fresh from a fresh
  // digest, never resuming — mirrors the relationship pass's backstop
  // discipline of "a stuck seat can always be killed," just without a timer,
  // because a chat panel has no natural end-of-turn to time out against.
  const CODESIGNER_BACKSTOP_MS = 10 * 60 * 1000; // generous — a live chat, not one turn
  let activeCodesigner = null; // { controller, draftId, backstop, seq, patches: [] }

  const closeCodesigner = (phase, error) => {
    if (!activeCodesigner) return;
    const session = activeCodesigner;
    activeCodesigner = null;
    clearTimeout(session.backstop);
    try { session.controller.close(); } catch { /* already gone */ }
    ctx.bus.post('codesignerStatus', { phase, draftId: session.draftId, error: error || null });
  };

  ctx.bus.on('codesignerOpen', (message) => {
    // Opening always replaces any previous session — "closed panel = closed
    // seat; reopening starts fresh" holds whether the old panel was closed
    // explicitly or the user just re-opened over it.
    closeCodesigner('closed', null);
    try {
      if (!ctx.seats || typeof ctx.seats.startDisposable !== 'function')
        throw new Error('Disposable seat service is unavailable.');
      const draft = currentWorkspaceDraft(message && message.id);
      const kickoff = codesigner.buildKickoff(draft, CARDS);

      // Slice 5's launch override, same passthrough as the suggest pass:
      // omitted entirely when the STUDIO picker holds no pick.
      const pick = modelPicker.readModelPick(ctx.stateDir);
      const launch = (pick.model || pick.effort)
        ? { model: pick.model || undefined, effort: pick.effort || undefined }
        : null;

      const session = { draftId: draft.id, finalText: '', seq: 0, patches: [], backstop: null };
      const controller = ctx.seats.startDisposable({
        kickoff,
        ...(launch ? { launch } : {}),
        onEvent: (event) => {
          if (activeCodesigner !== session) return;
          if (event.type === 'delta') {
            ctx.bus.post('codesignerDelta', { draftId: session.draftId, text: event.text || '' });
          } else if (event.type === 'text') {
            session.finalText += (session.finalText ? '\n\n' : '') + (event.text || '');
          } else if (event.type === 'result') {
            if (!event.ok) {
              ctx.bus.post('codesignerMessage', { draftId: session.draftId, role: 'assistant', text: '', error: 'the co-designer turn failed' });
              return;
            }
            const parsed = codesigner.parsePatchReply(session.finalText);
            const withIds = parsed.patches.map((p) => ({ id: 'p' + (++session.seq), ...p }));
            session.patches.push(...withIds);
            ctx.bus.post('codesignerMessage', {
              draftId: session.draftId, role: 'assistant', text: session.finalText, error: null,
            });
            if (withIds.length)
              ctx.bus.post('codesignerPatches', { draftId: session.draftId, patches: session.patches.slice() });
            session.finalText = '';
          } else if (event.type === 'dead') {
            closeCodesigner('error', 'the co-designer seat exited unexpectedly');
          }
        },
      });
      session.controller = controller;
      session.backstop = setTimeout(
        () => closeCodesigner('error', 'the co-designer session timed out'),
        CODESIGNER_BACKSTOP_MS
      );
      activeCodesigner = session;
      ctx.bus.post('codesignerStatus', { phase: 'open', draftId: draft.id, error: null });
    } catch (err) {
      ctx.bus.post('codesignerStatus', { phase: 'error', draftId: message && message.id, error: err.message });
    }
  });

  ctx.bus.on('codesignerSend', (message) => {
    try {
      if (!activeCodesigner || !message || activeCodesigner.draftId !== message.id)
        throw new Error('Open the co-designer panel before sending a turn.');
      const text = String((message && message.text) || '').trim();
      if (!text) throw new Error('Nothing to send.');
      // Re-read the draft so the digest reflects whatever the user just did to
      // a card, INCLUDING a patch accepted moments ago — the co-designer always
      // argues from the current draft, never a memorized snapshot of it.
      const draft = currentWorkspaceDraft(activeCodesigner.draftId);
      const turn = codesigner.buildTurn(text, draft, CARDS);
      activeCodesigner.controller.send(turn);   // the SAME controller — no new disposable
      ctx.bus.post('codesignerStatus', { phase: 'sending', draftId: draft.id, error: null });
    } catch (err) {
      ctx.bus.post('codesignerStatus', { phase: 'error', draftId: message && message.id, error: err.message });
    }
  });

  ctx.bus.on('codesignerClose', (message) => {
    if (activeCodesigner && (!message || activeCodesigner.draftId === message.id))
      closeCodesigner('closed', null);
  });

  // Accept/reject never touch the seat — they mutate the DRAFT (like every
  // other draft edit, through the same revision gate) and then drop the patch
  // from the pending list. The AI never writes the blueprint; this is the only
  // path that does, and it only runs on an explicit user click.
  ctx.bus.on('codesignerPatchAccept', (message) => {
    try {
      if (!activeCodesigner || !message || activeCodesigner.draftId !== message.id)
        throw new Error('That co-designer session is no longer open.');
      const idx = activeCodesigner.patches.findIndex((p) => p.id === (message && message.patchId));
      if (idx < 0) throw new Error('That patch is no longer pending.');
      const patch = activeCodesigner.patches[idx];
      const draft = currentWorkspaceDraft(activeCodesigner.draftId);
      const current = draft.answers[patch.card] || '';
      const updatedAnswer = (current.trim() ? current + '\n' : '') + '• ' + patch.proposal;
      const updated = drafts.updateDraft(ctx.stateDir, draft.id, message.expectedRevision, {
        answers: { [patch.card]: updatedAnswer },
      });
      activeCodesigner.patches.splice(idx, 1);
      // A dedicated post, NOT postDraftStatus/projectsDraftStatus: that handler
      // also drives step navigation (jumps to draft.currentCard), which would
      // yank the user away from wherever they are reading the co-designer
      // panel just because a patch on some OTHER card was accepted. This just
      // refreshes the draft in place.
      ctx.bus.post('projectsDraftPatched', { draft: updated, cards: CARDS });
      ctx.bus.post('codesignerPatches', { draftId: updated.id, patches: activeCodesigner.patches.slice() });
    } catch (err) {
      ctx.bus.post('toast', { text: 'Patch was not accepted: ' + err.message });
    }
  });

  ctx.bus.on('codesignerPatchReject', (message) => {
    if (!activeCodesigner || !message || activeCodesigner.draftId !== message.id) return;
    const idx = activeCodesigner.patches.findIndex((p) => p.id === (message && message.patchId));
    if (idx < 0) return;
    activeCodesigner.patches.splice(idx, 1);
    ctx.bus.post('codesignerPatches', { draftId: activeCodesigner.draftId, patches: activeCodesigner.patches.slice() });
  });

  // ---- Create Project + Lift-off (slice 8) ---------------------------------
  // Create writes the atomic package (lib/creator.js), reusing slice 2's
  // contract.js for every safety check. Everything past Create reads the
  // package straight off disk by projectId — never from the in-memory draft
  // preview — so Lift-off works the same whether it runs the instant after
  // Create or after a reload.
  ctx.bus.on('projectsCreate', (message) => {
    try {
      if (!message || message.confirmed !== true)
        throw new Error('Creating the project package requires explicit confirmation.');
      const draft = currentWorkspaceDraft(message.id);
      if (!draft.preview) throw new Error('Generate and approve a canonical preview first.');
      if (message.expectedRevision !== draft.revision)
        throw new Error('The draft changed; reopen it before creating the project.');
      const workspace = selectedWorkspace(ctx.stateDir);
      // A4: the approved, still-current mockups ride into the package (staged
      // inside creator.js's same atomic temp dir, before the rename — never a
      // post-rename write). No/stale approval = an empty list = no mockups/.
      const created = packageCreator.createProjectPackage(workspace, draft.preview, {
        mockups: mockup.collectApprovedMockups(ctx.stateDir, draft),
      });
      ctx.bus.post('projectsCreateResult', {
        ok: true,
        projectId: created.projectId,
        projectDir: created.projectDir,
        displayName: draft.preview.displayName,
        warnings: created.report.warnings,
        suggestions: created.report.suggestions,
      });
    } catch (err) {
      ctx.bus.post('projectsCreateResult', { ok: false, error: err.message });
      ctx.bus.post('toast', { text: 'Project was not created: ' + err.message });
    }
  });

  // Archive-based removal — a SEPARATE explicit action from draft deletion
  // (projectsDraftDelete, above): removing a created project never touches a
  // draft, and deleting a draft never touches a written package.
  // KEEP (Sweep v1, slice 10): this verb has no renderer poster yet — no
  // "remove project" affordance exists in the PROJECTS UI. Not dead: it is
  // spec'd (design/app-builder-v1.md § Write safety: "removal archives...
  // rather than deletes, like personas") and proven by
  // test/studio-liftoff-drill.js's "projectsRemove archives the created
  // project" case. The UI trigger is a follow-up, not sweep scope.
  ctx.bus.on('projectsRemove', (message) => {
    try {
      if (!message || message.confirmed !== true)
        throw new Error('Removing a project requires explicit confirmation.');
      const workspace = selectedWorkspace(ctx.stateDir);
      const dest = packageCreator.archiveProject(workspace, message.projectId);
      ctx.bus.post('projectsRemoveResult', { ok: true, projectId: message.projectId, archivedTo: dest });
      ctx.bus.post('toast', {
        text: 'Project archived — recover it from ' + path.basename(workspace) +
          '/.archive/' + path.basename(dest) + ' if needed.',
      });
    } catch (err) {
      ctx.bus.post('projectsRemoveResult', { ok: false, error: err.message });
      ctx.bus.post('toast', { text: 'Project was not removed: ' + err.message });
    }
  });

  // Reads a created project's canonical frontmatter straight off disk — every
  // Lift-off action keys off projectId, not the in-memory draft/preview.
  const projectFrontmatter = (projectDir, canonicalPath) =>
    fs.existsSync(canonicalPath)
      ? contract.parseFrontmatter(fs.readFileSync(canonicalPath, 'utf8')).attributes
      : {};

  // F2 (§ Wave F): the contract addendum rides the Lift-off kickoff. Each
  // spine file reads fail-soft — absent = undefined, so the addendum states
  // does-not-exist-yet honestly; unreadable or unparseable = a junk sentinel
  // every spines/design validator rejects, so the addendum reports the file
  // present-but-unusable by name. A malformed spine costs one honest line in
  // the addendum, never the kickoff itself.
  const readSpine = (file) => {
    if (!fs.existsSync(file)) return undefined;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return { unparseable: true }; }
  };
  const contractAddendum = (paths) => spines.renderContractAddendum(
    readSpine(paths.tokens),
    readSpine(path.join(paths.designDir, 'components.json')),
    readSpine(path.join(paths.designDir, 'manifest.json')));

  // Lift-off (a): register the project's folder into seatconfig.json's
  // `_workspaces`. The actual write is ctx.seats.registerWorkspace — a plain
  // synchronous ctx.seats method, not a bus verb (see its comment in
  // main/seats.js for why): collision-warns-never-clobbers, every other
  // seatconfig key untouched.
  ctx.bus.on('projectsLiftoffRegisterWorkspace', (message) => {
    try {
      const projectId = message && message.projectId;
      const workspace = selectedWorkspace(ctx.stateDir);
      const paths = contract.projectPaths(workspace, projectId);
      if (!fs.existsSync(paths.projectDir))
        throw new Error('Create the project before registering its workspace.');
      if (!ctx.seats || typeof ctx.seats.registerWorkspace !== 'function')
        throw new Error('Workspace registration service is unavailable.');
      const frontmatter = projectFrontmatter(paths.projectDir, paths.canonical);
      const name = (message && typeof message.name === 'string' && message.name.trim())
        || frontmatter.display_name || projectId;
      const result = ctx.seats.registerWorkspace({ name, path: paths.projectDir });
      ctx.bus.post('projectsLiftoffRegisterResult', result);
      if (!result.ok) ctx.bus.post('toast', { text: 'Workspace was not registered: ' + result.error });
    } catch (err) {
      ctx.bus.post('projectsLiftoffRegisterResult', { ok: false, error: err.message });
    }
  });

  // Lift-off (b): delegate to the Architect — the workflow layer's OWN
  // taskCreate (+ taskRouteSave when the user accepts the route as a
  // template) via ctx.bus.inject: main/tasks.js registers those verbs on the
  // SAME bus singleton ctx.bus is, and inject() is "the same code path a
  // renderer post takes past ipc" (main/bus.js) — the sanctioned way for one
  // main-side module to drive another's bus verb in-process, since post()
  // only reaches the renderer and can never hand a return value back to a
  // calling extension. No route ever reaches taskCreate unless every step in
  // it is a currently-registered preset; no Architect-shaped preset at all
  // means the whole action explains itself instead of failing opaquely.
  ctx.bus.on('projectsLiftoffDelegate', (message) => {
    try {
      const projectId = message && message.projectId;
      const workspace = selectedWorkspace(ctx.stateDir);
      const paths = contract.projectPaths(workspace, projectId);
      if (!fs.existsSync(paths.canonical))
        throw new Error('Create the project before delegating.');
      if (!ctx.seats || typeof ctx.seats.presetNames !== 'function')
        throw new Error('Live persona presets are unavailable.');
      const liveNames = ctx.seats.presetNames();
      const architect = liftoff.findArchitectPreset(liveNames);
      if (!architect) {
        ctx.bus.post('projectsLiftoffDelegateResult', {
          ok: false, noArchitect: true,
          error: 'No Architect-shaped persona is registered yet — create one in the ' +
            'PERSONAS sub-tab, then delegate.',
        });
        return;
      }
      const route = liftoff.normalizeRouteInput(message && message.route, architect);
      const plan = liftoff.planDelegateRoute({ presetNames: liveNames, route });
      if (!plan.ok) {
        ctx.bus.post('projectsLiftoffDelegateResult', {
          ok: false,
          unknownPresets: plan.unknownPresets,
          error: plan.error || ('This route names personas that are not currently registered: ' +
            plan.unknownPresets.join(', ')),
        });
        return;
      }
      if (typeof ctx.bus.inject !== 'function')
        throw new Error('Delegation requires the bus injection seam.');
      const canonicalText = fs.readFileSync(paths.canonical, 'utf8');
      // F2: the brief is PROJECT.md verbatim PLUS the contract addendum —
      // composed (and cap-trimmed, PROJECT.md winning) in lib/liftoff.js so
      // main/tasks.js's own 20000-char slice never cuts anything silently.
      const brief = liftoff.composeKickoffBrief(canonicalText, contractAddendum(paths));
      const frontmatter = projectFrontmatter(paths.projectDir, paths.canonical);
      const title = 'Delegate: ' + (frontmatter.display_name || projectId);
      ctx.bus.inject({
        type: 'taskCreate', title, cwd: paths.projectDir,
        route, brief, auto: false, start: true,
      });
      if (message && message.saveAsTemplate) {
        const templateName = (typeof message.templateName === 'string' && message.templateName.trim())
          || ('App Builder: ' + route.join(' → '));
        ctx.bus.inject({ type: 'taskRouteSave', name: templateName, steps: route });
      }
      ctx.bus.post('projectsLiftoffDelegateResult', { ok: true, route, title, cwd: paths.projectDir });
    } catch (err) {
      ctx.bus.post('projectsLiftoffDelegateResult', { ok: false, error: err.message });
    }
  });

  // Lift-off (c): open a chat here — one bare seat in the project cwd, no
  // route, no task. seatCreate is main/seats.js's own normal "open a rail
  // seat" verb (the same one a click on a rail button posts); same
  // in-process dispatch reasoning as taskCreate above.
  // F2 caveat, stated rather than faked: the contract addendum rides the
  // DELEGATE kickoff (above) but cannot ride this one yet — seatCreate reads
  // no kickoff text off the wire (a seat's kickoff comes from its persona
  // preset alone; see main/seats.js createFromMessage), and main/seats.js is
  // outside this slice's surface. Wiring an additive message-carried kickoff
  // there is the follow-up; a dead field injected here today would be a lie.
  ctx.bus.on('projectsLiftoffChat', (message) => {
    try {
      const projectId = message && message.projectId;
      const workspace = selectedWorkspace(ctx.stateDir);
      const paths = contract.projectPaths(workspace, projectId);
      if (!fs.existsSync(paths.projectDir))
        throw new Error('Create the project before opening a chat.');
      if (typeof ctx.bus.inject !== 'function')
        throw new Error('Opening a chat requires the bus injection seam.');
      const frontmatter = projectFrontmatter(paths.projectDir, paths.canonical);
      const title = 'Chat — ' + (frontmatter.display_name || projectId);
      ctx.bus.inject({ type: 'seatCreate', persona: '', cwd: paths.projectDir, title });
      ctx.bus.post('projectsLiftoffChatResult', { ok: true, cwd: paths.projectDir, title });
    } catch (err) {
      ctx.bus.post('projectsLiftoffChatResult', { ok: false, error: err.message });
    }
  });

  // ---- the dev-server runner (slice B1, § Wave B) --------------------------
  // lib/servers.js owns config persistence, the lifecycle machine, ready
  // detection, the log ring, and the tree-kill; this block is bus plumbing +
  // the guards. The spawner and timing are injectable seams (ctx.serverSpawner
  // / ctx.serverTuning in drills — the same optionality pattern as ctx.serve),
  // so the whole lifecycle drills with zero real processes; the real loader
  // passes neither and gets child_process + production timings.
  const serverManager = servers.createServerManager({
    ...(ctx.serverTuning || {}),
    spawner: ctx.serverSpawner || undefined,
    onState: (state) => ctx.bus.post('projectsServerState', state),
    onLog: (delta) => ctx.bus.post('projectsServerLog', delta),
  });
  liveServerManagers.add(serverManager);

  // Containment roots beyond the projects workspace: the registered
  // workspaces (seatconfig `_workspaces`). ctx.seats offers no workspace
  // READER (registerWorkspace only writes), and B1 is extension-only — so the
  // list is read straight off seatconfig.json, read-only and fail-soft, with
  // the same absolute+exists validation main/seats.js's readWorkspaces
  // applies. The day a core reader seam exists, it replaces this.
  const seatconfigFile = ctx.seatconfigFile ||   // drill seam — a fixture file
    path.resolve(__dirname, '..', '..', 'seatconfig.json');
  const registeredWorkspaceRoots = () => {
    try {
      const cfg = JSON.parse(fs.readFileSync(seatconfigFile, 'utf8'));
      return (Array.isArray(cfg._workspaces) ? cfg._workspaces : [])
        .filter((w) => w && typeof w.path === 'string' && path.isAbsolute(w.path) && fs.existsSync(w.path))
        .map((w) => w.path);
    } catch { return []; }   // no config = no extra roots, never a crash
  };

  const requireServerProject = (message) => {
    const projectId = message && message.projectId;
    if (!contract.isSafeProjectId(projectId)) throw new Error('That is not a valid project id.');
    return projectId;
  };

  const postServerConfig = (projectId) => ctx.bus.post('projectsServerConfig', {
    projectId, config: servers.readServerConfig(ctx.stateDir, projectId), error: null,
  });

  // Any refusal (bad config, containment, not running) rides the SAME state
  // post the lifecycle uses, with the error attached — one shape for the
  // renderer to render, and the current phase always travels with the story.
  const postServerFailure = (projectId, err) => ctx.bus.post('projectsServerState', {
    ...serverManager.state(typeof projectId === 'string' ? projectId : ''),
    projectId, error: err.message,
  });

  ctx.bus.on('projectsServerConfigGet', (message) => {
    try { postServerConfig(requireServerProject(message)); }
    catch (err) {
      ctx.bus.post('projectsServerConfig', {
        projectId: message && message.projectId, config: null, error: err.message,
      });
    }
  });

  ctx.bus.on('projectsServerConfigSave', (message) => {
    try {
      const projectId = requireServerProject(message);
      servers.writeServerConfig(ctx.stateDir, projectId, message && message.config);
      postServerConfig(projectId);
    } catch (err) {
      ctx.bus.post('projectsServerConfig', {
        projectId: message && message.projectId,
        config: servers.readServerConfig(ctx.stateDir, message && message.projectId),
        error: err.message,
      });
    }
  });

  ctx.bus.on('projectsServerStart', (message) => {
    try {
      const projectId = requireServerProject(message);
      const workspace = selectedWorkspace(ctx.stateDir);
      const paths = contract.projectPaths(workspace, projectId);
      if (!fs.existsSync(paths.projectDir))
        throw new Error('Create the project before running its dev server.');
      const config = servers.readServerConfig(ctx.stateDir, projectId);
      if (!config) throw new Error('Save a launch config first.');
      serverManager.start({
        projectId, config,
        fallbackCwd: paths.projectDir,   // empty cwd = the project's own folder
        allowedRoots: [workspace, ...registeredWorkspaceRoots()],
      });
    } catch (err) { postServerFailure(message && message.projectId, err); }
  });

  ctx.bus.on('projectsServerStop', (message) => {
    try { serverManager.stop(requireServerProject(message)); }
    catch (err) { postServerFailure(message && message.projectId, err); }
  });
}

// Slice B1: every dev server dies with the extension — main/extensions.js
// calls this on app quit (window-all-closed), the servers drill calls it
// directly. Kills across every manager register() ever created.
function dispose() {
  for (const manager of liveServerManagers) {
    try { manager.stopAll(); } catch { /* dying anyway */ }
  }
  liveServerManagers.clear();
}

module.exports = {
  register,
  dispose,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  workspaceStatus,
  selectedWorkspace,
  validateBundleReport,
};

module.exports.modelPicker = modelPicker;
module.exports.suggest = suggest;
module.exports.mockup = mockup;
module.exports.codesigner = codesigner;
module.exports.packageCreator = packageCreator;
module.exports.liftoff = liftoff;
module.exports.importer = importer;
module.exports.servers = servers;
