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
  let collapsedRepos = new Set();  // repo groups folded away

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
      '<button class="tkDelRoute" type="button" title="delete the route template picked above">del route</button>' +
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
  form.querySelector('.tkSaveRoute').onclick = async () => {
    if (!chips.length) { ApexToast('build the persona sequence first'); return; }
    // ApexPrompt, not prompt() — Electron renderers have no window.prompt
    const name = await ApexPrompt('route name:', chips.join('-').toLowerCase().slice(0, 60));
    if (name) ApexBus.post('taskRouteSave', { name, steps: chips.slice() });
  };
  form.querySelector('.tkDelRoute').onclick = () => {
    const name = routeSel.value;
    if (!name) { ApexToast('pick a route template above to delete'); return; }
    ApexBus.post('taskRouteDelete', { name });
    routeSel.value = '';
    ApexToast('route "' + name + '" deleted');
  };
  // Click-economy: the form remembers the last task's repo + route, and the
  // repo prefills from the focused chat's cwd — the common case is title → CREATE.
  const readLast = () => { try { return JSON.parse(localStorage.getItem('apex.task.last')) || {}; } catch { return {}; } };
  form.querySelector('.tkCreate').onclick = () => {
    try { localStorage.setItem('apex.task.last', JSON.stringify({ cwd: cwdIn.value, route: chips.slice() })); }
    catch { /* remembering is best-effort */ }
    ApexBus.post('taskCreate', {
      title: titleIn.value, cwd: cwdIn.value, route: chips.slice(),
      auto: autoIn.checked, start: true,
    });
    // clear so reopening NEW TASK doesn't show the just-created title and invite
    // a duplicate (repo + route intentionally persist as the remembered defaults)
    titleIn.value = '';
    form.hidden = true;
  };
  form.querySelector('.tkCancel').onclick = () => { form.hidden = true; };
  newBtn.onclick = () => {
    form.hidden = !form.hidden;
    if (!form.hidden) {
      fillSelects();
      const last = readLast();
      if (!cwdIn.value)
        cwdIn.value = (window.ApexChat && ApexChat.activeCwd()) || last.cwd || '';
      if (!chips.length && Array.isArray(last.route) && last.route.length) {
        chips = last.route.filter((p) => typeof p === 'string').slice(0, 8);
        renderChips();
      }
      titleIn.focus();
    }
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
    title.title = 'double-click to rename';
    title.ondblclick = async () => {
      const name = await ApexPrompt('rename task:', t.title);
      if (name && name.trim()) ApexBus.post('taskUpdate', { id: t.id, patch: { title: name.trim() } });
    };
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

    // the plan checklist: phases the personas laid out; they check items off
    // via their packets, you can toggle by hand
    if (Array.isArray(t.todos) && t.todos.length) {
      const doneN = t.todos.filter((x) => x.done).length;
      const list = document.createElement('div');
      list.className = 'tkTodos';
      list.title = 'the task\'s plan — laid out by its personas (packet "plan"), checked off as ' +
        'steps report progress ("planDone"). Click to toggle by hand.';
      const headRow = document.createElement('div');
      headRow.className = 'tkTodoHead';
      headRow.textContent = 'PLAN · ' + doneN + '/' + t.todos.length;
      list.appendChild(headRow);
      t.todos.forEach((todo, i) => {
        const row = document.createElement('label');
        row.className = 'tkTodoRow' + (todo.done ? ' done' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!todo.done;
        cb.onchange = () => ApexBus.post('taskTodoToggle', { id: t.id, index: i });
        const tx = document.createElement('span');
        tx.textContent = todo.text;
        row.append(cb, tx);
        list.appendChild(row);
      });
      el.appendChild(list);
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
    // Route already finished but held open by unchecked todos (advance()'s
    // 'complete' attention gate). currentStep is past the last step, so
    // Delegate/Retry would silently no-op inside main. Show the real move
    // instead: check the boxes or Mark done to force-settle.
    const routeOver = t.currentStep >= t.steps.length;
    if (t.status !== 'done' && !routeOver) {
      if (cur && cur.status === 'pending')
        mk('▶ Start', 'launch this step\'s persona seat',
          () => ApexBus.post('taskStart', { id: t.id }), 'tkGo');
      else
        mk('Delegate →', cur && cur.packet && cur.packet.status === 'done'
            ? 'hand the packet to the next step'
            : 'asks the seat to wrap up and hands off when its packet lands',
          // main owns the fallback ladder: packet → ask the seat → only then
          // the typed-summary box (taskNeedSummary below)
          () => ApexBus.post('taskDelegate', { id: t.id }), 'tkGo');
      if (t.status === 'paused')
        mk('Resume', 'let the chain move again', () => ApexBus.post('taskResume', { id: t.id }));
      else
        mk('Pause', 'stop the chain from advancing (a running seat keeps working)',
          () => ApexBus.post('taskPause', { id: t.id }));
      mk('Retry', 'relaunch the current step in a fresh seat',
        () => ApexBus.post('taskRetry', { id: t.id }));
    } else if (routeOver && t.status !== 'done') {
      mk('✓ Mark done', 'the route is finished — settle the task even with todos unchecked',
        () => ApexBus.post('taskMarkDone', { id: t.id }), 'tkGo');
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
      n.innerHTML = 'This board is for <b>planned, multi-step work</b> — a build or refactor that ' +
        'moves through a route of personas with a checklist of phases. Press <b>NEW TASK</b> to ' +
        'lay one out.<br><br><span class="tkNoteDim">To just pass one chat to another persona, ' +
        'use <b>Hand off →</b> above the chat — it never touches this board.</span>';
      list.appendChild(n);
    }
    // group by repo — multi-repo work is the point; groups collapse so a busy
    // repo can be folded away while you work in another (the operator's ask)
    const groups = new Map();
    for (const t of tasks) {
      if (!groups.has(t.cwd)) groups.set(t.cwd, []);
      groups.get(t.cwd).push(t);
    }
    for (const [cwd, group] of groups) {
      const collapsed = collapsedRepos.has(cwd);
      const needs = group.filter((t) => t.status === 'needs-attention').length;
      const h = document.createElement('button');
      h.className = 'tkGroup' + (collapsed ? ' collapsed' : '');
      h.title = cwd + ' — click to ' + (collapsed ? 'expand' : 'collapse');
      h.textContent = (collapsed ? '▸ ' : '▾ ') +
        (cwd.split(/[\\/]/).filter(Boolean).pop() || cwd) +
        '  (' + group.length + (needs ? ', ' + needs + ' need you' : '') + ')';
      h.onclick = () => { if (collapsed) collapsedRepos.delete(cwd); else collapsedRepos.add(cwd); render(); };
      list.appendChild(h);
      if (!collapsed) for (const t of group) list.appendChild(card(t));
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

  // Build a starter handoff summary from what the board already knows: the
  // task title, checked/unchecked todos, artifacts + summary from any prior
  // step's packet. The user rarely knows what to type here — this gives them
  // a working draft they can edit or send as-is.
  function generateHandoffTemplate(task) {
    const step = task.steps[task.currentStep];
    const lines = [step.persona + ' — wrap-up for "' + task.title + '":'];
    const done = (task.todos || []).filter((t) => t.done);
    const open = (task.todos || []).filter((t) => !t.done);
    if (done.length) {
      lines.push('', 'Completed:');
      for (const t of done) lines.push('- ' + t.text);
    }
    if (open.length) {
      lines.push('', 'Not done (for next step):');
      for (const t of open) lines.push('- ' + t.text);
    }
    const artifacts = new Set();
    for (const s of task.steps) {
      if (s.packet && Array.isArray(s.packet.artifacts))
        for (const a of s.packet.artifacts) artifacts.add(a);
    }
    if (artifacts.size) {
      lines.push('', 'Artifacts:');
      for (const a of artifacts) lines.push('- ' + a);
    }
    const prior = task.currentStep > 0 ? task.steps[task.currentStep - 1] : null;
    if (prior && prior.packet && prior.packet.summary) {
      lines.push('', 'Prior step (' + prior.persona + '):', prior.packet.summary);
    }
    return lines.join('\n');
  }

  // A textarea-based prompt with a Generate button that fills the box from
  // task state. Same visual language as ApexPrompt but multiline, wider, and
  // resolves the raw text (null on cancel). Singleton like ApexPrompt.
  function handoffPrompt({ header, note, task }) {
    return new Promise((resolve) => {
      if (document.querySelector('.apxPrompt')) { resolve(null); return; }
      const wrap = document.createElement('div');
      wrap.className = 'apxPrompt apxPromptWide';
      const box = document.createElement('div');
      box.className = 'apxPromptBox';
      const msg = document.createElement('div');
      msg.className = 'apxPromptMsg';
      msg.textContent = header;
      const sub = document.createElement('div');
      sub.className = 'apxPromptSub';
      sub.textContent = note;
      const ta = document.createElement('textarea');
      ta.className = 'apxPromptArea';
      ta.rows = 12;
      ta.maxLength = 4000;
      ta.placeholder = 'What did the seat do? What must the next step know?';
      const btns = document.createElement('div');
      btns.className = 'apxPromptBtns';
      const gen = document.createElement('button');
      gen.textContent = 'Generate from task';
      gen.title = 'fill the box with a draft built from the task title, checked todos, and prior packets — you can edit it';
      const ok = document.createElement('button');
      ok.className = 'primary';
      ok.textContent = 'Hand off';
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      const done = (v) => { wrap.remove(); resolve(v); };
      gen.onclick = () => { ta.value = generateHandoffTemplate(task); ta.focus(); };
      ok.onclick = () => done(ta.value);
      cancel.onclick = () => done(null);
      ta.addEventListener('keydown', (e) => {
        // Ctrl/Cmd+Enter sends; plain Enter inserts a newline (multiline field)
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(ta.value); }
        else if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      });
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(null); });
      btns.append(gen, cancel, ok);
      box.append(msg, sub, ta, btns);
      wrap.appendChild(box);
      document.body.appendChild(wrap);
      ta.focus();
    });
  }

  // The typed-summary box — the TRUE last resort (main already tried the
  // packet and asked the seat). The message says WHY it's being asked, and
  // Generate builds a starter draft so the operator isn't staring at empty.
  ApexBus.on('taskNeedSummary', async (m) => {
    const task = tasks.find((t) => t.id === m.id);
    if (!task) return;
    const s = await handoffPrompt({
      header: m.persona + ' needs a handoff summary',
      note: (m.reason || 'no packet available') +
        '. Type what to hand to the next step, or click "Generate from task" for a starter draft.',
      task,
    });
    if (s && s.trim()) ApexBus.post('taskDelegate', { id: m.id, summary: s });
  });
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
