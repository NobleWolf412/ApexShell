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
      // E1: the BUILD step's milestone track. `milestones` null = not asked
      // yet for this project ([] = asked, none parsed); `milestone` is a
      // DELEGATE THIS pre-fill riding the next DELEGATE click (the C2
      // boomIntent pattern). Status is never held here — it derives from
      // state.board on every paint (never stored, so it can't go stale).
      milestones: null, milestonesError: null, milestone: null,
    },
    // E1: the live task board (main/tasks.js's taskList broadcast) — the
    // derived-status source for the milestone track. Held whole; the BUILD
    // step filters by project cwd at render time.
    board: [],
    // ---- slice B1: the RUN drawer (dev-server runner on Lift-off) ----
    // `form` is the user's working copy of the config inputs — it survives
    // re-renders (the liveAnswers rule) and is seeded from the saved config
    // exactly once per project. `forProject` doubles as the fetch guard so
    // opening Lift-off asks main for the config only once. Log deltas patch
    // the <pre> directly (a full render per log line would eat the caret).
    // B3 rides along: `events` is the instrument strip's store (main already
    // shaped and rate-bounded them; capped at 100 here), `eventsOpen` the
    // expanded list, `deviceWidth` the placeholder's width preset.
    server: {
      forProject: null, config: null, form: null,
      phase: 'stopped', port: null, log: [], error: null, busy: false,
      events: [], eventsOpen: false, deviceWidth: 'desktop',
      // C2: the strip's INSPECT toggle — main's truth (appFrameInspectState /
      // an in-page Esc) mirrors here; every page replacement drops it there,
      // so the reload/url-change paths drop it here too.
      inspect: false,
    },
    // ---- slice C2: the boom loop. A pick from the app frame's inspector
    // opens the card (context = the shaped appFramePick payload); GO is the
    // approval (the A3 two-step collapsed — usage shows on the card first);
    // candidates/result mirror main's posts; the ledger lists landed booms
    // with REVERT. Intent survives re-renders the liveAnswers way.
    boom: {
      open: false, context: null, intent: '', usage: null, cardError: null,
      busy: false, candidates: null, truncated: false, result: null,
      ledger: [], revertMsg: null, revertBusy: false,
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
    // ---- slice D2: the X-ray (ARCHITECTURE) step. `forDraft` is the fetch
    // guard (the mockups discipline); `data` is main's projectsDiagramState
    // payload — the stored AI diagram parsed main-side by
    // lib/xray.parseValidated (this half only lays out boxes and draws
    // arrows; it never re-reads mermaid) plus the free D1 fallback.
    // prepared/busy mirror the mockup block's two-step gate. Provenance/
    // staleness truth is read off state.draft directly (diagramCurrent()),
    // never mirrored here — the A6 one-source-of-truth rule.
    xray: { forDraft: null, data: null, prepared: null, busy: false, resultError: null },
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
      // D2: the step id is 'xray', never 'architecture' — that name is an
      // interview CARD key, and a step id colliding with a card key would
      // route goStep/renderStep to the card.
      { id: 'xray', label: 'X-ray', sub: 'architecture diagram' },
      { id: 'create', label: 'Create', sub: 'write the package' },
      // E1: Lift-off is the BUILD step now — LABEL ONLY. The step id stays
      // 'liftoff': renames that break goStep routing are how card/step
      // collisions happen (the D2 'xray'-not-'architecture' lesson).
      { id: 'liftoff', label: 'Build', sub: 'milestones · run · preview' },
    ];
  }

  const hasPreview = () => Boolean(state.draft && state.draft.preview);
  // The client mirror of lib/mockup.isApprovalCurrent: an approval counts only
  // while its hash still matches the approved canonical (regen clears the
  // field main-side, so that arm needs no mirror).
  const approvalCurrent = () => Boolean(state.draft && state.draft.mockupApproval &&
    state.draft.preview &&
    state.draft.mockupApproval.canonicalHash === state.draft.preview.generatedCanonicalHash);
  // The client mirror of lib/xray.isDiagramStale's current-arm (one-way, like
  // approvalCurrent above): the stored AI diagram counts only while its
  // generating hash still matches the approved canonical.
  const diagramCurrent = () => Boolean(state.draft && state.draft.diagram &&
    state.draft.diagram.provenance && state.draft.preview &&
    state.draft.diagram.provenance.canonicalHash === state.draft.preview.generatedCanonicalHash);

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
    if (id === 'xray') return diagramCurrent();   // AI-drawn and still current; the fallback is a floor, not a checkmark
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
    if (id === 'xray') return hasPreview();                   // the diagram is drawn FROM the approved blueprint
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
    renderStep();
    // B2: the app frame tracks every repaint — a step change replaces .pjMain
    // wholesale (no observer fires for a vanished placeholder), so the sync
    // has to ride the render itself: show on a ready Lift-off, hide elsewhere.
    scheduleFrameSync();
  }

  function renderStep() {
    if (state.step === 'ws') return renderWs();
    if (state.step === 'start') return renderStart();
    if (state.step === 'import') return renderImport();
    if (state.step === 'review') return renderReview();
    if (state.step === 'canonical') return renderCanonicalView();
    if (state.step === 'see') return renderSee();
    if (state.step === 'xray') return renderXray();
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

  // B3: the app frame's presets — mobile/tablet match the SEE step's frame,
  // but desktop means FULL: the live app fills whatever the card gives it
  // (null = no inline width, the plot's own 100% rules).
  const FRAME_WIDTHS = { mobile: 390, tablet: 768, desktop: null };

  // B3: the expanded instrument list, newest last — the store caps at 100,
  // the view shows the last 30. A 'drop' line is main's own honest summary
  // of a rate-limited storm; it rides through verbatim.
  function instrumentLines(srv) {
    if (!srv.events.length) return 'No console errors or failed loads since the last reset.';
    return srv.events.slice(-30).map((e) =>
      e.kind === 'drop' ? e.text
        : '[' + e.kind.toUpperCase() + '] ' + e.text + (e.url ? ' — ' + e.url : '')).join('\n');
  }

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
        '<button type="button" class="pjBtn primary pjSeeContinue">CONTINUE TO X-RAY →</button>' +
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
    if (cont) cont.addEventListener('click', () => goStep('xray'));
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

  // ---- slice D2: the X-ray (ARCHITECTURE) step -----------------------------
  // The diagram renders as plain HTML boxes + SVG arrows — NO mermaid
  // library, no new deps (the argued Wave D decision): the validated
  // allowlist source is parsed by lib/xray.parseValidated main-side, and a
  // renderer that only draws what the validator vouched for cannot be
  // surprised by what it refused. Layout is a simple layered pass — each
  // node's tier is its longest edge-path depth from a root, tiers stack as
  // rows — bounded relaxation, so an exotic cyclic AI diagram degrades to an
  // approximate but honest picture, and the UI says so in as many words.
  function diagramTiers(parsed) {
    const tier = new Map(parsed.nodes.map((n) => [n.id, 0]));
    const cap = parsed.nodes.length;
    for (let pass = 0; pass <= cap; pass++) {
      let moved = false;
      for (const e of parsed.edges) {
        if (!tier.has(e.from) || !tier.has(e.to) || e.from === e.to) continue;
        const next = tier.get(e.from) + 1;
        if (next > tier.get(e.to) && next <= cap) { tier.set(e.to, next); moved = true; }
      }
      if (!moved) break;
    }
    const rows = [];
    for (const n of parsed.nodes) {
      const t = tier.get(n.id);
      (rows[t] = rows[t] || []).push(n);
    }
    return rows.filter((r) => r && r.length);
  }

  function xrayCanvasHtml(parsed) {
    const sgOf = (id) => {
      for (const sg of parsed.subgraphs) if (sg.nodes.includes(id)) return sg.label;
      return null;
    };
    const rows = diagramTiers(parsed).map((row) =>
      '<div class="pjXrayRow">' + row.map((n) => {
        const sub = sgOf(n.id);
        return '<div class="pjXrayNode" data-node-id="' + escapeHtml(n.id) + '" data-shape="' + escapeHtml(n.shape) + '">' +
          '<span class="pjXrayLabel">' + escapeHtml(n.label) + '</span>' +
          (sub ? '<span class="pjXraySub">' + escapeHtml(sub) + '</span>' : '') +
        '</div>';
      }).join('') + '</div>').join('');
    return '<div class="pjXrayCanvas"><svg class="pjXrayWires"></svg>' + rows + '</div>';
  }

  // The SVG arrow pass: boxes are already laid out by normal flow, so the
  // wires just connect measured offsets (offsetParent is the canvas — the
  // positioned ancestor). Drawn once per render; approximate by design.
  function drawXrayWires(parsed) {
    const canvas = main.querySelector('.pjXrayCanvas');
    const svg = main.querySelector('.pjXrayWires');
    if (!canvas || !svg || !canvas.offsetWidth) return;
    const w = canvas.scrollWidth, h = canvas.scrollHeight;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.style.width = w + 'px';
    svg.style.height = h + 'px';
    const box = {};
    for (const el of canvas.querySelectorAll('.pjXrayNode')) {
      box[el.dataset.nodeId] = {
        x: el.offsetLeft + el.offsetWidth / 2,
        top: el.offsetTop,
        bottom: el.offsetTop + el.offsetHeight,
      };
    }
    const NS = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '<defs><marker id="pjXrayHead" markerWidth="7" markerHeight="7" ' +
      'refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor"/></marker></defs>';
    for (const e of parsed.edges) {
      const a = box[e.from], b = box[e.to];
      if (!a || !b || e.from === e.to) continue;
      const downward = b.top >= a.bottom;
      const y1 = downward ? a.bottom : a.top;
      const y2 = downward ? b.top : b.bottom;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', y1);
      line.setAttribute('x2', b.x); line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', e.style === 'thick' ? '2.5' : '1.2');
      if (e.style === 'dotted') line.setAttribute('stroke-dasharray', '4 3');
      if (e.style !== 'open') line.setAttribute('marker-end', 'url(#pjXrayHead)');
      svg.appendChild(line);
      if (e.label) {
        const text = document.createElementNS(NS, 'text');
        text.setAttribute('x', (a.x + b.x) / 2 + 4);
        text.setAttribute('y', (y1 + y2) / 2 - 3);
        text.setAttribute('class', 'pjXrayEdgeLabel');
        text.textContent = e.label;
        svg.appendChild(text);
      }
    }
  }

  function renderXray() {
    const draft = state.draft;
    // Smoke-safe empty state (the renderSee discipline): the step renders
    // without a draft rather than redirect-chaining to Start.
    if (!draft || !draft.preview) {
      main.innerHTML =
        '<h2 class="pjTitle">X-ray — the architecture, visible</h2>' +
        '<p class="pjLead">The blueprint\'s components, data, and integrations as one diagram — ' +
          'generate the canonical on the Review step first; the diagram is drawn FROM the approved blueprint.</p>' +
        '<div class="pjCard"><div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjXrayBackOut">← ' + (draft ? 'REVIEW' : 'START') + '</button>' +
        '</div></div>';
      main.querySelector('.pjXrayBackOut').addEventListener('click', () => goStep(draft ? 'review' : 'start'));
      return;
    }

    if (state.xray.forDraft !== draft.id) {
      state.xray = { forDraft: draft.id, data: null, prepared: null, busy: false, resultError: null };
      ApexBus.post('projectsDiagramGet', { id: draft.id });
    }
    const xr = state.xray;
    if (xr.data && xr.data.error) {
      main.innerHTML = '<h2 class="pjTitle">X-ray</h2><div class="pjCard">' +
        '<div class="pjErr" data-tone="warn">' + escapeHtml(xr.data.error) + '</div></div>';
      return;
    }

    const d = xr.data;
    // The stored AI diagram leads when it exists (stale INCLUDED — a stale
    // diagram shows with its badge and a regenerate path, it is never
    // silently swapped for the fallback); the free fallback otherwise.
    const showing = d ? (d.diagram || d.fallback) : null;
    const isAi = Boolean(d && d.diagram);
    const stale = Boolean(isAi && d.diagram.stale);

    let badges = '';
    if (isAi) {
      const p = d.diagram.provenance || {};
      badges =
        '<div class="pjXrayBadgeRow">' +
          '<span class="pjXrayBadge" data-tone="ai">AI-DRAWN</span>' +
          (stale ? '<span class="pjXrayBadge" data-tone="warn">STALE</span>' : '') +
          '<span class="pjWsSub">drawn ' + escapeHtml(p.generatedAt ? new Date(p.generatedAt).toLocaleString() : '(unknown)') +
            ' · ' + escapeHtml(String(p.bytes || 0)) + ' bytes · from canonical ' +
            escapeHtml(String(p.canonicalHash || '').slice(0, 12)) + '…</span>' +
        '</div>' +
        (stale
          ? '<div class="pjErr" data-tone="warn">STALE — the blueprint moved on after this diagram was drawn. ' +
            'Regenerate it below, or it stays as-is; nothing redraws without you.</div>'
          : '');
    } else {
      badges =
        '<div class="pjXrayBadgeRow">' +
          '<span class="pjXrayBadge">DERIVED</span>' +
          '<span class="pjWsSub">derived from your architecture card — free, always available; the AI pass below upgrades it.</span>' +
        '</div>';
    }

    const canRun = Boolean(xr.prepared) && !xr.busy;
    main.innerHTML =
      '<h2 class="pjTitle">X-ray — the architecture, visible</h2>' +
      '<p class="pjLead">The blueprint\'s components, data stores, and integrations as one diagram. ' +
        'A blueprint change marks an AI-drawn diagram STALE; nothing redraws without you.</p>' +
      '<div class="pjCard">' +
        badges +
        (d ? xrayCanvasHtml(showing.parsed) : '<div class="pjWsSub">Deriving the diagram…</div>') +
        '<div class="pjWsSub">diagram view — layout is approximate</div>' +
        (d
          ? '<details class="pjXraySrc"><summary class="pjWsSub">VIEW MERMAID SOURCE</summary>' +
            '<pre>' + escapeHtml(showing.mermaid) + '</pre></details>'
          : '') +
      '</div>' +
      '<div class="pjCard">' +
        '<label class="pjLabel">' + (isAi ? 'REDRAW WITH AI' : 'DRAW WITH AI') + '</label>' +
        '<div class="pjWsSub">One hidden disposable turn draws the diagram from the approved blueprint — ' +
          'opt-in, on the STUDIO model pick. The derived sketch above costs nothing and stays available.</div>' +
        '<div class="pjBtnRow">' +
          '<button type="button" class="pjBtn pjXrayPrepare" ' + (xr.busy ? 'disabled' : '') + ' ' +
            'title="Runs one hidden disposable session to draw the architecture diagram — a real Claude turn, opt-in.">' +
            (xr.prepared ? 'RE-CHECK USAGE' : (isAi ? 'REDRAW' : 'DRAW') + ' WITH AI (USES A SESSION)') +
          '</button>' +
          (xr.prepared
            ? '<button type="button" class="pjBtn primary pjXrayRun" ' + (canRun ? '' : 'disabled') + '>RUN DIAGRAM PASS</button>'
            : '') +
          (xr.busy ? '<button type="button" class="pjBtn pjXrayStop">STOP</button>' : '') +
        '</div>' +
        (xr.prepared
          ? '<div class="pjWsSub pjAiUsage">' + escapeHtml(usageNote(xr.prepared.usage)) + '</div>'
          : '') +
        (xr.busy ? '<div class="pjWsSub pjAiUsage">Drawing the diagram…</div>' : '') +
        (xr.resultError ? '<div class="pjErr" data-tone="warn">' + escapeHtml(xr.resultError) + '</div>' : '') +
      '</div>' +
      '<div class="pjCard"><div class="pjBtnRow">' +
        '<button type="button" class="pjBtn pjXrayBack">← BACK TO SEE</button>' +
        '<button type="button" class="pjBtn primary pjXrayContinue">CONTINUE TO CREATE →</button>' +
      '</div></div>';

    wireXray(draft, d ? showing : null);
  }

  function wireXray(draft, showing) {
    if (showing) drawXrayWires(showing.parsed);
    const xr = state.xray;
    const prepareBtn = main.querySelector('.pjXrayPrepare');
    if (prepareBtn) prepareBtn.addEventListener('click', () => {
      if (prepareBtn.disabled) return;
      xr.prepared = null;
      xr.resultError = null;
      ApexBus.post('projectsDiagramPrepare', { id: draft.id });
    });
    const runBtn = main.querySelector('.pjXrayRun');
    if (runBtn) runBtn.addEventListener('click', () => {
      if (runBtn.disabled || !xr.prepared) return;
      xr.busy = true;
      ApexBus.post('projectsDiagramRun', {
        id: xr.prepared.draftId, expectedRevision: xr.prepared.revision, approved: true,
      });
      render();
    });
    const stopBtn = main.querySelector('.pjXrayStop');
    if (stopBtn) stopBtn.addEventListener('click', () => ApexBus.post('projectsDiagramStop', {}));
    const back = main.querySelector('.pjXrayBack');
    if (back) back.addEventListener('click', () => goStep('see'));
    const cont = main.querySelector('.pjXrayContinue');
    if (cont) cont.addEventListener('click', () => goStep('create'));
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
        (already ? '<div class="pjBtnRow"><button type="button" class="pjBtn primary pjToLiftoff">BUILD →</button></div>' : '') +
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

  // ---- slice C2: the BOOM card + ledger (markup halves; wireBoom below) ----
  function describePick(c) {
    if (!c) return '(no element)';
    const cls = c.classes && c.classes.length ? '.' + c.classes.join('.') : '';
    return '<' + (c.tag || 'element') + cls + '>' + (c.text ? ' — “' + c.text + '”' : '');
  }

  // The resolver's honesty, shown before anything lands: every candidate with
  // its tier and confidence, verbatim from main.
  function boomCandidateLines(b) {
    const lines = (b.candidates || []).map((c, i) =>
      (i + 1) + '. [' + c.tier + ', ' + c.confidence + ' confidence] ' +
      (c.file ? c.file + (c.line ? ':' + c.line : '') : '(no file — element context only)'));
    if (b.truncated) lines.push('(project walk truncated — a huge tree lowers confidence)');
    return lines.join('\n');
  }

  function boomResultHtml(m) {
    if (!m) return '';
    if (m.error)
      return '<div class="pjErr" data-tone="warn">Nothing landed — ' + escapeHtml(m.error) + '</div>';
    if (m.demoted)
      return '<div class="pjErr" data-tone="warn">BIGGER THAN A BOOM — ' +
          escapeHtml((m.reasons || []).join(' · ') || 'the surgeon asked to delegate') + '. Nothing was written.</div>' +
        (m.summary ? '<div class="pjWsSub">' + escapeHtml(m.summary) + '</div>' : '') +
        '<div class="pjBtnRow"><button type="button" class="pjBtn primary pjBoomDelegate" ' +
          'title="Pre-fills DELEGATE TO THE ARCHITECT with this intent riding the kickoff brief">DELEGATE IT →</button></div>';
    if (m.ok)
      return '<div class="pjErr" data-tone="good">LANDED (' + escapeHtml(m.mode || '') +
          (m.token ? ' · ' + escapeHtml(String(m.token).slice(0, 12)) : '') + ') — ' +
          escapeHtml(m.summary || '') + '</div>' +
        '<div class="pjWsSub">' + escapeHtml((m.edits || [])
          .map((e) => e.file + ' (' + e.kind + ')').join(' · ')) + '</div>' +
        (m.warning ? '<div class="pjErr" data-tone="warn">' + escapeHtml(m.warning) + '</div>' : '');
    return '';
  }

  function boomCardHtml() {
    const b = state.boom;
    if (!b.open) return '';
    return '<div class="pjCard pjBoomCard">' +
      '<div class="pjLabel">BOOM — CHANGE WHAT YOU CLICKED</div>' +
      '<div class="pjWsSub">Picked ' + escapeHtml(describePick(b.context)) +
        (b.context && b.context.selector ? ' · at ' + escapeHtml(b.context.selector) : '') + '</div>' +
      (b.cardError ? '<div class="pjErr" data-tone="warn">' + escapeHtml(b.cardError) + '</div>' : '') +
      '<input type="text" class="pjName pjBoomIntent" maxlength="1000" ' +
        'placeholder="What should change here? One surgical strike — your words are the whole job." ' +
        (b.busy ? 'disabled ' : '') + 'value="' + escapeHtml(b.intent) + '" />' +
      '<div class="pjWsSub pjAiUsage">' + escapeHtml(usageNote(b.usage)) +
        ' GO launches one hidden Surgeon session — GO is the approval; small edits land (with a revert), bigger ones demote to a delegate card.</div>' +
      '<div class="pjBtnRow">' +
        '<button type="button" class="pjBtn primary pjBoomGo" ' + (b.busy ? 'disabled' : '') + '>GO (USES A SESSION)</button>' +
        (b.busy ? '<button type="button" class="pjBtn pjBoomStop">STOP</button>' : '') +
        '<button type="button" class="pjBtn pjBoomClose">CLOSE</button>' +
      '</div>' +
      (b.busy ? '<div class="pjWsSub pjAiUsage">The Surgeon is on it — one strike, then the report…</div>' : '') +
      (b.candidates && b.candidates.length
        ? '<pre class="pjInstrList">' + escapeHtml('WHERE IT PROBABLY LIVES\n' + boomCandidateLines(b)) + '</pre>'
        : '') +
      boomResultHtml(b.result) +
    '</div>';
  }

  function boomLedgerHtml() {
    const b = state.boom;
    if (!b.ledger.length) return '';
    const rows = b.ledger.slice().reverse().slice(0, 20).map((e) => {
      const files = (e.files || []).map((f) => f.file).join(', ');
      return '<div class="pjSeeNoteChip">' +
        '<span class="pjWsSub">' + escapeHtml(String(e.ts || '').replace('T', ' ').slice(0, 19)) +
          (e.demoted ? ' · DEMOTED' : ' · ' + escapeHtml(String(e.mode || '').toUpperCase())) + '</span>' +
        '<span class="pjSeeNoteText">' + escapeHtml(e.intent || '(no intent recorded)') +
          (files ? ' — ' + escapeHtml(files) : '') + '</span>' +
        (e.demoted
          ? ''
          : '<button type="button" class="pjBtn pjBoomRevert" data-ts="' + escapeHtml(e.ts || '') +
              '" data-token="' + escapeHtml(e.token || '') + '" ' + (b.revertBusy ? 'disabled ' : '') +
              'title="' + (e.mode === 'git'
                ? 'git revert --no-edit of this boom\'s commit (refused if the tree is dirty)'
                : 'Restore the backed-up originals (files the boom created are removed)') + '">REVERT</button>') +
      '</div>';
    }).join('');
    return '<div class="pjCard">' +
      '<label class="pjLabel">BOOM LEDGER — ' + b.ledger.length + ' (LAST ' + Math.min(20, b.ledger.length) + ' SHOWN)</label>' +
      '<div class="pjWsSub">Every boom, revertable: a git project reverts by commit; anything else restores the backup copies. Capped at 100, oldest dropped.</div>' +
      '<div class="pjSeeNotes">' + rows + '</div>' +
      (b.revertMsg ? '<div class="pjErr" data-tone="warn">' + escapeHtml(b.revertMsg) + '</div>' : '') +
    '</div>';
  }

  function wireBoom(p) {
    const b = state.boom;
    const inspectBtn = main.querySelector('.pjInspectBtn');
    if (inspectBtn) inspectBtn.addEventListener('click', () => {
      // main is the truth — the toggle flips when appFrameInspectState answers
      ApexBus.post('appFrameInspect', { on: !state.server.inspect });
    });
    const intentEl = main.querySelector('.pjBoomIntent');
    if (intentEl) intentEl.addEventListener('input', () => { b.intent = intentEl.value; });
    const goBtn = main.querySelector('.pjBoomGo');
    if (goBtn) goBtn.addEventListener('click', () => {
      if (b.busy) return;
      const intent = (intentEl ? intentEl.value : b.intent).trim();
      if (!intent) { b.result = { error: 'Say what should change first — the intent is the whole job.' }; render(); return; }
      b.intent = intent;
      b.busy = true;
      b.result = null;
      b.candidates = null;
      render();
      ApexBus.post('projectsBoomGo', {
        projectId: p.projectId, context: b.context, intent, approved: true,
      });
    });
    const stopBtn = main.querySelector('.pjBoomStop');
    if (stopBtn) stopBtn.addEventListener('click', () => ApexBus.post('projectsBoomStop', {}));
    const closeBtn = main.querySelector('.pjBoomClose');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      if (b.busy) ApexBus.post('projectsBoomStop', {});
      b.open = false;
      b.busy = false;
      b.context = null;
      b.result = null;
      b.candidates = null;
      render();
    });
    const delegateBtn = main.querySelector('.pjBoomDelegate');
    if (delegateBtn) delegateBtn.addEventListener('click', () => {
      // demote → delegate: pre-fill the EXISTING Lift-off flow (no new
      // machinery — the intent rides the next DELEGATE click's kickoff)
      state.liftoff.boomIntent = b.intent;
      b.open = false;
      b.result = null;
      render();
    });
    const handoffClear = main.querySelector('.pjBoomHandoffClear');
    if (handoffClear) handoffClear.addEventListener('click', () => {
      state.liftoff.boomIntent = '';
      render();
    });
    for (const btn of main.querySelectorAll('.pjBoomRevert')) {
      btn.addEventListener('click', () => {
        if (b.revertBusy) return;
        b.revertBusy = true;
        b.revertMsg = null;
        render();
        ApexBus.post('projectsBoomRevert', {
          projectId: p.projectId, ts: btn.dataset.ts, token: btn.dataset.token || null,
        });
      });
    }
  }

  // ---- E1: the milestone track's derive logic — the client mirror of
  // lib/liftoff.js's milestoneSlug/deriveMilestoneStatus (the renderer can't
  // require node libs; the lib export is the drilled AUTHORITY and this
  // mirror is held to it — the SECTIONS/validatePickMessage discipline).
  // Matching: slug-in-slugified-title on token boundaries (the '-' wrap),
  // same-cwd via plain normalized strings (both sides originate from the
  // same projectDir string). Precedence: any live task = 'building' (a
  // re-delegated done milestone honestly reopens), else a done task =
  // 'done', else 'open'; 'failed' counts as neither.
  const MS_ACTIVE_STATUSES = ['open', 'running', 'paused', 'needs-attention'];
  const msSlug = (text) => String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48).replace(/-+$/g, '');
  const msDirKey = (dir) => String(dir || '')
    .replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
  function milestoneStatus(slug, tasks, projectDir) {
    const wantDir = msDirKey(projectDir);
    if (!slug || !wantDir) return 'open';
    let done = false;
    for (const t of (Array.isArray(tasks) ? tasks : [])) {
      if (!t || typeof t.title !== 'string' || typeof t.cwd !== 'string') continue;
      if (msDirKey(t.cwd) !== wantDir) continue;
      if (!('-' + msSlug(t.title) + '-').includes('-' + slug + '-')) continue;
      if (MS_ACTIVE_STATUSES.includes(t.status)) return 'building';
      if (t.status === 'done') done = true;
    }
    return done ? 'done' : 'open';
  }

  // Status chips patch in place on every taskList broadcast — a full render
  // per board change would eat the RUN form's caret (the projectsServerLog /
  // patchInstruments precedent). The row SET only changes when the parsed
  // milestones do, and that path renders in full.
  function patchMilestones() {
    const p = state.createdProject;
    if (!p) return;
    for (const row of main.querySelectorAll('.pjMsRow')) {
      const st = milestoneStatus(row.dataset.slug, state.board, p.projectDir);
      const chip = row.querySelector('.pjMsStatus');
      if (chip && chip.dataset.status !== st) {
        chip.dataset.status = st;
        chip.textContent = st.toUpperCase();
      }
    }
  }

  // ---- BUILD (slice 8's Lift-off, reorganized by E1 § Wave E): the living
  // payoff screen, offered right after Create succeeds. Milestone-first: the
  // track (parsed from the delivery area, status derived off the board) sits
  // on top; the register/delegate/chat/RUN/PREVIEW/boom cards remain below.
  // The actions stay independent — none of them chains into another.
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
        // B3: events belong to a project's frame; the width taste carries over
        events: [], eventsOpen: false,
        deviceWidth: state.server.deviceWidth || 'desktop',
        inspect: false,
      };
      // C2: a fresh project gets a fresh boom slate + its own ledger
      state.boom = {
        open: false, context: null, intent: '', usage: null, cardError: null,
        busy: false, candidates: null, truncated: false, result: null,
        ledger: [], revertMsg: null, revertBusy: false,
      };
      // E1: a fresh project gets a fresh milestone track (same guard — the
      // reply re-renders, which must not re-ask)
      lift.milestones = null;
      lift.milestonesError = null;
      lift.milestone = null;
      ApexBus.post('projectsServerConfigGet', { projectId: p.projectId });
      ApexBus.post('projectsBoomLedgerGet', { projectId: p.projectId });
      ApexBus.post('projectsMilestonesGet', { projectId: p.projectId });
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

    // E1: the milestone track — the step's headline. Rows derive status at
    // paint time (never stored); DELEGATE THIS pre-fills the delegate flow
    // below, the same handoff shape a demoted boom takes.
    const msRows = (lift.milestones || []).map((ms) => {
      const st = milestoneStatus(ms.slug, state.board, p.projectDir);
      return '<div class="pjMsRow" data-slug="' + escapeHtml(ms.slug) + '">' +
        '<span class="pjMsStatus" data-status="' + st + '">' + st.toUpperCase() + '</span>' +
        '<span class="pjMsText">' + escapeHtml(ms.text) + '</span>' +
        '<button type="button" class="pjBtn pjMsDelegate" data-slug="' + escapeHtml(ms.slug) + '" ' +
          (lift.delegateBusy ? 'disabled ' : '') +
          'title="Pre-fill the delegate flow below with this milestone — its slug rides the task title (how the status here tracks the board) and the kickoff carries it as a bounded MILESTONE FOCUS block">DELEGATE THIS</button>' +
      '</div>';
    }).join('');

    main.innerHTML =
      '<h2 class="pjTitle">Build — ' + escapeHtml(p.displayName || p.projectId) + '</h2>' +
      '<p class="pjLead">' + escapeHtml(p.projectDir) + '</p>' +

      '<div class="pjCard">' +
        '<div class="pjLabel">MILESTONES — THE DELIVERY PLAN' +
          (lift.milestones && lift.milestones.length ? ' (' + lift.milestones.length + ')' : '') + '</div>' +
        '<div class="pjWsSub">Parsed from the blueprint\'s delivery area — numbered/bulleted lines and ' +
          'milestone-marked sentences. Status is derived live from the board (a task in this project\'s ' +
          'folder whose title carries the milestone), never stored. Wrong list? The delivery card is the fix.</div>' +
        (lift.milestones === null
          ? '<div class="pjWsSub">Reading the delivery plan…</div>'
          : (lift.milestones.length
              ? '<div class="pjMsTrack">' + msRows + '</div>'
              : '<div class="pjWsSub">No milestones found — write the delivery area as a numbered ' +
                'list (or say "milestone" in a sentence) and the track fills in.</div>')) +
        (lift.milestonesError
          ? '<div class="pjErr" data-tone="warn">' + escapeHtml(lift.milestonesError) + '</div>'
          : '') +
      '</div>' +

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
        // C2: a demoted boom's DELEGATE pre-fills this flow — the intent rides
        // the kickoff brief as extra context (the F2 composition, one call).
        (lift.boomIntent
          ? '<div class="pjWsSub" data-tone="quiet">BOOM HANDOFF rides the kickoff: “' +
              escapeHtml(String(lift.boomIntent).slice(0, 160)) + '” ' +
              '<button type="button" class="pjBtn pjBoomHandoffClear" title="Drop the boom handoff from the kickoff">✕</button></div>'
          : '') +
        // E1: a milestone's DELEGATE THIS pre-fills the same way — one more
        // bounded block on the same composition, plus the slug on the title.
        (lift.milestone
          ? '<div class="pjWsSub" data-tone="quiet">MILESTONE FOCUS rides the kickoff: “' +
              escapeHtml(String(lift.milestone.text).slice(0, 160)) + '” ' +
              '<button type="button" class="pjBtn pjMsHandoffClear" title="Drop the milestone focus from the kickoff">✕</button></div>'
          : '') +
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
        '<div class="pjWsSub">One plain chat seat in this project\'s folder — no route, no task. ' +
          'It opens on the same brief a delegation carries: PROJECT.md + the contract addendum.</div>' +
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

      // slice B2: the PREVIEW surface — the placeholder rectangle main's
      // WebContentsView overlays while the B1 server is ready (Wave E renames
      // this area). No iframe and no URL in this DOM: the frame is main-owned,
      // and this card only stakes out the geometry the frame sync measures.
      // slice B3: the instrument strip rides over it — error chips counting
      // main's shaped appFrameEvent stream (click = the capped list), width
      // presets sizing the placeholder (the B2 bounds sync follows on its
      // own), and RELOAD, moved in from its old lone row.
      (srv.phase === 'ready' && srv.port
        ? '<div class="pjCard">' +
            '<div class="pjLabel">PREVIEW — YOUR APP ' +
              '<span class="pjRunPhase" data-phase="ready">LOCALHOST:' + escapeHtml(String(srv.port)) + '</span></div>' +
            '<div class="pjInstrStrip">' +
              '<button type="button" class="pjChip pjInstrChip pjInstrToggle" data-kind="console"' +
                ' data-on="' + (srv.eventsOpen ? 'true' : 'false') + '"' +
                (srv.events.some((e) => e.kind === 'console') ? ' data-tone="warn"' : '') +
                ' title="Console errors from your app — click for the list">CONSOLE ' +
                srv.events.filter((e) => e.kind === 'console').length + '</button>' +
              '<button type="button" class="pjChip pjInstrChip pjInstrToggle" data-kind="net"' +
                ' data-on="' + (srv.eventsOpen ? 'true' : 'false') + '"' +
                (srv.events.some((e) => e.kind === 'net') ? ' data-tone="warn"' : '') +
                ' title="Failed loads in your app — click for the list">NET ' +
                srv.events.filter((e) => e.kind === 'net').length + '</button>' +
              '<button type="button" class="pjBtn pjInstrClear" title="Clear the counted events">CLEAR</button>' +
              '<span class="pjInstrGap"></span>' +
              ['mobile', 'tablet', 'desktop'].map((w) =>
                '<button type="button" class="pjBtn pjFrameWidth' + (srv.deviceWidth === w ? ' primary' : '') +
                  '" data-width="' + w + '">' + w.toUpperCase() +
                  (FRAME_WIDTHS[w] ? ' ' + FRAME_WIDTHS[w] : ' FULL') + '</button>').join('') +
              '<button type="button" class="pjBtn pjFrameReloadBtn" ' +
                'title="Reload the app frame (the dev server keeps running)">RELOAD</button>' +
              // C2: the inspect toggle — main injects the picker into the
              // hosted page; a click there opens the BOOM card below.
              '<button type="button" class="pjBtn pjInspectBtn' + (srv.inspect ? ' primary' : '') + '" ' +
                'title="Click an element in your running app to change it — hover highlights, a click opens the BOOM card, Esc cancels">' +
                (srv.inspect ? 'INSPECT ON (ESC)' : 'INSPECT') + '</button>' +
            '</div>' +
            (srv.eventsOpen
              ? '<pre class="pjInstrList">' + escapeHtml(instrumentLines(srv)) + '</pre>'
              : '') +
            '<div class="pjFramePlot" aria-label="Live app preview"' +
              (FRAME_WIDTHS[srv.deviceWidth]
                ? ' style="width:' + FRAME_WIDTHS[srv.deviceWidth] + 'px"' : '') + '></div>' +
          '</div>'
        : '') +

      // C2: the BOOM card (opens on a pick, survives a server stop so the
      // result stays readable) + the ledger of landed booms.
      boomCardHtml() +
      boomLedgerHtml() +

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
        boomIntent: lift.boomIntent || undefined,   // C2: the demote handoff
        // E1: text only — main recomputes the slug, never trusts one
        milestone: lift.milestone ? lift.milestone.text : undefined,
      });
    });

    main.querySelector('.pjLiftChatBtn').addEventListener('click', () => {
      if (lift.chatBusy) return;
      lift.chatBusy = true;
      lift.chatResult = null;
      render();
      ApexBus.post('projectsLiftoffChat', { projectId: p.projectId });
    });

    // E1: the milestone track's wiring — DELEGATE THIS pre-fills the delegate
    // flow (the C2 boom-demote pattern); ✕ drops the pre-fill.
    for (const btn of main.querySelectorAll('.pjMsDelegate'))
      btn.addEventListener('click', () => {
        const ms = (lift.milestones || []).find((x) => x.slug === btn.dataset.slug);
        if (!ms) return;
        lift.milestone = { text: ms.text, slug: ms.slug };
        render();
      });
    const msClear = main.querySelector('.pjMsHandoffClear');
    if (msClear) msClear.addEventListener('click', () => {
      lift.milestone = null;
      render();
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

    // slice B3: the instrument strip's wiring (present only while the ready
    // card is). RELOAD keeps B2's same-URL-navigate-is-the-reload-button
    // contract and now also clears the chips — main resets its rate gate on
    // the same navigate, so both halves start the fresh page clean.
    for (const btn of main.querySelectorAll('.pjInstrToggle'))
      btn.addEventListener('click', () => { srv.eventsOpen = !srv.eventsOpen; render(); });
    const instrClear = main.querySelector('.pjInstrClear');
    if (instrClear) instrClear.addEventListener('click', () => { srv.events = []; render(); });
    for (const btn of main.querySelectorAll('.pjFrameWidth'))
      btn.addEventListener('click', () => { srv.deviceWidth = btn.dataset.width; render(); });
    const frameReloadBtn = main.querySelector('.pjFrameReloadBtn');
    if (frameReloadBtn) frameReloadBtn.addEventListener('click', () => {
      srv.events = [];
      // C2: main drops its inspect flag on the same navigate (the injected
      // picker dies with the document) — mirror it so the toggle tells truth
      srv.inspect = false;
      render();
      ApexBus.post('appFrameNavigate', { url: 'http://localhost:' + srv.port + '/' });
    });

    // C2: the inspect toggle + the BOOM card/ledger wiring
    wireBoom(p);

    main.querySelector('.pjLiftBack').addEventListener('click', () => goStep('create'));
  }

  // ---- slice B2: the app frame sync ---------------------------------------
  // The real app renders in a MAIN-owned WebContentsView (main/appFrame.js);
  // this half owns only geometry and visibility truth. One function
  // (frameSyncNow) recomputes both from the live DOM, and every way the
  // placeholder can move or vanish funnels into it: renders (the schedule in
  // render()), element resizes (ResizeObserver — a hidden ancestor zeroes the
  // rect, so a dock-tab/sub-tab/step hide lands here without the shell having
  // to tell us), window resizes, and scrolls. Trailing-edge throttle so a
  // drag posts a handful of bounds, not hundreds. Fail-soft by construction:
  // on a core without appFrame.js the posts are unhandled-type warnings and
  // the placeholder simply stays an empty card.
  const frame = {
    shown: false, timer: null, plotEl: null,
    url: null,   // B3: the last synced target — a change resets the chips
    ro: typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduleFrameSync()) : null,
  };

  // B3: chips and the open list patch in place — a full render per event
  // would eat the RUN form's caret (the projectsServerLog precedent). When
  // the strip isn't on screen the store still counts; the next render shows.
  function patchInstruments() {
    const srv = state.server;
    const chips = main.querySelectorAll('.pjInstrChip');
    for (const chip of chips) {
      const kind = chip.dataset.kind;
      const n = srv.events.filter((e) => e.kind === kind).length;
      chip.textContent = kind.toUpperCase() + ' ' + n;
      if (n) chip.setAttribute('data-tone', 'warn');
      else chip.removeAttribute('data-tone');
    }
    const list = main.querySelector('.pjInstrList');
    if (list) {
      list.textContent = instrumentLines(srv);
      list.scrollTop = list.scrollHeight;
    }
  }

  function frameSyncNow() {
    const p = state.createdProject;
    const srv = state.server;
    const plot = main.querySelector('.pjFramePlot');
    // re-aim the observer only when the element CHANGED — re-observing the
    // same node fires the initial-size callback and would loop the throttle
    if (frame.ro && frame.plotEl !== plot) {
      frame.ro.disconnect();
      frame.plotEl = plot;
      if (plot) frame.ro.observe(plot);
    }
    let bounds = null;
    if (plot && p && srv.phase === 'ready' && srv.port) {
      const r = plot.getBoundingClientRect();   // zero while any ancestor hides
      if (r.width > 0 && r.height > 0)
        bounds = { x: r.left, y: r.top, width: r.width, height: r.height };
    }
    if (bounds) {
      const url = 'http://localhost:' + srv.port + '/';
      // B3: a different target (port change → another server) means main
      // reloads AND resets its gate — old-page noise would lie about the new
      // (and C2's injected picker died with the old page; main dropped its
      // inspect flag at the same trigger, so the toggle follows)
      if (frame.url && frame.url !== url) { srv.events = []; srv.inspect = false; patchInstruments(); }
      frame.url = url;
      frame.shown = true;
      // show doubles as the bounds sync (main reloads only on a CHANGED url)
      ApexBus.post('appFrameShow', { projectId: p.projectId, url, bounds });
    } else if (frame.shown) {
      frame.shown = false;
      ApexBus.post('appFrameHide', {});
    }
  }

  function scheduleFrameSync() {
    if (!hasBus || frame.timer) return;
    frame.timer = setTimeout(() => { frame.timer = null; frameSyncNow(); }, 80);
  }

  if (hasBus && typeof window !== 'undefined') {
    window.addEventListener('resize', scheduleFrameSync);
    // capture: .pjMain (and any inner scroller) moves the placeholder without
    // resizing it — the only signal ResizeObserver cannot see
    el.addEventListener('scroll', scheduleFrameSync, true);
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

  // ---- slice D2: the X-ray diagram pass -------------------------------------
  ApexBus.on('projectsDiagramState', (m) => {
    if (state.draft && m.draftId !== state.draft.id) return;
    state.xray.forDraft = m.draftId;
    state.xray.data = m;
    if (state.step === 'xray') render();
  });

  ApexBus.on('projectsDiagramPrepared', (m) => {
    if (state.draft && m.draftId !== state.draft.id) return;
    Object.assign(state.xray, { prepared: m, busy: false, resultError: null });
    if (state.step === 'xray') render();
  });

  ApexBus.on('projectsDiagramStatus', (m) => {
    if (m.phase === 'error') {
      Object.assign(state.xray, { prepared: null, busy: false, resultError: m.error });
      if (state.step === 'xray') render();
      return;
    }
    if (m.phase === 'stopped') {
      Object.assign(state.xray, { prepared: null, busy: false });
      if (state.step === 'xray') render();
    }
    // 'running' is already reflected client-side the instant RUN is clicked.
  });

  ApexBus.on('projectsDiagramResult', (m) => {
    if (state.draft && m.draftId !== state.draft.id) return;
    Object.assign(state.xray, {
      prepared: null, busy: false,
      resultError: m.ok ? null : m.error,
    });
    // A successful pass is followed by projectsDraftPatched (the field) and a
    // fresh projectsDiagramState from main, which repaints the AI-drawn view.
    if (state.step === 'xray') render();
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
    // D2: the diagram field lands the same way — the X-ray step repaints.
    else if (state.step === 'xray') render();
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
        delegateBusy: false, delegateResult: null, chatBusy: false, chatResult: null,
        milestones: null, milestonesError: null, milestone: null };
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
    // E1: a LANDED delegation consumes its milestone pre-fill (the board task
    // now carries the slug — the track shows 'building'); a refusal keeps it
    // for the retry, the boomIntent way.
    if (m && m.ok) state.liftoff.milestone = null;
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsLiftoffChatResult', (m) => {
    state.liftoff.chatBusy = false;
    state.liftoff.chatResult = m;
    if (state.step === 'liftoff') render();
  });

  // E1: the parsed milestone track (per-project — the guard mirrors
  // forRunProject's, and a stale project's post drops).
  ApexBus.on('projectsMilestones', (m) => {
    if (!m || !state.createdProject || m.projectId !== state.createdProject.projectId) return;
    state.liftoff.milestones = Array.isArray(m.milestones) ? m.milestones : [];
    state.liftoff.milestonesError = m.error || null;
    if (state.step === 'liftoff') render();
  });

  // E1: the board broadcast — the derived-status source. Chips patch in
  // place (patchMilestones), never a full render: a board change mid-typing
  // must not eat the RUN form's caret (the appFrameEvent discipline).
  ApexBus.on('taskList', (m) => {
    if (!m) return;
    state.board = Array.isArray(m.tasks) ? m.tasks : [];
    if (state.step === 'liftoff') patchMilestones();
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

  // slice B2: a frame refusal (URL wall, dead window) tells its story in the
  // RUN drawer's existing error slot — per-window truth, postTo'd by main, so
  // it can only ever describe THIS window's frame.
  ApexBus.on('appFrameState', (m) => {
    if (!m || m.ok || !m.error) return;
    const srv = state.server;
    if (srv.error !== m.error) {
      srv.error = m.error;
      if (state.step === 'liftoff') render();
    }
  });

  // slice B3: the instrument stream — per-window postTo'd by main (this
  // window's frame alone), already shaped and rate-bounded there; this half
  // only counts and shows. Three kinds ride the wire: console/net events and
  // main's own '…dropped N' summary (kind:'drop'); anything else is noise.
  ApexBus.on('appFrameEvent', (m) => {
    if (!m || (m.kind !== 'console' && m.kind !== 'net' && m.kind !== 'drop')) return;
    const srv = state.server;
    srv.events.push({
      kind: m.kind,
      text: typeof m.text === 'string' ? m.text : '',
      url: typeof m.url === 'string' ? m.url : null,
    });
    if (srv.events.length > 100) srv.events.splice(0, srv.events.length - 100);
    // patch, never render — a full render per event would eat the RUN caret
    if (state.step === 'liftoff') patchInstruments();
  });

  // ---- slice C2: the boom loop's bus traffic --------------------------------
  // The inspect toggle's per-window truth (a refusal tells its story on the
  // toggle's own card slot, not the RUN drawer's).
  ApexBus.on('appFrameInspectState', (m) => {
    if (!m) return;
    const srv = state.server;
    srv.inspect = Boolean(m.ok && m.inspect);
    if (!m.ok && m.error && srv.error !== m.error) srv.error = m.error;
    if (state.step === 'liftoff') render();
  });

  // A pick (or an in-page Esc) from the app frame's inspector — per-window
  // postTo'd by main, already shaped fail-closed there (shapePickPayload).
  ApexBus.on('appFramePick', (m) => {
    if (!m) return;
    const srv = state.server;
    if (m.kind === 'cancel') {
      srv.inspect = false;   // the page's Esc uninstalled the picker; main's flag dropped with it
      if (state.step === 'liftoff') render();
      return;
    }
    if (m.kind !== 'pick' || !state.createdProject) return;
    const b = state.boom;
    b.open = true;
    b.context = m;
    b.result = null;
    b.candidates = null;
    b.cardError = null;
    // the click froze the pick — drop inspect so a stray second click can't
    // clobber the card while the user is typing the intent
    srv.inspect = false;
    ApexBus.post('appFrameInspect', { on: false });
    ApexBus.post('projectsBoomOpen', { projectId: state.createdProject.projectId });
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsBoomCard', (m) => {
    if (!m) return;
    state.boom.usage = m.usage || null;
    state.boom.cardError = m.error || null;
    if (state.step === 'liftoff' && state.boom.open) render();
  });

  ApexBus.on('projectsBoomStatus', (m) => {
    if (!m) return;
    const b = state.boom;
    if (m.phase === 'running') {
      b.busy = true;
      b.candidates = m.candidates || null;
      b.truncated = Boolean(m.truncated);
    } else if (m.phase === 'stopped') {
      b.busy = false;
    }
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsBoomResult', (m) => {
    if (!m) return;
    state.boom.busy = false;
    state.boom.result = m;
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsBoomLedger', (m) => {
    if (!m) return;
    if (state.createdProject && m.projectId !== state.createdProject.projectId) return;
    state.boom.ledger = m.entries || [];
    if (state.step === 'liftoff') render();
  });

  ApexBus.on('projectsBoomRevertResult', (m) => {
    if (!m) return;
    const b = state.boom;
    b.revertBusy = false;
    b.revertMsg = m.ok
      ? 'Reverted (' + (m.mode || '') + ').'
      : 'Not reverted — ' + (m.error || 'unknown error');
    if (state.createdProject)
      ApexBus.post('projectsBoomLedgerGet', { projectId: state.createdProject.projectId });
    if (state.step === 'liftoff') render();
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
  // E1: ask the board for its current state (main/tasks.js answers a
  // 'taskList' post with a fresh publish) — without this, a Reload
  // mid-project would show every milestone 'open' until the next change.
  ApexBus.post('taskList', {});
}
