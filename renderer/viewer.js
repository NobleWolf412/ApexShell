// Apex — the VIEWER dock tab (the operator, 2026-07-13: the working view moves off
// the chat's flank into the top-left dock tab). This is the seats' show-and-
// tell surface: any 'artifact' from any seat renders here, latest wins. The
// tab dot pulses when something lands while the pane is closed — pull it open
// to watch, or ignore it. Explicit path-clicks in a chat open the tab
// themselves (chatView posts + ApexShell.openDock).
'use strict';

window.ApexViewer = (() => {
  const pane = document.getElementById('dock-viewer');
  const body = pane.querySelector('.vwBody');
  const nameEl = pane.querySelector('.vwName');
  const dot = pane.querySelector('.vDot');
  const openBtn = pane.querySelector('.vwOpen');
  let curPath = null;

  openBtn.onclick = () => {
    if (curPath) ApexBus.post('openPath', { path: curPath });
  };

  // show(m) renders {kind, uri|text, name, path?}. Also the door for
  // renderer-local content (pasted-image thumbs — no file, no path).
  function show(m) {
    curPath = m.path || null;
    openBtn.hidden = !curPath;    // ↗ needs a real file; a pasted dataURL has none
    openBtn.title = curPath ? 'open ' + curPath + ' with your system app (browser, editor, image viewer)' : '';
    nameEl.textContent = m.name || m.path || '';
    nameEl.title = (m.path ? m.path + '\n' : '') +
      'live view — re-renders when this file changes on disk; the newest artifact from any chat replaces it';
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
    if (!pane.classList.contains('open')) dot.hidden = false;
  }

  ApexBus.on('artifact', show);

  // opening the pane (click OR drag — any road to 'open') retires the dot
  new MutationObserver(() => {
    if (pane.classList.contains('open')) dot.hidden = true;
  }).observe(pane, { attributes: true, attributeFilter: ['class'] });

  return { show };
})();
