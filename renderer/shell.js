// Apex — the shell surface (ported from the VS Code build, J13/J14; gestures
// and collision rules unchanged):
//   TOP    the Tracker blind — covers everything (window-blind rule, z 500)
//   LEFT   the Dock drawer — folder-tab panes, staggered tabs (z 400)
//   RIGHT  the AI bar — persona rail; seats land with the engine (Phase 1)
// Gestures: CLICK = quarter toggle; DRAG = hand-pull, directional snap.
// Collision: quarters coexist; a side going FULL evicts the opposing side and
// REMEMBERS it, restoring on retreat. The top blind ignores both — it covers.
// State: localStorage (this module's own concern; nothing else reads it).
'use strict';
(function () {
  // ---------- persisted shell state ----------
  let store;
  try { store = JSON.parse(localStorage.getItem('apex.shell.v1')) || {}; } catch { store = {}; }
  store = Object.assign(
    { top: 'collapsed', right: 'collapsed', tabs: {}, zsq: [], memRight: null, memLeft: null },
    store);
  const persist = () => localStorage.setItem('apex.shell.v1', JSON.stringify(store));

  const BAR = 40, TITLE = 34;
  // usable height = below our title bar (the blind's coordinate space)
  const H = () => innerHeight - TITLE, W = () => innerWidth;

  // ---- generic pull: click = quarter toggle, drag = directional snap (J14) ----
  function attachPull(cfg) {
    let drag = null;
    cfg.handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .chip')) return;   // buttons/chips on handles act, never pull
      drag = { p0: cfg.axis === 'y' ? e.clientY : e.clientX,
               base: cfg.posOf(cfg.get()), moved: false };
      cfg.handle.setPointerCapture(e.pointerId);
    });
    cfg.handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const d = ((cfg.axis === 'y' ? e.clientY : e.clientX) - drag.p0) * cfg.dir;
      if (!drag.moved && Math.abs(d) < 5) return;
      if (!drag.moved && cfg.onDragStart) cfg.onDragStart();
      drag.moved = true;
      const lim = cfg.posOf('full');
      cfg.el.style.transition = 'none';
      cfg.setLive(Math.min(lim, Math.max(cfg.posOf('collapsed'), drag.base + d)));
    });
    const THRESH = 36;
    const up = (e) => {
      if (!drag) return;
      const { p0, base, moved } = drag;
      drag = null;
      if (!moved) { cfg.set(cfg.get() === 'collapsed' ? 'quarter' : 'collapsed', true); return; }
      const d = ((cfg.axis === 'y' ? e.clientY : e.clientX) - p0) * cfg.dir;
      const lim = cfg.posOf('full');
      const pos = Math.min(lim, Math.max(cfg.posOf('collapsed'), base + d));
      let target = cfg.get();
      if (Math.abs(pos - base) >= THRESH) {
        const dirn = pos > base ? 1 : -1;
        const cands = cfg.states.filter((s) =>
          dirn > 0 ? cfg.posOf(s) > base + 1 : cfg.posOf(s) < base - 1);
        let bd = Infinity;
        for (const s of cands) {
          const dd = Math.abs(cfg.posOf(s) - pos);
          if (dd < bd) { bd = dd; target = s; }
        }
      }
      cfg.el.style.transition = '';
      cfg.el.style.transform = '';
      cfg.set(target, false);
    };
    cfg.handle.addEventListener('pointerup', up);
    cfg.handle.addEventListener('pointercancel', up);
  }

  // ---- TOP: tracker (covers everything; no collision involvement) ----
  const blind = document.getElementById('blind');
  // The quarter position lives in the --quarter CSS var (class transforms +
  // band height both derive from it). Size it to what the tiles NEED —
  // fixed fractions kept clipping the grid behind the bar (the operator, twice).
  const updateQuarter = () => {
    const grid = document.getElementById('detailGrid');
    const need = (grid ? grid.scrollHeight : 0) + BAR + 28;
    const px = Math.round(Math.min(Math.max(need, .26 * H()), .62 * H()));
    document.documentElement.style.setProperty('--quarter', px + 'px');
    return px;
  };
  const setTop = (s, instant) => {
    store.top = s;
    if (instant) blind.style.transition = 'none';
    blind.className = 'blind ' + s;
    blind.style.transform = '';
    if (instant) requestAnimationFrame(() => { blind.style.transition = ''; });
    persist();
  };
  attachPull({
    el: blind, handle: document.getElementById('trackerBar'),
    axis: 'y', dir: 1, states: ['collapsed', 'quarter', 'full'],
    posOf: (s) => s === 'collapsed' ? BAR : s === 'quarter' ? updateQuarter() : H(),
    setLive: (p) => { blind.style.transform = 'translateY(' + (p - H()) + 'px)'; },
    get: () => store.top,
    set: (s) => setTop(s),
  });
  // smoke eyes (#top=quarter|full): open the blind on load so screenshots
  // can capture the pulldown content
  const hashTop = new URLSearchParams(location.hash.slice(1)).get('top');
  if (hashTop === 'quarter' || hashTop === 'full') store.top = hashTop;
  setTop(store.top, true);

  // ---- side geometry ----
  const dockPos = (s) => s === 'collapsed' ? 0 : s === 'quarter' ? .26 * W() : W() - 80;
  const aiPos = (s) => s === 'collapsed' ? BAR : s === 'quarter' ? .26 * W() + BAR : W() - 44;

  const aiPane = document.getElementById('aiPane');
  const dockEls = {};
  const dockOrder = {};
  const tabIds = [];
  // smoke eyes: `#dock=<tab>` opens that pane at quarter on load (main sets it
  // from APEX_SMOKE_DOCK) — a fresh smoke profile starts all-collapsed, so a
  // screenshot could never show pane CONTENT without this
  const hashDock = new URLSearchParams(location.hash.slice(1)).get('dock');

  const anyDockFull = () => tabIds.some((id) => store.tabs[id] === 'full');

  function renderDock(id, instant) {
    const el = dockEls[id];
    // persisted state (memLeft, zsq) can name a pane whose extension is gone —
    // stale data must never throw the shell (Codex review, R32)
    if (!el) return;
    const s = store.tabs[id];
    if (instant) el.style.transition = 'none';
    el.style.transform = 'translateX(' + (dockPos(s) - W()) + 'px)';
    // content lays out in the VISIBLE width, not the full hidden sheet
    el.style.setProperty('--paneW', Math.max(dockPos(s), dockPos('quarter')) + 'px');
    el.classList.toggle('open', s !== 'collapsed');
    // Collapsed panes ride a HIGHER tier (460+) so their tabs are never buried.
    // But promoting DURING the closing slide made the shutting sheet sweep
    // OVER neighboring tabs (the operator, 2026-07-14) — a closing pane keeps a
    // BELOW-everything tier until the slide lands, then takes the tab tier.
    const zi = store.zsq.indexOf(id);
    clearTimeout(el._zPromote);
    if (s === 'collapsed') {
      const promote = () => {
        if (store.tabs[id] === 'collapsed') el.style.zIndex = 460 + tabIds.indexOf(id);
      };
      if (instant) promote();
      // promote only after BOTH the .5s slide and the .55s body-hide have
      // landed — promoting at 380ms rode the still-closing sheet's edge over
      // sibling tabs (the thin-bar flicker, the operator 2026-07-14)
      else { el.style.zIndex = 400; el._zPromote = setTimeout(promote, 560); }
    } else {
      el.style.zIndex = 401 + (zi < 0 ? 0 : zi);
    }
    if (instant) requestAnimationFrame(() => { el.style.transition = ''; });
  }
  function renderAi(instant) {
    if (instant) aiPane.style.transition = 'none';
    // drives the usage choreography: the class sets --uprog's resting value
    // (0/1); dropping the drag's inline scrub value lets the registered
    // property TRANSITION from wherever the hand left it — one fluid motion
    aiPane.classList.toggle('open', store.right !== 'collapsed');
    aiPane.style.removeProperty('--uprog');
    aiPane.style.transform = 'translateX(' + (W() - aiPos(store.right)) + 'px)';
    aiPane.style.setProperty('--paneW',
      (Math.max(aiPos(store.right), aiPos('quarter')) - BAR) + 'px');
    aiPane.style.zIndex = 401 + store.zsq.length;
    if (instant) requestAnimationFrame(() => { aiPane.style.transition = ''; });
  }

  const raise = (id) => {
    store.zsq = store.zsq.filter((x) => x !== id); store.zsq.push(id);
    tabIds.forEach((t) => renderDock(t, true));
  };

  // ---- collision: FULL evicts the opposing side, remembers, restores ----
  function setDockTab(id, s, fromClick) {
    const was = store.tabs[id];
    if (fromClick && was === 'full') {
      const top = store.zsq[store.zsq.length - 1];
      if (top !== id) { raise(id); persist(); return; }
      s = 'collapsed';
    }
    if (s !== 'collapsed')   // opening ANY tab evicts another tab's quarter (J14)
      tabIds.forEach((t) => { if (t !== id && store.tabs[t] === 'quarter') { store.tabs[t] = 'collapsed'; renderDock(t); } });
    const hadFull = anyDockFull();
    store.tabs[id] = s;
    if (s !== 'collapsed') raise(id);
    else store.zsq = store.zsq.filter((x) => x !== id);
    if (s === 'full' && store.right !== 'collapsed') {
      store.memRight = store.right; setRight('collapsed', false, true);
    }
    if (hadFull && !anyDockFull() && store.memRight) {
      setRight(store.memRight, false, true); store.memRight = null;
    }
    renderDock(id);
    persist();
  }
  function setRight(s, fromClick, internal) {
    if (s === 'full') {
      const openTabs = {};
      let had = false;
      tabIds.forEach((id) => {
        if (store.tabs[id] !== 'collapsed') { openTabs[id] = store.tabs[id]; had = true;
          store.tabs[id] = 'collapsed'; renderDock(id); } });
      if (had) store.memLeft = openTabs;
    }
    if (store.right === 'full' && s !== 'full' && store.memLeft && !internal) {
      for (const [id, st] of Object.entries(store.memLeft)) { store.tabs[id] = st; renderDock(id); }
      store.memLeft = null;
    }
    store.right = s;
    renderAi();
    persist();
  }

  // ---- dock pane registration (built-ins at boot, extensions later) ----
  // Tab slots are ORDER-derived: panes sort by their order value and stagger
  // down the edge at 104px steps (the pre-extension hardcoded 18/122/226).
  function layoutTabs() {
    const sorted = [...tabIds].sort((a, b) => dockOrder[a] - dockOrder[b]);
    sorted.forEach((id, i) => {
      const tab = dockEls[id].querySelector('.dockTab');
      if (tab) tab.style.top = (18 + i * 104) + 'px';
    });
  }
  function registerDockPane(el, opts) {
    const id = el.dataset.tab;
    if (!id || dockEls[id]) return;   // no id / duplicate — refuse quietly
    if (!el.parentElement) document.querySelector('.sideWrap').insertBefore(el, aiPane);
    dockEls[id] = el;
    tabIds.push(id);
    const orders = Object.values(dockOrder);
    dockOrder[id] = (opts && opts.order !== undefined)
      ? opts.order : (orders.length ? Math.max(...orders) : 0) + 10;
    if (!store.tabs[id]) store.tabs[id] = 'collapsed';
    if (hashDock === id) store.tabs[id] = 'quarter';
    // a pane registering AFTER the right side went full must respect the
    // eviction it missed — full's covenant is "nothing opens over me"
    if (store.right === 'full' && store.tabs[id] !== 'collapsed' && hashDock !== id)
      store.tabs[id] = 'collapsed';
    attachPull({
      el,
      handle: el.querySelector('.dockTab'),
      axis: 'x', dir: 1, states: ['collapsed', 'quarter', 'full'],
      posOf: dockPos,
      // content tracks the pull LIVE (the operator: quarter felt "literal" — the sheet
      // stretched to full while the content stayed quarter-wide, disconnected)
      setLive: (p) => {
        el.style.transform = 'translateX(' + (p - W()) + 'px)';
        el.style.setProperty('--paneW', Math.max(p, dockPos('quarter')) + 'px');
      },
      get: () => store.tabs[id],
      set: (s, fromClick) => setDockTab(id, s, fromClick),
      onDragStart: () => {
        el.style.zIndex = 401 + store.zsq.length;
        el.classList.add('open');   // body must be visible while hand-pulling
      },
    });
    layoutTabs();
    renderDock(id, true);
  }
  document.querySelectorAll('.dockPane').forEach((el) =>
    registerDockPane(el, { order: parseFloat(el.dataset.order) || undefined }));
  // Modules may open a dock tab on explicit user intent (viewer path-clicks),
  // and extensions can register their own panes.
  window.ApexShell = {
    openDock: (id, s) => { if (dockEls[id]) setDockTab(id, s || 'quarter', false); },
    registerDockPane,
  };

  attachPull({
    el: aiPane, handle: document.getElementById('aiRail'),
    axis: 'x', dir: -1, states: ['collapsed', 'quarter', 'full'],
    posOf: aiPos,
    setLive: (p) => {
      aiPane.style.transform = 'translateX(' + (W() - p) + 'px)';
      aiPane.style.setProperty('--paneW', (Math.max(p, aiPos('quarter')) - BAR) + 'px');
      // the usage choreography SCRUBS with the hand (the operator, 2026-07-14: one
      // fluid animation from the grab; fill/drain tied to how open it is) —
      // 0 at collapsed, 1 at quarter; CSS derives every stage from this
      aiPane.style.setProperty('--uprog',
        Math.max(0, Math.min(1, (p - BAR) / (aiPos('quarter') - BAR))));
    },
    get: () => store.right,
    set: (s, fromClick) => setRight(s, fromClick),
  });
  renderAi(true);

  addEventListener('resize', () => {
    updateQuarter();
    tabIds.forEach((id) => renderDock(id, true));
    renderAi(true);
  });
  updateQuarter();

  // ---- AI rail: DOUBLE-click = new chat (J82, the operator — a stray single click
  // must never open a session); single click peeks the menu, hover unchanged ----
  const rail = document.getElementById('aiRail');
  rail.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-persona]');
    if (!btn) return;
    ApexChat.openRailMenu(btn, btn.dataset.persona);
  });
  rail.addEventListener('dblclick', (e) => {
    const btn = e.target.closest('button[data-persona]');
    if (!btn) return;
    ApexChat.hideRailMenu();
    ApexChat.newSeat(btn.dataset.persona);
  });
  rail.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('button[data-persona]');
    if (btn) ApexChat.openRailMenu(btn, btn.dataset.persona);
  });
  rail.addEventListener('pointerleave', () => ApexChat.scheduleHide());
  // right-click a seat button = that persona's launch defaults (the operator,
  // 2026-07-15): open the pane if needed, park the panel on them
  rail.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('button[data-persona]');
    if (!btn) return;
    e.preventDefault();
    ApexChat.hideRailMenu();
    if (store.right === 'collapsed') setRight('quarter', false);
    ApexChat.showDefaults(btn.dataset.persona || 'Seat');
  });

  // ---- monitors: chips + two grids off one data stream ----
  const chipsEl = document.getElementById('chips');
  const chipMeta = new Map();
  ApexBus.on('config', (m) => {
    ApexMonitors.buildGrid(document.getElementById('detailGrid'), m.panes, { compact: true });
    ApexMonitors.buildGrid(document.getElementById('fullGrid'), m.panes, {});
    // bare-install empty state (R32): an empty tracker says how to fill itself
    if (!m.panes.length) {
      for (const gid of ['detailGrid', 'fullGrid']) {
        const n = document.createElement('div');
        n.className = 'paneNote';
        n.textContent = 'No trackers configured — copy main/monitors/panes.sample.json ' +
          'to panes.json and make the panes yours (any tracker: a service, a feed, a ' +
          'queue). Sources: demo, http-json, or write your own — floorplan.md maps it.';
        document.getElementById(gid).appendChild(n);
      }
    }
    // tile heights settle once widgets render — re-derive the quarter size
    setTimeout(updateQuarter, 60);
    chipsEl.textContent = '';
    chipMeta.clear();
    for (const p of m.panes) {
      const led = (p.widgets || []).find((w) => w.kind === 'led');
      const val = (p.widgets || []).find((w) => w.kind === 'gauge' || w.kind === 'stat');
      const el = document.createElement('div');
      el.className = 'chip';
      el.innerHTML = '<span class="dot"></span><b></b><span class="v"></span>';
      el.querySelector('b').textContent = p.title;
      // chips navigate: click one → the blind opens straight to that pane
      // (quarter-only panes live in the detail band; the rest in the full grid)
      el.title = p.title + ' — click to open this tracker';
      el.addEventListener('click', (e) => {
        e.stopPropagation();   // the bar's click-toggle must not double-handle
        const view = p.only === 'quarter' ? 'quarter' : 'full';
        setTop(view);
        const grid = view === 'quarter' ? 'detailGrid' : 'fullGrid';
        setTimeout(() => {
          const card = document.querySelector('#' + grid + ' .mon-pane[data-pane="' + p.id + '"]');
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 300);   // after the blind's slide
      });
      chipsEl.appendChild(el);
      chipMeta.set(p.id, { el, ledBind: led && led.bind, valBind: val && val.bind });
    }
  });
  ApexBus.on('data', (m) => {
    ApexMonitors.dispatch(m.paneId, m.data);
    const c = chipMeta.get(m.paneId);
    if (c) {
      if (c.ledBind && m.data[c.ledBind] !== undefined) c.el.className = 'chip ' + m.data[c.ledBind];
      if (c.valBind && m.data[c.valBind] !== undefined) c.el.querySelector('.v').textContent = m.data[c.valBind];
    }
  });
  ApexBus.on('actionLog', (m) => {
    ApexMonitors.log(m.paneId, m.line);
    // Start/finish lines also toast — button feedback must be unmissable even
    // if the pane's log is scrolled away (the operator's speed-test report, J33).
    const t = m.line.trim();
    if (t.startsWith('▶') || t.startsWith('✓') || t.startsWith('✕'))
      ApexToast(m.paneId.toUpperCase() + ' — ' + t);
  });
  ApexBus.on('actionState', (m) => ApexMonitors.busy(m.paneId, m.busy));

  // ---- title bar: caption buttons + ☰ menu ----
  const closeBtn = document.getElementById('btnClose');
  const menu = document.getElementById('appMenu');
  const restartBtn = document.getElementById('menuRestart');
  const restartLabel = restartBtn.querySelector('.menuLabel');
  const codeBadge = document.getElementById('codeBadge');
  let codeChangeKind = '';
  let armed = null;

  document.getElementById('btnMin').onclick = () => apex.win.minimize();
  document.getElementById('btnMax').onclick = () => apex.win.maximize();
  closeBtn.onclick = () => apex.win.close();
  ApexBus.on('winState', (s) => {
    const b = document.getElementById('btnMax');
    b.textContent = s.maximized ? '❐' : '□';
    b.title = s.maximized ? 'Restore down' : 'Maximize';   // the label was a liar (the operator)
    const f = document.getElementById('menuFullscreen');
    if (f && s.fullscreen !== undefined)
      f.querySelector('.menuLabel').textContent = s.fullscreen ? 'Exit fullscreen' : 'Fullscreen';
  });

  function renderCodeBadge() {
    codeBadge.hidden = !codeChangeKind;
    codeBadge.classList.toggle('armed',
      !!armed && (armed.action === 'restart' || armed.action === 'reload'));
    if (!codeChangeKind) return;
    // SAFETY LOCK (the operator, 2026-07-14: the badge pops while a seat is still
    // landing files — a click then applies a HALF-FINISHED change set). While
    // any seat is mid-turn the badge holds: labeled honestly, and the click
    // arms instead of firing. When the seat's turn ends it goes one-click.
    const busy = window.ApexChat ? ApexChat.busyCount() : 0;
    codeBadge.classList.toggle('hold', !armed && busy > 0);
    if (armed && (armed.action === 'restart' || armed.action === 'reload')) {
      codeBadge.textContent = armed.n + ' working — ' + armed.action + ' anyway';
      codeBadge.title = 'Click again within 5 seconds to ' + armed.action +
        ' anyway — the working seat may still be mid-change';
    } else if (codeChangeKind === 'restart') {
      codeBadge.textContent = 'code changed — Restart' + (busy ? ' (seat working)' : '');
      codeBadge.title = busy
        ? 'A seat is mid-turn — its change set may be incomplete. Click arms; second click restarts anyway.'
        : 'Main or preload code changed — update and restart';
    } else {
      codeBadge.textContent = 'code changed — Reload' + (busy ? ' (seat working)' : '');
      codeBadge.title = busy
        ? 'A seat is mid-turn — its change set may be incomplete. Click arms; second click reloads anyway.'
        : 'Renderer code changed — reload the window';
    }
  }
  // the hold state must clear ITSELF when the seat finishes — cheap tick,
  // only does work while the badge is visible
  setInterval(() => { if (codeChangeKind && !armed) renderCodeBadge(); }, 2000);

  function resetArmed() {
    if (armed) clearTimeout(armed.timer);
    armed = null;
    closeBtn.classList.remove('armed');
    closeBtn.title = 'Close';
    restartBtn.classList.remove('warn');
    restartLabel.textContent = 'Update & restart';
    renderCodeBadge();
  }

  function safeGate(action) {
    const n = window.ApexChat ? ApexChat.busyCount() : 0;
    if (!n || (armed && armed.action === action)) {
      resetArmed();
      return true;
    }

    resetArmed();
    armed = { action, n, timer: null };
    const seats = n + ' seat' + (n === 1 ? '' : 's');
    if (action === 'quit') {
      closeBtn.classList.add('armed');
      closeBtn.title = seats + ' working — click again within 5 seconds to force-quit';
      ApexToast(seats + ' are working — click × again within 5s to force-quit');
    } else if (action === 'restart') {
      restartBtn.classList.add('warn');
      restartLabel.textContent = seats + ' working — click again to restart';
      ApexToast(seats + ' are working — click Update & restart again within 5s to restart anyway');
    } else {   // reload — the badge is its own affordance
      ApexToast(seats + ' are working (change set may be mid-landing) — click again within 5s to reload anyway');
    }
    renderCodeBadge();
    armed.timer = setTimeout(resetArmed, 5000);
    return false;
  }

  // The panels sit exactly where the menu drops. An open panel used to bury the
  // menu (z 1300 vs 1200) — ☰ still "opened", invisibly, behind it: no way back
  // to Reload/Quit. Opening the menu now dismisses the panels it launched.
  document.getElementById('btnMenu').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('themePanel').classList.remove('open');
    document.getElementById('backgroundPanel').classList.remove('open');
    menu.classList.toggle('open');
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#appMenu')) menu.classList.remove('open');
  });
  document.getElementById('menuTheme').onclick = () => { menu.classList.remove('open'); ApexTheme.open(); };
  document.getElementById('menuFullscreen').onclick = () => {
    menu.classList.remove('open');
    apex.win.fullscreen();
  };
  document.getElementById('menuReload').onclick = () => {
    if (!safeGate('reload')) return;   // same mid-landing lock as the badge
    menu.classList.remove('open');
    apex.win.reload();
  };
  restartBtn.onclick = () => {
    if (!safeGate('restart')) return;
    menu.classList.remove('open');
    ApexBus.post('updateRestart', {});
  };

  // OS closes originate in main. The renderer answers immediately if it is
  // alive; main's timeout is only for the crashed/hung/not-yet-loaded case.
  ApexBus.on('closeRequested', (m) =>
    apex.win.closeDecision(m.requestId, safeGate('quit')));

  ApexBus.on('codeChanged', (m) => {
    codeChangeKind = m.kind === 'restart' || m.kind === 'renderer' ? m.kind : '';
    renderCodeBadge();
  });
  codeBadge.onclick = () => {
    if (codeChangeKind === 'renderer' && safeGate('reload')) {
      apex.win.reload();
    } else if (codeChangeKind === 'restart' && safeGate('restart')) {
      ApexBus.post('updateRestart', {});
    }
  };

  // ---- the ? cheat-sheet: gestures are invisible until told (UX pass 2026-07-17) ----
  const helpOverlay = document.getElementById('helpOverlay');
  document.getElementById('btnHelp').onclick = (e) => {
    e.stopPropagation();
    menu.classList.remove('open');
    helpOverlay.hidden = !helpOverlay.hidden;
  };
  helpOverlay.addEventListener('mousedown', (e) => {
    if (e.target === helpOverlay) helpOverlay.hidden = true;
  });

  // ---- keyboard: Ctrl+1..5 toggle dock tabs, Ctrl+T new chat, Esc collapse ----
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.querySelector('.apxPrompt')) return;   // the prompt owns its own Esc
      if (!helpOverlay.hidden) { helpOverlay.hidden = true; return; }
      const rm = document.getElementById('railMenu');     // an open menu closes FIRST —
      if (rm && !rm.hidden) { ApexChat.hideRailMenu(); return; }   // one Esc, one layer
      tabIds.forEach((id) => { if (store.tabs[id] !== 'collapsed') setDockTab(id, 'collapsed', false); });
      if (store.right !== 'collapsed') setRight('collapsed', false);
      if (store.top !== 'collapsed') setTop('collapsed');
      return;
    }
    if (!e.ctrlKey) return;
    // never hijack keys the user is typing into a field or a live terminal
    if (e.target.closest('textarea, input, [contenteditable], .termMount, .xterm')) return;
    if (e.key >= '1' && e.key <= '9') {
      const sorted = [...tabIds].sort((a, b) => dockOrder[a] - dockOrder[b]);
      const id = sorted[Number(e.key) - 1];
      if (!id) return;
      e.preventDefault();
      setDockTab(id, store.tabs[id] === 'collapsed' ? 'quarter' : 'collapsed', false);
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      if (window.ApexChat) ApexChat.newSeat('');
    }
  });

  // ---- Ctrl+scroll zoom (the operator: the text feels small) ----
  // Ctrl+wheel steps 5%, Ctrl+= / Ctrl+- step 10%, Ctrl+0 resets; clamped
  // 60–200% in the preload; persists across sessions.
  const applyZoom = (f) => {
    apex.zoom.set(f);
    const real = apex.zoom.get();
    localStorage.setItem('apex.zoom', real);
    ApexToast('zoom ' + Math.round(real * 100) + '%');
  };
  addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    applyZoom(apex.zoom.get() + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return;
    if (e.key === '=' || e.key === '+') { e.preventDefault(); applyZoom(apex.zoom.get() + 0.1); }
    if (e.key === '-') { e.preventDefault(); applyZoom(apex.zoom.get() - 0.1); }
    if (e.key === '0') { e.preventDefault(); applyZoom(1); }
  });
  const savedZoom = parseFloat(localStorage.getItem('apex.zoom'));
  if (savedZoom && savedZoom !== 1) apex.zoom.set(savedZoom);

  // App, not webpage: no context menu except where selection matters.
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('textarea, input, pre')) return;
    e.preventDefault();
  });

  // ---- boot ----
  ApexTheme.boot();
  ApexBackground.boot();
  ApexBus.post('ready', {});
})();
