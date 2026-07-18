// Wiki Pipeline — the store (the FREE, mechanical half; no model, no tokens).
//
// Two folders under one root:
//   raw/    — entries waiting to be compiled (one .md file each)
//   wiki/   — compiled, interlinked pages (one .md file each)
//   index.json — which raw entries have been compiled, into which pages.
//
// The "queue" is never stored — it's DERIVED (raw entries minus compiled ones),
// so it can never desync. This mirrors the intake/compile split: deciding
// WHAT to compile is a set-difference (cheap code); compiling is the model's job.
'use strict';

const fs = require('fs');
const path = require('path');

const SAFE = /[^a-z0-9._-]+/gi;
const slug = (s) => String(s || '').trim().toLowerCase().replace(SAFE, '-')
  .replace(/^-+|-+$/g, '').slice(0, 80) || 'entry';

function Store(root) {
  const rawDir = path.join(root, 'raw');
  const wikiDir = path.join(root, 'wiki');
  const indexFile = path.join(root, 'index.json');

  function ensure() {
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(wikiDir, { recursive: true });
  }

  function loadIndex() {
    try { return JSON.parse(fs.readFileSync(indexFile, 'utf8')); }
    catch { return { compiled: {}, updated: null }; }
  }
  function saveIndex(ix) {
    fs.writeFileSync(indexFile, JSON.stringify(ix, null, 2) + '\n');
  }

  // ---- raw entries ----
  function listRaw() {
    ensure();
    return fs.readdirSync(rawDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const stem = f.replace(/\.md$/, '');
        const full = path.join(rawDir, f);
        let title = stem;
        try {
          const first = fs.readFileSync(full, 'utf8').split('\n').find((l) => l.trim());
          if (first) title = first.replace(/^#+\s*/, '').slice(0, 100);
        } catch { /* keep stem */ }
        return { stem, title, size: (fs.statSync(full).size) };
      })
      .sort((a, b) => a.stem.localeCompare(b.stem));
  }
  function readRaw(stem) {
    return fs.readFileSync(path.join(rawDir, slug(stem) + '.md'), 'utf8');
  }
  // ingest — the only "intake" v1 needs: text in, one raw entry out. A
  // transcript-capture adapter can feed this same folder later.
  function ingest(title, text) {
    ensure();
    const base = slug(title) || 'entry';
    let stem = base, n = 1;
    while (fs.existsSync(path.join(rawDir, stem + '.md'))) stem = base + '-' + (++n);
    const body = (String(text || '').startsWith('#') ? '' : ('# ' + (title || stem) + '\n\n')) +
      String(text || '');
    fs.writeFileSync(path.join(rawDir, stem + '.md'), body);
    return stem;
  }

  // ---- wiki pages ----
  function listPages() {
    ensure();
    return fs.readdirSync(wikiDir).filter((f) => f.endsWith('.md')).sort();
  }
  function readPage(name) {
    return fs.readFileSync(path.join(wikiDir, path.basename(name)), 'utf8');
  }
  function writePage(relPath, content) {
    ensure();
    // confine writes to wiki/ — the model proposes a path, the store sanitizes it
    const name = path.basename(String(relPath || '')).replace(/[^a-z0-9._-]+/gi, '-');
    const safe = name.endsWith('.md') ? name : (slug(name) + '.md');
    fs.writeFileSync(path.join(wikiDir, safe), String(content || ''));
    return safe;
  }
  function searchPages(term) {
    const q = String(term || '').trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const f of listPages()) {
      const text = readPage(f);
      const idx = text.toLowerCase().indexOf(q);
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        out.push({ page: f, snippet: text.slice(start, idx + q.length + 90).replace(/\s+/g, ' ').trim() });
      }
    }
    return out.slice(0, 50);
  }

  // ---- the derived queue + compiled bookkeeping ----
  function queue() {
    const ix = loadIndex();
    return listRaw().filter((e) => !ix.compiled[e.stem]).map((e) => e);
  }
  function markCompiled(stem, pages, stamp) {
    const ix = loadIndex();
    ix.compiled[slug(stem)] = { pages: pages || [], at: stamp || null };
    ix.updated = stamp || null;
    saveIndex(ix);
  }

  function status() {
    const q = queue();
    return {
      root,
      queueDepth: q.length,
      queue: q.slice(0, 100),
      pageCount: listPages().length,
      pages: listPages(),
      rawCount: listRaw().length,
    };
  }

  return { ensure, root, rawDir, wikiDir, listRaw, readRaw, ingest,
    listPages, readPage, writePage, searchPages, queue, markCompiled,
    loadIndex, status, slug };
}

module.exports = { Store, slug };
