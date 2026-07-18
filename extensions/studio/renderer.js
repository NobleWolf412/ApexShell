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

  // PROJECTS ships as an empty placeholder in slice 1 — the App Builder
  // registers a real id:'projects' builder in a later slice and replaces it.
  registerBuilder({
    id: 'projects',
    label: 'PROJECTS',
    order: 20,
    mount: (el) => {
      const note = document.createElement('div');
      note.className = 'studioPlaceholder';
      note.textContent = 'The App Builder lands here — a guided interview that turns an idea into a delegable project blueprint. Coming soon.';
      el.appendChild(note);
    },
  });

  ApexShell.registerDockPane(pane, { order: 20 });
})();
