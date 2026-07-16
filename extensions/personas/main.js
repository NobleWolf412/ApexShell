// Persona Builder — the full guided flow: workspace selection, shared
// foundation, interview drafts, preview/validation, disposable behavior
// tests, atomic permanent package creation, and relationship
// recommendations (lib/relationships.js). Shell state (workspace choice)
// is written only after an explicit directory-picker action.
'use strict';

const fs = require('fs');
const path = require('path');
const foundation = require('./lib/foundation');
const drafts = require('./lib/drafts');
const { CARDS } = require('./lib/interview');
const previewRenderer = require('./lib/render');
const previewValidator = require('./lib/validator');
const importer = require('./lib/importer');
const tester = require('./lib/tester');
const creator = require('./lib/creator');
const manage = require('./lib/manage');
const relationships = require('./lib/relationships');

const CONFIG_FILE = 'workspace.json';
const TEST_PREPARE_TTL_MS = 5 * 60 * 1000;

function configPath(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir))
    throw new Error('Persona Builder state directory must be absolute.');
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
    throw new Error('Persona workspace must be an absolute path.');
  const resolved = path.resolve(workspace);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('Persona workspace must be a directory.');

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

function workspaceStatus(stateDir) {
  const saved = readWorkspaceConfig(stateDir);
  const status = {
    configured: false,
    workspace: saved.workspace,
    exists: false,
    foundationReady: false,
    personasReady: false,
    personaCount: 0,
    error: saved.error,
  };
  if (!saved.workspace) return status;

  try {
    if (!fs.existsSync(saved.workspace)) return status;
    status.exists = fs.statSync(saved.workspace).isDirectory();
    if (!status.exists) return status;
    status.configured = true;
    status.foundationReady = fs.existsSync(path.join(saved.workspace, 'foundation.md'));
    const personasDir = path.join(saved.workspace, 'personas');
    status.personasReady = fs.existsSync(personasDir) && fs.statSync(personasDir).isDirectory();
    if (status.personasReady) {
      status.personaCount = fs.readdirSync(personasDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory()).length;
    }
  } catch (err) {
    status.error = 'Could not inspect the persona workspace: ' + err.message;
  }
  return status;
}

function selectedWorkspace(stateDir) {
  const saved = readWorkspaceConfig(stateDir);
  if (saved.error) throw new Error(saved.error);
  if (!saved.workspace) throw new Error('Choose a persona workspace first.');
  return saved.workspace;
}

function foundationStatus(stateDir) {
  let workspace = null;
  try {
    workspace = selectedWorkspace(stateDir);
    return { ...foundation.inspectFoundation(workspace), error: null };
  } catch (err) {
    return { workspace, exists: false, content: '', revision: null, error: err.message };
  }
}

function interviewWorkspace(stateDir) {
  const workspace = selectedWorkspace(stateDir);
  if (!foundation.inspectFoundation(workspace).exists)
    throw new Error('Create the shared foundation before starting a persona draft.');
  return workspace;
}

function register(ctx) {
  if (!ctx || !ctx.bus || typeof ctx.bus.on !== 'function' || typeof ctx.bus.post !== 'function')
    throw new Error('Persona Builder requires the extension bus.');
  if (typeof ctx.pickDirectory !== 'function')
    throw new Error('Persona Builder requires the directory-picker service.');
  configPath(ctx.stateDir); // validate once at load, before registering handlers
  let activeImportAudit = null;
  let preparedTest = null;
  let activeTest = null;
  let completedTest = null;

  const syncPresets = () => {
    try {
      if (!ctx.seats || typeof ctx.seats.replacePresetGroup !== 'function')
        throw new Error('Permanent seat preset service is unavailable.');
      const saved = readWorkspaceConfig(ctx.stateDir);
      const presets = saved.workspace && !saved.error ? creator.listPresets(saved.workspace) : [];
      const report = ctx.seats.replacePresetGroup('persona-builder', presets) || {};
      return {
        error: null,
        registered: Array.isArray(report.registered) ? report.registered : [],
        skipped: Array.isArray(report.skipped) ? report.skipped : [],
      };
    } catch (err) { return { error: err, registered: [], skipped: [] }; }
  };
  const presetSyncIssue = (result) => {
    if (result.error) return result.error.message;
    if (!result.skipped.length) return null;
    return result.skipped.map((item) =>
      `${item.name || 'Unnamed preset'} (${item.reason || 'could not be registered'})`).join(', ');
  };

  const publishStatus = () => ctx.bus.post('personaWorkspaceStatus', workspaceStatus(ctx.stateDir));
  const publishFoundation = () =>
    ctx.bus.post('personaFoundationStatus', foundationStatus(ctx.stateDir));
  const publishDraftList = () => {
    try {
      const workspace = interviewWorkspace(ctx.stateDir);
      const listed = drafts.listDrafts(ctx.stateDir, workspace);
      ctx.bus.post('personaDraftList', { workspace, cards: CARDS, ...listed, error: null });
    } catch (err) {
      ctx.bus.post('personaDraftList', {
        workspace: null,
        cards: CARDS,
        drafts: [],
        warnings: [],
        error: err.message,
      });
    }
  };
  const draftFailure = (action, err) => {
    ctx.bus.post('personaDraftResult', {
      ok: false,
      action,
      conflict: err.code === 'DRAFT_CONFLICT',
      error: err.message,
    });
    ctx.bus.post('toast', { text: 'Persona draft was not changed: ' + err.message });
  };
  const postDraftStatus = (draft) => ctx.bus.post('personaDraftStatus', {
    draft,
    cards: CARDS,
    suggestedPersonaId: previewRenderer.normalizePersonaId(draft.name),
  });
  const previewFailure = (action, err, extra) => {
    ctx.bus.post('personaPreviewResult', { ok: false, action, error: err.message, ...(extra || {}) });
    if (!extra || !extra.needsConfirmation)
      ctx.bus.post('toast', { text: 'Persona preview was not changed: ' + err.message });
  };
  const currentWorkspaceDraft = (id) => {
    const workspace = interviewWorkspace(ctx.stateDir);
    const draft = drafts.readDraft(ctx.stateDir, id);
    if (path.resolve(draft.workspace) !== path.resolve(workspace))
      throw new Error('Draft belongs to a different workspace.');
    return draft;
  };

  ctx.bus.on('personaWorkspaceGet', publishStatus);
  ctx.bus.on('personaFoundationGet', publishFoundation);
  ctx.bus.on('personaDraftListGet', publishDraftList);
  ctx.bus.on('personaWorkspaceChoose', async () => {
    try {
      const current = readWorkspaceConfig(ctx.stateDir).workspace;
      const selected = await ctx.pickDirectory({
        title: 'Choose a Persona Builder workspace',
        defaultPath: current || undefined,
      });
      if (selected) {
        writeWorkspaceConfig(ctx.stateDir, selected);
        const presetIssue = presetSyncIssue(syncPresets());
        if (presetIssue)
          ctx.bus.post('toast', { text: 'Persona workspace changed, but some presets could not refresh: ' + presetIssue });
      }
      publishStatus();
    } catch (err) {
      ctx.bus.post('toast', { text: 'Persona workspace was not changed: ' + err.message });
      publishStatus();
    }
  });

  ctx.bus.on('personaFoundationCreate', (message) => {
    try {
      foundation.createFoundation(selectedWorkspace(ctx.stateDir), message && message.content);
      ctx.bus.post('personaFoundationResult', { ok: true, action: 'created' });
      publishFoundation();
      publishStatus();
    } catch (err) {
      ctx.bus.post('personaFoundationResult', { ok: false, action: 'create', error: err.message });
      ctx.bus.post('toast', { text: 'Shared foundation was not created: ' + err.message });
    }
  });

  ctx.bus.on('personaFoundationSave', (message) => {
    try {
      foundation.saveFoundation(
        selectedWorkspace(ctx.stateDir),
        message && message.content,
        message && message.expectedRevision
      );
      ctx.bus.post('personaFoundationResult', { ok: true, action: 'saved' });
      publishFoundation();
      publishStatus();
    } catch (err) {
      ctx.bus.post('personaFoundationResult', {
        ok: false,
        action: 'save',
        conflict: err.code === 'FOUNDATION_CONFLICT',
        error: err.message,
      });
      ctx.bus.post('toast', { text: 'Shared foundation was not saved: ' + err.message });
    }
  });

  ctx.bus.on('personaDraftCreate', (message) => {
    try {
      const draft = drafts.createDraft(ctx.stateDir, interviewWorkspace(ctx.stateDir), {
        name: message && message.name,
        useCase: message && message.useCase,
      });
      ctx.bus.post('personaDraftResult', { ok: true, action: 'created' });
      postDraftStatus(draft);
    } catch (err) { draftFailure('create', err); }
  });

  ctx.bus.on('personaDraftOpen', (message) => {
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      postDraftStatus(draft);
    } catch (err) { draftFailure('open', err); }
  });

  ctx.bus.on('personaDraftSave', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      const draft = drafts.updateDraft(
        ctx.stateDir,
        current.id,
        message && message.expectedRevision,
        message && message.changes
      );
      ctx.bus.post('personaDraftResult', { ok: true, action: 'saved' });
      postDraftStatus(draft);
    } catch (err) { draftFailure('save', err); }
  });

  ctx.bus.on('personaDraftDelete', (message) => {
    try {
      if (!message || message.confirmed !== true)
        throw new Error('Draft deletion requires explicit confirmation.');
      const workspace = interviewWorkspace(ctx.stateDir);
      drafts.deleteDraft(ctx.stateDir, message.id, workspace);
      ctx.bus.post('personaDraftResult', { ok: true, action: 'deleted' });
      publishDraftList();
    } catch (err) { draftFailure('delete', err); }
  });

  ctx.bus.on('personaPreviewGenerate', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      const stale = current.preview &&
        current.preview.sourceHash !== previewRenderer.draftSourceHash(current);
      const bundle = previewRenderer.renderBundle(current, {
        personaId: message && message.personaId,
        mode: message && message.mode,
        actions: message && message.actions,
        collaboration: message && message.collaboration,
      });
      const replacesCanonical = current.preview &&
        bundle.canonical !== current.preview.canonical;
      if (current.preview && (current.preview.canonicalDrift || stale || replacesCanonical) &&
          (!message || message.confirmedOverwrite !== true)) {
        const err = new Error('Regenerating everything will replace manual canonical edits or newer interview work.');
        previewFailure('generate', err, { needsConfirmation: true });
        return;
      }
      const draft = drafts.updateDraft(ctx.stateDir, current.id,
        message && message.expectedRevision, { preview: bundle });
      ctx.bus.post('personaPreviewResult', { ok: true, action: 'generated' });
      ctx.bus.post('personaPreviewStatus', { draft, bundle: draft.preview, stale: false });
    } catch (err) { previewFailure('generate', err); }
  });

  ctx.bus.on('personaPreviewOpen', (message) => {
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      if (!draft.preview) throw new Error('Generate a preview first.');
      ctx.bus.post('personaPreviewStatus', {
        draft,
        bundle: draft.preview,
        stale: draft.preview.sourceHash !== previewRenderer.draftSourceHash(draft),
      });
    } catch (err) { previewFailure('open', err); }
  });

  ctx.bus.on('personaPreviewSaveCanonical', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      const bundle = previewRenderer.withCanonicalEdit(current.preview, message && message.canonical);
      const draft = drafts.updateDraft(ctx.stateDir, current.id,
        message && message.expectedRevision, { preview: bundle });
      ctx.bus.post('personaPreviewResult', { ok: true, action: 'canonical-saved' });
      ctx.bus.post('personaPreviewStatus', {
        draft,
        bundle: draft.preview,
        stale: draft.preview.sourceHash !== previewRenderer.draftSourceHash(draft),
      });
    } catch (err) { previewFailure('canonical-save', err); }
  });

  ctx.bus.on('personaPreviewRegenerateSection', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      if (!current.preview) throw new Error('Generate a preview first.');
      const key = message && message.key;
      const area = current.preview.blueprint && current.preview.blueprint[key];
      if (!area || typeof area.response !== 'string')
        throw new Error('Blueprint section is unavailable: ' + key);
      const bundle = previewRenderer.regenerateSection(current.preview, key, area.response);
      const draft = drafts.updateDraft(ctx.stateDir, current.id,
        message && message.expectedRevision, { preview: bundle });
      ctx.bus.post('personaPreviewResult', { ok: true, action: 'section-regenerated' });
      ctx.bus.post('personaPreviewStatus', {
        draft,
        bundle: draft.preview,
        stale: draft.preview.sourceHash !== previewRenderer.draftSourceHash(draft),
      });
    } catch (err) { previewFailure('section-regenerate', err); }
  });

  ctx.bus.on('personaPreviewValidate', (message) => {
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      const workspace = interviewWorkspace(ctx.stateDir);
      const foundationText = foundation.inspectFoundation(workspace).content;
      ctx.bus.post('personaValidationStatus', {
        draftId: draft.id,
        report: previewValidator.validatePreview(workspace, draft, foundationText),
      });
    } catch (err) {
      ctx.bus.post('personaValidationStatus', {
        draftId: null,
        report: { valid: false, errors: [{ severity: 'error', code: 'validation', message: err.message }], warnings: [], suggestions: [] },
      });
    }
  });

  ctx.bus.on('personaPreviewAcceptCanonical', (message) => {
    try {
      const current = currentWorkspaceDraft(message && message.id);
      const bundle = previewRenderer.acceptCanonical(current.preview);
      const draft = drafts.updateDraft(ctx.stateDir, current.id,
        message && message.expectedRevision, { preview: bundle });
      ctx.bus.post('personaPreviewResult', { ok: true, action: 'canonical-accepted' });
      ctx.bus.post('personaPreviewStatus', {
        draft,
        bundle: draft.preview,
        stale: draft.preview.sourceHash !== previewRenderer.draftSourceHash(draft),
      });
    } catch (err) { previewFailure('canonical-accept', err); }
  });

  ctx.bus.on('personaImportChoose', async () => {
    try {
      const selected = await ctx.pickDirectory({ title: 'Choose a legacy persona folder' });
      if (!selected) return;
      activeImportAudit = importer.auditImportFolder(selected);
      ctx.bus.post('personaImportAudit', activeImportAudit);
    } catch (err) {
      activeImportAudit = null;
      ctx.bus.post('personaImportResult', { ok: false, action: 'audit', error: err.message });
      ctx.bus.post('toast', { text: 'Persona import could not be audited: ' + err.message });
    }
  });

  ctx.bus.on('personaImportCreateDraft', (message) => {
    try {
      if (!activeImportAudit || !message ||
          path.resolve(message.sourceFolder || '') !== path.resolve(activeImportAudit.sourceFolder))
        throw new Error('Choose and audit the import folder again.');
      if (activeImportAudit.errors.length)
        throw new Error('Resolve blocking import errors before creating a draft.');
      const answers = importer.answersFromMapping(activeImportAudit, message.mapping);
      const workspace = interviewWorkspace(ctx.stateDir);
      let draft = null;
      try {
        draft = drafts.createDraft(ctx.stateDir, workspace, {
          name: message.name,
          useCase: message.useCase,
        });
        draft = drafts.updateDraft(ctx.stateDir, draft.id, draft.revision, { answers });
      } catch (err) {
        if (draft) {
          try { drafts.deleteDraft(ctx.stateDir, draft.id, workspace); } catch (_) { /* best effort */ }
        }
        throw err;
      }
      activeImportAudit = null;
      ctx.bus.post('personaImportResult', { ok: true, action: 'draft-created' });
      postDraftStatus(draft);
    } catch (err) {
      ctx.bus.post('personaImportResult', { ok: false, action: 'create-draft', error: err.message });
      ctx.bus.post('toast', { text: 'Imported draft was not created: ' + err.message });
    }
  });

  const testFailure = (error) => {
    const run = activeTest;
    activeTest = null;
    if (run && run.controller) run.controller.close();
    ctx.bus.post('personaTestStatus', { phase: 'error', error: error.message || String(error) });
  };

  ctx.bus.on('personaTestPrepare', (message) => {
    if (activeTest) {
      ctx.bus.post('personaTestStatus', {
        phase: 'rejected', error: 'Stop the active disposable test before preparing another.',
      });
      return;
    }
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      const workspace = interviewWorkspace(ctx.stateDir);
      const foundationText = foundation.inspectFoundation(workspace).content;
      const report = previewValidator.validatePreview(workspace, draft, foundationText);
      if (!report.valid)
        throw new Error('Resolve blocking preview validation errors before testing.');
      const cases = tester.buildCases(draft);
      const usage = ctx.usage && typeof ctx.usage.claudeSnapshot === 'function'
        ? ctx.usage.claudeSnapshot() : null;
      const usageFresh = Boolean(usage && usage.asOf && !usage.stale &&
        Date.now() - usage.asOf <= 5 * 60 * 1000);
      preparedTest = {
        draftId: draft.id,
        revision: draft.revision,
        preparedAt: Date.now(),
        sourceHash: draft.preview.generatedCanonicalHash,
        kickoff: tester.buildKickoff(draft, foundationText),
        cases,
      };
      ctx.bus.post('personaTestPrepared', {
        draftId: draft.id,
        revision: draft.revision,
        cases,
        usage: usage ? {
          session: usage.session || null,
          weekly: usage.weekly || null,
          asOf: usage.asOf || null,
          stale: !usageFresh,
        } : null,
        requiresApproval: true,
      });
    } catch (err) {
      preparedTest = null;
      ctx.bus.post('personaTestStatus', { phase: 'error', error: err.message });
    }
  });

  ctx.bus.on('personaTestStart', (message) => {
    let startingRun = null;
    try {
      if (!message || message.approved !== true)
        throw new Error('Starting a disposable Claude test requires explicit approval after the usage check.');
      if (!preparedTest || message.id !== preparedTest.draftId ||
          message.expectedRevision !== preparedTest.revision)
        throw new Error('Prepare the disposable test again from the current draft.');
      if (Date.now() - preparedTest.preparedAt > TEST_PREPARE_TTL_MS)
        throw new Error('The usage check expired; prepare the disposable test again.');
      if (activeTest) throw new Error('A disposable test is already running.');
      if (!ctx.seats || typeof ctx.seats.startDisposable !== 'function')
        throw new Error('Disposable seat service is unavailable.');
      const current = currentWorkspaceDraft(message.id);
      if (current.revision !== preparedTest.revision ||
          current.preview.generatedCanonicalHash !== preparedTest.sourceHash)
        throw new Error('The draft changed; prepare the test again.');

      const run = {
        controller: null,
        cases: preparedTest.cases,
        index: -1,
        phase: 'boot',
        toolsVerified: false,
        finalText: '',
        deltaText: '',
      };
      startingRun = run;
      completedTest = null;
      const sendCase = () => {
        run.index++;
        if (run.index >= run.cases.length) {
          completedTest = {
            draftId: current.id,
            revision: current.revision,
            canonicalHash: current.preview.generatedCanonicalHash,
          };
          activeTest = null;
          run.controller.close();
          ctx.bus.post('personaTestStatus', { phase: 'complete', total: run.cases.length });
          return;
        }
        run.phase = 'case';
        run.finalText = '';
        run.deltaText = '';
        const currentCase = run.cases[run.index];
        ctx.bus.post('personaTestStatus', {
          phase: 'running', index: run.index, total: run.cases.length, caseId: currentCase.id,
        });
        run.controller.send(currentCase.prompt);
      };
      const onEvent = (event) => {
        if (activeTest !== run) return;
        if (event.type === 'init') {
          if (!Array.isArray(event.tools) || event.tools.length !== 0) {
            testFailure(new Error('Disposable seat did not launch with an empty tool list.'));
            return;
          }
          run.toolsVerified = true;
        } else if (event.type === 'text')
          run.finalText += (run.finalText ? '\n\n' : '') + (event.text || '');
        else if (event.type === 'delta') run.deltaText += event.text || '';
        else if (event.type === 'permission' || event.type === 'tool') {
          testFailure(new Error('Disposable test requested an unavailable tool; the test was stopped.'));
        } else if (event.type === 'result') {
          if (!event.ok) { testFailure(new Error('Disposable test turn failed.')); return; }
          const answer = (run.finalText || run.deltaText).trim();
          if (run.phase === 'boot') {
            if (!run.toolsVerified) {
              testFailure(new Error('Disposable seat tool isolation was not verified.'));
              return;
            }
            if (!answer.includes('TEST-SEAT-READY')) {
              testFailure(new Error('Disposable seat did not accept the draft persona cleanly.'));
              return;
            }
            sendCase();
            return;
          }
          const completedCase = run.cases[run.index];
          ctx.bus.post('personaTestCaseResult', {
            index: run.index,
            caseId: completedCase.id,
            prompt: completedCase.prompt,
            expected: completedCase.expected,
            response: answer || '(no text response)',
          });
          sendCase();
        } else if (event.type === 'dead') {
          testFailure(new Error('Disposable seat exited before the test completed.'));
        }
      };
      activeTest = run;
      run.controller = ctx.seats.startDisposable({
        kickoff: preparedTest.kickoff,
        onEvent,
      });
      preparedTest = null;
      ctx.bus.post('personaTestStatus', { phase: 'starting', total: run.cases.length });
    } catch (err) {
      if (startingRun && activeTest === startingRun) testFailure(err);
      else ctx.bus.post('personaTestStatus', { phase: 'rejected', error: err.message });
    }
  });

  ctx.bus.on('personaTestStop', () => {
    if (!activeTest) return;
    const run = activeTest;
    activeTest = null;
    run.controller.close();
    ctx.bus.post('personaTestStatus', { phase: 'stopped' });
  });

  ctx.bus.on('personaCreatePermanent', (message) => {
    try {
      if (!message || message.confirmed !== true)
        throw new Error('Permanent persona creation requires explicit confirmation.');
      const draft = currentWorkspaceDraft(message.id);
      if (message.expectedRevision !== draft.revision)
        throw new Error('The draft changed; reopen it before permanent creation.');
      if (!completedTest || completedTest.draftId !== draft.id ||
          completedTest.revision !== draft.revision ||
          completedTest.canonicalHash !== draft.preview.generatedCanonicalHash)
        throw new Error('Complete the disposable test for this exact draft before permanent creation.');
      const workspace = interviewWorkspace(ctx.stateDir);
      const foundationText = foundation.inspectFoundation(workspace).content;
      const report = previewValidator.validatePreview(workspace, draft, foundationText);
      if (!report.valid)
        throw new Error('Resolve blocking preview validation errors before permanent creation.');
      if (!ctx.seats || typeof ctx.seats.checkPresetNames !== 'function')
        throw new Error('Permanent seat preset name checking is unavailable.');
      const conflicts = ctx.seats.checkPresetNames('persona-builder', [draft.name]);
      if (conflicts.length) {
        const conflict = conflicts[0];
        throw new Error(`Seat preset name cannot be registered: ${conflict.name} (${conflict.reason}).`);
      }
      const created = creator.createPackage(workspace, draft);
      const presetResult = syncPresets();
      const skippedCreatedPreset = presetResult.skipped.find((item) =>
        String(item.name || '').toLowerCase() === created.displayName.toLowerCase());
      const registrationError = presetResult.error
        ? presetResult.error.message
        : skippedCreatedPreset
          ? `${skippedCreatedPreset.name} (${skippedCreatedPreset.reason})`
          : null;
      completedTest = null;
      ctx.bus.post('personaCreateResult', {
        ok: true,
        presetRegistered: !registrationError,
        registrationError,
        personaId: created.personaId,
        displayName: created.displayName,
        personaDir: created.paths.personaDir,
        warnings: report.warnings,
        suggestions: report.suggestions,
      });
      if (registrationError)
        ctx.bus.post('toast', { text: 'Persona package was created, but its seat preset was not registered: ' + registrationError });
      publishStatus();
      publishPackageList();   // a created/edited persona joins the manage list
    } catch (err) {
      ctx.bus.post('personaCreateResult', { ok: false, error: err.message });
      ctx.bus.post('toast', { text: 'Permanent persona was not created: ' + err.message });
    }
  });

  // ---- relationship recommendations (accepted chips fill the collaboration
  // contract; accepted routes land as Task Board templates via taskRouteSave) ----
  let activeRelSeat = null;   // one LLM suggestion pass at a time

  ctx.bus.on('personaProjectContextGet', () => {
    try {
      const workspace = selectedWorkspace(ctx.stateDir);
      ctx.bus.post('personaProjectContext', {
        content: relationships.readProjectContext(workspace), error: null });
    } catch (err) {
      ctx.bus.post('personaProjectContext', { content: '', error: err.message });
    }
  });

  ctx.bus.on('personaProjectContextSave', (message) => {
    try {
      const workspace = selectedWorkspace(ctx.stateDir);
      const content = relationships.saveProjectContext(workspace, message && message.content);
      ctx.bus.post('personaProjectContext', { content, error: null, saved: true });
    } catch (err) {
      ctx.bus.post('toast', { text: 'Project context was not saved: ' + err.message });
    }
  });

  ctx.bus.on('personaRelSuggest', (message) => {
    try {
      const draft = currentWorkspaceDraft(message && message.id);
      const workspace = interviewWorkspace(ctx.stateDir);
      const summaries = relationships.personaSummaries(workspace, creator);
      const { suggestions, routes } = relationships.heuristicSuggestions(draft, summaries);
      ctx.bus.post('personaRelSuggestions', {
        draftId: draft.id, suggestions, routes, source: 'heuristic', error: null });
    } catch (err) {
      ctx.bus.post('personaRelSuggestions', {
        draftId: message && message.id, suggestions: [], routes: [],
        source: 'heuristic', error: err.message });
    }
  });

  ctx.bus.on('personaRelSuggestLlm', (message) => {
    try {
      if (!message || message.approved !== true)
        throw new Error('The AI suggestion pass runs a hidden Claude session — it needs explicit approval.');
      if (activeRelSeat) throw new Error('An AI suggestion pass is already running.');
      if (!ctx.seats || typeof ctx.seats.startDisposable !== 'function')
        throw new Error('Disposable seat service is unavailable.');
      const draft = currentWorkspaceDraft(message.id);
      const workspace = interviewWorkspace(ctx.stateDir);
      const summaries = relationships.personaSummaries(workspace, creator);
      const knownNames = [draft.name, ...summaries.map((s) => s.name)];
      const prompt = relationships.buildPrompt(draft, summaries,
        relationships.readProjectContext(workspace));
      let finalText = '';
      const done = (payload) => {
        if (!activeRelSeat) return;
        const seat = activeRelSeat;
        activeRelSeat = null;
        clearTimeout(seat.backstop);
        try { seat.controller.close(); } catch { /* already gone */ }
        ctx.bus.post('personaRelSuggestions', {
          draftId: draft.id, source: 'llm', suggestions: [], routes: [], error: null,
          ...payload });
      };
      const controller = ctx.seats.startDisposable({
        kickoff: prompt,
        onEvent: (event) => {
          if (!activeRelSeat) return;
          if (event.type === 'text') finalText += (finalText ? '\n\n' : '') + (event.text || '');
          else if (event.type === 'result') {
            const parsed = relationships.parseLlmReply(finalText, knownNames);
            done(parsed.error ? { error: parsed.error }
                              : { suggestions: parsed.suggestions, routes: parsed.routes });
          } else if (event.type === 'dead') {
            done({ error: 'the suggestion seat exited before answering' });
          }
        },
      });
      activeRelSeat = {
        controller,
        backstop: setTimeout(() => done({ error: 'the suggestion pass timed out' }), 120000),
      };
      ctx.bus.post('personaRelStatus', { phase: 'running' });
    } catch (err) {
      ctx.bus.post('personaRelSuggestions', {
        draftId: message && message.id, suggestions: [], routes: [],
        source: 'llm', error: err.message });
    }
  });

  // ---- permanent-package management: list, edit (reopen-as-draft), delete ----
  const publishPackageList = () => {
    try {
      const workspace = selectedWorkspace(ctx.stateDir);
      ctx.bus.post('personaPackageList', { packages: manage.listPackages(workspace), error: null });
    } catch (err) {
      ctx.bus.post('personaPackageList', { packages: [], error: err.message });
    }
  };

  ctx.bus.on('personaManageList', publishPackageList);

  ctx.bus.on('personaPackageEdit', (message) => {
    try {
      const workspace = interviewWorkspace(ctx.stateDir);
      const draft = manage.reopenAsDraft(workspace, message && message.personaId, ctx.stateDir);
      ctx.bus.post('personaDraftResult', { ok: true, action: 'reopened' });
      postDraftStatus(draft);   // jumps the UI into the interview flow on this draft
    } catch (err) {
      ctx.bus.post('personaManageResult', { ok: false, action: 'edit', error: err.message });
      ctx.bus.post('toast', { text: 'Could not open the persona for editing: ' + err.message });
    }
  });

  ctx.bus.on('personaPackageArchive', (message) => {
    try {
      if (!message || message.confirmed !== true)
        throw new Error('Deleting a persona requires explicit confirmation.');
      const workspace = selectedWorkspace(ctx.stateDir);
      const dest = creator.archivePackage(workspace, message.personaId);
      const presetIssue = presetSyncIssue(syncPresets());
      ctx.bus.post('personaManageResult', {
        ok: true, action: 'archived', personaId: message.personaId, archivedTo: dest });
      ctx.bus.post('toast', { text: 'Persona archived (memory kept) — recover it from personas/.archive/' +
        path.basename(dest) + ' if needed.' });
      if (presetIssue)
        ctx.bus.post('toast', { text: 'Preset refresh note: ' + presetIssue });
      publishPackageList();
      publishStatus();
    } catch (err) {
      ctx.bus.post('personaManageResult', { ok: false, action: 'archive', error: err.message });
      ctx.bus.post('toast', { text: 'Persona was not archived: ' + err.message });
    }
  });

  ctx.bus.on('ready', () => {
    const presetIssue = presetSyncIssue(syncPresets());
    if (presetIssue)
      ctx.bus.post('toast', { text: 'Some Persona Builder seat presets were not registered: ' + presetIssue });
    publishPackageList();
  });
}

module.exports = {
  register,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  workspaceStatus,
  selectedWorkspace,
  foundationStatus,
  interviewWorkspace,
};

