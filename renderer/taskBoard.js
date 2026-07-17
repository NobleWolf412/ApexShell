// Apex — the TASKS dock pane (workflow layer). Pure projection of main's
// taskList/taskRoutes pushes: per-repo groups, route-progress dots, and the
// delegate/pause/retry controls. All state lives in main/tasks.js — this view
// rebuilds idempotently on every push (R23 by architecture, same as chat).
'use strict';
(function () {
  const pane = document.getElementById('dock-tasks');
  const form = pane.querySelector('.tkForm');
  const list = pane.querySelector('.tkList');
  const newBtn = pane.querySelector('.tkNew');
  const dot = pane.querySelector('.tkDot');

  let tasks = [];
  let routes = [];
  let personas = [];            // registered preset names (seatPresets push)
  let openHistories = new Set();   // task ids with the history fold open

  // ---------- new-task form ----------
  let chips = [];               // the persona sequence being built
  form.innerHTML =
    '<input class="tkTitleIn" type="text" maxlength="200" placeholder="what needs doing" ' +
      'title="the work itself — every persona on the route sees this as the task brief">' +
    '<div class="tkRow"><input class="tkCwdIn" type="text" placeholder="repo folder (absolute path)" ' +
      'title="which repo this task works in — its seats launch here, and the task groups under this repo on the board">' +
      '<button class="tkBrowse" type="button" title="pick a folder">BROWSE</button></div>' +
    '<div class="tkRow"><select class="tkRouteSel" title="a saved persona sequence — picking one fills the chips below">' +
      '<option value="">route template…</option></select>' +
      '<select class="tkPersonaSel" title="append a persona to the route — the task visits them in this order">' +
      '<option value="">add persona…</option></select></div>' +
    '<div class="tkChips" title="the route: each persona runs in its own seat and hands a packet to the next"></div>' +
    '<div class="tkRow tkFormFoot">' +
      '<label class="tkAuto" title="ON: steps hand off to the next persona on their own — you are pulled in only at gates (a decision is needed, a step errors, the bounce limit hits, or the chain completes). OFF: each finished step waits for you to press Delegate.">' +
        '<input type="checkbox" class="tkAutoIn"> auto-chain ' +
        '<span class="tkHintTx" title="steps hand off to the next persona on their own; you are pulled in only at gates (decision, error, bounce limit, done)">?</span></label>' +
      '<button class="tkSaveRoute" type="button" title="save this persona sequence as a reusable route template">save route</button>' +
      '<button class="tkCreate" type="button" title="create the task and launch its first persona">CREATE</button>' +
      '<button class="tkCancel" type="button" title="close the form without creating anything">cancel</button></div>';
  const titleIn = form.querySelector('.tkTitleIn');
  const cwdIn = form.querySelector('.tkCwdIn');
  const routeSel = form.querySelector('.tkRouteSel');
  const personaSel = form.querySelector('.tkPersonaSel');
  const chipsEl = form.querySelector('.tkChips');
  const autoIn = form.querySelector('.tkAutoIn');

  function renderChips() {
    chipsEl.textContent = '';
    chips.forEach((p, i) => {
      if (i) {
        const arrow = document.createElement('span');
        arrow.className = 'tkArrow';
        arrow.textContent = '→';
        chipsEl.appendChild(arrow);
      }
      const chip = document.createElement('span');
      chip.className = 'tkChip';
      chip.textContent = p;
      const x = document.createElement('button');
      x.textContent = '✕';
      x.title = 'remove ' + p;
      x.onclick = () => { chips.splice(i, 1); renderChips(); };
      chip.appendChild(x);
      chipsEl.appendChild(chip);
    });
    if (!chips.length) {
      const n = document.createElement('span');
      n.className = 'tkChipsEmpty';
      n.textContent = 'route: pick a template or add personas in order';
      chipsEl.appendChild(n);
    }
  }
  renderChips();

  function fillSelects() {
    routeSel.textContent = '';
    routeSel.appendChild(new Option('route template…', ''));
    for (const r of routes)
      routeSel.appendChild(new Option(
        r.name + '  (' + r.steps.map((s) => s.persona).join(' → ') + ')', r.name));
    personaSel.textContent = '';
    personaSel.appendChild(new Option('add persona…', ''));
    for (const p of personas) personaSel.appendChild(new Option(p, p));
  }

  routeSel.onchange = () => {
    const r = routes.find((x) => x.name === routeSel.value);
    if (r) { chips = r.steps.map((s) => s.persona); renderChips(); }
  };
  personaSel.onchange = () => {
    if (personaSel.value && chips.length < 8) { chips.push(personaSel.value); renderChips(); }
    personaSel.value = '';
  };
  form.querySelector('.tkBrowse').onclick = () => ApexBus.post('taskPickCwd', {});
  form.querySelector('.tkSaveRoute').onclick = () => {
    if (!chips.length) { ApexToast('build the persona sequence first'); return; }
    const name = prompt('route name:', chips.join('-').toLowerCase().slice(0, 60));
    if (name) ApexBus.post('taskRouteSave', { name, steps: chips.slice() });
  };
  form.querySelector('.tkCreate').onclick = () => {
    ApexBus.post('taskCreate', {
      title: titleIn.value, cwd: cwdIn.value, route: chips.slice(),
      auto: autoIn.checked, start: true,
    });
    form.hidden = true;
  };
  form.querySelector('.tkCancel').onclick = () => { form.hidden = true; };
  newBtn.onclick = () => {
    form.hidden = !form.hidden;
    if (!form.hidden) { fillSelects(); titleIn.focus(); }
  };

  // ---------- task cards ----------
  const STEP_DOT = { done: '●', running: '◐', pending: '○', bounced: '↩', failed: '⚠' };
  const AGE = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'now' : m < 60 ? m + 'm' : Math.round(m / 60) + 'h';
  };

  function stepLine(t) {
    const s = t.steps[t.currentStep];
    if (!s) return '';
    const bits = ['step ' + (t.currentStep + 1) + '/' + t.steps.length, s.persona];
    if (s.status === 'running') {
      bits.push(s.startedAt ? 'running ' + AGE(s.startedAt) : 'running');
      if (s.waiting === 'permission') bits.push('waiting on a permission');
      else if (s.packet) bits.push('packet ✓ (' + s.packet.status + ')');
      else if (s.packetError) bits.push(s.packetError === 'no-packet' ? 'no packet yet' : s.packetError);
    } else bits.push(s.status);
    return bits.join(' · ');
  }

  function card(t) {
    const el = document.createElement('div');
    el.className = 'tkCard tk-' + t.status;

    const head = document.createElement('div');
    head.className = 'tkCardHead';
    const title = document.createElement('span');
    title.className = 'tkCardTitle';
    title.textContent = t.title;
    head.appendChild(title);
    const badge = document.createElement('span');
    badge.className = 'tkBadge';
    badge.textContent =
      t.status === 'needs-attention' ? '⚠ needs you' :
      t.status === 'done' ? 'done ✓' :
      t.status === 'paused' ? 'paused' :
      t.status === 'running' ? (t.auto ? 'auto ⛓' : 'running') : 'open';
    badge.title = t.attention && t.attention.reason
      ? t.attention.reason + (t.attention.detail ? ' — ' + t.attention.detail : '')
      : t.status === 'running'
        ? (t.auto
          ? 'auto-chain: finished steps hand off to the next persona on their own'
          : 'running: when this step finishes, press Delegate → to hand off')
        : t.status === 'paused' ? 'paused: the chain will not advance until you Resume'
        : t.status === 'done' ? 'the whole route completed'
        : 'not started yet — press ▶ Start';
    head.appendChild(badge);
    el.appendChild(head);

    const routeRow = document.createElement('div');
    routeRow.className = 'tkRoute';
    const dots = t.steps.map((s) => STEP_DOT[s.status] || '○').join('──');
    routeRow.textContent = dots + '   ' + t.steps.map((s) => s.persona).join(' → ');
    routeRow.title = 'route progress — ● done · ◐ running · ○ pending · ↩ bounced back · ⚠ failed. ' +
      'Each persona runs in its own seat and hands a packet to the next.';
    el.appendChild(routeRow);

    const status = document.createElement('div');
    status.className = 'tkStep';
    status.textContent = stepLine(t);
    status.title = 'the current step. "packet ✓" = the persona finished and wrote its handoff; ' +
      '"no packet yet" = still working (or it ended a turn without one — reply in its chat); ' +
      '"waiting on a permission" = answer the card in its chat.';
    el.appendChild(status);

    if (t.attention && t.attention.detail && t.status === 'needs-attention') {
      const att = document.createElement('div');
      att.className = 'tkAttention';
      att.textContent = t.attention.detail;
      el.appendChild(att);
    }

    const cur = t.steps[t.currentStep];
    const btns = document.createElement('div');
    btns.className = 'tkBtns';
    const mk = (label, title, fn, cls) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      if (cls) b.className = cls;
      b.onclick = fn;
      btns.appendChild(b);
    };
    if (t.status !== 'done') {
      if (cur && cur.status === 'pending')
        mk('▶ Start', 'launch this step\'s persona seat',
          () => ApexBus.post('taskStart', { id: t.id }), 'tkGo');
      else
        mk('Delegate →', cur && cur.packet && cur.packet.status === 'done'
            ? 'hand the packet to the next step'
            : 'needs a completed packet — or type a summary when asked',
          () => {
            if (cur && cur.packet && cur.packet.status === 'done')
              ApexBus.post('taskDelegate', { id: t.id });
            else {
              const s = prompt('no handoff packet yet — type a summary to hand off manually:');
              if (s) ApexBus.post('taskDelegate', { id: t.id, summary: s });
            }
          }, 'tkGo');
      if (t.status === 'paused')
        mk('Resume', 'let the chain move again', () => ApexBus.post('taskResume', { id: t.id }));
      else
        mk('Pause', 'stop the chain from advancing (a running seat keeps working)',
          () => ApexBus.post('taskPause', { id: t.id }));
      mk('Retry', 'relaunch the current step in a fresh seat',
        () => ApexBus.post('taskRetry', { id: t.id }));
    }
    if (cur && cur.seatId != null && window.ApexChat && ApexChat.hasSeat(cur.seatId))
      mk('Open seat', 'jump to this step\'s chat', () => ApexChat.focusSeat(cur.seatId));
    mk('✕', 'remove this task (its seats stay open)', () => {
      if (confirm('remove task "' + t.title + '"?')) ApexBus.post('taskDelete', { id: t.id });
    }, 'tkX');
    el.appendChild(btns);

    // history fold: what each settled step reported
    const settled = t.steps.filter((s) => s.packet && s.index !== t.currentStep);
    if (settled.length) {
      const fold = document.createElement('div');
      fold.className = 'tkFold';
      const toggle = document.createElement('button');
      toggle.className = 'tkFoldBtn';
      toggle.title = 'what each finished step reported in its handoff packet';
      toggle.textContent = (openHistories.has(t.id) ? '▾' : '▸') + ' history (' + settled.length + ')';
      toggle.onclick = () => {
        if (openHistories.has(t.id)) openHistories.delete(t.id);
        else openHistories.add(t.id);
        render();
      };
      fold.appendChild(toggle);
      if (openHistories.has(t.id)) {
        for (const s of settled) {
          const row = document.createElement('div');
          row.className = 'tkFoldRow';
          row.textContent = s.persona + ' [' + s.status + '] — ' +
            (s.packet.summary || s.packet.findings || s.packet.decision || '(no text)');
          fold.appendChild(row);
        }
      }
      el.appendChild(fold);
    }
    return el;
  }

  function render() {
    list.textContent = '';
    if (!tasks.length) {
      const n = document.createElement('div');
      n.className = 'paneNote';
      n.textContent = 'No tasks yet — NEW TASK starts one. A task follows a route of ' +
        'personas (design → audit → code); each step runs in its own seat and hands ' +
        'a packet to the next. For unattended auto-chains, give the personas ' +
        'acceptEdits/dontAsk defaults so they never stall on a permission card.';
      list.appendChild(n);
    }
    // group by repo — multi-repo work is the point
    const groups = new Map();
    for (const t of tasks) {
      if (!groups.has(t.cwd)) groups.set(t.cwd, []);
      groups.get(t.cwd).push(t);
    }
    for (const [cwd, group] of groups) {
      const h = document.createElement('div');
      h.className = 'tkGroup';
      h.textContent = (cwd.split(/[\\/]/).filter(Boolean).pop() || cwd);
      h.title = cwd;
      list.appendChild(h);
      for (const t of group) list.appendChild(card(t));
    }
    // attention count on the folder tab
    const needs = tasks.filter((t) => t.status === 'needs-attention').length;
    dot.hidden = !needs;
    // chain chips on the seats running steps
    if (window.ApexChat) {
      for (const t of tasks) {
        for (const s of t.steps) {
          if (s.seatId != null && ApexChat.hasSeat(s.seatId))
            ApexChat.setSeatBadge(s.seatId,
              s.status === 'running' ? '⛓ ' + (s.index + 1) + '/' + t.steps.length : '');
        }
      }
    }
  }

  // keep the "running Xm" ages honest while the pane is open
  setInterval(() => {
    if (pane.classList.contains('open') && tasks.some((t) => t.status === 'running')) render();
  }, 30000);

  ApexBus.on('taskList', (m) => { tasks = m.tasks || []; render(); });
  ApexBus.on('taskRoutes', (m) => { routes = m.routes || []; if (!form.hidden) fillSelects(); });
  ApexBus.on('taskCwdPicked', (m) => { if (m.path) cwdIn.value = m.path; });
  ApexBus.on('seatPresets', (m) => {
    personas = (m.presets || []).map((p) => p.name);
    if (!form.hidden) fillSelects();
  });
  // seatNew/seatGone change which "Open seat" buttons are valid
  ApexBus.on('seatNew', () => render());
  ApexBus.on('seatGone', () => render());

  ApexBus.post('taskList', {});
  ApexBus.post('taskRoutes', {});
})();
