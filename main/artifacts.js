// Apex — the working view's data plane (J17/J18/J19, app-level; the engine
// only emits artifactCandidate). One artifact per seat (the most recent
// write/visual read); fs.watch with a 300ms debounce live-refreshes it.
// Images ship as data: URIs (render from ANY path — the J19 lesson); HTML
// ships as an apex:// URL for the iframe (the localResourceRoots wall,
// retired on our terms — plan §3); everything else as capped text.
'use strict';

const fs = require('fs');
const path = require('path');
const bus = require('./bus');

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const isHtml = (e) => e === 'html' || e === 'htm';

const current = new Map();   // seatId -> { path, watcher, t }

function show(id, p) {
  const ext = (p.split('.').pop() || '').toLowerCase();
  const m = { id, path: p, v: Date.now(),
              name: p.split(/[\\/]/).pop(),
              kind: IMG_EXT.has(ext) ? 'img' : isHtml(ext) ? 'html' : 'text' };
  // A DIRECTORY (or a vanished path) must never be classified img/html — those
  // route to a data-URI read / the apex:// iframe fetch, and reading a dir
  // throws "EISDIR: illegal operation on a directory" (the img branch catches
  // it, but the html branch surfaces it raw in the iframe). Fall to a clear
  // text note instead. Stat once, up front.
  let st = null;
  try { st = fs.statSync(p); } catch { /* missing — handled below */ }
  if (!st || st.isDirectory()) {
    m.kind = 'text';
    m.text = st
      ? '(this path is a folder, not a viewable file: ' + p + ')'
      : '(nothing to show yet — the path does not exist: ' + p + ')';
    bus.post('artifact', m);
    return;
  }
  if (m.kind === 'text') {
    try {
      let t = fs.readFileSync(p, 'utf8');
      if (t.length > 100000) t = t.slice(0, 100000) + '\n…[truncated]';
      m.text = t;
    } catch (e) { m.text = '(not readable yet: ' + e.message + ')'; }
  } else if (m.kind === 'img') {
    try {
      const buf = fs.readFileSync(p);
      if (buf.length > 12 * 1024 * 1024) {
        m.kind = 'text';
        m.text = '(image too large for the viewer: ' + Math.round(buf.length / 1048576) + ' MB — use ↗ to open it)';
      } else {
        const mt = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
        m.uri = 'data:' + mt + ';base64,' + buf.toString('base64');
      }
    } catch (e) { m.kind = 'text'; m.text = '(not readable yet: ' + e.message + ')'; }
  } else {
    // apex://local/<encoded absolute path> — resolved by the protocol handler
    m.uri = 'apex://local/' + encodeURIComponent(p);
  }
  bus.post('artifact', m);
}

function candidate(id, p) {
  show(id, p);
  const cur = current.get(id);
  if (cur && cur.path === p && cur.watcher) return;   // already watching
  if (cur && cur.watcher) try { cur.watcher.close(); } catch { /* gone */ }
  const entry = { path: p, watcher: null, t: null };
  current.set(id, entry);
  // Watch the containing DIRECTORY, not the file: tools that save via atomic
  // rename retire a file-bound watcher on Windows and the view silently stops
  // refreshing — the exact failure liveUpdate documents for preload.js.
  const base = path.basename(p).toLowerCase();
  try {
    entry.watcher = fs.watch(path.dirname(p), (_event, filename) => {
      // a null filename can't be attributed — refresh anyway (debounced, cheap)
      if (filename && String(filename).toLowerCase() !== base) return;
      clearTimeout(entry.t);
      entry.t = setTimeout(() => show(id, p), 300);
    });
    entry.watcher.on('error', () => { /* dir vanished — keep the last render */ });
  } catch { /* directory may not exist — fail-safe, no watcher */ }
}

function seatClosed(id) {
  const cur = current.get(id);
  if (cur && cur.watcher) try { cur.watcher.close(); } catch { /* gone */ }
  current.delete(id);
}

function dispose() { for (const id of [...current.keys()]) seatClosed(id); }

module.exports = { candidate, seatClosed, dispose };
