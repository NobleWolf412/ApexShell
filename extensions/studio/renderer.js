// Apex — the STUDIO shell. One dock pane (order 20 — the slot PERSONAS held
// before it moved house) that hosts the builders as sub-views: PERSONAS
// (the re-homed Persona Builder) and PROJECTS (the App Builder, slice 2+).
// The TERMINAL/VIEWER/TODO base-shell tabs are untouched.
//
// The seam a builder plugs into:
//
//   ApexStudio.registerBuilder({ id, label, mount(el), order })
//
// A builder hands over a mount(el) callback; STUDIO gives it a view container
// and a header sub-tab, sorts the tabs by order, and shows one view at a time.
// Re-registering the same id replaces its view in place — that is how the
// real App Builder (slice 2+) takes over the empty PROJECTS placeholder below.
//
// LOAD ORDER (the one thing this shell must get right): this script has to run
// before any builder's renderer, so that window.ApexStudio exists when a
// builder calls registerBuilder synchronously. Two cooperating guarantees make
// that hold, both documented at their source:
//   1. main/extensions.js emits studio ahead of its dependents (manifest
//      `priority: -10`, lower loads first).
//   2. renderer/extensions.js injects the extension scripts with async=false,
//      so they execute in that emitted order, not whichever loads first.
'use strict';
(function () {
  const pane = document.createElement('div');
  pane.className = 'sidePane dockPane studioPane';
  pane.id = 'dock-studio';
  pane.dataset.tab = 'studio';
  pane.dataset.order = '20';
  pane.innerHTML =
    '<div class="paneBody studioBody">' +
      '<div class="studioHeader">' +
        '<div class="studioTabs" role="tablist"></div>' +
        '<div class="studioModelPicker" title="One model choice drives both AI levels once a builder offers them (haiku for quick suggest passes, sonnet+ for a longer co-designer conversation). No effect yet — nothing in STUDIO calls a disposable.">' +
          '<select class="studioModelSelect" aria-label="STUDIO model">' +
            '<option value="">Model: default</option>' +
            '<option value="haiku">haiku</option>' +
            '<option value="sonnet">sonnet</option>' +
            '<option value="opus">opus</option>' +
            '<option value="fable">fable</option>' +
          '</select>' +
          '<select class="studioEffortSelect" aria-label="STUDIO effort">' +
            '<option value="">Effort: default</option>' +
            '<option value="low">low</option>' +
            '<option value="medium">medium</option>' +
            '<option value="high">high</option>' +
            '<option value="xhigh">xhigh</option>' +
            '<option value="max">max</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="studioViews"></div>' +
    '</div>' +
    '<div class="dockTab" data-tab="studio" title="Studio — build personas and project blueprints in one place">STUDIO</div>';

  const tabsEl = pane.querySelector('.studioTabs');
  const viewsEl = pane.querySelector('.studioViews');
  const modelSelectEl = pane.querySelector('.studioModelSelect');
  const effortSelectEl = pane.querySelector('.studioEffortSelect');
  const builders = new Map();   // id -> { id, label, order, tab, view }
  let activeId = null;
  let userPicked = false;       // until the user picks, the lowest-order view leads

  function activate(id) {
    if (!id || !builders.has(id)) return;
    activeId = id;
    for (const b of builders.values()) {
      const on = b.id === id;
      b.tab.dataset.active = on ? 'true' : 'false';
      b.view.hidden = !on;
    }
  }

  function relayout() {
    // sub-tabs sort by order; the lowest-order builder is the default view
    const sorted = [...builders.values()].sort((a, b) => a.order - b.order);
    tabsEl.replaceChildren(...sorted.map((b) => b.tab));
    if (userPicked && activeId && builders.has(activeId)) activate(activeId);
    else activate(sorted.length ? sorted[0].id : null);
  }

  function registerBuilder(spec) {
    if (!spec || typeof spec.id !== 'string' || typeof spec.mount !== 'function') return;
    const order = Number.isFinite(spec.order) ? spec.order : 100;
    const label = String(spec.label || spec.id).toUpperCase();
    // Re-registration replaces a builder's view in place (PROJECTS ships empty
    // until the App Builder lands and registers its own id:'projects').
    const existing = builders.get(spec.id);
    const view = existing ? existing.view : document.createElement('div');
    view.className = 'studioView';
    view.dataset.builder = spec.id;
    if (existing) view.replaceChildren();
    else viewsEl.appendChild(view);
    const tab = existing ? existing.tab : document.createElement('button');
    tab.type = 'button';
    tab.className = 'studioTab';
    tab.dataset.builder = spec.id;
    tab.textContent = label;
    if (!existing) tab.addEventListener('click', () => { userPicked = true; activate(spec.id); });
    builders.set(spec.id, { id: spec.id, label, order, tab, view });
    spec.mount(view);
    relayout();
  }

  window.ApexStudio = { registerBuilder };

  // The App Builder (PROJECTS) registers through the same seam. Its wiring speaks
  // the bus (ApexBus), which the shell provides in the live renderer but the
  // headless studio-drill does not — so all data wiring is gated behind hasBus.
  // The static skeleton still builds under the drill's mock (innerHTML only), and
  // the shell-seam assertions (one PROJECTS tab/view) hold unchanged.
  const hasBus = typeof ApexBus !== 'undefined';

  registerBuilder({
    id: 'projects',
    label: 'PROJECTS',
    order: 20,
    mount: (el) => mountProjects(el, hasBus),
  });

  // The STUDIO header model picker (slice 5): one persisted choice shared
  // across builders. Nothing reads it yet — slices 6/7 will pass it through
  // as launch.model/launch.effort to a disposable. Headless studio-drill has
  // no ApexBus, so wiring stays gated behind hasBus like the rest of the shell.
  if (hasBus) {
    modelSelectEl.addEventListener('change', () => {
      ApexBus.post('studioModelSet', { model: modelSelectEl.value || null, effort: effortSelectEl.value || null });
    });
    effortSelectEl.addEventListener('change', () => {
      ApexBus.post('studioModelSet', { model: modelSelectEl.value || null, effort: effortSelectEl.value || null });
    });
    ApexBus.on('studioModelPick', (m) => {
      if (!m) return;
      modelSelectEl.value = m.model || '';
      effortSelectEl.value = m.effort || '';
    });
    ApexBus.post('studioModelGet', {});
  }

  ApexShell.registerDockPane(pane, { order: 20 });
})();

// ---- PROJECTS builder: the guided interview (slice 3) ----------------------
// Workspace pick → Start (name + pitch) → six cards with Back / Save draft /
// Skip / Help-me-decide. Crash-safe drafts live in main; this half is view +
// bus traffic only. No AI: Help-me-decide reveals card heuristics and computes
// live nudges client-side (mirrors extensions/studio/lib/interview.helpForCard).
function mountProjects(el, hasBus) {
  el.innerHTML =
    '<div class="pjRoot">' +
      '<div class="pjRail" role="tablist"></div>' +
      '<div class="pjMain"></div>' +
      '<div class="pjCoLauncher" hidden>' +
        '<button type="button" class="pjBtn primary pjCoOpenBtn" title="A persistent chat, seated on the STUDIO model picker\'s choice, that argues from your current draft. Patches it proposes land as accept/reject chips on the card — it never writes the blueprint itself.">CO-DESIGNER</button>' +
      '</div>' +
      '<div class="pjCoPanel" hidden>' +
        '<div class="pjCoHead">' +
          '<span class="pjCoTitle">CO-DESIGNER</span>' +
          '<span class="pjCoSub"></span>' +
          '<button type="button" class="pjBtn pjCoCloseBtn">CLOSE</button>' +
        '</div>' +
        '<div class="pjCoLog"></div>' +
        '<div class="pjCoErr" hidden></div>' +
        '<div class="pjCoInputRow">' +
          '<input type="text" class="pjCoInput" maxlength="4000" placeholder="Argue with it…" />' +
          '<button type="button" class="pjBtn primary pjCoSendBtn">SEND</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  if (!hasBus) return;   // headless shell drill: skeleton only, no bus, no wiring

  const rail = el.querySelector('.pjRail');
  const main = el.querySelector('.pjMain');
  // ---- co-designer panel DOM (slice 7) — a fixed sibling of pjRail/pjMain, so
  // its own render() calls never get wiped out by a card/review/canonical
  // repaint of .pjMain.
  const coLauncher = el.querySelector('.pjCoLauncher');
  const coOpenBtn = el.querySelector('.pjCoOpenBtn');
  const coPanel = el.querySelector('.pjCoPanel');
  const coHeadSub = el.querySelector('.pjCoSub');
  const coLog = el.querySelector('.pjCoLog');
  const coErr = el.querySelector('.pjCoErr');
  const coInput = el.querySelector('.pjCoInput');
  const coSendBtn = el.querySelector('.pjCoSendBtn');
  const coCloseBtn = el.querySelector('.pjCoCloseBtn');

  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const state = {
    step: 'ws',            // 'ws' | 'start' | <cardKey> | 'review' | 'canonical'
    ws: null,              // last projectsWorkspaceStatus
    cards: [],             // interview card copy, shipped from main
    draft: null,           // current draft (from main)
    drafts: [],            // resumable drafts for this workspace
    draftWarnings: [],
    listError: null,
    busy: false,
    pendingStep: null,     // where to go once the in-flight save returns
    deleteArmedId: null,
    helpOpen: false,
    // ---- slice 4: Blueprint Review + Canonical Draft ----
    bundle: null,          // current preview bundle (= draft.preview)
    stale: false,          // interview answers changed after this preview
    projectId: '',         // the review's chosen project id
    canonicalDirty: false, // the canonical textarea diverges from the saved bundle
    confirmOverwrite: false,
    validation: null,      // last projectsValidationStatus report
    suggestedProjectId: '',
    // ---- slice 8: Create Project + Lift-off ----
    createBusy: false,
    createError: null,
    createdProject: null,   // { projectId, projectDir, displayName } once Create succeeds
    liftoff: {
      registerBusy: false, registerName: '', registerResult: null,
      routeText: '', saveAsTemplate: false, templateName: '',
      delegateBusy: false, delegateResult: null,
      chatBusy: false, chatResult: null,
    },
    // ---- slice 6: per-card AI suggest pass (opt-in, one disposable turn) ----
    // Keyed to a single card at a time; switching cards drops any stale
    // prepared/result state rather than carrying it to the wrong question.
    suggest: { card: null, prepared: null, busy: false, phase: null, result: null },
    // ---- slice 7: the co-designer panel (one long-lived controller per open) ----
    codesigner: {
      open: false,
      busy: false,       // a turn is in flight (open's first turn, or a send)
      log: [],           // [{ role: 'user'|'assistant', text }] — this session only
      streaming: '',     // in-flight assistant text (deltas accumulate here)
      streamingIndex: -1,// index into log of the bubble currently streaming
      patches: [],       // [{ id, card, field, proposal, why }] — pending chips
      error: null,
    },
  };

  // The six canonical sections — key + default heading — mirrored from
  // lib/render.js SECTIONS (the renderer can't require node libs; this static
  // copy drives the per-section regen picker and the gap labels only).
  const SECTIONS = [
    { key: 'vision', heading: 'Vision and Users' },
    { key: 'scope', heading: 'Scope and MVP Cut' },
    { key: 'platform', heading: 'Platform and Stack' },
    { key: 'architecture', heading: 'Architecture Sketch' },
    { key: 'delivery', heading: 'Milestones and Delivery' },
    { key: 'risks', heading: 'Risks and Open Questions' },
  ];
  const sectionHeading = (key) => (SECTIONS.find((s) => s.key === key) || {}).heading || key;

  const cardKeys = () => state.cards.map((c) => c.key);
  const isCardStep = (id) => cardKeys().includes(id);
  const cardIndex = (id) => cardKeys().indexOf(id);
  const findCard = (id) => state.cards.find((c) => c.key === id);

  function steps() {
    return [
      { id: 'ws', label: 'Workspace', sub: 'where projects live' },
      { id: 'start', label: 'Start', sub: 'name + pitch' },
      ...state.cards.map((c, i) => ({ id: c.key, label: (i + 1) + ' · ' + c.title, sub: null, card: true })),
      { id: 'review', label: 'Review', sub: 'answers + gaps' },
      { id: 'canonical', label: 'Canonical', sub: 'PROJECT.md + validate' },
      { id: 'create', label: 'Create', sub: 'write the package' },
      { id: 'liftoff', label: 'Lift-off', sub: 'register · delegate · chat' },
    ];
  }

  const hasPreview = () => Boolean(state.draft && state.draft.preview);

  const stepDone = (id) => {
    if (id === 'ws') return Boolean(state.ws && state.ws.configured);
    if (id === 'start') return Boolean(state.draft);
    if (id === 'review') return hasPreview();
    if (id === 'canonical') return hasPreview() && !state.draft.preview.canonicalDrift;
    if (id === 'create') return Boolean(state.createdProject);
    if (id === 'liftoff') return false;
    return Boolean(state.draft && (state.draft.answers[id] || '').trim());
  };
  const stepReachable = (id) => {
    if (id === 'ws') return true;
    if (id === 'start') return Boolean(state.ws && state.ws.configured);
    if (id === 'review') return Boolean(state.draft);       // review needs a started draft
    if (id === 'canonical') return hasPreview();             // canonical needs a preview
    if (id === 'create') return hasPreview();                 // Create needs an approved canonical
    if (id === 'liftoff') return Boolean(state.createdProject); // offered right after Create succeeds
    return Boolean(state.draft);   // cards need a started draft
  };

  // ---- live nudges: the client mirror of interview.helpForCard's dynamic rules.
  function helpNudges(key, text) {
    const answer = String(text || '').trim();
    const out = [];
    if (!answer) { out.push('Nothing here yet — the example above is a complete answer you can adapt.'); return out; }
    if (answer.length < 120) out.push('This reads thin for an Architect to act on — add a concrete detail or two.');
    if (key === 'users' && !/\b(user|who|team|people|customer|client|operator|me|myself|i)\b/i.test(answer))
      out.push('Name the actual user in the answer — a job needs someone who hires it.');
    if (key === 'scope' && !/(non.?goals?|won'?t|will not|\bnot\b|exclude|out of scope)/i.test(answer))
      out.push('Scope names no non-goal. Say at least one thing v1 deliberately will not do.');
    if (key === 'delivery' && !/(test|drill|verif|gate|proof|evidence|demo|accept|milestone)/i.test(answer))
      out.push('Delivery names no way to prove lift-off. Say what evidence counts as done.');
    return out;
  }

  const answerBox = () => main.querySelector('.pjAnswer');

  // ---- navigation + persistence -------------------------------------------
  function goStep(id) {
    if (!stepReachable(id)) return;
    if (state.busy) return;
    if (isCardStep(state.step) && state.draft) { save(id); return; }
    state.step = id;
    state.helpOpen = false;
    render();
  }

  // Every card move persists the current answer (autosave on card changes) and,
  // when moving to another card, records the position. pendingStep drives where
  // the view lands once main answers with the new revision.
  function save(nextStep) {
    if (!state.draft) { state.step = nextStep; render(); return; }
    const changes = {};
    if (isCardStep(state.step)) {
      const box = answerBox();
      if (box) changes.answers = { [state.step]: box.value };
    }
    if (isCardStep(nextStep)) changes.currentCard = cardIndex(nextStep);
    state.busy = true;
    state.pendingStep = nextStep;
    ApexBus.post('projectsDraftSave', {
      id: state.draft.id, expectedRevision: state.draft.revision, changes,
    });
  }

  // ---- render -------------------------------------------------------------
  function render() {
    renderRail();
    coUpdateVisibility();
    if (state.step === 'ws') return renderWs();
    if (state.step === 'start') return renderStart();
    if (state.step === 'review') return renderReview();
    if (state.step === 'canonical') return renderCanonicalView();
    if (state.step === 'create') return renderCreate();
    if (state.step === 'liftoff') return renderLiftoff();
    if (isCardStep(state.step)) return renderCard(findCard(state.step));
    state.step = 'ws';
    renderWs();
  }

  function renderRail() {
    rail.replaceChildren();
    for (const s of steps()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pjStep' + (state.step === s.id ? ' on' : '') +
        (stepDone(s.id) ? ' done' : '') + (stepReachable(s.id) ? '' : ' locked');
      b.textContent = s.label;
      if (s.sub) {
        const sub = document.createElement('span');
        sub.className = 'pjStepSub';
        sub.textContent = s.sub;
        b.appendChild(sub);
      }
      b.addEventListener('click', () => goStep(s.id));
      rail.appendChild(b);
    }
  }

  function renderWs() {
    const ws = state.ws;
    const configured = ws && ws.configured;
    const pathLine = ws && ws.workspace ? ws.workspace : 'No workspace chosen';
    let sub;
    if (ws && ws.error) sub = ws.error;
    else if (configured) {
      sub = ws.projectCount
        ? `${ws.projectCount} existing project${ws.projectCount === 1 ? '' : 's'} found — their project-context.md feeds overlap detection later.`
        : 'Ready. Every project the builder creates is one folder under here.';
    } else if (ws && ws.workspace) sub = 'That folder is unavailable — choose another.';
    else sub = 'Pick once. Portable, git-trackable, no provider or machine path inside.';

    main.innerHTML =
      '<h2 class="pjTitle">Projects workspace</h2>' +
      '<p class="pjLead">Choose one folder to hold every project blueprint. This setting stays on this Apex install; it never enters a project package.</p>' +
      '<div class="pjCard">' +
        '<div class="pjWsPath" data-tone="' + (configured ? 'good' : 'quiet') + '">' + escapeHtml(pathLine) + '</div>' +
        '<div class="pjWsSub">' + escapeHtml(sub) + '</div>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn ' + (configured ? '' : 'primary') + ' pjWsChoose">' +
            (configured ? 'CHANGE…' : 'CHOOSE WORKSPACE…') + '</button>' +
          (configured ? '<button type="button" class="pjBtn primary pjWsContinue">CONTINUE →</button>' : '') +
        '</div>' +
      '</div>';

    main.querySelector('.pjWsChoose').addEventListener('click', () => {
      ApexBus.post('projectsWorkspaceChoose', {});
    });
    const cont = main.querySelector('.pjWsContinue');
    if (cont) cont.addEventListener('click', () => goStep('start'));
  }

  function renderStart() {
    const options = state.drafts.map((d) =>
      `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} — card ${d.currentCard + 1} · ${escapeHtml(d.updatedAt)}</option>`
    ).join('');
    const hasDrafts = state.drafts.length > 0;

    main.innerHTML =
      '<h2 class="pjTitle">Start a project</h2>' +
      '<p class="pjLead">A working name and a one-sentence pitch. Everything stays a draft until you create the project.</p>' +
      '<div class="pjCard">' +
        '<label class="pjLabel" for="pjName">WORKING NAME</label>' +
        '<input class="pjName" id="pjName" maxlength="80" placeholder="Example: SniperSight" />' +
        '<label class="pjLabel" for="pjPitch">ONE-SENTENCE PITCH — OPTIONAL TO BEGIN</label>' +
        '<textarea class="pjPitch" id="pjPitch" maxlength="240" placeholder="What is it, in one breath?"></textarea>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn primary pjBegin" disabled>BEGIN INTERVIEW →</button>' +
        '</div>' +
        '<div class="pjErr pjStartErr"></div>' +
      '</div>' +
      '<div class="pjCard pjResume" ' + (hasDrafts || state.listError ? '' : 'hidden') + '>' +
        '<div class="pjLabel">RESUME A SAVED DRAFT</div>' +
        '<select class="pjDraftSelect" aria-label="Saved project drafts" ' + (hasDrafts ? '' : 'hidden') + '>' + options + '</select>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjResumeBtn"' + (hasDrafts ? '' : ' disabled') + '>RESUME</button>' +
          '<button type="button" class="pjBtn pjDeleteBtn"' + (hasDrafts ? '' : ' disabled') + '>DELETE DRAFT</button>' +
        '</div>' +
        '<div class="pjErr pjResumeMsg" data-tone="' + (state.listError ? 'warn' : 'quiet') + '">' +
          escapeHtml(state.listError || state.draftWarnings.join(' · ')) + '</div>' +
      '</div>';

    const nameEl = main.querySelector('.pjName');
    const pitchEl = main.querySelector('.pjPitch');
    const begin = main.querySelector('.pjBegin');
    nameEl.value = state.draft ? state.draft.name : '';
    pitchEl.value = state.draft ? state.draft.pitch : '';
    const refresh = () => { begin.disabled = !nameEl.value.trim() || state.busy; };
    nameEl.addEventListener('input', refresh);
    pitchEl.addEventListener('input', refresh);
    refresh();
    begin.addEventListener('click', () => {
      if (begin.disabled) return;
      begin.disabled = true;
      state.busy = true;
      state.pendingStep = cardKeys()[0] || 'idea';
      ApexBus.post('projectsDraftCreate', { name: nameEl.value, pitch: pitchEl.value });
    });

    const select = main.querySelector('.pjDraftSelect');
    const resumeBtn = main.querySelector('.pjResumeBtn');
    const deleteBtn = main.querySelector('.pjDeleteBtn');
    const disarm = () => { state.deleteArmedId = null; if (deleteBtn) deleteBtn.textContent = 'DELETE DRAFT'; };
    if (select) select.addEventListener('change', disarm);
    if (resumeBtn) resumeBtn.addEventListener('click', () => {
      if (!select || !select.value) return;
      disarm();
      state.busy = true;
      ApexBus.post('projectsDraftOpen', { id: select.value });
    });
    if (deleteBtn) deleteBtn.addEventListener('click', () => {
      if (!select || !select.value) return;
      if (state.deleteArmedId !== select.value) {
        state.deleteArmedId = select.value;
        deleteBtn.textContent = 'CONFIRM DELETE';
        return;
      }
      ApexBus.post('projectsDraftDelete', { id: select.value, confirmed: true });
      disarm();
    });
  }

  // ---- slice 6: AI suggest pass block (opt-in, one card at a time) --------
  // Prepare shows a usage estimate; nothing runs until the user hits RUN,
  // mirroring personas' personaTestPrepare→personaTestStart two-step gate.
  function suggestFor(cardKey) {
    if (state.suggest.card !== cardKey) return { card: cardKey, prepared: null, busy: false, phase: null, result: null };
    return state.suggest;
  }

  function renderAiSuggestBlock(card) {
    const s = suggestFor(card.key);
    const canRun = Boolean(s.prepared) && !s.busy;
    const chips = (s.result && s.result.suggestions) || [];
    const errText = (s.result && s.result.error) ||
      (s.phase === 'error' && s.errorText) || '';
    return (
      '<div class="pjAiSuggest">' +
        '<div class="pjAiRow">' +
          '<button type="button" class="pjBtn pjAiPrepare" ' + (s.busy ? 'disabled' : '') + ' ' +
            'title="Runs one hidden, tool-disabled disposable session to suggest additions to this answer — a real Claude turn, opt-in.">' +
            (s.prepared ? 'RE-CHECK USAGE' : 'AI SUGGEST (USES A SESSION)') +
          '</button>' +
          (s.prepared
            ? '<button type="button" class="pjBtn primary pjAiRun" ' + (canRun ? '' : 'disabled') + '>RUN AI PASS</button>'
            : '') +
          (s.busy ? '<button type="button" class="pjBtn pjAiStop">STOP</button>' : '') +
        '</div>' +
        (s.prepared
          ? '<div class="pjWsSub pjAiUsage">' + escapeHtml(usageNote(s.prepared.usage)) + '</div>'
          : '') +
        (s.busy ? '<div class="pjWsSub pjAiUsage">Running the disposable turn…</div>' : '') +
        (errText ? '<div class="pjErr" data-tone="warn">' + escapeHtml(errText) + '</div>' : '') +
        (chips.length
          ? '<div class="pjChipRow pjAiChipRow">' +
              chips.map((c, i) => `<span class="pjChip pjAiChip" data-ai-i="${i}">${escapeHtml(c)}</span>`).join('') +
            '</div>'
          : '') +
      '</div>'
    );
  }

  function usageNote(usage) {
    if (!usage) return 'Usage data is unavailable — the pass can still run.';
    if (usage.stale) return 'Usage snapshot is stale, but the pass can still run.';
    const bits = [];
    if (usage.session) bits.push('session ' + usage.session);
    if (usage.weekly) bits.push('weekly ' + usage.weekly);
    return bits.length ? 'Usage — ' + bits.join(' · ') : 'Usage check passed.';
  }

  function wireAiSuggestBlock(card) {
    const prepareBtn = main.querySelector('.pjAiPrepare');
    const runBtn = main.querySelector('.pjAiRun');
    const stopBtn = main.querySelector('.pjAiStop');
    const box = answerBox();
    if (prepareBtn) prepareBtn.addEventListener('click', () => {
      if (!state.draft) return;
      state.suggest = { card: card.key, prepared: null, busy: false, phase: null, result: null };
      ApexBus.post('projectsCardSuggestPrepare', { id: state.draft.id, card: card.key });
    });
    if (runBtn) runBtn.addEventListener('click', () => {
      const s = suggestFor(card.key);
      if (!s.prepared || runBtn.disabled) return;
      state.suggest = { ...s, busy: true, phase: 'running', result: null };
      ApexBus.post('projectsCardSuggestRun', {
        id: s.prepared.draftId, card: s.prepared.card,
        expectedRevision: s.prepared.revision, approved: true,
      });
      renderCard(card);   // reflect busy state immediately
    });
    if (stopBtn) stopBtn.addEventListener('click', () => ApexBus.post('projectsCardSuggestStop', {}));
    for (const chip of main.querySelectorAll('.pjAiChip[data-ai-i]')) {
      chip.addEventListener('click', () => {
        const s = suggestFor(card.key);
        const text = ((s.result && s.result.suggestions) || [])[Number(chip.dataset.aiI)];
        if (!text || !box) return;
        // A chip only ever proposes text into the free-text box — the user
        // still has to save/next for it to become part of the answer; the AI
        // never writes the draft directly.
        box.value = (box.value ? box.value + '\n' : '') + '• ' + text;
        chip.style.opacity = '.35';
      });
    }
  }

  // ---- co-designer patch chips ON the target card (slice 7) --------------
  // A patch never touches the card until the user clicks ACCEPT here — the
  // draft is untouched by the mere existence of a chip.
  function renderCoPatchBlock(card) {
    const patches = state.codesigner.patches.filter((p) => p.card === card.key);
    if (!patches.length) return '';
    return '<div class="pjCoPatches">' + patches.map((p) =>
      '<div class="pjPatch" data-patch-id="' + escapeHtml(p.id) + '">' +
        '<div class="pjPatchWho">CO-DESIGNER PROPOSES</div>' +
        '<div class="pjPatchText">' + escapeHtml(p.proposal) + '</div>' +
        (p.why ? '<div class="pjPatchWhy">why: ' + escapeHtml(p.why) + '</div>' : '') +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn primary pjPatchAccept" data-patch-id="' + escapeHtml(p.id) + '">ACCEPT INTO CARD</button>' +
          '<button type="button" class="pjBtn pjPatchReject" data-patch-id="' + escapeHtml(p.id) + '">REJECT</button>' +
        '</div>' +
      '</div>').join('') + '</div>';
  }

  function wireCoPatchesForCard() {
    for (const btn of main.querySelectorAll('.pjPatchAccept')) {
      btn.addEventListener('click', () => {
        if (!state.draft || btn.disabled) return;
        btn.disabled = true;
        ApexBus.post('codesignerPatchAccept', {
          id: state.draft.id, patchId: btn.dataset.patchId, expectedRevision: state.draft.revision,
        });
      });
    }
    for (const btn of main.querySelectorAll('.pjPatchReject')) {
      btn.addEventListener('click', () => {
        if (!state.draft || btn.disabled) return;
        btn.disabled = true;
        ApexBus.post('codesignerPatchReject', { id: state.draft.id, patchId: btn.dataset.patchId });
      });
    }
  }

  // ---- the co-designer panel itself (slice 7) -----------------------------
  // ONE session at a time, riding ONE long-lived controller (main.js). Opening
  // always starts fresh (empty log/patches); closing tears the seat down and
  // clears local state too, so a reopen never shows a stale conversation.
  function coUpdateVisibility() {
    const hasDraft = Boolean(state.draft);
    coLauncher.hidden = !hasDraft || state.codesigner.open;
    coPanel.hidden = !state.codesigner.open;
  }

  function coUpdateControls() {
    const cs = state.codesigner;
    const canSend = cs.open && cs.controllerActive && !cs.busy;
    coInput.disabled = !canSend;
    coSendBtn.disabled = !canSend;
    coHeadSub.textContent = cs.busy ? 'thinking…' : (cs.controllerActive ? 'live' : 'not connected');
  }

  function coRenderLog() {
    const cs = state.codesigner;
    coLog.innerHTML = cs.log.map((m, i) => {
      const text = (i === cs.streamingIndex) ? (m.text + cs.streaming) : m.text;
      const cls = m.role === 'user' ? 'pjCoMsgUser' : 'pjCoMsgAi';
      return '<div class="pjCoMsg ' + cls + '">' + (escapeHtml(text) || '&hellip;') + '</div>';
    }).join('');
    coLog.scrollTop = coLog.scrollHeight;
  }

  function coShowError(message) {
    const cs = state.codesigner;
    cs.error = message || null;
    coErr.hidden = !cs.error;
    coErr.textContent = cs.error || '';
  }

  function coReset() {
    state.codesigner = {
      open: false, busy: false, controllerActive: false,
      log: [], streaming: '', streamingIndex: -1, patches: [], error: null,
    };
    coErr.hidden = true;
    coLog.innerHTML = '';
  }
  coReset();

  coOpenBtn.addEventListener('click', () => {
    if (!state.draft || state.codesigner.open) return;
    coReset();
    const cs = state.codesigner;
    cs.open = true;
    cs.busy = true;   // opening already sends the kickoff turn
    // seed the assistant's first (streaming) bubble now, so the panel never
    // looks empty while the disposable's opening turn is still in flight
    cs.log.push({ role: 'assistant', text: '' });
    cs.streamingIndex = 0;
    coUpdateVisibility();
    coUpdateControls();
    coRenderLog();
    ApexBus.post('codesignerOpen', { id: state.draft.id });
  });

  coCloseBtn.addEventListener('click', () => {
    if (!state.draft) return;
    ApexBus.post('codesignerClose', { id: state.draft.id });
    coReset();
    coUpdateVisibility();
    coUpdateControls();
    if (isCardStep(state.step)) renderCard(findCard(state.step));   // drop any chips
  });

  function coSend() {
    const cs = state.codesigner;
    if (!state.draft || !cs.open || !cs.controllerActive || cs.busy) return;
    const text = coInput.value.trim();
    if (!text) return;
    coInput.value = '';
    cs.log.push({ role: 'user', text });
    cs.log.push({ role: 'assistant', text: '' });
    cs.streamingIndex = cs.log.length - 1;
    cs.streaming = '';
    cs.busy = true;
    coShowError(null);
    coUpdateControls();
    coRenderLog();
    ApexBus.post('codesignerSend', { id: state.draft.id, text });
  }
  coSendBtn.addEventListener('click', coSend);
  coInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') coSend(); });

  function renderCard(card) {
    if (!card) { state.step = 'start'; return renderStart(); }
    const idx = cardIndex(card.key);
    const total = state.cards.length;
    const value = state.draft ? (state.draft.answers[card.key] || '') : '';

    main.innerHTML =
      '<h2 class="pjTitle">' + (idx + 1) + ' / ' + total + ' — ' + escapeHtml(card.title) + '</h2>' +
      '<p class="pjLead">' + escapeHtml(card.question) + '</p>' +
      '<div class="pjCard">' +
        '<div class="pjDepth">' + escapeHtml(card.depth) + '</div>' +
        '<div class="pjExample">' + escapeHtml(card.example) + '</div>' +
        '<textarea class="pjAnswer" maxlength="12000" placeholder="Free text — your words, not the AI\'s."></textarea>' +
        '<div class="pjChipRow">' +
          (card.suggestions || []).map((s, i) =>
            `<span class="pjChip" data-i="${i}">${escapeHtml(s)}</span>`).join('') +
          '<span class="pjChip pjHelpToggle">Help me decide</span>' +
        '</div>' +
        '<div class="pjHelp" ' + (state.helpOpen ? '' : 'hidden') + '></div>' +
        renderAiSuggestBlock(card) +
        renderCoPatchBlock(card) +
        '<div class="pjBtnRow">' +
          (idx > 0 ? '<button type="button" class="pjBtn pjBack">← BACK</button>' : '') +
          '<button type="button" class="pjBtn primary pjNext">' +
            (idx < total - 1 ? 'SAVE & NEXT →' : 'REVIEW BLUEPRINT →') + '</button>' +
          '<button type="button" class="pjBtn pjSaveDraft">SAVE DRAFT</button>' +
          (idx < total - 1 ? '<button type="button" class="pjBtn pjSkip">SKIP FOR NOW</button>' : '') +
        '</div>' +
        '<div class="pjErr pjCardErr"></div>' +
      '</div>';

    const box = main.querySelector('.pjAnswer');
    box.value = value;
    box.disabled = state.busy;
    // autosave on blur (a "card change" the spec asks be persisted)
    box.addEventListener('change', () => { if (state.draft && !state.busy) save(card.key); });

    for (const chip of main.querySelectorAll('.pjChip[data-i]')) {
      chip.addEventListener('click', () => {
        const text = (card.suggestions || [])[Number(chip.dataset.i)];
        box.value = (box.value ? box.value + '\n' : '') + '• ' + text;
        chip.style.opacity = '.35';
      });
    }

    wireAiSuggestBlock(card);
    wireCoPatchesForCard(card);

    const help = main.querySelector('.pjHelp');
    const renderHelp = () => {
      const nudges = helpNudges(card.key, box.value);
      help.innerHTML =
        '<div class="pjHelpHead">HELP ME DECIDE</div>' +
        (nudges.length ? '<ul class="pjNudges">' + nudges.map((n) =>
          `<li>${escapeHtml(n)}</li>`).join('') + '</ul>' : '') +
        '<ul class="pjHints">' + (card.heuristics || []).map((h) =>
          `<li>${escapeHtml(h)}</li>`).join('') + '</ul>' +
        '<div class="pjHelpTail">' + escapeHtml(card.help) + '</div>';
    };
    main.querySelector('.pjHelpToggle').addEventListener('click', () => {
      state.helpOpen = !state.helpOpen;
      help.hidden = !state.helpOpen;
      if (state.helpOpen) renderHelp();
    });
    if (state.helpOpen) renderHelp();

    const back = main.querySelector('.pjBack');
    if (back) back.addEventListener('click', () => goStep(cardKeys()[idx - 1]));
    main.querySelector('.pjNext').addEventListener('click', () => {
      goStep(idx < total - 1 ? cardKeys()[idx + 1] : 'review');
    });
    main.querySelector('.pjSaveDraft').addEventListener('click', () => goStep('start'));
    const skip = main.querySelector('.pjSkip');
    if (skip) skip.addEventListener('click', () => goStep(cardKeys()[idx + 1]));
  }

  // ---- Blueprint Review: structured answers, gaps highlighted -------------
  function renderReview() {
    const draft = state.draft;
    if (!draft) { state.step = 'start'; return renderStart(); }
    const preview = draft.preview;
    const projectId = preview ? preview.projectId : (state.projectId || state.suggestedProjectId || '');
    let gapCount = 0;
    const rows = state.cards.map((c) => {
      const text = (draft.answers[c.key] || '').trim();
      const gap = !text;
      if (gap) gapCount += 1;
      return '<div class="pjReviewRow" data-gap="' + (gap ? 'true' : 'false') + '">' +
        '<div class="pjReviewHead">' + escapeHtml(c.title) +
          (gap ? '<span class="pjGapTag">INCOMPLETE</span>' : '') + '</div>' +
        '<div class="pjReviewBody">' +
          (gap
            ? 'No answer yet — this area renders as a visible gap in the canonical. The builder never invents content to fill it.'
            : escapeHtml(text)) +
        '</div>' +
      '</div>';
    }).join('');

    const gapNote = gapCount
      ? gapCount + ' area' + (gapCount === 1 ? '' : 's') + ' incomplete. You can generate the canonical now — the gaps stay visibly marked — or go back and fill them.'
      : 'All six areas answered. Note: "Risks and Open Questions" has no dedicated card, so it renders as a gap until you author it in the canonical.';

    main.innerHTML =
      '<h2 class="pjTitle">Blueprint review</h2>' +
      '<p class="pjLead">Your structured answers, before prose. Gaps are highlighted; the canonical is generated from approved answers only.</p>' +
      '<div class="pjCard">' +
        '<label class="pjLabel" for="pjProjectId">PROJECT ID — LOWERCASE KEBAB-CASE</label>' +
        '<input class="pjName pjProjectId" id="pjProjectId" maxlength="64" value="' + escapeHtml(projectId) + '" />' +
        '<div class="pjWsSub pjGapNote">' + escapeHtml(gapNote) + '</div>' +
      '</div>' +
      '<div class="pjReviewList">' + rows + '</div>' +
      '<div class="pjCard">' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjReviewBack">← BACK TO INTERVIEW</button>' +
          '<button type="button" class="pjBtn primary pjGenerate">' +
            (preview ? 'REGENERATE CANONICAL →' : 'GENERATE CANONICAL →') + '</button>' +
          (preview ? '<button type="button" class="pjBtn pjToCanonical">OPEN CANONICAL →</button>' : '') +
        '</div>' +
        '<div class="pjErr pjReviewErr"></div>' +
      '</div>';

    const idInput = main.querySelector('.pjProjectId');
    idInput.addEventListener('input', () => {
      state.projectId = idInput.value.trim();
      state.confirmOverwrite = false;
      const g = main.querySelector('.pjGenerate');
      if (g) g.textContent = preview ? 'REGENERATE CANONICAL →' : 'GENERATE CANONICAL →';
    });
    main.querySelector('.pjReviewBack').addEventListener('click', () => goStep(cardKeys()[state.cards.length - 1]));
    main.querySelector('.pjGenerate').addEventListener('click', () => {
      if (state.busy) return;
      state.busy = true;
      ApexBus.post('projectsPreviewGenerate', {
        id: draft.id, expectedRevision: draft.revision,
        projectId: (idInput.value.trim() || projectId),
        confirmedOverwrite: state.confirmOverwrite,
      });
    });
    const toCanonical = main.querySelector('.pjToCanonical');
    if (toCanonical) toCanonical.addEventListener('click', () => goStep('canonical'));
  }

  // ---- Canonical Draft: preview, per-section regen, manual edit, drift ----
  function renderCanonicalView() {
    const draft = state.draft;
    if (!draft || !draft.preview) { state.step = 'review'; return renderReview(); }
    const bundle = draft.preview;
    const drift = Boolean(bundle.canonicalDrift);
    const gaps = bundle.gaps || [];

    const sectionOptions = SECTIONS.map((s) =>
      '<option value="' + s.key + '">' + escapeHtml(s.heading) +
        (gaps.includes(s.key) ? ' — gap' : '') + '</option>').join('');

    const driftBlock = drift
      ? '<div class="pjCard pjDrift">' +
          '<div class="pjHelpHead">CANONICAL CHANGED AFTER APPROVAL</div>' +
          '<div class="pjWsSub">A manual edit no longer matches the approved blueprint hash. Nothing is regenerated silently — choose:</div>' +
          '<div class="pjBtnRow">' +
            '<button type="button" class="pjBtn primary pjReapprove">RE-APPROVE EDITED CANONICAL</button>' +
            '<button type="button" class="pjBtn pjRegenFromAnswers">REGENERATE FROM ANSWERS (DISCARD EDIT)</button>' +
          '</div>' +
        '</div>'
      : '';

    let validationBlock = '';
    if (state.validation) {
      const r = state.validation;
      const summary = r.valid
        ? 'VALID · ' + r.warnings.length + ' warning(s) · ' + r.suggestions.length + ' suggestion(s)'
        : 'BLOCKED · ' + r.errors.length + ' error(s) · ' + r.warnings.length + ' warning(s)';
      const findings = [
        ...r.errors.map((f) => ['error', f]),
        ...r.warnings.map((f) => ['warning', f]),
        ...r.suggestions.map((f) => ['suggestion', f]),
      ].map(([sev, f]) =>
        '<div class="pjFinding" data-sev="' + sev + '">' + sev.toUpperCase() + ' · ' + escapeHtml(f.message) + '</div>').join('');
      validationBlock =
        '<div class="pjValSummary" data-tone="' + (r.valid ? 'good' : 'warn') + '">' + escapeHtml(summary) + '</div>' +
        '<div class="pjFindings">' + findings + '</div>';
    }

    main.innerHTML =
      '<h2 class="pjTitle">Canonical draft</h2>' +
      '<p class="pjLead">PROJECT.md, generated from approved answers. Edit it, regenerate one section, or validate — errors block, warnings need review, suggestions advise.</p>' +
      '<div class="pjWsSub pjCanonState" data-tone="' + (state.stale || drift ? 'warn' : 'good') + '">' +
        escapeHtml(state.stale
          ? 'Interview answers changed after this canonical. Regenerate from answers to bring them in.'
          : (drift ? 'Manual edits differ from the approved blueprint hash — resolve the review below.'
                   : 'Canonical matches the approved blueprint hash.')) +
        (gaps.length ? ' Gaps (visibly incomplete, never invented): ' + gaps.map(sectionHeading).join(', ') + '.' : '') +
      '</div>' +
      driftBlock +
      '<div class="pjCard">' +
        '<label class="pjLabel">BLUEPRINT.JSON</label>' +
        '<pre class="pjBlueprint">' + escapeHtml(JSON.stringify(bundle.blueprint, null, 2)) + '</pre>' +
      '</div>' +
      '<div class="pjCard">' +
        '<label class="pjLabel" for="pjCanonical">AUTHORITATIVE CANONICAL MARKDOWN</label>' +
        '<textarea class="pjCanonical" id="pjCanonical" maxlength="131072" spellcheck="false"></textarea>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjCanonSave" disabled>SAVE CANONICAL EDIT</button>' +
          '<button type="button" class="pjBtn pjCanonRestore">RESTORE SAVED</button>' +
        '</div>' +
        '<div class="pjSectionRegen">' +
          '<label class="pjLabel">REGENERATE ONE SECTION FROM ITS ANSWER</label>' +
          '<select class="pjSectionSelect pjDraftSelect">' + sectionOptions + '</select>' +
          '<div class="pjBtnRow">' +
            '<button type="button" class="pjBtn pjSectionRegenBtn">REGENERATE SECTION</button>' +
          '</div>' +
        '</div>' +
        '<div class="pjErr pjCanonErr"></div>' +
      '</div>' +
      '<div class="pjCard">' +
        '<label class="pjLabel">VALIDATION REPORT</label>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjValidate">VALIDATE</button>' +
        '</div>' +
        validationBlock +
      '</div>' +
      '<div class="pjCard">' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjCanonReviewBack">← BACK TO REVIEW</button>' +
          '<button type="button" class="pjBtn pjRegenAll">REGENERATE ALL FROM ANSWERS</button>' +
        '</div>' +
      '</div>';

    const canon = main.querySelector('.pjCanonical');
    canon.value = bundle.canonical;
    canon.disabled = state.busy;
    const saveBtn = main.querySelector('.pjCanonSave');
    canon.addEventListener('input', () => {
      state.canonicalDirty = canon.value !== bundle.canonical;
      saveBtn.disabled = !state.canonicalDirty || state.busy;
    });
    saveBtn.addEventListener('click', () => {
      if (saveBtn.disabled || state.busy) return;
      state.busy = true;
      ApexBus.post('projectsPreviewSaveCanonical', {
        id: draft.id, expectedRevision: draft.revision, canonical: canon.value,
      });
    });
    main.querySelector('.pjCanonRestore').addEventListener('click', () => {
      if (state.busy) return;
      state.busy = true;
      ApexBus.post('projectsPreviewOpen', { id: draft.id });
    });
    main.querySelector('.pjSectionRegenBtn').addEventListener('click', () => {
      if (state.busy) return;
      state.busy = true;
      ApexBus.post('projectsPreviewRegenerateSection', {
        id: draft.id, expectedRevision: draft.revision,
        key: main.querySelector('.pjSectionSelect').value,
      });
    });
    main.querySelector('.pjValidate').addEventListener('click', () => {
      ApexBus.post('projectsPreviewValidate', { id: draft.id });
    });
    main.querySelector('.pjCanonReviewBack').addEventListener('click', () => goStep('review'));
    main.querySelector('.pjRegenAll').addEventListener('click', () => {
      if (state.busy) return;
      state.busy = true;
      ApexBus.post('projectsPreviewGenerate', {
        id: draft.id, expectedRevision: draft.revision,
        projectId: bundle.projectId, confirmedOverwrite: true,
      });
    });
    const reapprove = main.querySelector('.pjReapprove');
    if (reapprove) reapprove.addEventListener('click', () => {
      if (state.busy) return;
      state.busy = true;
      ApexBus.post('projectsPreviewAcceptCanonical', { id: draft.id, expectedRevision: draft.revision });
    });
    const regenFromAnswers = main.querySelector('.pjRegenFromAnswers');
    if (regenFromAnswers) regenFromAnswers.addEventListener('click', () => {
      if (state.busy) return;
      state.busy = true;
      ApexBus.post('projectsPreviewGenerate', {
        id: draft.id, expectedRevision: draft.revision,
        projectId: bundle.projectId, confirmedOverwrite: true,
      });
    });
  }

  // ---- Create Project (slice 8): the explicit action that writes the atomic
  // package. Everything before this is a draft; nothing on disk exists yet.
  function renderCreate() {
    const draft = state.draft;
    if (!draft || !draft.preview) { state.step = 'canonical'; return renderCanonicalView(); }
    const bundle = draft.preview;
    const already = state.createdProject && state.createdProject.projectId === bundle.projectId;
    main.innerHTML =
      '<h2 class="pjTitle">Create project</h2>' +
      '<p class="pjLead">Writes ' + escapeHtml(bundle.projectId) + '/ into the projects workspace — PROJECT.md, ' +
        'blueprint.json, project-context.md — atomically. This never overwrites an existing project; ' +
        'a collision is a clean error, not a partial write.</p>' +
      '<div class="pjCard">' +
        (bundle.canonicalDrift
          ? '<div class="pjErr" data-tone="warn">The canonical has unresolved drift — resolve it on the Canonical Draft step first.</div>'
          : '') +
        (already
          ? '<div class="pjWsSub" data-tone="good">Created at ' + escapeHtml(state.createdProject.projectDir) + '</div>'
          : '<div class="pjBtnRow">' +
              '<button type="button" class="pjBtn primary pjCreateBtn" ' +
                (state.createBusy || bundle.canonicalDrift ? 'disabled' : '') + '>CREATE PROJECT</button>' +
            '</div>') +
        (state.createError ? '<div class="pjErr" data-tone="warn">Not created — ' + escapeHtml(state.createError) + '</div>' : '') +
        (already ? '<div class="pjBtnRow"><button type="button" class="pjBtn primary pjToLiftoff">LIFT-OFF →</button></div>' : '') +
      '</div>' +
      '<div class="pjCard">' +
        '<div class="pjBtnRow"><button type="button" class="pjBtn pjCreateBack">← BACK TO CANONICAL</button></div>' +
      '</div>';

    const createBtn = main.querySelector('.pjCreateBtn');
    if (createBtn) createBtn.addEventListener('click', () => {
      if (state.createBusy) return;
      state.createBusy = true;
      state.createError = null;
      render();
      ApexBus.post('projectsCreate', { id: draft.id, expectedRevision: draft.revision, confirmed: true });
    });
    const toLiftoff = main.querySelector('.pjToLiftoff');
    if (toLiftoff) toLiftoff.addEventListener('click', () => goStep('liftoff'));
    main.querySelector('.pjCreateBack').addEventListener('click', () => goStep('canonical'));
  }

  // ---- Lift-off (slice 8): the payoff screen, offered right after Create
  // succeeds. Three independent actions — none of them chains into another.
  function renderLiftoff() {
    if (!state.createdProject) { state.step = 'create'; return renderCreate(); }
    const p = state.createdProject;
    const lift = state.liftoff;

    main.innerHTML =
      '<h2 class="pjTitle">Lift-off — ' + escapeHtml(p.displayName || p.projectId) + '</h2>' +
      '<p class="pjLead">' + escapeHtml(p.projectDir) + '</p>' +

      '<div class="pjCard">' +
        '<div class="pjLabel">REGISTER WORKSPACE</div>' +
        '<div class="pjWsSub">Adds this project to every seat/workspace picker in Apex. A name or path already ' +
          'registered WARNS and is never overwritten.</div>' +
        '<input class="pjName pjLiftRegisterName" maxlength="80" placeholder="' + escapeHtml(p.displayName || p.projectId) + '" />' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn primary pjLiftRegisterBtn" ' + (lift.registerBusy ? 'disabled' : '') + '>REGISTER</button>' +
        '</div>' +
        (lift.registerResult
          ? '<div class="pjErr" data-tone="' + (lift.registerResult.ok ? 'good' : 'warn') + '">' +
              escapeHtml(lift.registerResult.ok
                ? 'Registered as "' + lift.registerResult.name + '".'
                : (lift.registerResult.warning ? lift.registerResult.error : 'Not registered — ' + lift.registerResult.error)) +
            '</div>'
          : '') +
      '</div>' +

      '<div class="pjCard">' +
        '<div class="pjLabel">DELEGATE TO THE ARCHITECT</div>' +
        '<div class="pjWsSub">Creates a board task in this project\'s folder and hands PROJECT.md to the route\'s ' +
          'first step. Leave the route blank to default to the Architect alone; edit it before delegating.</div>' +
        '<label class="pjLabel" for="pjLiftRoute">ROUTE — COMMA-SEPARATED PERSONA NAMES</label>' +
        '<input class="pjName pjLiftRoute" id="pjLiftRoute" maxlength="400" placeholder="Architect" value="' + escapeHtml(lift.routeText) + '" />' +
        '<label class="pjBtnRow"><input type="checkbox" class="pjLiftSaveTemplate" ' + (lift.saveAsTemplate ? 'checked' : '') + ' /> ' +
          'save this route as a template</label>' +
        '<input class="pjName pjLiftTemplateName" maxlength="60" placeholder="Template name" ' +
          (lift.saveAsTemplate ? '' : 'hidden') + ' value="' + escapeHtml(lift.templateName) + '" />' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn primary pjLiftDelegateBtn" ' + (lift.delegateBusy ? 'disabled' : '') + '>DELEGATE →</button>' +
        '</div>' +
        (lift.delegateResult
          ? '<div class="pjErr" data-tone="' + (lift.delegateResult.ok ? 'good' : 'warn') + '">' +
              escapeHtml(lift.delegateResult.ok
                ? 'Delegated on the route: ' + lift.delegateResult.route.join(' → ')
                : 'Not delegated — ' + lift.delegateResult.error) +
            '</div>'
          : '') +
      '</div>' +

      '<div class="pjCard">' +
        '<div class="pjLabel">OPEN A CHAT HERE</div>' +
        '<div class="pjWsSub">One plain chat seat in this project\'s folder — no route, no task.</div>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjLiftChatBtn" ' + (lift.chatBusy ? 'disabled' : '') + '>OPEN CHAT</button>' +
        '</div>' +
        (lift.chatResult
          ? '<div class="pjErr" data-tone="' + (lift.chatResult.ok ? 'good' : 'warn') + '">' +
              escapeHtml(lift.chatResult.ok ? 'Opened.' : 'Not opened — ' + lift.chatResult.error) +
            '</div>'
          : '') +
      '</div>' +

      '<div class="pjCard"><div class="pjBtnRow"><button type="button" class="pjBtn pjLiftBack">← BACK TO CREATE</button></div></div>';

    main.querySelector('.pjLiftRegisterBtn').addEventListener('click', () => {
      if (lift.registerBusy) return;
      lift.registerBusy = true;
      lift.registerResult = null;
      const nameEl = main.querySelector('.pjLiftRegisterName');
      render();
      ApexBus.post('projectsLiftoffRegisterWorkspace', {
        projectId: p.projectId, name: (nameEl && nameEl.value.trim()) || undefined,
      });
    });

    const saveTplBox = main.querySelector('.pjLiftSaveTemplate');
    saveTplBox.addEventListener('change', () => {
      lift.saveAsTemplate = saveTplBox.checked;
      render();
    });
    main.querySelector('.pjLiftRoute').addEventListener('input', (ev) => { lift.routeText = ev.target.value; });
    const tplNameEl = main.querySelector('.pjLiftTemplateName');
    if (tplNameEl) tplNameEl.addEventListener('input', (ev) => { lift.templateName = ev.target.value; });

    main.querySelector('.pjLiftDelegateBtn').addEventListener('click', () => {
      if (lift.delegateBusy) return;
      lift.delegateBusy = true;
      lift.delegateResult = null;
      const route = lift.routeText.split(',').map((s) => s.trim()).filter(Boolean);
      render();
      ApexBus.post('projectsLiftoffDelegate', {
        projectId: p.projectId,
        route: route.length ? route : undefined,
        saveAsTemplate: lift.saveAsTemplate,
        templateName: lift.templateName,
      });
    });

    main.querySelector('.pjLiftChatBtn').addEventListener('click', () => {
      if (lift.chatBusy) return;
      lift.chatBusy = true;
      lift.chatResult = null;
      render();
      ApexBus.post('projectsLiftoffChat', { projectId: p.projectId });
    });

    main.querySelector('.pjLiftBack').addEventListener('click', () => goStep('create'));
  }

  // ---- bus handlers -------------------------------------------------------
  ApexBus.on('projectsWorkspaceStatus', (m) => {
    state.ws = m;
    if (m.configured) ApexBus.post('projectsDraftListGet', {});
    // stay on the current step, but if we were gated on ws, the rail unlocks
    if (state.step === 'ws' || (!m.configured && state.step === 'start')) render();
    else renderRail();
  });

  ApexBus.on('projectsDraftList', (m) => {
    state.cards = m.cards || state.cards;
    state.drafts = m.drafts || [];
    state.draftWarnings = m.warnings || [];
    state.listError = m.error || null;
    if (state.step === 'start') renderStart(); else renderRail();
  });

  ApexBus.on('projectsDraftStatus', (m) => {
    state.draft = m.draft;
    state.cards = m.cards || state.cards;
    if (m.suggestedProjectId) state.suggestedProjectId = m.suggestedProjectId;
    state.bundle = m.draft ? m.draft.preview : null;
    state.validation = null;   // a fresh draft state means any prior report is stale
    state.busy = false;
    const target = state.pendingStep;
    state.pendingStep = null;
    state.step = target || cardKeys()[state.draft.currentCard] || 'start';
    state.helpOpen = false;
    render();
  });

  ApexBus.on('projectsDraftResult', (m) => {
    if (m.ok) return;   // a status/list post carries the new state on success
    state.busy = false;
    state.pendingStep = null;
    render();
    const errBox = main.querySelector('.pjCardErr') || main.querySelector('.pjStartErr');
    if (errBox) {
      errBox.textContent = 'Not saved — ' + m.error;
      errBox.dataset.tone = 'warn';
    }
  });

  // ---- slice 4 preview bus handlers ----
  ApexBus.on('projectsPreviewStatus', (m) => {
    state.draft = m.draft;
    state.cards = m.cards || state.cards;
    state.bundle = m.bundle;
    state.stale = Boolean(m.stale);
    state.busy = false;
    state.canonicalDirty = false;
    state.confirmOverwrite = false;
    state.validation = null;   // a new bundle must be re-validated explicitly
    state.step = 'canonical';  // every preview mutation lands in the canonical view
    render();
  });

  ApexBus.on('projectsPreviewResult', (m) => {
    if (m.ok) return;   // a preview status carries the new bundle on success
    state.busy = false;
    if (m.needsConfirmation) {
      state.confirmOverwrite = true;
      render();
      const btn = main.querySelector('.pjGenerate') || main.querySelector('.pjRegenAll');
      if (btn) btn.textContent = state.step === 'review' ? 'CONFIRM REGENERATE →' : 'CONFIRM REGENERATE ALL';
      const err = main.querySelector('.pjReviewErr') || main.querySelector('.pjCanonErr');
      if (err) { err.textContent = m.error; err.dataset.tone = 'warn'; }
      return;
    }
    render();
    const err = main.querySelector('.pjCanonErr') || main.querySelector('.pjReviewErr');
    if (err) { err.textContent = 'Not saved — ' + m.error; err.dataset.tone = 'warn'; }
  });

  ApexBus.on('projectsValidationStatus', (m) => {
    state.validation = m.report;
    if (state.step === 'canonical') render();
  });

  // ---- slice 6: per-card AI suggest pass -----------------------------------
  ApexBus.on('projectsCardSuggestPrepared', (m) => {
    state.suggest = { card: m.card, prepared: m, busy: false, phase: 'prepared', result: null };
    if (state.step === m.card) renderCard(findCard(m.card));
  });

  ApexBus.on('projectsCardSuggestStatus', (m) => {
    if (m.phase === 'error') {
      const card = state.suggest.card;
      state.suggest = { card, prepared: null, busy: false, phase: 'error', result: null, errorText: m.error };
      if (state.step === card) renderCard(findCard(card));
      return;
    }
    if (m.phase === 'stopped') {
      const card = state.suggest.card;
      state.suggest = { card, prepared: null, busy: false, phase: 'stopped', result: null };
      if (state.step === card) renderCard(findCard(card));
    }
    // 'running' is already reflected client-side the instant RUN is clicked.
  });

  ApexBus.on('projectsCardSuggestResult', (m) => {
    const card = m.card;
    state.suggest = { card, prepared: null, busy: false, phase: m.error ? 'error' : 'done', result: m };
    if (state.step === card) renderCard(findCard(card));
  });

  // ---- slice 7: the co-designer panel ---------------------------------------
  // A dedicated draft refresh that does NOT drive step navigation (unlike
  // projectsDraftStatus) — accepting a patch on a card the user isn't even
  // looking at must not yank them there.
  ApexBus.on('projectsDraftPatched', (m) => {
    if (!state.draft || !m.draft || m.draft.id !== state.draft.id) return;
    state.draft = m.draft;
    if (m.cards) state.cards = m.cards;
    if (isCardStep(state.step)) renderCard(findCard(state.step));
  });

  ApexBus.on('codesignerStatus', (m) => {
    if (!state.draft || m.draftId !== state.draft.id) return;
    const cs = state.codesigner;
    if (m.phase === 'open') {
      cs.controllerActive = true;
      cs.busy = true;
      coShowError(null);
    } else if (m.phase === 'sending') {
      // already reflected client-side the instant SEND was clicked
    } else if (m.phase === 'closed') {
      cs.controllerActive = false;
      cs.busy = false;
    } else if (m.phase === 'error') {
      cs.controllerActive = false;
      cs.busy = false;
      coShowError(m.error || 'the co-designer session ended unexpectedly');
    }
    coUpdateControls();
  });

  ApexBus.on('codesignerDelta', (m) => {
    if (!state.draft || m.draftId !== state.draft.id) return;
    const cs = state.codesigner;
    if (!cs.open || cs.streamingIndex < 0) return;
    cs.streaming += m.text || '';
    coRenderLog();
  });

  ApexBus.on('codesignerMessage', (m) => {
    if (!state.draft || m.draftId !== state.draft.id) return;
    const cs = state.codesigner;
    if (cs.streamingIndex >= 0 && cs.log[cs.streamingIndex])
      cs.log[cs.streamingIndex].text = (m.text || cs.streaming || '').trim() || '(no reply)';
    cs.streaming = '';
    cs.streamingIndex = -1;
    cs.busy = false;
    if (m.error) coShowError(m.error);
    coUpdateControls();
    coRenderLog();
  });

  ApexBus.on('codesignerPatches', (m) => {
    if (!state.draft || m.draftId !== state.draft.id) return;
    state.codesigner.patches = m.patches || [];
    if (isCardStep(state.step)) renderCard(findCard(state.step));
  });

  // ---- slice 8: Create Project + Lift-off ----------------------------------
  ApexBus.on('projectsCreateResult', (m) => {
    state.createBusy = false;
    if (m.ok) {
      state.createError = null;
      state.createdProject = { projectId: m.projectId, projectDir: m.projectDir, displayName: m.displayName };
      state.liftoff = { registerBusy: false, registerName: '', registerResult: null,
        routeText: '', saveAsTemplate: false, templateName: '',
        delegateBusy: false, delegateResult: null, chatBusy: false, chatResult: null };
      state.step = 'liftoff';
    } else {
      state.createError = m.error;
    }
    render();
  });

  ApexBus.on('projectsLiftoffRegisterResult', (m) => {
    state.liftoff.registerBusy = false;
    state.liftoff.registerResult = m;
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsLiftoffDelegateResult', (m) => {
    state.liftoff.delegateBusy = false;
    state.liftoff.delegateResult = m;
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsLiftoffChatResult', (m) => {
    state.liftoff.chatBusy = false;
    state.liftoff.chatResult = m;
    if (state.step === 'liftoff') render();
  });

  render();
  ApexBus.post('projectsWorkspaceGet', {});
}
