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
      '<div class="studioTabs" role="tablist"></div>' +
      '<div class="studioViews"></div>' +
    '</div>' +
    '<div class="dockTab" data-tab="studio" title="Studio — build personas and project blueprints in one place">STUDIO</div>';

  const tabsEl = pane.querySelector('.studioTabs');
  const viewsEl = pane.querySelector('.studioViews');
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
    '</div>';
  if (!hasBus) return;   // headless shell drill: skeleton only, no bus, no wiring

  const rail = el.querySelector('.pjRail');
  const main = el.querySelector('.pjMain');

  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const state = {
    step: 'ws',            // 'ws' | 'start' | <cardKey>
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
  };

  const cardKeys = () => state.cards.map((c) => c.key);
  const isCardStep = (id) => cardKeys().includes(id);
  const cardIndex = (id) => cardKeys().indexOf(id);
  const findCard = (id) => state.cards.find((c) => c.key === id);

  function steps() {
    return [
      { id: 'ws', label: 'Workspace', sub: 'where projects live' },
      { id: 'start', label: 'Start', sub: 'name + pitch' },
      ...state.cards.map((c, i) => ({ id: c.key, label: (i + 1) + ' · ' + c.title, sub: null, card: true })),
    ];
  }

  const stepDone = (id) => {
    if (id === 'ws') return Boolean(state.ws && state.ws.configured);
    if (id === 'start') return Boolean(state.draft);
    return Boolean(state.draft && (state.draft.answers[id] || '').trim());
  };
  const stepReachable = (id) => {
    if (id === 'ws') return true;
    if (id === 'start') return Boolean(state.ws && state.ws.configured);
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
    if (state.step === 'ws') return renderWs();
    if (state.step === 'start') return renderStart();
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
        '<div class="pjBtnRow">' +
          (idx > 0 ? '<button type="button" class="pjBtn pjBack">← BACK</button>' : '') +
          '<button type="button" class="pjBtn primary pjNext">' +
            (idx < total - 1 ? 'SAVE & NEXT →' : 'SAVE DRAFT ✓') + '</button>' +
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
      goStep(idx < total - 1 ? cardKeys()[idx + 1] : 'start');
    });
    main.querySelector('.pjSaveDraft').addEventListener('click', () => goStep('start'));
    const skip = main.querySelector('.pjSkip');
    if (skip) skip.addEventListener('click', () => goStep(cardKeys()[idx + 1]));
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

  render();
  ApexBus.post('projectsWorkspaceGet', {});
}
