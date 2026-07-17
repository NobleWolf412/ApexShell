// Apex — the VIEWER dock tab (the operator, 2026-07-13: the working view moves off
// the chat's flank into the top-left dock tab). This is the seats' show-and-
// tell surface: any 'artifact' from any seat renders here. Latest wins BY
// DEFAULT — the pin (2026-07-17, the operator's UX pass) stops other seats'
// artifacts from hijacking the view, and the history strip keeps the last few
// artifacts one click away either way. The tab dot pulses when something lands
// while the pane is closed OR while the pin holds it back.
'use strict';

window.ApexViewer = (() => {
  const pane = document.getElementById('dock-viewer');
  const body = pane.querySelector('.vwBody');
  const nameEl = pane.querySelector('.vwName');
  const dot = pane.querySelector('.vDot');
  const openBtn = pane.querySelector('.vwOpen');
  const pinBtn = pane.querySelector('.vwPin');
  const histEl = pane.querySelector('.vwHist');
  let curPath = null;
  let curKey = null;
  let pinned = false;
  let expectKey = null;          // a history click re-shows — its key passes the pin
  let pasteSeq = 0;              // makes pathless (pasted/sent) artifacts uniquely keyed
  const HIST_MAX = 6;
  const history = [];            // [{key, name, m}] most-recent-first; m = the artifact push

  // Path artifacts key by path (so a file's live-refresh collapses to one entry);
  // pathless ones (pasted/sent images) get a stamped unique key ONCE, so two with
  // the same name (e.g. both "sent image") don't collide into a single slot.
  const keyOf = (m) => m.path || (m.__vwKey || (m.__vwKey = 'pasted:' + (++pasteSeq)));

  openBtn.onclick = () => {
    if (curPath) ApexBus.post('openPath', { path: curPath });
  };

  pinBtn.onclick = () => {
    pinned = !pinned;
    pinBtn.classList.toggle('active', pinned);
    pinBtn.title = pinned
      ? 'Pinned — other artifacts queue in the strip below instead of replacing this. Click to follow latest again.'
      : 'Pin this view — other seats\' artifacts stop replacing it (they still queue in the strip below)';
  };

  function remember(m) {
    const key = keyOf(m);
    const at = history.findIndex((h) => h.key === key);
    if (at >= 0) history.splice(at, 1);
    history.unshift({ key, name: m.name || key, m });
    if (history.length > HIST_MAX) history.pop();
    renderHist();
  }

  function renderHist() {
    histEl.hidden = history.length < 2;   // one artifact needs no strip
    histEl.textContent = '';
    for (const h of history) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vwHistChip' + (h.key === curKey ? ' current' : '');
      b.textContent = h.name;
      b.title = (h.m.path || 'pasted image') + ' — click to show';
      b.onclick = () => {
        // Re-show from the stored snapshot — NOT a round-trip through main.
        // Re-requesting armed a fresh fs.watch keyed to the (often dead) source
        // seat, leaking one watcher per click. A live seat's further writes
        // still flow in through the normal 'artifact' push; looking back at a
        // past artifact needs no watcher.
        expectKey = h.key;     // let it pass the pin
        show(h.m);
      };
      histEl.appendChild(b);
    }
  }

  // show(m) renders {kind, uri|text, name, path?}. Also the door for
  // renderer-local content (pasted-image thumbs — no file, no path).
  function show(m) {
    const key = keyOf(m);
    remember(m);
    // The pin holds the view: a DIFFERENT artifact arriving unasked doesn't
    // replace it — it queues in the strip and the dot pulses. The pinned
    // artifact's own live-refresh (same key) always passes; so does an
    // arrival the user explicitly clicked for (expectKey).
    if (pinned && key !== curKey && key !== expectKey) {
      dot.hidden = false;
      return;
    }
    expectKey = null;
    curKey = key;
    curPath = m.path || null;
    openBtn.hidden = !curPath;    // ↗ needs a real file; a pasted dataURL has none
    openBtn.title = curPath ? 'open ' + curPath + ' with your system app (browser, editor, image viewer)' : '';
    pinBtn.hidden = false;
    nameEl.textContent = m.name || m.path || '';
    nameEl.title = (m.path ? m.path + '\n' : '') +
      'live view — re-renders when this file changes on disk; the newest artifact from any chat replaces it (pin to stop that)';
    body.textContent = '';
    if (m.kind === 'img') {
      const i = document.createElement('img');
      i.src = m.uri;
      body.appendChild(i);
    } else if (m.kind === 'html') {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');   // self-contained pages only
      f.src = m.uri + '#' + m.v;                    // cache-bust on refresh
      body.appendChild(f);
    } else {
      const pre = document.createElement('pre');
      pre.textContent = m.text || '';
      body.appendChild(pre);
    }
    renderHist();                 // current-chip highlight follows the view
    if (!pane.classList.contains('open')) dot.hidden = false;
  }

  ApexBus.on('artifact', show);

  // opening the pane (click OR drag — any road to 'open') retires the dot
  new MutationObserver(() => {
    if (pane.classList.contains('open')) dot.hidden = true;
  }).observe(pane, { attributes: true, attributeFilter: ['class'] });

  return { show };
})();
