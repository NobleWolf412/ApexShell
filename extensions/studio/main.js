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
const codesigner = require('./lib/codesigner');
const packageCreator = require('./lib/creator');
const design = require('./lib/design');
const liftoff = require('./lib/liftoff');
const importer = require('./lib/importer');

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
    // Stage the tokens exactly as Create will write them (slice A2), so the
    // review report validates the package-to-be — not a bogus "tokens.json is
    // missing" warning about a file Create hasn't had its chance to write yet.
    fs.mkdirSync(path.join(dir, 'design'));
    fs.writeFileSync(path.join(dir, 'design', 'tokens.json'),
      design.serializeTokens(design.compileTokens(bundle.blueprint.look).tokens), 'utf8');
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
        report: validateBundleReport(draft.preview),
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
      const created = packageCreator.createProjectPackage(workspace, draft.preview);
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
      const frontmatter = projectFrontmatter(paths.projectDir, paths.canonical);
      const title = 'Delegate: ' + (frontmatter.display_name || projectId);
      ctx.bus.inject({
        type: 'taskCreate', title, cwd: paths.projectDir,
        route, brief: canonicalText, auto: false, start: true,
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
}

module.exports = {
  register,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  workspaceStatus,
  selectedWorkspace,
  validateBundleReport,
};

module.exports.modelPicker = modelPicker;
module.exports.suggest = suggest;
module.exports.codesigner = codesigner;
module.exports.packageCreator = packageCreator;
module.exports.liftoff = liftoff;
module.exports.importer = importer;
