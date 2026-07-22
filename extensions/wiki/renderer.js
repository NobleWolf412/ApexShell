// Wiki Pipeline — dock pane. Ingest entries, compile the queue, browse/search
// the compiled wiki. Talks to main over the bus; owns no truth of its own.
'use strict';
(function () {
  const pane = document.createElement('div');
  pane.className = 'sidePane dockPane wikiPane';
  pane.id = 'dock-wiki';
  pane.dataset.tab = 'wiki';
  pane.dataset.order = '30';
  pane.innerHTML =
    '<div class="paneBody wikiBody">' +
      '<div class="wikiKicker">WIKI PIPELINE</div>' +
      '<p class="wikiNote">Intake is free; compiling spends tokens. A compile runs one entry at a time, ' +
        'and an empty queue costs nothing. See <code>design/wiki-pipeline-cost.md</code>.</p>' +

      '<section class="wikiCard">' +
        '<div class="wikiStat"><b class="wikiQueue">0</b> queued · <b class="wikiPages">0</b> pages</div>' +
        '<div class="wikiRow">' +
          '<button class="wikiBtn wikiNext" type="button">Compile next</button>' +
          '<button class="wikiBtn wikiAll" type="button">Compile all</button>' +
          '<button class="wikiBtn wikiStop" type="button" hidden>Stop</button>' +
        '</div>' +
        '<div class="wikiCompileState" aria-live="polite"></div>' +
      '</section>' +

      '<section class="wikiCard">' +
        '<div class="wikiLabel">ADD ENTRY (intake — free)</div>' +
        '<input class="wikiTitle" placeholder="Entry title" maxlength="120" />' +
        '<textarea class="wikiText" placeholder="Paste the notes / transcript / material to compile…" rows="4"></textarea>' +
        '<button class="wikiBtn wikiAdd" type="button">Add to queue</button>' +
      '</section>' +

      '<section class="wikiCard">' +
        '<div class="wikiLabel">COMPILE VOICE (optional)</div>' +
        '<div class="wikiRow">' +
          '<input class="wikiVoice" placeholder="a persona name, or blank" maxlength="80" />' +
          '<button class="wikiBtn wikiVoiceSet" type="button">Set</button>' +
        '</div>' +
      '</section>' +

      '<section class="wikiCard">' +
        '<div class="wikiLabel">WIKI</div>' +
        '<input class="wikiSearch" placeholder="Search pages…" />' +
        '<div class="wikiList"></div>' +
        '<pre class="wikiView" hidden></pre>' +
      '</section>' +
    '</div>' +
    '<div class="dockTab" data-tab="wiki">WIKI</div>';   // pull-handle: shell.js attachPull needs this
  document.body.appendChild(pane);
  if (window.ApexShell && ApexShell.registerDockPane) ApexShell.registerDockPane(pane, { order: 30 });

  const $ = (s) => pane.querySelector(s);
  const queueEl = $('.wikiQueue'), pagesEl = $('.wikiPages');
  const stateEl = $('.wikiCompileState');
  const nextBtn = $('.wikiNext'), allBtn = $('.wikiAll'), stopBtn = $('.wikiStop');
  const titleEl = $('.wikiTitle'), textEl = $('.wikiText');
  const voiceEl = $('.wikiVoice');
  const searchEl = $('.wikiSearch'), listEl = $('.wikiList'), viewEl = $('.wikiView');

  const setBusy = (busy) => {
    nextBtn.disabled = busy; allBtn.disabled = busy;
    stopBtn.hidden = !busy;
  };

  nextBtn.onclick = () => ApexBus.post('wikiCompileNext', {});
  allBtn.onclick = () => ApexBus.post('wikiCompileAll', {});
  stopBtn.onclick = () => ApexBus.post('wikiStop', {});
  $('.wikiAdd').onclick = () => {
    const text = textEl.value.trim();
    if (!text) return;
    ApexBus.post('wikiIngest', { title: titleEl.value.trim(), text });
    titleEl.value = ''; textEl.value = '';
  };
  $('.wikiVoiceSet').onclick = () => ApexBus.post('wikiSetVoice', { persona: voiceEl.value.trim() });

  let searchTimer = null;
  searchEl.oninput = () => {
    clearTimeout(searchTimer);
    const term = searchEl.value.trim();
    searchTimer = setTimeout(() => {
      if (term) ApexBus.post('wikiSearch', { term });
      else ApexBus.post('wikiStatus', {});   // empty search → show full list
    }, 200);
  };

  function renderPageList(pages) {
    listEl.textContent = '';
    if (!pages || !pages.length) { listEl.innerHTML = '<div class="wikiEmpty">No pages yet.</div>'; return; }
    for (const name of pages) {
      const b = document.createElement('button');
      b.className = 'wikiPageLink'; b.type = 'button'; b.textContent = name;
      b.onclick = () => ApexBus.post('wikiReadPage', { name });
      listEl.appendChild(b);
    }
  }

  ApexBus.on('wikiStatus', (m) => {
    queueEl.textContent = m.queueDepth || 0;
    pagesEl.textContent = m.pageCount || 0;
    if (typeof m.voice === 'string' && document.activeElement !== voiceEl) voiceEl.value = m.voice;
    setBusy(!!m.compiling);
    if (!searchEl.value.trim()) renderPageList(m.pages);
  });
  ApexBus.on('wikiCompileStatus', (m) => {
    if (m.phase === 'running') { setBusy(true); stateEl.textContent = 'Compiling ' + (m.title || m.stem) + '…'; }
    else if (m.phase === 'done') stateEl.textContent = m.skipped ? ('Skipped ' + m.stem + ' (nothing wiki-worthy)') : ('Compiled ' + m.stem + ' → ' + (m.pages || []).join(', '));
    else if (m.phase === 'error') stateEl.textContent = 'Error on ' + m.stem + ': ' + m.error;
    else if (m.phase === 'idle') setBusy(false);
  });
  ApexBus.on('wikiPage', (m) => {
    viewEl.hidden = false;
    viewEl.textContent = m.content || '';
    viewEl.scrollTop = 0;
  });
  ApexBus.on('wikiSearchResult', (m) => {
    listEl.textContent = '';
    if (!m.results || !m.results.length) { listEl.innerHTML = '<div class="wikiEmpty">No matches.</div>'; return; }
    for (const r of m.results) {
      const b = document.createElement('button');
      b.className = 'wikiPageLink'; b.type = 'button';
      b.innerHTML = '<b>' + r.page + '</b><span class="wikiSnip">' + r.snippet.replace(/</g, '&lt;') + '</span>';
      b.onclick = () => ApexBus.post('wikiReadPage', { name: r.page });
      listEl.appendChild(b);
    }
  });

  ApexBus.post('wikiStatus', {});   // first paint
})();
