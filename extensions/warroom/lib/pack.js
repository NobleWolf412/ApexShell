// War Room — the context pack + the apex-fetch path guard.
//
// Disposable seats are tool-less and repo-blind (scratch cwd). We recover grounding
// in plain code: a capped context pack at kickoff, and a budget-limited file fetch
// the Auditor can request mid-debate. Both read real repo bytes; neither hands the
// seats a live tool. Every read is confined to the chosen repo (realpath-checked,
// symlink escapes rejected) and size-capped — the wiki store's traversal discipline.
'use strict';

const fs = require('fs');
const path = require('path');

const TREE_CAP = 4000;
const TREE_MAX_PATHS = 150;
const DOC_CAP = 6000;
const DOC_MAX = 2;
const CTX_CAP = 6000;
const CTX_MAX = 3;
const FETCH_CAP = 6000;
const FETCH_MAX = 3;

const SKIP_DIRS = new Set(['node_modules', '.git', 'state', 'dist', '.cache', 'coverage']);
const DOC_CANDIDATES = ['README.md', 'floorplan.md', 'ARCHITECTURE.md', 'AGENTS.md', 'CLAUDE.md'];

// Resolve `rel` against `repo`, rejecting anything that escapes the repo (via ..,
// absolute paths, or symlinks). Returns the real absolute path of an existing FILE,
// or null. This is the single guard both fetch and context-files pass through.
function safeResolve(repo, rel) {
  try {
    const base = fs.realpathSync(repo);
    const abs = path.resolve(base, rel);
    if (abs !== base && !abs.startsWith(base + path.sep)) return null;
    const real = fs.realpathSync(abs);                       // collapse symlinks
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    if (!fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

function readCapped(abs, capChars) {
  let data = fs.readFileSync(abs, 'utf8');
  if (data.length > capChars) data = data.slice(0, capChars) + '\n… (truncated)';
  return data;
}

function walkTree(repo) {
  const out = [];
  const walk = (dir, prefix) => {
    if (out.length >= TREE_MAX_PATHS) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= TREE_MAX_PATHS) return;
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) { out.push(rel + '/'); walk(path.join(dir, e.name), rel); }
      else out.push(rel);
    }
  };
  walk(repo, '');
  let text = out.join('\n');
  if (text.length > TREE_CAP) text = text.slice(0, TREE_CAP) + '\n… (tree truncated)';
  return text;
}

function readDocHeads(repo) {
  const docs = [];
  for (const name of DOC_CANDIDATES) {
    if (docs.length >= DOC_MAX) break;
    const abs = safeResolve(repo, name);
    if (abs) { try { docs.push({ name, head: readCapped(abs, DOC_CAP) }); } catch { /* skip */ } }
  }
  return docs;
}

/** Read up to FETCH_MAX operator/Auditor-requested files, guarded + capped. */
function readFetch(repo, relPaths) {
  const out = [];
  for (const rel of (relPaths || [])) {
    if (out.length >= FETCH_MAX) break;
    const abs = safeResolve(repo, rel);
    if (!abs) { out.push({ path: rel, content: '(unavailable — not found or outside the repo)' }); continue; }
    try { out.push({ path: rel, content: readCapped(abs, FETCH_CAP) }); }
    catch { out.push({ path: rel, content: '(unreadable)' }); }
  }
  return out;
}

/** Build the shared pack once at session start. `contextFiles` = operator-listed
 *  relative paths (≤3). Returns rendered strings the kickoffs compose per role. */
function buildPack(repo, contextFiles) {
  const tree = walkTree(repo);
  const docs = readDocHeads(repo);
  const extra = readFetch(repo, (contextFiles || []).slice(0, CTX_MAX));   // same guard, CTX cap ≈ FETCH cap
  const docsText = docs.map((d) => '=== ' + d.name + ' (head) ===\n' + d.head).join('\n\n');
  const extraText = extra.map((f) => '=== ' + f.path + ' ===\n' + f.content).join('\n\n');
  return {
    tree,
    docsText,
    extraText,
    // Role slices: the Brainstormer only needs the tree (so it doesn't re-propose
    // what exists); the Architect/Auditor also get the doc heads + operator files.
    forRole(role) {
      const s = ['PROJECT FILE TREE:\n' + tree];
      if (role !== 'brainstormer' && role !== 'contrarian' && docsText) s.push(docsText);
      if ((role === 'architect' || role === 'auditor') && extraText) s.push(extraText);
      return s.join('\n\n');
    },
  };
}

module.exports = { buildPack, readFetch, safeResolve, TREE_CAP, FETCH_CAP, FETCH_MAX, CTX_MAX };
