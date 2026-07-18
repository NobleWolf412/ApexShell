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
        // Wave S S2 — the detached-window affordances, docked shell only:
        // the chip marks "the studio is ALSO open in its own window" (both
        // views share the same live state — every post broadcasts), and ⧉
        // opens-or-focuses that window (main's studioWindowToggle verb).
        // In the detached window itself both hide: a pop-out button inside
        // the pop-out would be an escher stair.
        '<span class="studioWinChip" hidden title="The detached STUDIO window is open — this pane and that window are two live views of the same state">&#x29C9; also open in its own window</span>' +
        '<div class="studioModelPicker" title="One model choice drives both AI levels: the per-card AI suggest pass and the co-designer panel both launch their disposable with this pick (haiku for quick suggest passes, sonnet+ for a longer co-designer conversation).">' +
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
        '<button type="button" class="studioPopBtn" title="Open STUDIO in its own window (put it on the second monitor) — focuses the window if it is already open">&#x29C9;</button>' +
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

  // smoke eyes (A4): '#builder=<id>' fronts one sub-view on load, the same way
  // '#dock=' opens a pane — APEX_SMOKE_DOCK='studio&builder=projects&pjstep=see'
  // rides the extra params through main's verbatim hash. userPicked makes the
  // choice stick when later builders (PERSONAS, order 10) register and relayout.
  // Guarded: the headless studio-drill has no `location`.
  if (typeof location !== 'undefined') {
    const wantBuilder = new URLSearchParams((location.hash || '').slice(1)).get('builder');
    if (wantBuilder && builders.has(wantBuilder)) { userPicked = true; activate(wantBuilder); }
  }

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

  // Wave S S2 — pop-out wiring. `detached` reads the same '#apexWindow=studio'
  // boot flag shell.js's studio mode reads (guarded: the headless studio-drill
  // has no `location`, and its pane mock returns null for these selectors —
  // the skeleton still builds, the wiring simply doesn't attach).
  const popBtn = pane.querySelector('.studioPopBtn');
  const winChip = pane.querySelector('.studioWinChip');
  const detached = typeof location !== 'undefined' &&
    new URLSearchParams((location.hash || '').slice(1)).get('apexWindow') === 'studio';
  if (detached && popBtn) popBtn.hidden = true;
  if (hasBus && !detached && popBtn && winChip) {
    popBtn.addEventListener('click', () => ApexBus.post('studioWindowToggle', {}));
    ApexBus.on('studioWindowState', (m) => { winChip.hidden = !(m && m.open); });
    // this script loads after the shell's 'ready' replies landed, so ask for
    // the current truth instead of hoping to have caught the open/close post
    ApexBus.post('studioWindowGet', {});
  }

  ApexShell.registerDockPane(pane, { order: 20 });
})();

// ---- PROJECTS builder: the guided interview (slice 3) ----------------------
// Workspace pick → Start (name + pitch) → the interview cards with Back / Save draft /
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
    liveAnswers: {},       // per-card UNSAVED textarea content (see setLiveAnswer)
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
    // ---- slice B1: the RUN drawer (dev-server runner on Lift-off) ----
    // `form` is the user's working copy of the config inputs — it survives
    // re-renders (the liveAnswers rule) and is seeded from the saved config
    // exactly once per project. `forProject` doubles as the fetch guard so
    // opening Lift-off asks main for the config only once. Log deltas patch
    // the <pre> directly (a full render per log line would eat the caret).
    server: {
      forProject: null, config: null, form: null,
      phase: 'stopped', port: null, log: [], error: null, busy: false,
    },
    // ---- slice 9: import/audit mode ----
    // Read-only inspection of an existing project folder; a mapping the user
    // reviews (and can retarget one row at a time — targeted revision) before
    // anything is built. Reached from Start via IMPORT EXISTING PROJECT.
    importAudit: null,   // last projectsImportAudit payload (sections, mapping, gaps)
    importBusy: false,
    importError: null,
    // ---- slice 6: per-card AI suggest pass (opt-in, one disposable turn) ----
    // Keyed to a single card at a time; switching cards drops any stale
    // prepared/result state rather than carrying it to the wrong question.
    suggest: { card: null, prepared: null, busy: false, phase: null, result: null },
    // ---- slices A3+A4: the mockup pass + the SEE step. A3's minimal list on
    // the Canonical step is ABSORBED into the SEE step (A4) — one surface owns
    // screens, generation, preview, and approval. `forDraft` doubles as the
    // request guard so the list fetch never loops with its own re-render.
    // added/removed are the user's local edits over the deterministic proposal
    // (rename = remove + add); prepared/busy mirror the suggest block's
    // two-step gate; deviceWidth drives the preview frame's width preset.
    // Preview/approval truth is read off state.draft directly (hasPreview(),
    // approvalCurrent()) — never mirrored here, so it can't go stale (the A3
    // mirrors died when A4 absorbed the surface; Sweep A6).
    mockups: {
      forDraft: null, kind: null, proposed: [], generated: [],
      error: null, removed: [], added: [], selected: null,
      prepared: null, busy: false, resultError: null,
      deviceWidth: 'desktop', approveMsg: null,
      // ---- slice A5: annotate mode. The picker only exists in the derived
      // .annotate.html, which is only iframed while annotate is on — so "the
      // picker never runs outside the SEE step" holds by construction.
      annotate: false, pendingPick: null, noteMsg: null,
    },
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

  // The seven canonical sections — key + default heading — mirrored from
  // lib/render.js SECTIONS (the renderer can't require node libs; this static
  // copy drives the per-section regen picker and the gap labels only).
  const SECTIONS = [
    { key: 'vision', heading: 'Vision and Users' },
    { key: 'scope', heading: 'Scope and MVP Cut' },
    { key: 'platform', heading: 'Platform and Stack' },
    { key: 'architecture', heading: 'Architecture Sketch' },
    { key: 'delivery', heading: 'Milestones and Delivery' },
    { key: 'look', heading: 'Design Language' },
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
      { id: 'see', label: 'See', sub: 'mockups + approve' },
      { id: 'create', label: 'Create', sub: 'write the package' },
      { id: 'liftoff', label: 'Lift-off', sub: 'register · delegate · chat' },
    ];
  }

  const hasPreview = () => Boolean(state.draft && state.draft.preview);
  // The client mirror of lib/mockup.isApprovalCurrent: an approval counts only
  // while its hash still matches the approved canonical (regen clears the
  // field main-side, so that arm needs no mirror).
  const approvalCurrent = () => Boolean(state.draft && state.draft.mockupApproval &&
    state.draft.preview &&
    state.draft.mockupApproval.canonicalHash === state.draft.preview.generatedCanonicalHash);

  // ---- slice A5: the annotate bridge --------------------------------------
  // The client mirror of lib/mockup.validatePickMessage — the renderer cannot
  // require node modules, so the lib export is the drilled AUTHORITY and this
  // mirror is held to it (same one-way mirroring as SECTIONS/approvalCurrent).
  // Strict allowlist over an untrusted postMessage payload: exact type string,
  // capped selector/text (oversized DROPS the message, never truncates),
  // all-finite numeric bbox, and the result is REBUILT from known fields only
  // — never a spread of the raw message. Never throws; garbage is null.
  const PICK_TYPE = 'apex-mockup-pick';
  const PICK_CANCEL_TYPE = 'apex-mockup-pick-cancel';
  const MAX_PICK_SELECTOR = 256;
  const MAX_PICK_TEXT = 160;
  function validatePickMessage(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.type === PICK_CANCEL_TYPE) return { kind: 'cancel' };
    if (raw.type !== PICK_TYPE) return null;
    if (typeof raw.selector !== 'string' || !raw.selector.trim() ||
        raw.selector.length > MAX_PICK_SELECTOR) return null;
    if (typeof raw.text !== 'string' || raw.text.length > MAX_PICK_TEXT) return null;
    const b = raw.bbox;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    for (const key of ['x', 'y', 'w', 'h'])
      if (typeof b[key] !== 'number' || !Number.isFinite(b[key])) return null;
    return { kind: 'pick', selector: raw.selector, text: raw.text,
             bbox: { x: b.x, y: b.y, w: b.w, h: b.h } };
  }

  // The bridge's window listeners exist ONLY while the SEE step is mounted
  // AND annotate mode is on: every render() tears the bridge down first and
  // only wireSee (annotate on, iframe present) arms a fresh one, bound to
  // THAT iframe's contentWindow — the strongest identity check available
  // against a sandboxed (opaque-origin) frame. A hostile mockup can post
  // floods of garbage; everything non-conforming drops silently here.
  let pickBridge = null;   // { onMessage, onKey }
  function teardownPickBridge() {
    if (!pickBridge) return;
    window.removeEventListener('message', pickBridge.onMessage);
    window.removeEventListener('keydown', pickBridge.onKey);
    pickBridge = null;
  }

  const stepDone = (id) => {
    if (id === 'ws') return Boolean(state.ws && state.ws.configured);
    if (id === 'start') return Boolean(state.draft);
    if (id === 'import') return false;   // never shows a checkmark; it's a one-shot side entry
    if (id === 'review') return hasPreview();
    if (id === 'canonical') return hasPreview() && !state.draft.preview.canonicalDrift;
    if (id === 'see') return approvalCurrent();
    if (id === 'create') return Boolean(state.createdProject);
    if (id === 'liftoff') return false;
    return Boolean(state.draft && (state.draft.answers[id] || '').trim());
  };
  const stepReachable = (id) => {
    if (id === 'ws') return true;
    if (id === 'start') return Boolean(state.ws && state.ws.configured);
    if (id === 'import') return Boolean(state.ws && state.ws.configured); // same gate as Start
    if (id === 'review') return Boolean(state.draft);       // review needs a started draft
    if (id === 'canonical') return hasPreview();             // canonical needs a preview
    if (id === 'see') return hasPreview();                    // mockups render FROM the approved blueprint
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
    if (key === 'look' && !/(dark|light|palette|colou?r|neutral|accent|mono(?:chrome)?|warm|cool|contrast|muted|vivid)/i.test(answer))
      out.push('No palette leaning yet — even "dark, one accent color" steers every screen.');
    if (key === 'look' && !/(tone|feel|calm|playful|serious|minimal|bold|quiet|friendly|professional|utilitarian|focused|clean|sharp|soft|dense|airy)/i.test(answer))
      out.push('No tone words yet — three adjectives (calm, focused, dense) set the mood of every screen.');
    return out;
  }

  const answerBox = () => main.querySelector('.pjAnswer');

  // The card textarea's UNSAVED content, per card key. The card re-renders for
  // reasons that have nothing to do with the user's typing — a co-designer
  // patch list arriving/clearing, a patch accepted on another card, a save
  // rejected by the revision gate — and renderCard rebuilds main.innerHTML,
  // which used to reset the box to the last-SAVED answer and silently destroy
  // whatever was typed since (operator data-loss report, 2026-07-18: a
  // co-designer timeout + close reverted a card to its previous save). The box
  // is the user's working copy: it may only be replaced by an explicit save
  // landing or the draft itself changing — never by a passive re-render.
  // An entry exists only while the box actually diverges from the saved
  // answer, so `key in liveAnswers` doubles as the dirty flag.
  function setLiveAnswer(key, value) {
    const saved = state.draft ? (state.draft.answers[key] || '') : '';
    if (value === saved) delete state.liveAnswers[key];
    else state.liveAnswers[key] = value;
  }
  function boxValueFor(key) {
    if (key in state.liveAnswers) return state.liveAnswers[key];
    return state.draft ? (state.draft.answers[key] || '') : '';
  }

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
    teardownPickBridge();   // A5: only wireSee (SEE + annotate on) re-arms it
    renderRail();
    coUpdateVisibility();
    if (state.step === 'ws') return renderWs();
    if (state.step === 'start') return renderStart();
    if (state.step === 'import') return renderImport();
    if (state.step === 'review') return renderReview();
    if (state.step === 'canonical') return renderCanonicalView();
    if (state.step === 'see') return renderSee();
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
          '<button type="button" class="pjBtn pjImportBtn">IMPORT EXISTING PROJECT…</button>' +
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

    main.querySelector('.pjImportBtn').addEventListener('click', () => {
      state.importAudit = null;
      state.importError = null;
      goStep('import');
    });
  }

  // ---- Import/audit mode (slice 9) -----------------------------------------
  // Read-only inspection -> a per-section mapping the user reviews (and can
  // retarget one row at a time without redoing the pick/read) -> a new draft
  // whose answers come from the APPROVED mapping only. The source folder is
  // never written by anything this view does.
  function renderImport() {
    const audit = state.importAudit;

    if (!audit) {
      main.innerHTML =
        '<h2 class="pjTitle">Import an existing project</h2>' +
        '<p class="pjLead">Pick a folder that holds an existing PROJECT.md (or a folder with just one Markdown ' +
          'file in it). Nothing in that folder is ever changed — this only reads it.</p>' +
        '<div class="pjCard">' +
          '<div class="pjBtnRow">' +
            '<button type="button" class="pjBtn primary pjImportChoose" ' + (state.importBusy ? 'disabled' : '') + '>CHOOSE FOLDER…</button>' +
            '<button type="button" class="pjBtn pjImportBack">← BACK</button>' +
          '</div>' +
          (state.importError ? '<div class="pjErr" data-tone="warn">' + escapeHtml(state.importError) + '</div>' : '') +
        '</div>';
      main.querySelector('.pjImportChoose').addEventListener('click', () => {
        state.importBusy = true;
        state.importError = null;
        render();
        ApexBus.post('projectsImportChoose', {});
      });
      main.querySelector('.pjImportBack').addEventListener('click', () => goStep('start'));
      return;
    }

    const areaOptions = (current) => '<option value="">— unmapped (a gap) —</option>' +
      state.cards.map((c) =>
        '<option value="' + escapeHtml(c.key) + '"' + (current === c.key ? ' selected' : '') + '>' +
          escapeHtml(c.title) + '</option>').join('');

    const rows = audit.sections.map((s) => {
      const current = audit.mapping[String(s.index)] || '';
      return '<div class="pjImportRow">' +
        '<div class="pjImportHeading">' + escapeHtml(s.heading) + '</div>' +
        '<div class="pjImportContent">' + escapeHtml(s.content.slice(0, 240)) + (s.content.length > 240 ? '…' : '') + '</div>' +
        '<label class="pjLabel">MAPS TO</label>' +
        '<select class="pjDraftSelect pjImportMap" data-index="' + s.index + '">' + areaOptions(current) + '</select>' +
      '</div>';
    }).join('');

    const gapNote = audit.gaps.length
      ? 'Not yet mapped, will report as a gap (never invented): ' +
        audit.gaps.map((k) => (findCard(k) || { title: k }).title).join(', ')
      : 'Every one of the areas has at least one section mapped to it.';

    const findings = [
      ...audit.errors.map((f) => ['error', f]),
      ...audit.warnings.map((f) => ['warning', f]),
    ].map(([sev, f]) => '<div class="pjFinding" data-sev="' + sev + '">' + sev.toUpperCase() + ' · ' + escapeHtml(f.message) + '</div>').join('');

    main.innerHTML =
      '<h2 class="pjTitle">Review the import mapping</h2>' +
      '<p class="pjLead">' + escapeHtml(audit.canonicalFile) + ' — read-only. Assign each section to one of the ' +
        'areas, or leave it unmapped. Changing one row is a targeted revision: it never re-reads the source.</p>' +
      (findings ? '<div class="pjFindings">' + findings + '</div>' : '') +
      '<div class="pjCard">' +
        '<label class="pjLabel" for="pjImportName">WORKING NAME</label>' +
        '<input class="pjName" id="pjImportName" maxlength="80" value="' + escapeHtml(audit.displayName || '') + '" />' +
        '<label class="pjLabel" for="pjImportPitch">ONE-SENTENCE PITCH</label>' +
        '<textarea class="pjPitch" id="pjImportPitch" maxlength="240">' + escapeHtml(audit.description || '') + '</textarea>' +
      '</div>' +
      '<div class="pjImportList">' + rows + '</div>' +
      '<div class="pjCard">' +
        '<div class="pjWsSub pjGapNote">' + escapeHtml(gapNote) + '</div>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjImportBack">← CHOOSE A DIFFERENT FOLDER</button>' +
          '<button type="button" class="pjBtn primary pjImportBuild" ' +
            (state.importBusy || audit.errors.length ? 'disabled' : '') + '>BUILD DRAFT FROM THIS MAPPING →</button>' +
        '</div>' +
        (state.importError ? '<div class="pjErr" data-tone="warn">' + escapeHtml(state.importError) + '</div>' : '') +
      '</div>';

    for (const select of main.querySelectorAll('.pjImportMap')) {
      select.addEventListener('change', () => {
        // Targeted revision: ONE row's key, posted alone — the cached audit
        // sections on the main side are never re-read for this.
        ApexBus.post('projectsImportSetMapping', {
          sourceFolder: audit.sourceFolder,
          index: Number(select.dataset.index),
          key: select.value || null,
        });
      });
    }
    main.querySelector('.pjImportBack').addEventListener('click', () => {
      state.importAudit = null;
      state.importError = null;
      render();
    });
    main.querySelector('.pjImportBuild').addEventListener('click', () => {
      if (state.importBusy || audit.errors.length) return;
      state.importBusy = true;
      state.importError = null;
      render();
      ApexBus.post('projectsImportBuild', {
        sourceFolder: audit.sourceFolder,
        name: main.querySelector('#pjImportName').value,
        pitch: main.querySelector('#pjImportPitch').value,
      });
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
        setLiveAnswer(card.key, box.value);   // programmatic edits fire no 'input'
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
    // The working copy survives passive re-renders (see setLiveAnswer) — the
    // saved answer is only the starting point when nothing dirty is pending.
    box.value = boxValueFor(card.key);
    box.disabled = state.busy;
    box.addEventListener('input', () => setLiveAnswer(card.key, box.value));
    // autosave on blur (a "card change" the spec asks be persisted)
    box.addEventListener('change', () => { if (state.draft && !state.busy) save(card.key); });

    for (const chip of main.querySelectorAll('.pjChip[data-i]')) {
      chip.addEventListener('click', () => {
        const text = (card.suggestions || [])[Number(chip.dataset.i)];
        box.value = (box.value ? box.value + '\n' : '') + '• ' + text;
        setLiveAnswer(card.key, box.value);   // programmatic edits fire no 'input'
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
      : 'All areas answered. Note: "Risks and Open Questions" has no dedicated card, so it renders as a gap until you author it in the canonical.';

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

  // ---- slice A4: the SEE step (absorbs A3's Canonical-step list whole) -----
  // One surface owns the mockup lifecycle: the derived screen list (renameable
  // via remove+add), the two-step prepare→run generation gate (A3's machinery,
  // untouched), the rendered preview, device widths, the STALE badge with its
  // REGENERATE action, and APPROVE MOCKUPS. Nothing regenerates silently, and
  // nothing proceeds to Create with pictures the eyes haven't signed off —
  // though approval is a validation WARNING, never a block.
  const mockupKindNote = (kind) =>
    kind === 'cli' ? 'CLI platform — terminal storyboard frames.'
      : kind === 'api' ? 'API platform — one endpoint-map page.'
        : 'Screen mockups.';

  function mockupScreensEffective() {
    const mk = state.mockups;
    const kept = mk.proposed.filter((s) => !mk.removed.includes(s.id));
    return kept.concat(mk.added);
  }

  // Merged screen list: the user-edited proposal, plus generated screens the
  // user has since removed — files still exist; never orphan them silently.
  function seeScreens() {
    const mk = state.mockups;
    const screens = mockupScreensEffective();
    for (const g of mk.generated)
      if (!screens.some((s) => s.id === g.screen.id)) screens.push(g.screen);
    return screens;
  }

  // Device-width presets for the preview frame (frame width, not a rescale —
  // the mockup's own CSS answers the width like a real viewport would).
  const DEVICE_WIDTHS = { mobile: 390, tablet: 768, desktop: 1180 };

  function renderSee() {
    const draft = state.draft;
    // Smoke-safe empty state (see the pjstep=see affordance at mount): the
    // step must render without a draft rather than redirect-chain to Start.
    if (!draft || !draft.preview) {
      main.innerHTML =
        '<h2 class="pjTitle">See it before you build it</h2>' +
        '<p class="pjLead">Clickable mockups of the screens your blueprint implies, rendered right here — ' +
          'generate the canonical on the Review step first; mockups are generated FROM the approved blueprint.</p>' +
        '<div class="pjCard"><div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjSeeBackOut">← ' + (draft ? 'REVIEW' : 'START') + '</button>' +
        '</div></div>';
      main.querySelector('.pjSeeBackOut').addEventListener('click', () => goStep(draft ? 'review' : 'start'));
      return;
    }

    // Fetch the screen list once per draft — forDraft (set before posting)
    // stops the arriving payload's re-render from re-requesting in a loop.
    if (state.mockups.forDraft !== draft.id) {
      state.mockups = {
        forDraft: draft.id, kind: null, proposed: [], generated: [],
        error: null, removed: [], added: [], selected: null,
        prepared: null, busy: false, resultError: null,
        deviceWidth: state.mockups.deviceWidth || 'desktop', approveMsg: null,
        annotate: false, pendingPick: null, noteMsg: null,
      };
      ApexBus.post('projectsMockupList', { id: draft.id });
    }
    const mk = state.mockups;
    if (mk.error) {
      main.innerHTML = '<h2 class="pjTitle">See</h2><div class="pjCard">' +
        '<div class="pjErr" data-tone="warn">' + escapeHtml(mk.error) + '</div></div>';
      return;
    }

    const generatedById = new Map(mk.generated.map((g) => [g.screen.id, g]));
    const screens = seeScreens();
    if (!mk.selected && screens.length) mk.selected = screens[0].id;
    const current = mk.selected ? generatedById.get(mk.selected) : null;

    // Screen switcher chips — one per screen, stale/ungenerated marked.
    const switcher = screens.map((s) => {
      const g = generatedById.get(s.id);
      const on = mk.selected === s.id ? ' primary' : '';
      const mark = g ? (g.stale ? ' ⚠' : '') : ' ·';
      return '<button type="button" class="pjBtn pjMockPick' + on + '" data-screen-id="' + escapeHtml(s.id) + '" ' +
        'title="' + (g ? (g.stale ? 'Generated, but the blueprint moved on — STALE' : 'Generated') : 'Not generated yet') + '">' +
        escapeHtml(s.title || s.id) + mark + '</button>' +
        '<button type="button" class="pjBtn pjMockRemove" data-screen-id="' + escapeHtml(s.id) + '" title="Remove from the list (files are untouched)">✕</button>';
    }).join('');

    const widths = ['mobile', 'tablet', 'desktop'].map((w) =>
      '<button type="button" class="pjBtn pjSeeWidth' + (mk.deviceWidth === w ? ' primary' : '') + '" data-width="' + w + '">' +
        w.toUpperCase() + ' ' + DEVICE_WIDTHS[w] + '</button>').join('');

    // The preview frame. sandbox="allow-scripts" WITHOUT allow-same-origin,
    // deliberately: the mockup's inline scripts run (clickable is the point),
    // but the document gets an OPAQUE origin — it cannot read Apex's storage,
    // cookies, or DOM, and it cannot reach preload/the bus (top-frame only,
    // unreachable from a sandboxed cross-origin child). Combined with A3's
    // no-external-URL contract and the apex:// response CSP (no network at
    // all), the page is fully inert. src is the apex:// URI the served-file
    // gate admitted; the provenance stamp busts the iframe cache on regen.
    // A5: annotate mode swaps the iframe's src to the DERIVED .annotate.html
    // (pristine bytes + the serve-time-injected picker script); the pristine
    // file renders otherwise. Same sandbox either way — the picker page is as
    // untrusted as the mockup it wraps.
    const annotating = Boolean(mk.annotate && current && current.annotateUri);
    let frame;
    if (current && current.uri) {
      const src = annotating ? current.annotateUri : current.uri;
      frame = '<div class="pjSeeFrame" style="width:' + DEVICE_WIDTHS[mk.deviceWidth] + 'px">' +
        (current.stale
          ? '<div class="pjSeeStale" data-tone="warn">STALE — the blueprint changed after this mockup was generated. ' +
            'Regenerate it below, or it stays as-is; nothing regenerates without you.</div>'
          : '') +
        (annotating
          ? '<div class="pjSeeStale" data-tone="quiet">ANNOTATE — hover to highlight, click an element to pin a note. Esc exits.</div>'
          : '') +
        '<iframe class="pjSeeIframe" sandbox="allow-scripts" src="' +
          escapeHtml(src + '#' + (current.generatedAt || '')) + '"></iframe>' +
      '</div>';
    } else {
      frame = '<div class="pjSeeFrame pjSeeEmpty" style="width:' + DEVICE_WIDTHS[mk.deviceWidth] + 'px">' +
        '<div class="pjWsSub">' + (mk.selected
          ? 'This screen has no mockup yet — generate it below (one approved disposable turn).'
          : 'No screens yet — add one below.') + '</div></div>';
    }

    // Approval status, in the validation report's plain voice.
    const upToDate = mk.generated.filter((g) => !g.stale);
    let approvalNote, approvalTone;
    if (approvalCurrent()) {
      approvalNote = 'Approved — ' + state.draft.mockupApproval.screens.length +
        ' screen(s) recorded against the current blueprint. They ride into the package at Create.';
      approvalTone = 'good';
    } else if (state.draft.mockupApproval) {
      approvalNote = 'The blueprint moved on after approval — look again and re-approve.';
      approvalTone = 'warn';
    } else {
      approvalNote = 'Not approved yet. Approval records what your eyes signed off (screens + blueprint hash); ' +
        'validation warns until it exists, and only approved mockups enter the package.';
      approvalTone = 'quiet';
    }

    const canRun = Boolean(mk.prepared) && !mk.busy;
    // A5: this screen's pinned note chips (persisted on the draft, capped 12).
    const screenNotes = (mk.selected && draft.mockupNotes && draft.mockupNotes[mk.selected]) || [];
    const noteChips = screenNotes.map((n, i) =>
      '<div class="pjSeeNoteChip">' +
        '<span class="pjSeeNoteSel">' + escapeHtml(n.selector) + '</span>' +
        (n.text ? '<span class="pjWsSub">“' + escapeHtml(n.text) + '”</span>' : '') +
        '<span class="pjSeeNoteText">' + escapeHtml(n.note) + '</span>' +
        '<button type="button" class="pjBtn pjSeeNoteRemove" data-note-index="' + i + '" title="Remove this note">✕</button>' +
      '</div>').join('');
    const notesCard =
      '<div class="pjCard">' +
        '<label class="pjLabel">NOTES — ' + screenNotes.length + '/12 ON THIS SCREEN</label>' +
        '<div class="pjWsSub">Pin a note to an element (ANNOTATE above), batch them, then regenerate — ' +
          'one turn carries them all, pinned to their elements. Notes clear when the regeneration succeeds.</div>' +
        '<div class="pjSeeNoteEntry"></div>' +
        (noteChips ? '<div class="pjSeeNotes">' + noteChips + '</div>' : '') +
        (mk.noteMsg ? '<div class="pjErr" data-tone="warn">' + escapeHtml(mk.noteMsg) + '</div>' : '') +
      '</div>';
    main.innerHTML =
      '<h2 class="pjTitle">See it before you build it</h2>' +
      '<p class="pjLead">' + escapeHtml(mockupKindNote(mk.kind)) +
        ' Switch screens, try device widths, click what reads wrong and say so, then approve. ' +
        'A blueprint change marks screens STALE; nothing regenerates without you.</p>' +
      '<div class="pjCard">' +
        '<div class="pjChipRow pjSeeSwitcher">' + switcher + '</div>' +
        '<div class="pjBtnRow">' +
          '<input type="text" class="pjMockAddName" maxlength="48" placeholder="new-screen-name (kebab-case)" />' +
          '<button type="button" class="pjBtn pjMockAdd">ADD SCREEN</button>' +
        '</div>' +
        '<div class="pjBtnRow pjSeeWidths">' + widths +
          '<button type="button" class="pjBtn pjSeeAnnotate' + (annotating ? ' primary' : '') + '" ' +
            (current && current.annotateUri ? '' : 'disabled') + ' ' +
            'title="Hover highlights, a click pins a note to that element. The picker only exists in a derived serve-time copy — the stored mockup stays pristine.">' +
            (annotating ? 'EXIT ANNOTATE (ESC)' : 'ANNOTATE') + '</button>' +
        '</div>' +
        frame +
      '</div>' +
      notesCard +
      '<div class="pjCard">' +
        '<label class="pjLabel">' + (current
          ? (screenNotes.length ? 'REGENERATE THIS SCREEN WITH ITS NOTES' : 'REGENERATE THIS SCREEN')
          : 'GENERATE THIS SCREEN') + '</label>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjMockPrepare" ' +
            (mk.busy || !mk.selected ? 'disabled' : '') + ' ' +
            'title="Runs one hidden disposable session to generate this screen\'s mockup — a real Claude turn, opt-in. Regenerating clears any recorded approval.">' +
            (mk.prepared ? 'RE-CHECK USAGE'
              : (current
                  ? (screenNotes.length ? 'REGENERATE WITH NOTES (' + screenNotes.length + ')' : 'REGENERATE')
                  : 'GENERATE') + ' SELECTED (USES A SESSION)') +
          '</button>' +
          (mk.prepared
            ? '<button type="button" class="pjBtn primary pjMockRun" ' + (canRun ? '' : 'disabled') + '>RUN MOCKUP PASS</button>'
            : '') +
          (mk.busy ? '<button type="button" class="pjBtn pjMockStop">STOP</button>' : '') +
        '</div>' +
        (mk.prepared
          ? '<div class="pjWsSub pjAiUsage">' + escapeHtml(usageNote(mk.prepared.usage)) + '</div>'
          : '') +
        (mk.busy ? '<div class="pjWsSub pjAiUsage">Generating ' + escapeHtml(mk.selected || '') + '…</div>' : '') +
        (mk.resultError ? '<div class="pjErr" data-tone="warn">' + escapeHtml(mk.resultError) + '</div>' : '') +
      '</div>' +
      '<div class="pjCard">' +
        '<label class="pjLabel">APPROVE MOCKUPS</label>' +
        '<div class="pjWsSub" data-tone="' + approvalTone + '">' + escapeHtml(approvalNote) + '</div>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn primary pjSeeApprove" ' +
            (upToDate.length && !approvalCurrent() && !mk.busy ? '' : 'disabled') + '>' +
            'APPROVE MOCKUPS (' + upToDate.length + ' UP-TO-DATE)</button>' +
        '</div>' +
        (mk.approveMsg ? '<div class="pjErr" data-tone="warn">' + escapeHtml(mk.approveMsg) + '</div>' : '') +
      '</div>' +
      '<div class="pjCard"><div class="pjBtnRow">' +
        '<button type="button" class="pjBtn pjSeeBack">← BACK TO CANONICAL</button>' +
        '<button type="button" class="pjBtn primary pjSeeContinue">CONTINUE TO CREATE →</button>' +
      '</div></div>';

    wireSee(draft);
  }

  // A5: the note-entry panel for a pending pick. A TARGETED repaint of its
  // own holder only — a full render() would reload the iframe and throw away
  // the mockup's state on every single pick, so the message bridge calls this
  // instead of render() for the pick arm (cancel/exit do full renders; they
  // swap the iframe src anyway).
  function renderNoteEntry(draft) {
    const holder = main.querySelector('.pjSeeNoteEntry');
    if (!holder) return;
    const mk = state.mockups;
    const p = mk.pendingPick;
    if (!p) { holder.replaceChildren(); return; }
    holder.innerHTML =
      '<div class="pjWsSub">Picked <b>' + escapeHtml(p.selector) + '</b>' +
        (p.text ? ' — “' + escapeHtml(p.text) + '”' : '') + '</div>' +
      '<div class="pjBtnRow">' +
        '<input type="text" class="pjSeeNoteInput" maxlength="500" placeholder="What should change here? (your words ride the regen prompt)" />' +
        '<button type="button" class="pjBtn primary pjSeeNoteSave">PIN NOTE</button>' +
        '<button type="button" class="pjBtn pjSeeNoteCancel">CANCEL</button>' +
      '</div>';
    const input = holder.querySelector('.pjSeeNoteInput');
    const saveNote = () => {
      const note = input.value.trim();
      if (!note) return;
      const existing = (mk.selected && state.draft.mockupNotes && state.draft.mockupNotes[mk.selected]) || [];
      if (existing.length >= 12) {
        mk.noteMsg = 'Note limit reached for this screen (12) — remove one, or regenerate to consume them.';
        mk.pendingPick = null;
        render();
        return;
      }
      ApexBus.post('projectsMockupNoteSave', {
        id: state.draft.id, expectedRevision: state.draft.revision, screenId: mk.selected,
        notes: existing.concat([{ selector: p.selector, text: p.text, note }]),
      });
      // the fresh draft rides projectsDraftPatched and repaints the chips
      mk.pendingPick = null;
      mk.noteMsg = null;
      renderNoteEntry(draft);
    };
    holder.querySelector('.pjSeeNoteSave').addEventListener('click', saveNote);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNote(); });
    holder.querySelector('.pjSeeNoteCancel').addEventListener('click', () => {
      mk.pendingPick = null;
      renderNoteEntry(draft);
    });
    input.focus();
  }

  function wireSee(draft) {
    const mk = state.mockups;
    for (const btn of main.querySelectorAll('.pjSeeWidth')) {
      btn.addEventListener('click', () => { mk.deviceWidth = btn.dataset.width; render(); });
    }
    // ---- A5: annotate mode + the message bridge ----
    const annotateBtn = main.querySelector('.pjSeeAnnotate');
    if (annotateBtn) annotateBtn.addEventListener('click', () => {
      if (annotateBtn.disabled) return;
      mk.annotate = !mk.annotate;
      mk.pendingPick = null;
      render();
    });
    for (const btn of main.querySelectorAll('.pjSeeNoteRemove')) {
      btn.addEventListener('click', () => {
        const existing = (mk.selected && state.draft.mockupNotes && state.draft.mockupNotes[mk.selected]) || [];
        const next = existing.filter((_, i) => i !== Number(btn.dataset.noteIndex));
        ApexBus.post('projectsMockupNoteSave', {
          id: state.draft.id, expectedRevision: state.draft.revision, screenId: mk.selected,
          notes: next,
        });
      });
    }
    renderNoteEntry(draft);
    const iframe = main.querySelector('.pjSeeIframe');
    if (mk.annotate && iframe) {
      // render() already tore any previous bridge down; arm one bound to THIS
      // iframe. event.source === contentWindow is the strongest identity
      // check available against a sandboxed opaque-origin frame (its origin
      // reads as 'null'); the validator mirror + the flood guard do the rest.
      // Everything non-conforming is dropped in silence — no throw, no log a
      // hostile page could spam.
      let windowStart = 0, count = 0;
      const allowPick = () => {   // mirror of lib/mockup.createPickLimiter (10/s)
        const now = Date.now();
        if (now - windowStart >= 1000) { windowStart = now; count = 0; }
        count += 1;
        return count <= 10;
      };
      const onMessage = (event) => {
        if (event.source !== iframe.contentWindow) return;
        if (!allowPick()) return;
        const valid = validatePickMessage(event.data);
        if (!valid) return;
        if (valid.kind === 'cancel') {   // Esc inside the mockup
          mk.annotate = false;
          mk.pendingPick = null;
          render();
          return;
        }
        // The whole validated pick is kept, bbox included: the shape is the
        // drilled contract (lib/mockup.validatePickMessage), even though only
        // selector/text ride the note today — see design/studio-v2.md § Wave C
        // for where element geometry goes next.
        mk.pendingPick = { selector: valid.selector, text: valid.text, bbox: valid.bbox };
        renderNoteEntry(draft);
      };
      const onKey = (event) => {        // Esc with focus on the studio side
        if (event.key !== 'Escape') return;
        mk.annotate = false;
        mk.pendingPick = null;
        render();
      };
      window.addEventListener('message', onMessage);
      window.addEventListener('keydown', onKey);
      pickBridge = { onMessage, onKey };
    }
    const approveBtn = main.querySelector('.pjSeeApprove');
    if (approveBtn) approveBtn.addEventListener('click', () => {
      if (approveBtn.disabled) return;
      mk.approveMsg = null;
      ApexBus.post('projectsMockupApprove', { id: draft.id, expectedRevision: draft.revision });
    });
    const back = main.querySelector('.pjSeeBack');
    if (back) back.addEventListener('click', () => goStep('canonical'));
    const cont = main.querySelector('.pjSeeContinue');
    if (cont) cont.addEventListener('click', () => goStep('create'));
    for (const btn of main.querySelectorAll('.pjMockPick')) {
      btn.addEventListener('click', () => {
        mk.selected = btn.dataset.screenId;
        mk.prepared = null;   // a prepare is per-screen; switching drops it
        render();
      });
    }
    for (const btn of main.querySelectorAll('.pjMockRemove')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.screenId;
        mk.added = mk.added.filter((s) => s.id !== id);
        if (!mk.removed.includes(id)) mk.removed.push(id);
        if (mk.selected === id) { mk.selected = null; mk.prepared = null; }
        render();
      });
    }
    const addBtn = main.querySelector('.pjMockAdd');
    const addName = main.querySelector('.pjMockAddName');
    if (addBtn && addName) addBtn.addEventListener('click', () => {
      const id = addName.value.trim().toLowerCase();
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || id.length > 48) {
        mk.resultError = 'Screen name must be lowercase kebab-case, at most 48 characters.';
        return render();
      }
      if (mockupScreensEffective().some((s) => s.id === id)) return;
      mk.removed = mk.removed.filter((r) => r !== id);   // re-adding a removed one
      if (!mk.proposed.some((s) => s.id === id))
        mk.added.push({ id, title: id, purpose: '' });
      mk.resultError = null;
      mk.selected = id;
      render();
    });
    const prepareBtn = main.querySelector('.pjMockPrepare');
    if (prepareBtn) prepareBtn.addEventListener('click', () => {
      if (prepareBtn.disabled || !mk.selected) return;
      const screen = mockupScreensEffective().find((s) => s.id === mk.selected) ||
        (state.mockups.generated.find((g) => g.screen.id === mk.selected) || {}).screen;
      if (!screen) return;
      mk.prepared = null;
      mk.resultError = null;
      ApexBus.post('projectsMockupPrepare', { id: draft.id, screen });
    });
    const runBtn = main.querySelector('.pjMockRun');
    if (runBtn) runBtn.addEventListener('click', () => {
      if (runBtn.disabled || !mk.prepared) return;
      mk.busy = true;
      ApexBus.post('projectsMockupRun', {
        id: mk.prepared.draftId, screen: mk.prepared.screen,
        expectedRevision: mk.prepared.revision, approved: true,
      });
      render();
    });
    const stopBtn = main.querySelector('.pjMockStop');
    if (stopBtn) stopBtn.addEventListener('click', () => ApexBus.post('projectsMockupStop', {}));
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
          // A4: the mockup surface moved off this step into SEE — this is the
          // golden-path door to it.
          '<button type="button" class="pjBtn primary pjToSee">SEE MOCKUPS →</button>' +
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
    main.querySelector('.pjToSee').addEventListener('click', () => goStep('see'));
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

    // slice B1: first visit for this project asks main for the saved launch
    // config (forProject is the guard — the reply re-renders, which must not
    // re-ask).
    if (state.server.forProject !== p.projectId) {
      state.server = {
        forProject: p.projectId, config: null, form: null,
        phase: 'stopped', port: null, log: [], error: null, busy: false,
      };
      ApexBus.post('projectsServerConfigGet', { projectId: p.projectId });
    }
    const srv = state.server;
    const form = srv.form || (srv.config ? {
      command: srv.config.command || '',
      argsText: (srv.config.args || []).join(' '),
      cwd: srv.config.cwd || '',
      port: srv.config.port != null ? String(srv.config.port) : '',
      readyRegex: srv.config.readyRegex || '',
    } : { command: '', argsText: '', cwd: '', port: '', readyRegex: '' });
    const srvRunning = srv.phase === 'starting' || srv.phase === 'ready';

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

      // slice B1: the RUN drawer — a minimal dev-server runner. The full BUILD
      // step is Wave E; this is config + start/stop + a log tail.
      '<div class="pjCard">' +
        '<div class="pjLabel">RUN — DEV SERVER ' +
          '<span class="pjRunPhase" data-phase="' + escapeHtml(srv.phase) + '">' +
            escapeHtml(srv.phase.toUpperCase() + (srv.phase === 'ready' && srv.port ? ' :' + srv.port : '')) +
          '</span></div>' +
        '<div class="pjWsSub">Launches this project\'s dev server as a plain process (argv array — never a shell ' +
          'line, so arguments are whitespace-split tokens with no quoting). The working folder must stay inside ' +
          'the projects workspace or a registered workspace. Ready = the pattern matching a log line, or the ' +
          'port answering.</div>' +
        '<label class="pjLabel" for="pjRunCommand">COMMAND (EXECUTABLE ONLY)</label>' +
        '<input class="pjName pjRunCommand" id="pjRunCommand" maxlength="200" placeholder="npm" value="' + escapeHtml(form.command) + '" />' +
        '<label class="pjLabel" for="pjRunArgs">ARGUMENTS — SPACE-SEPARATED</label>' +
        '<input class="pjName pjRunArgs" id="pjRunArgs" maxlength="400" placeholder="run dev" value="' + escapeHtml(form.argsText) + '" />' +
        '<label class="pjLabel" for="pjRunCwd">WORKING FOLDER — EMPTY = THE PROJECT FOLDER</label>' +
        '<input class="pjName pjRunCwd" id="pjRunCwd" maxlength="260" placeholder="' + escapeHtml(p.projectDir) + '" value="' + escapeHtml(form.cwd) + '" />' +
        '<label class="pjLabel" for="pjRunPort">PORT (OPTIONAL)</label>' +
        '<input class="pjName pjRunPort" id="pjRunPort" maxlength="5" placeholder="5173" value="' + escapeHtml(form.port) + '" />' +
        '<label class="pjLabel" for="pjRunReady">READY PATTERN (OPTIONAL REGEX OVER LOG LINES)</label>' +
        '<input class="pjName pjRunReady" id="pjRunReady" maxlength="200" placeholder="ready in|Local:" value="' + escapeHtml(form.readyRegex) + '" />' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjRunSaveBtn" ' + (srv.busy ? 'disabled' : '') + '>SAVE CONFIG</button>' +
          '<button type="button" class="pjBtn primary pjRunStartBtn" ' + (srv.busy || srvRunning || !srv.config ? 'disabled' : '') + '>START</button>' +
          '<button type="button" class="pjBtn pjRunStopBtn" ' + (srv.busy || !srvRunning ? 'disabled' : '') + '>STOP</button>' +
        '</div>' +
        (srv.error ? '<div class="pjErr" data-tone="warn">' + escapeHtml(srv.error) + '</div>' : '') +
        (srv.log.length
          ? '<pre class="pjRunLog">' + escapeHtml(srv.log.slice(-40).join('\n')) + '</pre>'
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

    // slice B1: the RUN drawer's wiring. Every keystroke lands in srv.form so
    // a passive re-render (a state post for another card) never eats typing.
    const readServerForm = () => {
      srv.form = {
        command: main.querySelector('.pjRunCommand').value,
        argsText: main.querySelector('.pjRunArgs').value,
        cwd: main.querySelector('.pjRunCwd').value,
        port: main.querySelector('.pjRunPort').value,
        readyRegex: main.querySelector('.pjRunReady').value,
      };
      return srv.form;
    };
    for (const cls of ['pjRunCommand', 'pjRunArgs', 'pjRunCwd', 'pjRunPort', 'pjRunReady'])
      main.querySelector('.' + cls).addEventListener('input', readServerForm);

    main.querySelector('.pjRunSaveBtn').addEventListener('click', () => {
      if (srv.busy) return;
      const f = readServerForm();
      const portText = f.port.trim();
      srv.busy = true;
      srv.error = null;
      render();
      ApexBus.post('projectsServerConfigSave', {
        projectId: p.projectId,
        config: {
          command: f.command.trim(),
          // whitespace-split tokens, one argv entry each — there is no shell,
          // so there is no quoting; that is the no-injection guarantee's price
          args: f.argsText.split(/\s+/).filter(Boolean),
          cwd: f.cwd.trim() || null,
          port: portText === '' ? null : Number(portText),
          readyRegex: f.readyRegex.trim() || null,
        },
      });
    });

    main.querySelector('.pjRunStartBtn').addEventListener('click', () => {
      if (srv.busy || srvRunning || !srv.config) return;
      srv.busy = true;
      srv.error = null;
      srv.log = [];
      render();
      ApexBus.post('projectsServerStart', { projectId: p.projectId });
    });

    main.querySelector('.pjRunStopBtn').addEventListener('click', () => {
      if (srv.busy || !srvRunning) return;
      srv.busy = true;
      render();
      ApexBus.post('projectsServerStop', { projectId: p.projectId });
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
    // Reconcile the unsaved working copies against the fresh draft: a
    // different draft invalidates them all; otherwise drop each entry the
    // save just landed (box content == saved answer now) and keep the rest —
    // still-dirty cards must survive a save made from another card.
    if (!state.draft || !m.draft || m.draft.id !== state.draft.id) {
      state.liveAnswers = {};
    } else {
      for (const key of Object.keys(state.liveAnswers)) {
        if (state.liveAnswers[key] === (m.draft.answers[key] || '')) delete state.liveAnswers[key];
      }
    }
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
    state.mockups.forDraft = null;  // canonical hash may have moved — refresh STALE bits
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

  // ---- slice 9: import/audit mode ------------------------------------------
  ApexBus.on('projectsImportAudit', (m) => {
    state.importAudit = m;
    state.cards = m.cards || state.cards;
    state.importBusy = false;
    state.importError = null;
    if (state.step === 'import') render();
  });

  ApexBus.on('projectsImportResult', (m) => {
    state.importBusy = false;
    if (m.action === 'audit' || m.action === 'build') {
      if (!m.ok) { state.importError = m.error; if (state.step === 'import') render(); return; }
    }
    if (m.action === 'build' && m.ok) {
      // The draft is fully built (its blueprint already ran through
      // buildBundle) — jump straight into Review so the gap report is the
      // very next thing the user sees, exactly like finishing the interview
      // by hand. projectsDraftStatus (posted right after this by main.js)
      // lands the draft and clears busy state.
      state.pendingStep = 'review';
    }
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

  // ---- slice A3: the mockup pass --------------------------------------------
  ApexBus.on('projectsMockupScreens', (m) => {
    const mk = state.mockups;
    if (state.draft && m.draftId !== state.draft.id) return;
    mk.forDraft = m.draftId;
    mk.kind = m.kind;
    mk.proposed = m.proposed || [];
    mk.generated = m.generated || [];
    // hasPreview/approval/approvalCurrent also ride this payload (the drilled
    // main-side contract; headless drills assert on them) but are NOT mirrored
    // into state: the step reads the draft itself, one source of truth.
    mk.error = m.error || null;
    if (mk.selected && !mockupScreensEffective().some((s) => s.id === mk.selected) &&
        !mk.generated.some((g) => g.screen.id === mk.selected))
      mk.selected = null;
    if (!mk.selected && mk.proposed.length) mk.selected = mk.proposed[0].id;
    if (state.step === 'see') render();
  });

  ApexBus.on('projectsMockupPrepared', (m) => {
    if (state.draft && m.draftId !== state.draft.id) return;
    Object.assign(state.mockups, { prepared: m, busy: false, resultError: null });
    if (state.step === 'see') render();
  });

  ApexBus.on('projectsMockupStatus', (m) => {
    if (m.phase === 'error') {
      Object.assign(state.mockups, { prepared: null, busy: false, resultError: m.error });
      if (state.step === 'see') render();
      return;
    }
    if (m.phase === 'stopped') {
      Object.assign(state.mockups, { prepared: null, busy: false });
      if (state.step === 'see') render();
    }
    // 'running' is already reflected client-side the instant RUN is clicked.
  });

  ApexBus.on('projectsMockupResult', (m) => {
    if (state.draft && m.draftId !== state.draft.id) return;
    Object.assign(state.mockups, {
      prepared: null, busy: false,
      resultError: m.ok ? null : m.error,
    });
    // A successful write is followed by a fresh projectsMockupScreens post
    // from main, which repaints the list with the new generated entry.
    if (state.step === 'see') render();
  });

  // ---- slice A4: APPROVE MOCKUPS -------------------------------------------
  // Success needs no handler work beyond the message slot: main follows with
  // projectsDraftPatched (the fresh draft + revision) and a fresh
  // projectsMockupScreens, which repaint the step.
  ApexBus.on('projectsMockupApproveResult', (m) => {
    if (state.draft && m.draftId !== state.draft.id) return;
    state.mockups.approveMsg = m.ok ? null : ('Not approved — ' + m.error);
    if (!m.ok && state.step === 'see') render();
  });

  // ---- slice A5: note chips. Success needs no handler work — the fresh
  // draft rides projectsDraftPatched, which already repaints SEE.
  ApexBus.on('projectsMockupNoteResult', (m) => {
    if (state.draft && m.draftId !== state.draft.id) return;
    state.mockups.noteMsg = m.ok ? null : ('Note was not saved — ' + m.error);
    if (!m.ok && state.step === 'see') render();
  });

  // ---- slice 7: the co-designer panel ---------------------------------------
  // A dedicated draft refresh that does NOT drive step navigation (unlike
  // projectsDraftStatus) — accepting a patch on a card the user isn't even
  // looking at must not yank them there.
  ApexBus.on('projectsDraftPatched', (m) => {
    if (!state.draft || !m.draft || m.draft.id !== state.draft.id) return;
    // An accepted patch APPENDS to the saved answer main-side. If that card
    // also has unsaved typing here, carry the same appended tail into the
    // working copy — otherwise the accept would be invisible in the box and
    // the next save would silently write it back OUT of the draft.
    for (const key of Object.keys(state.liveAnswers)) {
      const before = state.draft.answers[key] || '';
      const after = m.draft.answers[key] || '';
      if (after !== before && after.startsWith(before))
        state.liveAnswers[key] += after.slice(before.length);
    }
    state.draft = m.draft;
    if (m.cards) state.cards = m.cards;
    if (isCardStep(state.step)) renderCard(findCard(state.step));
    // A4: approval recording/clearing arrives through this same no-navigation
    // refresh; the SEE step repaints to reflect it (and the new revision).
    else if (state.step === 'see') render();
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

  // ---- slice B1: the RUN drawer (dev-server runner) ------------------------
  const forRunProject = (m) => m && state.createdProject &&
    m.projectId === state.createdProject.projectId;

  ApexBus.on('projectsServerConfig', (m) => {
    if (!forRunProject(m)) return;
    const srv = state.server;
    srv.busy = false;
    srv.config = m.config || null;
    srv.error = m.error || null;
    // seed the working copy once (or adopt a save that just landed clean)
    if (!srv.error) srv.form = null;
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsServerState', (m) => {
    if (!forRunProject(m)) return;
    const srv = state.server;
    srv.busy = false;
    srv.phase = m.phase || 'stopped';
    if (m.port != null) srv.port = m.port;
    if (Array.isArray(m.logTail) && m.logTail.length) srv.log = m.logTail.slice();
    srv.error = m.error || null;
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsServerLog', (m) => {
    if (!forRunProject(m) || !Array.isArray(m.lines)) return;
    const srv = state.server;
    srv.log.push(...m.lines);
    if (srv.log.length > 400) srv.log.splice(0, srv.log.length - 400);
    // patch the tail in place — a full render per log line would eat the caret
    if (state.step === 'liftoff') {
      const logEl = main.querySelector('.pjRunLog');
      if (logEl) {
        logEl.textContent = srv.log.slice(-40).join('\n');
        logEl.scrollTop = logEl.scrollHeight;
      } else render();   // first line: the card has no <pre> yet
    }
  });

  // smoke eyes (A4): the SEE step must be REACHABLE in a smoke run with no
  // draft on disk. APEX_SMOKE_DOCK='studio&pjstep=see' rides '&pjstep=see'
  // into the window hash verbatim through main's existing '#dock=' affordance
  // (no core change), and renderSee's empty state renders draft-free. Only
  // this builder knows its steps, so the flag is read here, not in the shell.
  if (typeof location !== 'undefined' &&
      new URLSearchParams((location.hash || '').slice(1)).get('pjstep') === 'see')
    state.step = 'see';
  render();
  ApexBus.post('projectsWorkspaceGet', {});
}
