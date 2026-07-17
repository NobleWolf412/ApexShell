// Apex — the AUDIT dock pane. Opt-in shadow review: per-seat watch toggles on
// top, findings below. Pure projection of main/audit.js — watch state, running
// state, and findings all arrive over the bus.
'use strict';
(function () {
  const pane = document.getElementById('dock-audit');
  const watchEl = pane.querySelector('.auWatch');
  const findingsEl = pane.querySelector('.auFindings');
  const dot = pane.querySelector('.auDot');

  const liveSeats = new Map();   // id -> title
  const watchedOn = new Map();   // id -> count (audits run)
  const watchedEst = new Map();  // id -> estimated tokens spent
  const running = new Set();     // ids mid-audit
  const findings = new Map();    // id -> [finding]
  let presets = [];              // persona names for the "reviewing as" picker

  // ---- settings: auto-off ceiling + whose voice the auditor borrows ----
  const settings = document.createElement('div');
  settings.className = 'auSettings';
  settings.innerHTML =
    '<label class="auSetRow"><input type="checkbox" class="auAutoOff"> auto-stop a watch after ' +
      '<input type="number" class="auBudget" min="1000" step="1000" value="50000"> tokens</label>' +
    '<label class="auSetRow">reviewing as <select class="auBorrow"><option value="">neutral reviewer</option></select></label>';
  pane.querySelector('.auHead').after(settings);
  const autoOffEl = settings.querySelector('.auAutoOff');
  const budgetEl = settings.querySelector('.auBudget');
  const borrowEl = settings.querySelector('.auBorrow');
  const postConfig = () => ApexBus.post('auditConfig', {
    autoOff: autoOffEl.checked, budget: Number(budgetEl.value) || 50000, borrow: borrowEl.value || null });
  autoOffEl.onchange = postConfig;
  budgetEl.onchange = postConfig;
  borrowEl.onchange = postConfig;
  function fillBorrow(current) {
    const keep = current !== undefined ? current : borrowEl.value;
    borrowEl.textContent = '';
    borrowEl.appendChild(new Option('neutral reviewer', ''));
    for (const p of presets) borrowEl.appendChild(new Option(p, p));
    if ([...borrowEl.options].some((o) => o.value === keep)) borrowEl.value = keep;
  }

  const SEV = { risk: '⚠ risk', warn: '△ warn', info: '· note' };

  function renderWatches() {
    watchEl.textContent = '';
    if (!liveSeats.size) return;
    for (const [id, title] of liveSeats) {
      const row = document.createElement('label');
      row.className = 'auWatchRow';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = watchedOn.has(id);
      cb.addEventListener('change', () => ApexBus.post('auditToggle', { id, on: cb.checked }));
      const name = document.createElement('span');
      name.className = 'auWatchName';
      name.textContent = title;
      row.append(cb, name);
      if (watchedOn.has(id)) {
        const meta = document.createElement('span');
        meta.className = 'auWatchMeta';
        const est = watchedEst.get(id) || 0;
        const spend = est ? ' · ~' + (est >= 1000 ? Math.round(est / 1000) + 'k' : est) + ' tok' : '';
        meta.textContent = running.has(id)
          ? 'auditing…' + spend
          : (watchedOn.get(id) + ' run' + (watchedOn.get(id) === 1 ? '' : 's') + spend);
        row.appendChild(meta);
        const now = document.createElement('button');
        now.type = 'button'; now.className = 'auNow'; now.textContent = 'audit now';
        now.title = 'run a pass immediately over the recent turns';
        now.addEventListener('click', (e) => { e.preventDefault(); ApexBus.post('auditOnce', { id }); });
        row.appendChild(now);
      }
      watchEl.appendChild(row);
    }
  }

  function renderFindings() {
    findingsEl.textContent = '';
    const seatsWith = [...findings.entries()].filter(([, f]) => f && f.length);
    if (!seatsWith.length) {
      const n = document.createElement('div');
      n.className = 'paneNote';
      n.textContent = watchedOn.size
        ? 'Watching — findings from the next audited turn will appear here.'
        : 'Turn on a watch above to get a live second opinion on a chat.';
      findingsEl.appendChild(n);
      updateDot();
      return;
    }
    for (const [id, list] of seatsWith) {
      const group = document.createElement('div');
      group.className = 'auGroup';
      const head = document.createElement('div');
      head.className = 'auGroupHead';
      head.textContent = liveSeats.get(id) || 'seat';
      group.appendChild(head);
      for (const f of list) {
        const card = document.createElement('div');
        card.className = 'auCard sev-' + f.severity;
        const sev = document.createElement('div');
        sev.className = 'auSev';
        sev.textContent = SEV[f.severity] || f.severity;
        card.appendChild(sev);
        const claim = document.createElement('div');
        claim.className = 'auClaim';
        claim.textContent = f.claim;
        card.appendChild(claim);
        if (f.why) {
          const why = document.createElement('div');
          why.className = 'auWhy';
          why.textContent = f.why;
          card.appendChild(why);
        }
        if (f.suggestion) {
          const sug = document.createElement('div');
          sug.className = 'auSuggestion';
          sug.textContent = '→ ' + f.suggestion;
          card.appendChild(sug);
        }
        const acts = document.createElement('div');
        acts.className = 'auActs';
        const send = document.createElement('button');
        send.type = 'button'; send.textContent = 'send to chat';
        send.title = 'drop this into the chat\'s composer to raise it with the seat';
        send.addEventListener('click', () => {
          const text = f.claim + (f.suggestion ? ' — ' + f.suggestion : '');
          if (window.ApexChat && ApexChat.fillComposer) ApexChat.fillComposer(id, text);
          else ApexToast('open the chat to raise this');
        });
        const dismiss = document.createElement('button');
        dismiss.type = 'button'; dismiss.textContent = 'dismiss';
        dismiss.addEventListener('click', () => {
          findings.set(id, findings.get(id).filter((x) => x !== f));
          renderFindings();
        });
        acts.append(send, dismiss);
        card.appendChild(acts);
        group.appendChild(card);
      }
      findingsEl.appendChild(group);
    }
    updateDot();
  }

  function updateDot() {
    const risky = [...findings.values()].some((f) => f && f.some((x) => x.severity === 'risk'));
    const any = [...findings.values()].some((f) => f && f.length);
    dot.hidden = !any;
    dot.classList.toggle('risk', risky);
  }

  ApexBus.on('seatNew', (m) => { if (!m.pty) { liveSeats.set(m.id, m.title || 'seat'); renderWatches(); } });
  ApexBus.on('seatTitle', (m) => { if (liveSeats.has(m.id)) { liveSeats.set(m.id, m.title); renderWatches(); renderFindings(); } });
  ApexBus.on('seatGone', (m) => {
    liveSeats.delete(m.id); watchedOn.delete(m.id); running.delete(m.id); findings.delete(m.id);
    renderWatches(); renderFindings();
  });
  ApexBus.on('seatList', (m) => {
    const live = new Set((m.seats || []).map((s) => s.id));
    for (const s of m.seats || []) if (!s.pty) liveSeats.set(s.id, s.title || 'seat');
    for (const id of [...liveSeats.keys()]) if (!live.has(id)) liveSeats.delete(id);
    renderWatches();
  });
  ApexBus.on('auditState', (m) => {
    if (m.on) { watchedOn.set(m.id, m.count || 0); if (m.estTokens != null) watchedEst.set(m.id, m.estTokens); }
    else { watchedOn.delete(m.id); watchedEst.delete(m.id); running.delete(m.id); }
    renderWatches(); renderFindings();
  });
  ApexBus.on('auditRunning', (m) => {
    running.add(m.id);
    if (watchedOn.has(m.id)) watchedOn.set(m.id, m.count);
    if (m.estTokens != null) watchedEst.set(m.id, m.estTokens);
    renderWatches();
  });
  ApexBus.on('auditFindings', (m) => {
    running.delete(m.id);
    if (watchedOn.has(m.id)) watchedOn.set(m.id, m.count);
    if (m.estTokens != null) watchedEst.set(m.id, m.estTokens);
    if (m.suppressed) { /* chain step owns the audit — stay quiet, no spend */ }
    else if (m.error) ApexToast('audit: ' + m.error);
    if (m.findings && m.findings.length) findings.set(m.id, m.findings);
    renderWatches(); renderFindings();
  });
  ApexBus.on('auditConfig', (m) => {
    if (typeof m.autoOff === 'boolean') autoOffEl.checked = m.autoOff;
    if (m.budget) budgetEl.value = m.budget;
    fillBorrow(m.borrow || '');
  });
  ApexBus.on('seatPresets', (m) => { presets = (m.presets || []).map((p) => p.name); fillBorrow(); });

  // ask for the live roster + config on boot / reload
  ApexBus.post('seatList', {});
  ApexBus.post('seatPresets', {});
  ApexBus.post('auditConfig', {});   // fetch current (no fields = read-only echo)
})();
