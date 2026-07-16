// Persona Builder — first-run workspace onboarding dock.
'use strict';
(function () {
  const pane = document.createElement('div');
  pane.className = 'sidePane dockPane personaBuilderPane';
  pane.id = 'dock-personas';
  pane.dataset.tab = 'personas';
  pane.dataset.order = '20';
  pane.innerHTML =
    '<div class="paneBody personaBuilderBody">' +
      '<div class="personaBuilderKicker">PERSONA BUILDER</div>' +
      '<h2>Give personas a home.</h2>' +
      '<p class="personaBuilderIntro">Choose one folder for the shared foundation, persona packages, and future wiki. The workspace stays portable and separate from model or provider settings.</p>' +
      '<section class="personaWorkspaceCard" aria-live="polite">' +
        '<div class="personaWorkspaceLabel">WORKSPACE</div>' +
        '<div class="personaWorkspaceState">Checking…</div>' +
        '<div class="personaWorkspacePath"></div>' +
        '<div class="personaWorkspaceChecks"></div>' +
      '</section>' +
      '<button class="personaWorkspaceChoose" type="button">CHOOSE WORKSPACE</button>' +
      '<section class="personaFoundationCard" aria-live="polite" hidden>' +
        '<div class="personaWorkspaceLabel">SHARED FOUNDATION</div>' +
        '<div class="personaFoundationState"></div>' +
        '<p class="personaFoundationHelp">Rules every persona inherits. Review the portable default or edit an existing foundation; nothing saves without this button.</p>' +
        '<textarea class="personaFoundationEditor" spellcheck="true" aria-label="Shared foundation rules"></textarea>' +
        '<button class="personaFoundationAction" type="button"></button>' +
        '<div class="personaFoundationConflict" hidden>' +
          '<button class="personaFoundationLoadDisk" type="button">LOAD DISK VERSION</button>' +
          '<button class="personaFoundationKeepEdit" type="button">KEEP MY EDIT</button>' +
        '</div>' +
        '<label class="personaFieldLabel" for="personaProjectContext">WHAT ARE YOU BUILDING? — OPTIONAL</label>' +
        '<textarea class="personaProjectContext" id="personaProjectContext" maxlength="8000" placeholder="A sentence or two about the system this team of personas works on. Used only to tailor relationship suggestions — never injected into a persona’s identity."></textarea>' +
        '<button class="personaProjectContextSave" type="button">SAVE PROJECT CONTEXT</button>' +
      '</section>' +
      '<section class="personaManageCard" hidden>' +
        '<div class="personaWorkspaceLabel">YOUR PERSONAS</div>' +
        '<p class="personaManageHelp">Every persona in this workspace — built here or imported. EDIT reopens the interview to change identity; RUNTIME sets model/effort/permissions (the AI-bar seat defaults); DELETE archives the persona and keeps its memory.</p>' +
        '<div class="personaManageList"></div>' +
      '</section>' +
      '<section class="personaDraftHome" hidden>' +
        '<div class="personaWorkspaceLabel">PERSONA DRAFTS</div>' +
        '<h3>Start with a name and a purpose.</h3>' +
        '<p class="personaDraftHelp">The name is the persona’s label. The six cards that follow define the deeper identity, role, style, boundaries, working method, and action posture.</p>' +
        '<label class="personaFieldLabel" for="personaDraftName">PERSONA NAME</label>' +
        '<input class="personaDraftName" id="personaDraftName" maxlength="80" placeholder="Example: Rowan" />' +
        '<label class="personaFieldLabel" for="personaDraftUseCase">ONE-SENTENCE USE CASE</label>' +
        '<textarea class="personaDraftUseCase" id="personaDraftUseCase" maxlength="240" placeholder="Example: Independently review code changes and return evidence-backed findings."></textarea>' +
        '<button class="personaDraftCreate" type="button" disabled>START INTERVIEW</button>' +
        '<button class="personaImportChoose" type="button">AUDIT LEGACY PERSONA</button>' +
        '<section class="personaImportAudit" hidden>' +
          '<div class="personaInterviewSubhead">READ-ONLY IMPORT AUDIT</div>' +
          '<div class="personaImportSource"></div>' +
          '<label class="personaFieldLabel" for="personaImportName">DRAFT NAME</label><input class="personaImportName" id="personaImportName" maxlength="80" />' +
          '<label class="personaFieldLabel" for="personaImportUseCase">ONE-SENTENCE USE CASE</label><textarea class="personaImportUseCase" id="personaImportUseCase" maxlength="240"></textarea>' +
          '<div class="personaImportFindings"></div>' +
          '<div class="personaImportMappings"></div>' +
          '<button class="personaImportCreate" type="button">CREATE MAPPED DRAFT</button>' +
        '</section>' +
        '<div class="personaDraftResumeBlock">' +
          '<div class="personaDraftResumeLabel">RESUME A SAVED DRAFT</div>' +
          '<select class="personaDraftSelect" aria-label="Saved persona drafts"></select>' +
          '<button class="personaDraftResume" type="button">RESUME</button>' +
          '<button class="personaDraftDelete" type="button">DELETE DRAFT</button>' +
          '<div class="personaDraftWarnings"></div>' +
        '</div>' +
      '</section>' +
      '<section class="personaInterview" aria-live="polite" hidden>' +
        '<div class="personaInterviewTop"><span class="personaInterviewStep"></span><span class="personaInterviewName"></span></div>' +
        '<h3 class="personaInterviewTitle"></h3>' +
        '<div class="personaInterviewQuestion"></div>' +
        '<p class="personaInterviewExplanation"></p>' +
        '<div class="personaInterviewSubhead">A USEFUL ANSWER INCLUDES</div>' +
        '<ul class="personaInterviewInclude"></ul>' +
        '<div class="personaInterviewSubhead">THOUGHT-STARTERS</div>' +
        '<div class="personaInterviewSuggestions"></div>' +
        '<div class="personaInterviewSubhead">COMPLETE EXAMPLE</div>' +
        '<div class="personaInterviewExample"></div>' +
        '<label class="personaFieldLabel" for="personaInterviewAnswer">YOUR ANSWER</label>' +
        '<textarea class="personaInterviewAnswer" id="personaInterviewAnswer" maxlength="12000"></textarea>' +
        '<div class="personaInterviewHelp"></div>' +
        '<div class="personaInterviewError"></div>' +
        '<div class="personaInterviewActions">' +
          '<button class="personaInterviewDrafts" type="button">DRAFTS</button>' +
          '<button class="personaInterviewBack" type="button">BACK</button>' +
          '<button class="personaInterviewNext" type="button">SAVE &amp; NEXT</button>' +
        '</div>' +
      '</section>' +
      '<section class="personaPreviewSetup" aria-live="polite" hidden>' +
        '<div class="personaWorkspaceLabel">BLUEPRINT SETUP</div>' +
        '<h3>Make the structured choices explicit.</h3>' +
        '<p class="personaDraftHelp">The interview prose describes intent. These fields create the safe machine-readable contract; the builder will not guess permissions from prose.</p>' +
        '<label class="personaFieldLabel" for="personaPreviewId">PERSONA ID — LOWERCASE KEBAB-CASE</label>' +
        '<input class="personaPreviewId" id="personaPreviewId" maxlength="64" />' +
        '<label class="personaFieldLabel" for="personaPreviewMode">ACTION POSTURE</label>' +
        '<select class="personaPreviewMode" id="personaPreviewMode">' +
          '<option value="">Choose a posture</option><option value="advisor">Advisor</option>' +
          '<option value="assisted-operator">Assisted operator</option><option value="operator">Operator</option>' +
          '<option value="automated-worker">Automated worker</option>' +
        '</select>' +
        '<div class="personaActionHeading">FOR EACH CATEGORY: ALLOWED · ASK · BLOCKED</div>' +
        '<div class="personaActionGrid">' +
          '<label>Read files<select class="personaAction-read_files"><option value="">Choose</option><option>allowed</option><option>ask</option><option>blocked</option></select></label>' +
          '<label>Edit files<select class="personaAction-edit_files"><option value="">Choose</option><option>allowed</option><option>ask</option><option>blocked</option></select></label>' +
          '<label>Run commands<select class="personaAction-run_commands"><option value="">Choose</option><option>allowed</option><option>ask</option><option>blocked</option></select></label>' +
          '<label>Search web<select class="personaAction-search_web"><option value="">Choose</option><option>allowed</option><option>ask</option><option>blocked</option></select></label>' +
          '<label>Use connectors<select class="personaAction-use_connectors"><option value="">Choose</option><option>allowed</option><option>ask</option><option>blocked</option></select></label>' +
          '<label>Send externally<select class="personaAction-send_external"><option value="">Choose</option><option>allowed</option><option>ask</option><option>blocked</option></select></label>' +
          '<label>Change system<select class="personaAction-change_system"><option value="">Choose</option><option>allowed</option><option>ask</option><option>blocked</option></select></label>' +
          '<label>Delete data<select class="personaAction-delete_data"><option value="">Choose</option><option>allowed</option><option>ask</option><option>blocked</option></select></label>' +
        '</div>' +
        '<label class="personaCollaborationToggle"><input class="personaCollaborationEnabled" type="checkbox" /> ADD A COLLABORATION CONTRACT</label>' +
        '<div class="personaCollaborationEditor" hidden>' +
          '<p class="personaCollaborationHelp">Default access controls whether a teammate receives this persona’s handoff material read-only or may return edits; it is not public/private visibility. Capabilities are work this persona can provide, accepts are structured inputs it can consume, and emits are the artifacts it returns.</p>' +
          '<label class="personaFieldLabel" for="personaCollaborationAccess">DEFAULT HANDOFF ACCESS</label>' +
          '<select class="personaCollaborationAccess" id="personaCollaborationAccess"><option value="">Choose access</option><option value="read-only">Read-only</option><option value="read-write">Read-write</option></select>' +
          '<label class="personaFieldLabel" for="personaCapabilities">CAPABILITIES — ONE PER LINE</label><textarea class="personaCapabilities" id="personaCapabilities" maxlength="12000"></textarea>' +
          '<label class="personaFieldLabel" for="personaAccepts">ACCEPTS — ONE INPUT TYPE PER LINE</label><textarea class="personaAccepts" id="personaAccepts" maxlength="12000"></textarea>' +
          '<label class="personaFieldLabel" for="personaEmits">EMITS — ONE OUTPUT TYPE PER LINE</label><textarea class="personaEmits" id="personaEmits" maxlength="12000"></textarea>' +
        '</div>' +
        '<div class="personaRelBlock">' +
          '<div class="personaInterviewSubhead">RELATIONSHIP SUGGESTIONS</div>' +
          '<p class="personaRelHelp">Who should this persona work with? Suggestions come from the roles already in this workspace; accepting one fills the collaboration contract, and suggested routes become one-click Task Board templates.</p>' +
          '<div class="personaRelActions">' +
            '<button class="personaRelSuggest" type="button">SUGGEST RELATIONSHIPS</button>' +
            '<button class="personaRelSuggestLlm" type="button" title="Runs one hidden, tool-disabled Claude session to tailor suggestions to your project context.">AI SUGGEST (USES A SESSION)</button>' +
          '</div>' +
          '<div class="personaRelStatus"></div>' +
          '<div class="personaRelList"></div>' +
        '</div>' +
        '<div class="personaPreviewError"></div>' +
        '<div class="personaInterviewActions"><button class="personaPreviewSetupBack" type="button">BACK TO INTERVIEW</button><button class="personaPreviewGenerate" type="button">GENERATE PREVIEW</button></div>' +
      '</section>' +
      '<section class="personaPreviewReview" aria-live="polite" hidden>' +
        '<div class="personaWorkspaceLabel">BLUEPRINT + CANONICAL REVIEW</div>' +
        '<div class="personaPreviewState"></div>' +
        '<div class="personaInterviewSubhead">BLUEPRINT.JSON</div>' +
        '<pre class="personaBlueprintPreview"></pre>' +
        '<div class="personaCollaborationPreviewWrap" hidden><div class="personaInterviewSubhead">COLLABORATION.JSON</div><pre class="personaCollaborationPreview"></pre></div>' +
        '<label class="personaFieldLabel" for="personaCanonicalPreview">AUTHORITATIVE CANONICAL MARKDOWN</label>' +
        '<textarea class="personaCanonicalPreview" id="personaCanonicalPreview"></textarea>' +
        '<div class="personaPreviewEditState"></div>' +
        '<button class="personaCanonicalSave" type="button">SAVE CANONICAL EDIT</button>' +
        '<button class="personaCanonicalRestore" type="button">RESTORE SAVED</button>' +
        '<div class="personaSectionRegen"><select class="personaSectionSelect"></select><button class="personaSectionRegenerate" type="button">REGENERATE SECTION</button></div>' +
        '<div class="personaPreviewError personaPreviewReviewError"></div>' +
        '<div class="personaValidationBlock"><button class="personaValidatePreview" type="button">VALIDATE PREVIEW</button><button class="personaAcceptCanonical" type="button" hidden>ACCEPT MANUAL CANONICAL HASH</button><div class="personaValidationSummary"></div><div class="personaValidationFindings"></div></div>' +
        '<div class="personaTestBlock"><div class="personaInterviewSubhead">DISPOSABLE BEHAVIOR TEST</div><p class="personaTestExplain">Checks current Claude usage, then runs persona-derived prompts in a hidden tool-disabled session that is not saved or registered.</p><button class="personaTestPrepare" type="button">CHECK USAGE &amp; PREPARE</button><button class="personaTestStart" type="button" hidden>START DISPOSABLE TEST</button><button class="personaTestStop" type="button" hidden>STOP TEST</button><div class="personaTestSummary"></div><div class="personaTestResults"></div></div>' +
        '<div class="personaCreateBlock"><div class="personaInterviewSubhead">PERMANENT CREATION</div><p class="personaCreateExplain">Available after this exact draft completes its disposable test. Creation writes a new portable package atomically and adds its permanent seat preset. Existing persona folders are never overwritten.</p><button class="personaCreatePermanent" type="button" disabled>CREATE PERSONA</button><div class="personaCreateSummary"></div></div>' +
        '<div class="personaInterviewActions"><button class="personaPreviewDrafts" type="button">DRAFTS</button><button class="personaPreviewBack" type="button">BACK TO INTERVIEW</button><button class="personaPreviewRegenerateAll" type="button">REGENERATE ALL</button></div>' +
      '</section>' +
      '<p class="personaBuilderFoot">This setting stays on this Apex installation. Model, provider, credentials, and runtime permissions stay outside the personas you build.</p>' +
    '</div>' +
    '<div class="dockTab" data-tab="personas">PERSONAS</div>';

  const state = pane.querySelector('.personaWorkspaceState');
  const pathText = pane.querySelector('.personaWorkspacePath');
  const checks = pane.querySelector('.personaWorkspaceChecks');
  const choose = pane.querySelector('.personaWorkspaceChoose');
  const foundationCard = pane.querySelector('.personaFoundationCard');
  const foundationState = pane.querySelector('.personaFoundationState');
  const foundationEditor = pane.querySelector('.personaFoundationEditor');
  const foundationAction = pane.querySelector('.personaFoundationAction');
  const foundationConflict = pane.querySelector('.personaFoundationConflict');
  const foundationLoadDisk = pane.querySelector('.personaFoundationLoadDisk');
  const foundationKeepEdit = pane.querySelector('.personaFoundationKeepEdit');
  const draftHome = pane.querySelector('.personaDraftHome');
  const draftName = pane.querySelector('.personaDraftName');
  const draftUseCase = pane.querySelector('.personaDraftUseCase');
  const draftCreate = pane.querySelector('.personaDraftCreate');
  const importChoose = pane.querySelector('.personaImportChoose');
  const importAudit = pane.querySelector('.personaImportAudit');
  const importSource = pane.querySelector('.personaImportSource');
  const importName = pane.querySelector('.personaImportName');
  const importUseCase = pane.querySelector('.personaImportUseCase');
  const importFindings = pane.querySelector('.personaImportFindings');
  const importMappings = pane.querySelector('.personaImportMappings');
  const importCreate = pane.querySelector('.personaImportCreate');
  const draftSelect = pane.querySelector('.personaDraftSelect');
  const draftResume = pane.querySelector('.personaDraftResume');
  const draftDelete = pane.querySelector('.personaDraftDelete');
  const draftWarnings = pane.querySelector('.personaDraftWarnings');
  const interview = pane.querySelector('.personaInterview');
  const interviewStep = pane.querySelector('.personaInterviewStep');
  const interviewName = pane.querySelector('.personaInterviewName');
  const interviewTitle = pane.querySelector('.personaInterviewTitle');
  const interviewQuestion = pane.querySelector('.personaInterviewQuestion');
  const interviewExplanation = pane.querySelector('.personaInterviewExplanation');
  const interviewInclude = pane.querySelector('.personaInterviewInclude');
  const interviewSuggestions = pane.querySelector('.personaInterviewSuggestions');
  const interviewExample = pane.querySelector('.personaInterviewExample');
  const interviewAnswer = pane.querySelector('.personaInterviewAnswer');
  const interviewHelp = pane.querySelector('.personaInterviewHelp');
  const interviewError = pane.querySelector('.personaInterviewError');
  const interviewDrafts = pane.querySelector('.personaInterviewDrafts');
  const interviewBack = pane.querySelector('.personaInterviewBack');
  const interviewNext = pane.querySelector('.personaInterviewNext');
  const previewSetup = pane.querySelector('.personaPreviewSetup');
  const previewId = pane.querySelector('.personaPreviewId');
  const previewMode = pane.querySelector('.personaPreviewMode');
  const previewSetupBack = pane.querySelector('.personaPreviewSetupBack');
  const previewGenerate = pane.querySelector('.personaPreviewGenerate');
  const previewError = pane.querySelector('.personaPreviewError');
  const previewReview = pane.querySelector('.personaPreviewReview');
  const previewState = pane.querySelector('.personaPreviewState');
  const blueprintPreview = pane.querySelector('.personaBlueprintPreview');
  const canonicalPreview = pane.querySelector('.personaCanonicalPreview');
  const previewEditState = pane.querySelector('.personaPreviewEditState');
  const canonicalSave = pane.querySelector('.personaCanonicalSave');
  const canonicalRestore = pane.querySelector('.personaCanonicalRestore');
  const sectionSelect = pane.querySelector('.personaSectionSelect');
  const sectionRegenerate = pane.querySelector('.personaSectionRegenerate');
  const previewReviewError = pane.querySelector('.personaPreviewReviewError');
  const previewDrafts = pane.querySelector('.personaPreviewDrafts');
  const previewBack = pane.querySelector('.personaPreviewBack');
  const previewRegenerateAll = pane.querySelector('.personaPreviewRegenerateAll');
  const validatePreview = pane.querySelector('.personaValidatePreview');
  const acceptCanonical = pane.querySelector('.personaAcceptCanonical');
  const validationSummary = pane.querySelector('.personaValidationSummary');
  const validationFindings = pane.querySelector('.personaValidationFindings');
  const testPrepare = pane.querySelector('.personaTestPrepare');
  const testStart = pane.querySelector('.personaTestStart');
  const testStop = pane.querySelector('.personaTestStop');
  const testSummary = pane.querySelector('.personaTestSummary');
  const testResults = pane.querySelector('.personaTestResults');
  const createPermanent = pane.querySelector('.personaCreatePermanent');
  const createSummary = pane.querySelector('.personaCreateSummary');
  const actionCategories = ['read_files', 'edit_files', 'run_commands', 'search_web',
    'use_connectors', 'send_external', 'change_system', 'delete_data'];
  const actionSelects = Object.fromEntries(actionCategories.map((category) =>
    [category, pane.querySelector('.personaAction-' + category)]));
  const projectContext = pane.querySelector('.personaProjectContext');
  const projectContextSave = pane.querySelector('.personaProjectContextSave');
  const manageCard = pane.querySelector('.personaManageCard');
  const manageList = pane.querySelector('.personaManageList');
  const relSuggest = pane.querySelector('.personaRelSuggest');
  const relSuggestLlm = pane.querySelector('.personaRelSuggestLlm');
  const relStatus = pane.querySelector('.personaRelStatus');
  const relList = pane.querySelector('.personaRelList');
  const collaborationEnabled = pane.querySelector('.personaCollaborationEnabled');
  const collaborationEditor = pane.querySelector('.personaCollaborationEditor');
  const collaborationAccess = pane.querySelector('.personaCollaborationAccess');
  const collaborationCapabilities = pane.querySelector('.personaCapabilities');
  const collaborationAccepts = pane.querySelector('.personaAccepts');
  const collaborationEmits = pane.querySelector('.personaEmits');
  const collaborationPreviewWrap = pane.querySelector('.personaCollaborationPreviewWrap');
  const collaborationPreview = pane.querySelector('.personaCollaborationPreview');
  let choosing = false;
  let foundationBusy = false;
  let foundationExists = false;
  let foundationRevision = null;
  let foundationBaseline = '';
  let foundationWorkspace = null;
  let conflictDraft = null;
  let interviewCards = [];
  let currentDraft = null;
  let draftBusy = false;
  let draftConflict = false;
  let pendingDraftHome = false;
  let pendingPreviewSetup = false;
  let deleteArmedId = null;
  let suggestedPersonaId = '';
  let previewBundle = null;
  let previewBusy = false;
  let previewConfirmOverwrite = false;
  let canonicalDirty = false;
  let activeImportAudit = null;
  let importMapSelects = [];
  let preparedTest = null;
  let testRows = new Map();
  let testRunning = false;
  let createArmed = false;
  let testCompletedForPreview = false;

  function setChoosing(value) {
    choosing = value;
    choose.disabled = value;
    choose.textContent = value ? 'CHOOSING…' : 'CHOOSE WORKSPACE';
  }

  function renderWorkspace(status) {
    setChoosing(false);
    pathText.textContent = status.workspace || 'No folder selected';
    if (status.error) {
      foundationWorkspace = null;
      foundationCard.hidden = true;
      state.textContent = 'Needs attention';
      state.dataset.tone = 'warning';
      checks.textContent = status.error;
      return;
    }
    if (!status.configured) {
      foundationWorkspace = null;
      foundationCard.hidden = true;
      state.textContent = status.workspace ? 'Folder is unavailable' : 'Not configured';
      state.dataset.tone = status.workspace ? 'warning' : 'quiet';
      checks.textContent = 'Choose or create a folder. Setup will add the portable structure only after approval.';
      return;
    }

    state.textContent = 'Ready for setup';
    state.dataset.tone = 'good';
    const foundation = status.foundationReady ? 'foundation found' : 'foundation not created';
    const personas = status.personasReady
      ? `${status.personaCount} persona package${status.personaCount === 1 ? '' : 's'}`
      : 'personas folder not created';
    checks.textContent = foundation + ' · ' + personas;
    if (foundationWorkspace !== status.workspace) {
      foundationCard.hidden = true;
      ApexBus.post('personaFoundationGet', {});
      ApexBus.post('personaProjectContextGet', {});
      ApexBus.post('personaManageList', {});
    }
  }

  function updateFoundationAction() {
    foundationAction.textContent = foundationBusy
      ? (foundationExists ? 'SAVING…' : 'CREATING…')
      : (foundationExists ? 'SAVE FOUNDATION' : 'CREATE FOUNDATION');
    foundationAction.disabled = foundationBusy || !foundationEditor.value.trim() ||
      (foundationExists && foundationEditor.value === foundationBaseline);
    foundationEditor.disabled = foundationBusy;
  }

  function renderFoundation(status) {
    if (!status.workspace) {
      foundationCard.hidden = true;
      return;
    }
    foundationCard.hidden = false;
    foundationBusy = false;
    if (status.error) {
      foundationWorkspace = null;
      foundationState.textContent = 'Needs attention — ' + status.error;
      foundationState.dataset.tone = 'warning';
      foundationEditor.disabled = true;
      foundationAction.disabled = true;
      draftHome.hidden = true;
      interview.hidden = true;
      return;
    }

    const preservedDraft = conflictDraft;
    conflictDraft = null;
    foundationWorkspace = status.workspace;
    foundationExists = status.exists;
    foundationRevision = status.revision;
    foundationBaseline = status.content;
    foundationEditor.disabled = false;
    foundationEditor.value = preservedDraft === null ? status.content : preservedDraft;
    foundationConflict.hidden = true;
    if (preservedDraft !== null) {
      foundationState.textContent = 'Your edit is preserved against the latest disk revision. Review it, then Save again to intentionally replace the disk version.';
      foundationState.dataset.tone = 'warning';
    } else {
      foundationState.textContent = status.exists
        ? 'Existing foundation loaded. Edit only the rules shared by every persona.'
        : 'Portable default ready for review. Creation also adds an empty personas folder.';
      foundationState.dataset.tone = status.exists ? 'good' : 'quiet';
    }
    updateFoundationAction();
    if (status.exists) ApexBus.post('personaDraftListGet', {});
    else {
      draftHome.hidden = true;
      interview.hidden = true;
    }
  }

  function renderFoundationResult(result) {
    if (result.ok) return; // the following status message installs the saved revision
    foundationBusy = false;
    foundationState.textContent = 'Not saved — ' + result.error;
    foundationState.dataset.tone = 'warning';
    foundationConflict.hidden = !result.conflict;
    updateFoundationAction();
  }

  function setStarterState() {
    draftCreate.disabled = !draftName.value.trim() || !draftUseCase.value.trim();
  }

  function resetDeleteArm() {
    deleteArmedId = null;
    draftDelete.textContent = 'DELETE DRAFT';
  }

  function renderDraftList(message) {
    interviewCards = message.cards || interviewCards;
    interview.hidden = true;
    previewSetup.hidden = true;
    previewReview.hidden = true;
    draftHome.hidden = false;
    currentDraft = null;
    draftBusy = false;
    draftConflict = false;
    pendingDraftHome = false;
    resetDeleteArm();
    draftSelect.replaceChildren();
    for (const draft of message.drafts || []) {
      const option = document.createElement('option');
      option.value = draft.id;
      option.textContent = `${draft.name} — card ${draft.currentCard + 1} · ${draft.updatedAt}`;
      draftSelect.appendChild(option);
    }
    const hasDrafts = Boolean((message.drafts || []).length);
    draftSelect.hidden = !hasDrafts;
    draftResume.disabled = !hasDrafts;
    draftDelete.disabled = !hasDrafts;
    draftWarnings.textContent = message.error || (message.warnings || []).join(' · ');
    draftWarnings.dataset.tone = message.error ? 'warning' : 'quiet';
    setStarterState();
    importAudit.hidden = true;
  }

  function fillList(element, items) {
    element.replaceChildren();
    for (const text of items || []) {
      const item = document.createElement('li');
      item.textContent = text;
      element.appendChild(item);
    }
  }

  function fillSuggestions(items) {
    interviewSuggestions.replaceChildren();
    for (const text of items || []) {
      const chip = document.createElement('span');
      chip.textContent = text;
      interviewSuggestions.appendChild(chip);
    }
  }

  function setInterviewBusy(value) {
    draftBusy = value;
    interviewAnswer.disabled = value;
    interviewDrafts.disabled = value;
    interviewBack.disabled = value || !currentDraft || currentDraft.currentCard === 0;
    interviewNext.disabled = value;
  }

  function renderDraftStatus(message) {
    currentDraft = message.draft;
    interviewCards = message.cards || interviewCards;
    suggestedPersonaId = message.suggestedPersonaId || suggestedPersonaId;
    draftBusy = false;
    draftConflict = false;
    interviewDrafts.textContent = 'DRAFTS';
    if (pendingDraftHome) {
      pendingDraftHome = false;
      ApexBus.post('personaDraftListGet', {});
      return;
    }
    if (pendingPreviewSetup) {
      pendingPreviewSetup = false;
      showPreviewSetup();
      return;
    }
    const card = interviewCards[currentDraft.currentCard];
    if (!card) {
      interviewError.textContent = 'This draft points to an interview card that is unavailable.';
      return;
    }
    draftHome.hidden = true;
    previewSetup.hidden = true;
    previewReview.hidden = true;
    interview.hidden = false;
    interviewStep.textContent = `CARD ${currentDraft.currentCard + 1} OF ${interviewCards.length}`;
    interviewName.textContent = currentDraft.name;
    interviewTitle.textContent = card.title;
    interviewQuestion.textContent = card.question;
    interviewExplanation.textContent = card.explanation;
    fillList(interviewInclude, card.include);
    fillSuggestions(card.suggestions);
    interviewExample.textContent = card.example;
    interviewAnswer.value = currentDraft.answers[card.key] || '';
    interviewHelp.textContent = 'HELP ME DECIDE — ' + card.help;
    interviewError.textContent = '';
    interviewNext.textContent = currentDraft.currentCard === interviewCards.length - 1
      ? 'SAVE DRAFT'
      : 'SAVE & NEXT';
    setInterviewBusy(false);
  }

  function saveInterview(targetCard, goHome) {
    if (!currentDraft || draftBusy) return;
    const card = interviewCards[currentDraft.currentCard];
    pendingDraftHome = Boolean(goHome);
    setInterviewBusy(true);
    ApexBus.post('personaDraftSave', {
      id: currentDraft.id,
      expectedRevision: currentDraft.revision,
      changes: {
        currentCard: targetCard,
        answers: { [card.key]: interviewAnswer.value },
      },
    });
  }

  function renderDraftResult(result) {
    if (result.ok) return; // create/save status or delete list follows
    draftBusy = false;
    pendingDraftHome = false;
    if (!interview.hidden && currentDraft) {
      draftConflict = Boolean(result.conflict);
      interviewError.textContent = 'Not saved — ' + result.error +
        (draftConflict ? ' Your current text is still here; reopening discards only this unsaved card.' : '');
      interviewDrafts.textContent = draftConflict ? 'REOPEN SAVED DRAFT' : 'DRAFTS';
      setInterviewBusy(false);
    } else {
      draftWarnings.textContent = result.error;
      draftWarnings.dataset.tone = 'warning';
      draftCreate.disabled = false;
    }
  }

  function previewChoices() {
    const lines = (value) => [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
    return {
      personaId: previewId.value,
      mode: previewMode.value,
      actions: Object.fromEntries(actionCategories.map((category) =>
        [category, actionSelects[category].value])),
      collaboration: collaborationEnabled.checked ? {
        enabled: true,
        default_access: collaborationAccess.value,
        capabilities: lines(collaborationCapabilities.value),
        accepts: lines(collaborationAccepts.value),
        emits: lines(collaborationEmits.value),
      } : { enabled: false },
    };
  }

  function setPreviewSetupState() {
    const choices = previewChoices();
    previewGenerate.disabled = previewBusy || !choices.personaId || !choices.mode ||
      Object.values(choices.actions).some((value) => !value) ||
      (choices.collaboration.enabled && (!choices.collaboration.default_access ||
        !choices.collaboration.capabilities.length || !choices.collaboration.accepts.length ||
        !choices.collaboration.emits.length));
  }

  function showPreviewSetup() {
    interview.hidden = true;
    draftHome.hidden = true;
    previewReview.hidden = true;
    previewSetup.hidden = false;
    previewBusy = false;
    previewConfirmOverwrite = false;
    previewGenerate.textContent = 'GENERATE PREVIEW';
    previewError.textContent = '';
    const existing = currentDraft && currentDraft.preview;
    previewId.value = existing ? existing.personaId : suggestedPersonaId;
    previewMode.value = existing ? existing.blueprint.action_posture.mode : '';
    for (const category of actionCategories) {
      actionSelects[category].value = existing
        ? existing.blueprint.action_posture.actions[category]
        : '';
    }
    const collaboration = existing && existing.collaboration;
    collaborationEnabled.checked = Boolean(collaboration);
    collaborationEditor.hidden = !collaboration;
    collaborationAccess.value = collaboration ? collaboration.default_access : '';
    collaborationCapabilities.value = collaboration ? collaboration.capabilities.join('\n') : '';
    collaborationAccepts.value = collaboration ? collaboration.accepts.join('\n') : '';
    collaborationEmits.value = collaboration ? collaboration.emits.join('\n') : '';
    setPreviewSetupState();
  }

  function postPreviewGenerate(confirmedOverwrite) {
    if (!currentDraft || previewBusy) return;
    previewBusy = true;
    setPreviewSetupState();
    ApexBus.post('personaPreviewGenerate', {
      id: currentDraft.id,
      expectedRevision: currentDraft.revision,
      ...previewChoices(),
      confirmedOverwrite: Boolean(confirmedOverwrite),
    });
  }

  function renderPreviewStatus(message) {
    currentDraft = message.draft;
    previewBundle = message.bundle;
    previewBusy = false;
    previewConfirmOverwrite = false;
    draftHome.hidden = true;
    interview.hidden = true;
    previewSetup.hidden = true;
    previewReview.hidden = false;
    previewRegenerateAll.textContent = 'REGENERATE ALL';
    blueprintPreview.textContent = JSON.stringify(previewBundle.blueprint, null, 2);
    collaborationPreviewWrap.hidden = !previewBundle.collaboration;
    collaborationPreview.textContent = previewBundle.collaboration
      ? JSON.stringify(previewBundle.collaboration, null, 2)
      : '';
    canonicalPreview.value = previewBundle.canonical;
    canonicalDirty = false;
    previewState.textContent = message.stale
      ? 'Interview answers changed after this preview. Regenerate all to bring them in.'
      : 'Blueprint and canonical are generated from the saved interview.';
    previewState.dataset.tone = message.stale ? 'warning' : 'good';
    if (previewBundle.collaboration && previewBundle.collaboration.default_access === 'read-only') {
      const routineWrites = ['edit_files', 'send_external', 'change_system', 'delete_data']
        .filter((category) => previewBundle.blueprint.action_posture.actions[category] === 'allowed');
      if (routineWrites.length) {
        previewState.textContent += ' Warning: read-only collaboration conflicts with allowed write actions: ' + routineWrites.join(', ') + '.';
        previewState.dataset.tone = 'warning';
      }
    }
    previewEditState.textContent = previewBundle.canonicalDrift
      ? 'Manual canonical edits differ from the generated blueprint hash. They will never be overwritten silently.'
      : 'Canonical matches the generated blueprint hash.';
    previewEditState.dataset.tone = previewBundle.canonicalDrift ? 'warning' : 'good';
    canonicalSave.disabled = true;
    previewReviewError.textContent = '';
    validationSummary.textContent = '';
    validationFindings.replaceChildren();
    acceptCanonical.hidden = true;
    preparedTest = null;
    testRows = new Map();
    testRunning = false;
    testSummary.textContent = '';
    testResults.replaceChildren();
    testPrepare.disabled = false;
    testStart.hidden = true;
    testStop.hidden = true;
    createArmed = false;
    testCompletedForPreview = false;
    createPermanent.textContent = 'CREATE PERSONA';
    createPermanent.disabled = true;
    createSummary.textContent = 'Complete the disposable behavior test before permanent creation.';
    createSummary.dataset.tone = 'quiet';
    sectionSelect.replaceChildren();
    for (const card of interviewCards) {
      const option = document.createElement('option');
      option.value = card.key;
      option.textContent = card.title;
      sectionSelect.appendChild(option);
    }
  }

  function renderPreviewResult(result) {
    if (result.ok) return; // preview status follows every successful mutation
    previewBusy = false;
    if (result.needsConfirmation) {
      previewConfirmOverwrite = true;
      const target = previewReview.hidden ? previewGenerate : previewRegenerateAll;
      target.textContent = 'CONFIRM REGENERATE ALL';
      target.disabled = false;
      const errorTarget = previewReview.hidden ? previewError : previewReviewError;
      errorTarget.textContent = result.error;
      return;
    }
    const errorTarget = previewReview.hidden ? previewError : previewReviewError;
    errorTarget.textContent = result.error;
    setPreviewSetupState();
    canonicalSave.disabled = canonicalPreview.value === (previewBundle && previewBundle.canonical);
  }

  function renderValidationStatus(message) {
    const report = message.report || { valid: false, errors: [], warnings: [], suggestions: [] };
    validationSummary.textContent = report.valid
      ? `VALID · ${report.warnings.length} warning(s) · ${report.suggestions.length} suggestion(s)`
      : `BLOCKED · ${report.errors.length} error(s) · ${report.warnings.length} warning(s)`;
    validationSummary.dataset.tone = report.valid ? 'good' : 'warning';
    validationFindings.replaceChildren();
    for (const finding of [...report.errors, ...report.warnings, ...report.suggestions]) {
      const row = document.createElement('div');
      row.textContent = `${finding.severity.toUpperCase()} · ${finding.message}`;
      row.dataset.tone = finding.severity;
      validationFindings.appendChild(row);
    }
    acceptCanonical.hidden = !report.warnings.some((finding) => finding.repair === 'accept-canonical');
  }

  function setImportCreateState() {
    importCreate.disabled = !activeImportAudit || Boolean(activeImportAudit.errors.length) ||
      !importName.value.trim() || !importUseCase.value.trim();
  }

  function renderImportAudit(message) {
    activeImportAudit = message;
    importAudit.hidden = false;
    importSource.textContent = message.canonicalFile;
    importName.value = message.displayName;
    importUseCase.value = message.description;
    importFindings.textContent = [
      ...(message.errors || []).map((finding) => 'ERROR · ' + finding.message),
      ...(message.warnings || []).map((finding) => 'WARNING · ' + finding.message),
    ].join(' · ') || 'No structural import errors. Review every semantic mapping.';
    importFindings.dataset.tone = message.errors.length ? 'warning' : 'quiet';
    importMappings.replaceChildren();
    importMapSelects = [];
    for (const section of message.sections || []) {
      const row = document.createElement('div');
      row.dataset.index = String(section.index);
      const label = document.createElement('span');
      label.textContent = section.heading;
      const select = document.createElement('select');
      const targets = [{ value: '', label: 'Leave unmapped' },
        ...interviewCards.map((card) => ({ value: card.key, label: card.title }))];
      for (const target of targets) {
        const option = document.createElement('option');
        option.value = target.value;
        option.textContent = target.label;
        select.appendChild(option);
      }
      select.value = section.suggestedKey || '';
      row.appendChild(label);
      row.appendChild(select);
      importMappings.appendChild(row);
      importMapSelects.push({ index: section.index, select });
    }
    setImportCreateState();
  }

  function renderImportResult(result) {
    if (result.ok) {
      activeImportAudit = null;
      importCreate.disabled = true;
      return;
    }
    importFindings.textContent = result.error;
    importFindings.dataset.tone = 'warning';
    setImportCreateState();
  }

  function usageLabel(usage) {
    if (!usage) return 'Usage is unavailable. Starting the test requires your explicit approval.';
    const session = usage.session && Number.isFinite(usage.session.pct) ? usage.session.pct + '%' : '—';
    const weekly = usage.weekly && Number.isFinite(usage.weekly.pct) ? usage.weekly.pct + '%' : '—';
    const age = usage.asOf ? Math.max(0, Math.round((Date.now() - usage.asOf) / 1000)) : null;
    return `${usage.stale ? 'STALE USAGE' : 'USAGE CHECKED'} · 5-hour ${session} · 7-day ${weekly}` +
      (age === null ? '' : ` · ${age}s ago`);
  }

  function renderTestPrepared(message) {
    preparedTest = { id: message.draftId, revision: message.revision };
    testRows = new Map();
    testResults.replaceChildren();
    for (const item of message.cases || []) {
      const row = document.createElement('section');
      row.dataset.caseId = item.id;
      const title = document.createElement('div');
      title.textContent = item.title;
      title.dataset.role = 'title';
      const prompt = document.createElement('div');
      prompt.textContent = 'PROMPT · ' + item.prompt;
      prompt.dataset.role = 'prompt';
      const expected = document.createElement('div');
      expected.textContent = 'EXPECTED · ' + item.expected;
      expected.dataset.role = 'expected';
      const observed = document.createElement('div');
      observed.textContent = 'OBSERVED · waiting';
      observed.dataset.role = 'observed';
      const rating = document.createElement('select');
      for (const choice of [['', 'Review outcome…'], ['pass', 'Matches persona'], ['revise', 'Needs revision']]) {
        const option = document.createElement('option');
        option.value = choice[0];
        option.textContent = choice[1];
        rating.appendChild(option);
      }
      row.appendChild(title);
      row.appendChild(prompt);
      row.appendChild(expected);
      row.appendChild(observed);
      row.appendChild(rating);
      testResults.appendChild(row);
      testRows.set(item.id, { row, observed, rating });
    }
    testSummary.textContent = usageLabel(message.usage) +
      ` · ${message.cases.length} persona-derived cases prepared. Review the numbers, then start explicitly.`;
    testSummary.dataset.tone = message.usage && !message.usage.stale ? 'good' : 'warning';
    testPrepare.disabled = false;
    testStart.hidden = false;
    testStart.disabled = false;
    testStop.hidden = true;
  }

  function renderTestStatus(message) {
    if (message.phase === 'rejected') {
      testSummary.textContent = (testRunning ? 'TEST CONTINUES · ' : 'TEST NOT STARTED · ') + message.error;
      testSummary.dataset.tone = 'warning';
      if (!testRunning) {
        testPrepare.disabled = false;
        testStart.hidden = true;
        testStop.hidden = true;
      }
      return;
    }
    if (message.phase === 'error') {
      testRunning = false;
      testSummary.textContent = 'TEST BLOCKED · ' + message.error;
      testSummary.dataset.tone = 'warning';
      testPrepare.disabled = false;
      testStart.hidden = true;
      testStop.hidden = true;
      createPermanent.disabled = true;
      return;
    }
    if (message.phase === 'starting') {
      testRunning = true;
      testCompletedForPreview = false;
      testSummary.textContent = `Disposable seat starting · ${message.total} cases queued.`;
      testPrepare.disabled = true;
      testStart.hidden = true;
      testStop.hidden = false;
    } else if (message.phase === 'running') {
      testRunning = true;
      testSummary.textContent = `Running case ${message.index + 1} of ${message.total}.`;
      testPrepare.disabled = true;
      testStop.hidden = false;
    } else if (message.phase === 'complete') {
      testRunning = false;
      testCompletedForPreview = true;
      testSummary.textContent = `TEST COMPLETE · ${message.total} observed responses. Mark each result, then revise the interview or canonical where needed.`;
      testSummary.dataset.tone = 'good';
      testPrepare.disabled = false;
      testStart.hidden = true;
      testStop.hidden = true;
      createArmed = false;
      createPermanent.textContent = 'CREATE PERSONA';
      createPermanent.disabled = false;
      createSummary.textContent = 'Test complete. Review every observed response and mark any needed revisions before creating.';
      createSummary.dataset.tone = 'warning';
    } else if (message.phase === 'stopped') {
      testRunning = false;
      testCompletedForPreview = false;
      testSummary.textContent = 'Disposable test stopped. No session was saved.';
      testPrepare.disabled = false;
      testStart.hidden = true;
      testStop.hidden = true;
      createPermanent.disabled = true;
    }
  }

  function renderTestCaseResult(message) {
    const target = testRows.get(message.caseId);
    if (!target) return;
    target.observed.textContent = 'OBSERVED · ' + message.response;
    target.row.dataset.complete = 'true';
  }

  function renderCreateResult(message) {
    if (message.ok) {
      createArmed = false;
      createPermanent.textContent = 'PERSONA CREATED';
      createPermanent.disabled = true;
      createSummary.textContent = message.presetRegistered === false
        ? `PACKAGE CREATED · Seat preset was not registered: ${message.registrationError}`
        : `CREATED · ${message.displayName} · ${message.personaDir}`;
      createSummary.dataset.tone = message.presetRegistered === false ? 'warning' : 'good';
      return;
    }
    createArmed = false;
    createPermanent.textContent = 'CREATE PERSONA';
    createPermanent.disabled = false;
    createSummary.textContent = 'NOT CREATED · ' + message.error;
    createSummary.dataset.tone = 'warning';
  }

  ApexBus.on('personaWorkspaceStatus', renderWorkspace);
  ApexBus.on('personaFoundationStatus', renderFoundation);
  ApexBus.on('personaFoundationResult', renderFoundationResult);
  ApexBus.on('personaDraftList', renderDraftList);
  ApexBus.on('personaDraftStatus', renderDraftStatus);
  ApexBus.on('personaDraftResult', renderDraftResult);
  ApexBus.on('personaPreviewStatus', renderPreviewStatus);
  ApexBus.on('personaPreviewResult', renderPreviewResult);
  ApexBus.on('personaValidationStatus', renderValidationStatus);
  ApexBus.on('personaImportAudit', renderImportAudit);
  ApexBus.on('personaImportResult', renderImportResult);
  ApexBus.on('personaTestPrepared', renderTestPrepared);
  ApexBus.on('personaTestStatus', renderTestStatus);
  ApexBus.on('personaTestCaseResult', renderTestCaseResult);
  ApexBus.on('personaCreateResult', renderCreateResult);
  choose.addEventListener('click', () => {
    if (choosing) return;
    setChoosing(true);
    ApexBus.post('personaWorkspaceChoose', {});
  });
  foundationEditor.addEventListener('input', updateFoundationAction);
  foundationLoadDisk.addEventListener('click', () => {
    foundationConflict.hidden = true;
    conflictDraft = null;
    ApexBus.post('personaFoundationGet', {});
  });
  foundationKeepEdit.addEventListener('click', () => {
    foundationConflict.hidden = true;
    conflictDraft = foundationEditor.value;
    ApexBus.post('personaFoundationGet', {});
  });
  foundationAction.addEventListener('click', () => {
    if (foundationBusy || foundationAction.disabled) return;
    foundationBusy = true;
    updateFoundationAction();
    if (foundationExists) {
      ApexBus.post('personaFoundationSave', {
        content: foundationEditor.value,
        expectedRevision: foundationRevision,
      });
    } else {
      ApexBus.post('personaFoundationCreate', { content: foundationEditor.value });
    }
  });
  draftName.addEventListener('input', setStarterState);
  draftUseCase.addEventListener('input', setStarterState);
  draftCreate.addEventListener('click', () => {
    if (draftCreate.disabled) return;
    draftCreate.disabled = true;
    ApexBus.post('personaDraftCreate', {
      name: draftName.value,
      useCase: draftUseCase.value,
    });
  });
  importChoose.addEventListener('click', () => ApexBus.post('personaImportChoose', {}));
  importName.addEventListener('input', setImportCreateState);
  importUseCase.addEventListener('input', setImportCreateState);
  importCreate.addEventListener('click', () => {
    if (importCreate.disabled || !activeImportAudit) return;
    importCreate.disabled = true;
    ApexBus.post('personaImportCreateDraft', {
      sourceFolder: activeImportAudit.sourceFolder,
      name: importName.value,
      useCase: importUseCase.value,
      mapping: Object.fromEntries(importMapSelects.map(({ index, select }) =>
        [String(index), select.value])),
    });
  });
  draftSelect.addEventListener('change', resetDeleteArm);
  draftResume.addEventListener('click', () => {
    resetDeleteArm();
    if (draftSelect.value) ApexBus.post('personaDraftOpen', { id: draftSelect.value });
  });
  draftDelete.addEventListener('click', () => {
    if (!draftSelect.value) return;
    if (deleteArmedId !== draftSelect.value) {
      deleteArmedId = draftSelect.value;
      draftDelete.textContent = 'CONFIRM DELETE';
      return;
    }
    ApexBus.post('personaDraftDelete', { id: draftSelect.value, confirmed: true });
    resetDeleteArm();
  });
  interviewBack.addEventListener('click', () =>
    saveInterview(Math.max(0, currentDraft.currentCard - 1), false));
  interviewNext.addEventListener('click', () => {
    const last = currentDraft.currentCard === interviewCards.length - 1;
    pendingPreviewSetup = last;
    saveInterview(last ? currentDraft.currentCard : currentDraft.currentCard + 1, false);
  });
  interviewDrafts.addEventListener('click', () => {
    if (draftConflict) {
      draftConflict = false;
      ApexBus.post('personaDraftOpen', { id: currentDraft.id });
      return;
    }
    saveInterview(currentDraft.currentCard, true);
  });
  previewId.addEventListener('input', () => {
    previewConfirmOverwrite = false;
    previewGenerate.textContent = 'GENERATE PREVIEW';
    setPreviewSetupState();
  });
  previewMode.addEventListener('change', setPreviewSetupState);
  for (const select of Object.values(actionSelects))
    select.addEventListener('change', setPreviewSetupState);
  collaborationEnabled.addEventListener('change', () => {
    collaborationEditor.hidden = !collaborationEnabled.checked;
    setPreviewSetupState();
  });
  collaborationAccess.addEventListener('change', setPreviewSetupState);
  collaborationCapabilities.addEventListener('input', setPreviewSetupState);
  collaborationAccepts.addEventListener('input', setPreviewSetupState);
  collaborationEmits.addEventListener('input', setPreviewSetupState);

  // ---- relationship suggestions (accept-to-apply chips) ----
  const appendContractLine = (textarea, line) => {
    const lines = textarea.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.some((l) => l.toLowerCase() === line.toLowerCase())) {
      lines.push(line);
      textarea.value = lines.join('\n');
    }
    if (!collaborationEnabled.checked) {
      collaborationEnabled.checked = true;
      collaborationEditor.hidden = false;
    }
    setPreviewSetupState();
  };
  function renderRelSuggestions(message) {
    if (message.draftId && currentDraft && message.draftId !== currentDraft.id) return;
    relSuggestLlm.disabled = false;
    relStatus.textContent = message.error
      ? 'No suggestions: ' + message.error
      : ((message.suggestions || []).length || (message.routes || []).length)
        ? (message.source === 'llm' ? 'AI suggestions' : 'Role-based suggestions') +
          ' — nothing applies until you accept it.'
        : 'No suggestions yet — add detail to the mission card, or create teammate personas first.';
    relList.textContent = '';
    for (const s of message.suggestions || []) {
      const isNew = s.with.startsWith('NEW:');
      const partner = isNew ? s.with.slice(4).trim() : s.with;
      const row = document.createElement('div');
      row.className = 'personaRelRow';
      const text = document.createElement('div');
      text.className = 'personaRelText';
      text.textContent = (s.direction === 'sends-to' ? 'Sends ' : 'Receives ') +
        (s.packet || 'work') +
        (s.direction === 'sends-to' ? ' to ' : ' from ') +
        (isNew ? 'a NEW ' + partner + ' persona' : partner);
      if (s.why) {
        const why = document.createElement('div');
        why.className = 'personaRelWhy';
        why.textContent = s.why;
        text.appendChild(why);
      }
      row.appendChild(text);
      const actions = document.createElement('div');
      actions.className = 'personaRelRowActions';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.textContent = 'APPLY';
      apply.title = s.direction === 'sends-to'
        ? 'add to EMITS (this persona produces it)'
        : 'add to ACCEPTS (this persona consumes it)';
      apply.addEventListener('click', () => {
        appendContractLine(
          s.direction === 'sends-to' ? collaborationEmits : collaborationAccepts,
          s.packet || ('handoff with ' + partner));
        row.remove();
      });
      actions.appendChild(apply);
      if (isNew) {
        const prefill = document.createElement('button');
        prefill.type = 'button';
        prefill.textContent = 'PREFILL DRAFT';
        prefill.title = 'pre-fill the new-draft form with this role — finish this persona first, then start it';
        prefill.addEventListener('click', () => {
          draftName.value = partner.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
          draftUseCase.value = (s.direction === 'sends-to'
            ? 'Receive and independently handle: ' : 'Produce for handoff: ') +
            (s.packet || 'work from ' + (currentDraft ? currentDraft.name : 'the team'));
          draftName.dispatchEvent(new Event('input', { bubbles: true }));
          draftUseCase.dispatchEvent(new Event('input', { bubbles: true }));
          relStatus.textContent = 'New-draft form pre-filled with "' + draftName.value +
            '" — finish this persona, then start the interview from PERSONA DRAFTS.';
        });
        actions.appendChild(prefill);
      }
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = '✕';
      dismiss.title = 'dismiss';
      dismiss.addEventListener('click', () => row.remove());
      actions.appendChild(dismiss);
      row.appendChild(actions);
      relList.appendChild(row);
    }
    for (const r of message.routes || []) {
      const row = document.createElement('div');
      row.className = 'personaRelRow personaRelRoute';
      const text = document.createElement('div');
      text.className = 'personaRelText';
      text.textContent = 'Route "' + r.name + '": ' + r.steps.join(' → ');
      const why = document.createElement('div');
      why.className = 'personaRelWhy';
      why.textContent = 'saving makes this a one-click route template on the Task Board';
      text.appendChild(why);
      row.appendChild(text);
      const actions = document.createElement('div');
      actions.className = 'personaRelRowActions';
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'SAVE ROUTE';
      save.addEventListener('click', () => {
        ApexBus.post('taskRouteSave', { name: r.name, steps: r.steps });
        save.textContent = 'SAVED ✓';
        save.disabled = true;
      });
      actions.appendChild(save);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = '✕';
      dismiss.title = 'dismiss';
      dismiss.addEventListener('click', () => row.remove());
      actions.appendChild(dismiss);
      row.appendChild(actions);
      relList.appendChild(row);
    }
  }
  relSuggest.addEventListener('click', () => {
    if (!currentDraft) return;
    relStatus.textContent = 'Looking at the roles in this workspace…';
    ApexBus.post('personaRelSuggest', { id: currentDraft.id });
  });
  relSuggestLlm.addEventListener('click', () => {
    if (!currentDraft || relSuggestLlm.disabled) return;
    relSuggestLlm.disabled = true;
    relStatus.textContent = 'AI suggestion pass starting (one hidden, tool-disabled session)…';
    ApexBus.post('personaRelSuggestLlm', { id: currentDraft.id, approved: true });
  });
  projectContextSave.addEventListener('click', () => {
    ApexBus.post('personaProjectContextSave', { content: projectContext.value });
  });
  ApexBus.on('personaRelStatus', () => {
    relStatus.textContent = 'AI suggestion pass running…';
  });
  ApexBus.on('personaRelSuggestions', renderRelSuggestions);

  // ---- manage existing personas (edit / runtime / delete) ----
  function renderPackageList(message) {
    const packages = (message && message.packages) || [];
    manageList.textContent = '';
    if (message && message.error) { manageCard.hidden = true; return; }
    manageCard.hidden = !packages.length;
    for (const p of packages) {
      const row = document.createElement('div');
      row.className = 'personaManageRow';
      const name = document.createElement('span');
      name.className = 'personaManageName';
      name.textContent = p.displayName;
      if (p.hasCollaboration) {
        const chip = document.createElement('span');
        chip.className = 'personaManageChip';
        chip.textContent = 'collab';
        chip.title = 'has a collaboration contract';
        name.appendChild(chip);
      }
      row.appendChild(name);
      const actions = document.createElement('div');
      actions.className = 'personaManageActions';
      const mk = (label, title, fn, cls) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.title = title;
        if (cls) b.className = cls;
        b.addEventListener('click', fn);
        actions.appendChild(b);
      };
      mk('EDIT', 'reopen this persona in the interview to change its identity',
        () => ApexBus.post('personaPackageEdit', { personaId: p.personaId }));
      mk('RUNTIME', 'model / effort / permissions — opens the AI-bar seat defaults', () => {
        if (window.ApexChat && window.ApexChat.showDefaults) window.ApexChat.showDefaults(p.displayName);
        else ApexToast('Open the AI bar to set launch dials for ' + p.displayName + '.');
      });
      mk('DELETE', 'archive this persona (its memory is kept under personas/.archive)', () => {
        if (window.confirm('Delete "' + p.displayName + '"?\n\nIt is archived, not erased — its memory is ' +
            'kept and you can restore it from personas/.archive.'))
          ApexBus.post('personaPackageArchive', { personaId: p.personaId, confirmed: true });
      }, 'personaManageDelete');
      row.appendChild(actions);
      manageList.appendChild(row);
    }
  }
  ApexBus.on('personaPackageList', renderPackageList);
  ApexBus.on('personaProjectContext', (m) => {
    if (m.error) return;
    if (!m.saved) projectContext.value = m.content || '';
    else {
      projectContextSave.textContent = 'SAVED ✓';
      setTimeout(() => { projectContextSave.textContent = 'SAVE PROJECT CONTEXT'; }, 1500);
    }
  });
  previewSetupBack.addEventListener('click', () =>
    renderDraftStatus({ draft: currentDraft, cards: interviewCards, suggestedPersonaId }));
  previewGenerate.addEventListener('click', () => {
    if (previewGenerate.disabled) return;
    postPreviewGenerate(previewConfirmOverwrite);
  });
  canonicalPreview.addEventListener('input', () => {
    canonicalDirty = canonicalPreview.value !== previewBundle.canonical;
    canonicalSave.disabled = !canonicalDirty;
    previewEditState.textContent = canonicalDirty
      ? 'Unsaved canonical edit. Save it before leaving or regenerating.'
      : (previewBundle.canonicalDrift
        ? 'Manual canonical edits differ from the generated blueprint hash.'
        : 'Canonical matches the generated blueprint hash.');
    previewEditState.dataset.tone = canonicalDirty || previewBundle.canonicalDrift ? 'warning' : 'good';
    createPermanent.disabled = canonicalDirty || !testCompletedForPreview;
  });
  canonicalSave.addEventListener('click', () => {
    if (!canonicalDirty || canonicalSave.disabled) return;
    canonicalSave.disabled = true;
    ApexBus.post('personaPreviewSaveCanonical', {
      id: currentDraft.id,
      expectedRevision: currentDraft.revision,
      canonical: canonicalPreview.value,
    });
  });
  canonicalRestore.addEventListener('click', () => {
    canonicalPreview.value = previewBundle.canonical;
    canonicalDirty = false;
    canonicalSave.disabled = true;
    previewEditState.textContent = previewBundle.canonicalDrift
      ? 'Manual canonical edits differ from the generated blueprint hash.'
      : 'Canonical matches the generated blueprint hash.';
    previewEditState.dataset.tone = previewBundle.canonicalDrift ? 'warning' : 'good';
    previewReviewError.textContent = '';
    createPermanent.disabled = !testCompletedForPreview;
  });
  sectionRegenerate.addEventListener('click', () => {
    if (canonicalDirty) {
      previewReviewError.textContent = 'Save or discard the current canonical edit before regenerating a section.';
      return;
    }
    ApexBus.post('personaPreviewRegenerateSection', {
      id: currentDraft.id,
      expectedRevision: currentDraft.revision,
      key: sectionSelect.value,
    });
  });
  previewRegenerateAll.addEventListener('click', () => {
    if (canonicalDirty) {
      previewReviewError.textContent = 'Save or discard the current canonical edit before regenerating everything.';
      return;
    }
    postPreviewGenerate(previewConfirmOverwrite);
  });
  previewBack.addEventListener('click', () => {
    if (canonicalDirty) {
      previewReviewError.textContent = 'Save or discard the current canonical edit before returning to the interview.';
      return;
    }
    renderDraftStatus({ draft: currentDraft, cards: interviewCards, suggestedPersonaId });
  });
  previewDrafts.addEventListener('click', () => {
    if (canonicalDirty) {
      previewReviewError.textContent = 'Save or discard the current canonical edit before leaving the preview.';
      return;
    }
    ApexBus.post('personaDraftListGet', {});
  });
  validatePreview.addEventListener('click', () => {
    if (canonicalDirty) {
      previewReviewError.textContent = 'Save or restore the canonical edit before validating.';
      return;
    }
    ApexBus.post('personaPreviewValidate', { id: currentDraft.id });
  });
  acceptCanonical.addEventListener('click', () => {
    if (canonicalDirty) {
      previewReviewError.textContent = 'Save or restore the canonical edit before accepting its hash.';
      return;
    }
    ApexBus.post('personaPreviewAcceptCanonical', {
      id: currentDraft.id,
      expectedRevision: currentDraft.revision,
    });
  });
  testPrepare.addEventListener('click', () => {
    if (canonicalDirty) {
      previewReviewError.textContent = 'Save or restore the canonical edit before preparing a test.';
      return;
    }
    testPrepare.disabled = true;
    ApexBus.post('personaTestPrepare', { id: currentDraft.id });
  });
  testStart.addEventListener('click', () => {
    if (!preparedTest || testStart.disabled) return;
    testStart.disabled = true;
    ApexBus.post('personaTestStart', {
      id: preparedTest.id,
      expectedRevision: preparedTest.revision,
      approved: true,
    });
  });
  testStop.addEventListener('click', () => ApexBus.post('personaTestStop', {}));
  createPermanent.addEventListener('click', () => {
    if (createPermanent.disabled) return;
    if (canonicalDirty) {
      previewReviewError.textContent = 'Save or restore the canonical edit before permanent creation.';
      return;
    }
    if (!createArmed) {
      createArmed = true;
      createPermanent.textContent = 'CONFIRM PERMANENT CREATION';
      createSummary.textContent = 'This creates a new portable package and permanent seat preset. Click again to confirm.';
      createSummary.dataset.tone = 'warning';
      return;
    }
    createPermanent.disabled = true;
    ApexBus.post('personaCreatePermanent', {
      id: currentDraft.id,
      expectedRevision: currentDraft.revision,
      confirmed: true,
    });
  });

  ApexShell.registerDockPane(pane, { order: 20 });
  ApexBus.post('personaWorkspaceGet', {});
  ApexBus.post('personaManageList', {});
})();

