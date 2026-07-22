// War Room — dock pane. Watch five personas deliberate live, interject mid-debate,
// review the ranked ideas. Talks to main over the bus; owns no truth of its own.
'use strict';
(function () {
  const PERSONAS = [
    { key: 'brainstormer', label: 'Brainstormer' },
    { key: 'architect', label: 'Architect' },
    { key: 'auditor', label: 'Auditor' },
    { key: 'advocate', label: 'User Advocate' },
    { key: 'contrarian', label: 'Contrarian' },
    { key: 'operator', label: 'You' },
  ];
  const LABEL = Object.fromEntries(PERSONAS.map((p) => [p.key, p.label]));
  const PHASES = ['diverge', 'clash', 'converge'];

  const pane = document.createElement('div');
  pane.className = 'sidePane dockPane warroomPane';
  pane.id = 'dock-warroom';
  pane.dataset.tab = 'warroom';
  pane.dataset.order = '40';
  pane.innerHTML =
    '<div class="paneBody wrBody">' +
      '<div class="wrKicker">WAR ROOM</div>' +
      '<p class="wrNote">Five personas deliberate to invent ideas no single agent would reach. ' +
        'Cheap hidden seats, a hard token budget, and a ranked idea list at the end.</p>' +

      '<section class="wrCard wrSetup">' +
        '<textarea class="wrTopic" rows="2" placeholder="The topic / problem to chew on…"></textarea>' +
        '<div class="wrRow">' +
          '<button class="wrBtn wrRepo" type="button" title="the repo the room reasons about">Repo: (none)</button>' +
          '<button class="wrBtn wrCfgToggle" type="button" title="models, budget, rounds">⚙ config</button>' +
        '</div>' +
        '<div class="wrConfig" hidden>' +
          '<div class="wrCfgRow"><span>Brainstormer</span><select class="wrM" data-k="brainstormer"></select></div>' +
          '<div class="wrCfgRow"><span>Architect</span><select class="wrM" data-k="architect"></select></div>' +
          '<div class="wrCfgRow"><span>Auditor</span><select class="wrM" data-k="auditor"></select></div>' +
          '<div class="wrCfgRow"><span>User Advocate</span><select class="wrM" data-k="advocate"></select></div>' +
          '<div class="wrCfgRow"><span>Contrarian</span><select class="wrM" data-k="contrarian"></select></div>' +
          '<div class="wrCfgRow"><span>Budget (k tokens)</span><input class="wrBudget" type="number" min="10" max="150" step="5"></div>' +
          '<div class="wrCfgRow"><span>Rounds</span><select class="wrRounds"><option value="3">3 (diverge·clash·converge)</option><option value="2">2 (diverge·converge)</option></select></div>' +
          '<div class="wrCfgRow"><span>Context files (≤3, one per line)</span></div>' +
          '<textarea class="wrCtxFiles" rows="2" placeholder="relative/path.js"></textarea>' +
        '</div>' +
        '<button class="wrBtn wrStart" type="button">Start deliberation</button>' +
      '</section>' +

      '<section class="wrCard wrLiveCard" hidden>' +
        '<div class="wrStrip">' +
          '<div class="wrPips"></div>' +
          '<div class="wrMeter" title="estimated tokens spent"><div class="wrMeterFill"></div><span class="wrMeterTx"></span></div>' +
        '</div>' +
        '<div class="wrRow">' +
          '<button class="wrBtn wrWrap" type="button" title="skip to the ranked list now">Wrap up</button>' +
          '<button class="wrBtn wrStop" type="button" title="stop and keep what exists">Stop</button>' +
        '</div>' +
        '<div class="wrStream" aria-live="polite"></div>' +
        '<div class="wrRow wrSayRow">' +
          '<input class="wrSay" placeholder="Interject — lands on the next turn…">' +
          '<button class="wrBtn wrSayBtn" type="button">Send</button>' +
        '</div>' +
      '</section>' +

      '<section class="wrCard wrIdeasCard" hidden>' +
        '<div class="wrLabel">IDEAS <button class="wrBtn wrReport" type="button">Write report</button></div>' +
        '<div class="wrReportPath"></div>' +
        '<div class="wrIdeas"></div>' +
      '</section>' +
    '</div>';
  document.body.appendChild(pane);
  if (window.ApexShell && ApexShell.registerDockPane) ApexShell.registerDockPane(pane, { order: 40 });

  const $ = (s) => pane.querySelector(s);
  const $$ = (s) => pane.querySelectorAll(s);
  const topicEl = $('.wrTopic'), repoBtn = $('.wrRepo'), ctxEl = $('.wrCtxFiles');
  const cfgBox = $('.wrConfig'), budgetEl = $('.wrBudget'), roundsEl = $('.wrRounds');
  const liveCard = $('.wrLiveCard'), pipsEl = $('.wrPips'), streamEl = $('.wrStream');
  const meterFill = $('.wrMeterFill'), meterTx = $('.wrMeterTx');
  const ideasCard = $('.wrIdeasCard'), ideasEl = $('.wrIdeas'), reportPathEl = $('.wrReportPath');
  const sayEl = $('.wrSay');

  for (const sel of $$('.wrM')) {
    for (const mdl of ['haiku', 'sonnet', 'opus', 'fable']) {
      const o = document.createElement('option'); o.value = mdl; o.textContent = mdl; sel.appendChild(o);
    }
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // config push (debounced-ish: on change)
  function pushConfig() {
    const models = {};
    for (const sel of $$('.wrM')) models[sel.dataset.k] = sel.value;
    ApexBus.post('warroomConfig', { models, budget: (Number(budgetEl.value) || 55) * 1000, rounds: Number(roundsEl.value) });
  }
  $('.wrCfgToggle').onclick = () => { cfgBox.hidden = !cfgBox.hidden; };
  for (const sel of $$('.wrM')) sel.onchange = pushConfig;
  budgetEl.onchange = pushConfig; roundsEl.onchange = pushConfig;
  repoBtn.onclick = () => ApexBus.post('warroomPickRepo', {});
  $('.wrStart').onclick = () => {
    const topic = topicEl.value.trim();
    if (!topic) return;
    ApexBus.post('warroomStart', { topic, contextFiles: ctxEl.value });
  };
  $('.wrWrap').onclick = () => ApexBus.post('warroomWrapup', {});
  $('.wrStop').onclick = () => ApexBus.post('warroomStop', {});
  $('.wrReport').onclick = () => ApexBus.post('warroomExport', {});
  const sendSay = () => { const t = sayEl.value.trim(); if (t) { ApexBus.post('warroomSay', { text: t }); sayEl.value = ''; } };
  $('.wrSayBtn').onclick = sendSay;
  sayEl.onkeydown = (e) => { if (e.key === 'Enter') sendSay(); };

  // ---- live stream ----
  let atBottom = true;
  streamEl.onscroll = () => { atBottom = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < 40; };
  function msgEl(persona) {
    let el = streamEl.querySelector('.wrMsg.wr-cur[data-persona="' + persona + '"]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'wrMsg wr-cur'; el.dataset.persona = persona;
      el.innerHTML = '<b class="wrWho">' + esc(LABEL[persona] || persona) + '</b><span class="wrTx"></span>';
      streamEl.appendChild(el);
    }
    return el;
  }
  function seal() { for (const e of streamEl.querySelectorAll('.wrMsg.wr-cur')) e.classList.remove('wr-cur'); }
  function autoscroll() { if (atBottom) streamEl.scrollTop = streamEl.scrollHeight; }

  ApexBus.on('warroomSpeaking', (m) => { seal(); msgEl(m.persona); autoscroll(); });
  ApexBus.on('warroomDelta', (m) => { const e = msgEl(m.persona); e.querySelector('.wrTx').textContent += m.text || ''; autoscroll(); });
  ApexBus.on('warroomStatement', (m) => {
    // authoritative: replace the streaming bubble's text with the final statement
    if (m.persona === 'operator') { seal(); }
    const e = msgEl(m.persona);
    e.querySelector('.wrTx').textContent = m.text || '';
    e.classList.remove('wr-cur');
    autoscroll();
  });

  function renderPips(phase, round, total) {
    pipsEl.textContent = '';
    PHASES.slice(0, total || 3).forEach((ph) => {
      const s = document.createElement('span');
      s.className = 'wrPip' + (ph === phase ? ' wr-on' : '');
      s.textContent = ph;
      pipsEl.appendChild(s);
    });
  }
  function renderMeter(est, budget) {
    const pct = budget ? Math.min(100, Math.round((est / budget) * 100)) : 0;
    meterFill.style.width = pct + '%';
    meterFill.classList.toggle('wr-hot', pct > 85);
    meterTx.textContent = Math.round((est || 0) / 1000) + 'k / ' + Math.round((budget || 0) / 1000) + 'k';
  }
  function renderIdeas(cards, repo) {
    ideasEl.textContent = '';
    if (!cards || !cards.length) { ideasEl.innerHTML = '<div class="wrEmpty">No ideas yet.</div>'; return; }
    cards.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'wrIdea wr-' + (c.status || 'proposed');
      const badges = [c.feasibility]; if (c.exists) badges.push('exists');
      card.innerHTML =
        '<div class="wrIdeaHead"><b>' + esc(c.title) + '</b>' +
          '<span class="wrBadges">' + badges.map((b) => '<span class="wrBadge">' + esc(b) + '</span>').join('') + '</span></div>' +
        (c.pitch ? '<div class="wrPitch">' + esc(c.pitch) + '</div>' : '') +
        (c.novelty ? '<div class="wrMeta">✦ ' + esc(c.novelty) + '</div>' : '') +
        (c.evidence ? '<div class="wrMeta">⌖ ' + esc(c.evidence) + '</div>' : '') +
        '<div class="wrMeta wrChamps">argued by: ' + esc((c.champions || []).map((k) => LABEL[k] || k).join(', ')) + '</div>' +
        '<div class="wrRow wrIdeaBtns">' +
          '<button class="wrBtn wrApprove" type="button">Approve</button>' +
          '<button class="wrBtn wrDismiss" type="button">Dismiss</button></div>';
      card.querySelector('.wrApprove').onclick = () => ApexBus.post('warroomIdeaStatus', { id: c.id, status: 'approved' });
      card.querySelector('.wrDismiss').onclick = () => ApexBus.post('warroomIdeaStatus', { id: c.id, status: 'dismissed' });
      ideasEl.appendChild(card);
    });
  }

  let lastStmtCount = 0;
  ApexBus.on('warroomStatus', (m) => {
    repoBtn.textContent = 'Repo: ' + (m.repoName || '(none)');
    if (m.models) for (const sel of $$('.wrM')) if (m.models[sel.dataset.k] && document.activeElement !== sel) sel.value = m.models[sel.dataset.k];
    if (document.activeElement !== budgetEl && m.budget) budgetEl.value = Math.round(m.budget / 1000);
    if (document.activeElement !== roundsEl && m.rounds) roundsEl.value = String(m.rounds);

    const has = !!m.topic;
    liveCard.hidden = !has;
    renderPips(m.phase, m.round, m.totalRounds);
    renderMeter(m.estTokens, m.sessionBudget || m.budget);

    // rebuild stream on (re)load if the renderer is empty but a transcript exists
    if (Array.isArray(m.statements) && m.statements.length && streamEl.children.length <= lastStmtCount) {
      streamEl.textContent = '';
      for (const s of m.statements) {
        const e = document.createElement('div');
        e.className = 'wrMsg'; e.dataset.persona = s.persona;
        e.innerHTML = '<b class="wrWho">' + esc(LABEL[s.persona] || s.persona) + '</b><span class="wrTx">' + esc(s.text) + '</span>';
        streamEl.appendChild(e);
      }
      lastStmtCount = m.statements.length;
      autoscroll();
    }

    const done = m.stopReason && !m.running;
    ideasCard.hidden = !(m.cards && m.cards.length) && !done;
    renderIdeas(m.cards, m.repo);
    reportPathEl.textContent = m.reportPath ? ('report: ' + m.reportPath) : '';
  });

  ApexBus.on('warroomStarted', () => { streamEl.textContent = ''; lastStmtCount = 0; ideasCard.hidden = true; });
  ApexBus.on('warroomDone', (m) => { seal(); ideasCard.hidden = false; });

  ApexBus.post('warroomStatus', {});   // first paint
})();
