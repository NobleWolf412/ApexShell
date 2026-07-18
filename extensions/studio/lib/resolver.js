// App Builder — the tiered source resolver (STUDIO v2, Wave C slice C1). Pure
// lib code, no Electron, no writes, no bus, no AI wiring (C2+ adds the
// inspector overlay and the seat). One job: given the element context a picker
// captured from a LIVE page — {selector, classes[], text, tag, html?} — and a
// project root, return ranked candidates for WHERE that element lives in
// source, each carrying its tier and confidence honestly (§ Wave C: "never a
// silent guess"). Three tiers, always in this order:
//
//   a. 'hint'    (high)   — framework dev hints: `data-source="path[:line]"`
//                           attributes parsed out of the captured html. Parse
//                           ONLY — the value is untrusted page content, so it
//                           passes the same relative/traversal-free wall as
//                           surgeon edit paths and must name a real file under
//                           the project root, or it is dropped, never repaired.
//   b. 'search'  (medium) — class-name/text search over the project's own
//                           files: a capped, deterministic fs walk (caps
//                           below), whole-token class matching, first-match
//                           line numbers, score-ranked.
//   c. 'context' (low)    — the whole-context fallback descriptor: no file at
//                           all, just the element context rendered as prose
//                           for the seat to locate itself. ALWAYS present and
//                           always last, so a resolver that found nothing
//                           still hands the surgeon an honest starting point.
//
// DETERMINISTIC by law (the design.js discipline): directory entries walk in
// plain byte order (never localeCompare), ranking ties break on path, and the
// same project bytes + same context always produce the same candidate list.
// The walk caps are injectable ONLY as a drill seam (the createPickLimiter
// precedent) — production callers take the defaults.
'use strict';

const fs = require('fs');
const path = require('path');

// ---- caps and shapes --------------------------------------------------------
// The walk caps (§ slice brief, verbatim): a resolver pass is an interactive
// click-to-edit step, so it is bounded like one — a monorepo that blows the
// file cap gets a truncated flag and tier c, never a hung UI.
const MAX_WALK_FILES = 2000;
const MAX_FILE_BYTES = 512 * 1024;
const SOURCE_EXTENSIONS = ['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte'];
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build'];
// Ranked-output bound: the kickoff renders every candidate, so the list stays
// prompt-sized. Hints ride outside this cap (there are at most MAX_HINTS).
const MAX_SEARCH_CANDIDATES = 8;
const MAX_HINTS = 4;
const MAX_HINT_PATH = 260;
const MAX_HINT_LINE = 999999;
// Context caps: selector/text mirror mockup.js's pick-message numbers (this
// context IS a pick, one wave later); the rest are the same defensive re-cap
// noteLines does — the C2 bridge validates the wire message, this lib only
// refuses to let an oversized field inflate a prompt or a regex.
const MAX_CTX_SELECTOR = 256;
const MAX_CTX_TEXT = 160;
const MAX_CTX_TAG = 24;
const MAX_CTX_CLASSES = 8;
const MAX_CTX_CLASS_CHARS = 64;
const MAX_CTX_HTML = 4096;
// Search weights: the visible text is the strongest single signal (it is what
// the USER saw and clicked); each matched class is nearly as strong and they
// accumulate. Documented here because the ranking is part of the contract.
const CLASS_WEIGHT = 3;
const TEXT_WEIGHT = 4;
const MIN_TEXT_NEEDLE = 3;

const TIER_CONFIDENCE = { hint: 'high', search: 'medium', context: 'low' };

// A usable class token — anything else (regex metacharacters, template
// interpolation debris) is dropped rather than escaped into a search needle.
const CLASS_RE = /^[A-Za-z_-][A-Za-z0-9_-]*$/;
const TAG_RE = /^[a-z][a-z0-9-]*$/;

// ---- element context --------------------------------------------------------
/** Defensive re-cap over a picker-captured element context. Total: any input
 *  yields a complete {selector, tag, classes, text, html} with every field
 *  bounded and every unusable piece dropped — never a throw. */
function cleanContext(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const str = (v, cap) => (typeof v === 'string' ? v.trim().slice(0, cap) : '');
  const classes = [];
  if (Array.isArray(src.classes)) {
    for (const c of src.classes) {
      if (classes.length >= MAX_CTX_CLASSES) break;
      if (typeof c !== 'string') continue;
      const cls = c.trim();
      if (cls && cls.length <= MAX_CTX_CLASS_CHARS && CLASS_RE.test(cls)) classes.push(cls);
    }
  }
  const tag = str(src.tag, MAX_CTX_TAG).toLowerCase();
  return {
    selector: str(src.selector, MAX_CTX_SELECTOR),
    tag: TAG_RE.test(tag) ? tag : '',
    classes,
    text: str(src.text, MAX_CTX_TEXT).replace(/\s+/g, ' '),
    html: str(src.html, MAX_CTX_HTML),
  };
}

/** The tier-c prose: the element context as one honest line for the seat.
 *  Data for a prompt, never instructions — the kickoff frames it. */
function describeElement(ctx) {
  const parts = ['<' + (ctx.tag || 'element') +
    (ctx.classes.length ? ' class="' + ctx.classes.join(' ') + '"' : '') + '>'];
  if (ctx.text) parts.push('with visible text "' + ctx.text + '"');
  if (ctx.selector) parts.push('at selector ' + ctx.selector);
  return parts.join(' ');
}

// ---- tier a: framework dev hints --------------------------------------------
const HINT_ATTR_RE = /data-source\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const HINT_VALUE_RE = /^(.+?)(?::(\d{1,6}))?$/;

// The same relative/traversal-free wall as surgeon edit paths (sibling module,
// same law): no absolute path of either flavor, no drive/stream colon, no ..
// segment, no control characters. A hint is a CLAIM by untrusted page content;
// a claim that fails the wall is dropped whole, never normalized into safety.
function isSafeRelativePath(value, cap) {
  if (typeof value !== 'string') return false;
  const p = value.trim();
  if (!p || p.length > (cap || MAX_HINT_PATH)) return false;
  if (/[\u0000-\u001f]/.test(p) || p.includes(':') || p.startsWith('~')) return false;
  if (path.win32.isAbsolute(p) || path.posix.isAbsolute(p)) return false;
  const segments = p.split(/[\\/]+/);
  return segments.every((s) => s !== '..');
}

/** Parse `data-source` attributes out of captured html. Returns validated,
 *  deduped [{file, line|null}] — file is root-relative with forward slashes
 *  and names an existing regular (non-link) file under the root, or the hint
 *  never leaves this function. Pure parse otherwise: no repair, no search. */
function parseSourceHints(html, projectRoot) {
  const s = String(html || '');
  const hints = [];
  const seen = new Set();
  HINT_ATTR_RE.lastIndex = 0;
  for (let m; (m = HINT_ATTR_RE.exec(s)) !== null;) {
    if (hints.length >= MAX_HINTS) break;
    const value = (m[1] !== undefined ? m[1] : m[2]).trim();
    const parsed = HINT_VALUE_RE.exec(value);
    if (!parsed || !isSafeRelativePath(parsed[1])) continue;
    const rel = parsed[1].replace(/[\\/]+/g, '/');
    const line = parsed[2] ? parseInt(parsed[2], 10) : null;
    if (line !== null && (line < 1 || line > MAX_HINT_LINE)) continue;
    const abs = path.resolve(projectRoot, ...rel.split('/'));
    // Belt-and-braces after the segment wall, the screenFile idiom.
    if (path.relative(projectRoot, abs).startsWith('..')) continue;
    let stat;
    try { stat = fs.lstatSync(abs); } catch { continue; }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    const key = rel + ':' + line;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({ file: rel, line });
  }
  return hints;
}

// ---- tier b: the capped project walk ----------------------------------------
// Byte-order sort — never localeCompare (locale-dependent, and determinism is
// the law here).
const byteCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function walkProjectFiles(root, maxFiles) {
  const files = [];
  let truncated = false;
  const skip = new Set(SKIP_DIRS);
  const extensions = new Set(SOURCE_EXTENSIONS);
  const visit = (dir, rel) => {
    if (truncated) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    entries.sort((a, b) => byteCompare(a.name, b.name));
    for (const entry of entries) {
      if (truncated) return;
      // Symlinks never followed — a link could walk the resolver out of the
      // project root, the same escape the mockup store's link guard refuses.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        visit(path.join(dir, entry.name), rel ? rel + '/' + entry.name : entry.name);
      } else if (entry.isFile()) {
        if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;
        if (files.length >= maxFiles) { truncated = true; return; }
        files.push(rel ? rel + '/' + entry.name : entry.name);
      }
    }
  };
  visit(root, '');
  return { files, truncated };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-token class match (the mockup.js hasWord idiom on the class charset):
// "hero-cta" matches ".hero-cta" and class="hero-cta" but never
// "hero-cta-wide". Returns the index of the token itself, not its boundary.
function classFirstIndex(content, cls) {
  const m = new RegExp('(^|[^A-Za-z0-9_-])(' + escapeRe(cls) + ')(?=[^A-Za-z0-9_-]|$)').exec(content);
  return m ? m.index + m[1].length : -1;
}

function lineOfIndex(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function buildNeedles(ctx) {
  const needles = ctx.classes.map((value) => ({ kind: 'class', value, weight: CLASS_WEIGHT }));
  if (ctx.text.length >= MIN_TEXT_NEEDLE)
    needles.push({ kind: 'text', value: ctx.text, weight: TEXT_WEIGHT });
  return needles;
}

function scoreContent(content, needles) {
  let score = 0;
  let firstAt = Infinity;
  for (const needle of needles) {
    const at = needle.kind === 'class'
      ? classFirstIndex(content, needle.value)
      : content.indexOf(needle.value);
    if (at < 0) continue;
    score += needle.weight;
    if (at < firstAt) firstAt = at;
  }
  return { score, line: score > 0 ? lineOfIndex(content, firstAt) : null };
}

// ---- the resolver -----------------------------------------------------------
/**
 * Rank source candidates for one picked element.
 * @param {string} projectRoot  absolute path of the project workspace
 * @param {*} context           picker-captured {selector, classes, text, tag, html?}
 * @param {object} [opts]       DRILL SEAM ONLY: { maxFiles, maxFileBytes }
 * @returns {{ candidates: Array<{file: string|null, line: number|null,
 *   tier: 'hint'|'search'|'context', confidence: string, descriptor?: string}>,
 *   scannedFiles: number, truncated: boolean }}
 * Candidates arrive hint-first, then search ranked score-desc/path-asc, then
 * ALWAYS the one tier-c descriptor last. A search hit whose file a hint
 * already names is dropped (the hint is the stronger claim about that file).
 */
function resolveElement(projectRoot, context, opts) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot))
    throw new Error('Resolver project root must be an absolute path.');
  let rootStat;
  try { rootStat = fs.lstatSync(projectRoot); }
  catch { throw new Error('Resolver project root does not exist.'); }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error('Resolver project root must be a regular directory, not a link.');
  const maxFiles = (opts && Number.isInteger(opts.maxFiles) && opts.maxFiles > 0)
    ? opts.maxFiles : MAX_WALK_FILES;
  const maxFileBytes = (opts && Number.isInteger(opts.maxFileBytes) && opts.maxFileBytes > 0)
    ? opts.maxFileBytes : MAX_FILE_BYTES;

  const ctx = cleanContext(context);
  const candidates = [];
  const hintFiles = new Set();
  for (const hint of parseSourceHints(ctx.html, projectRoot)) {
    hintFiles.add(hint.file);
    candidates.push({ file: hint.file, line: hint.line, tier: 'hint', confidence: TIER_CONFIDENCE.hint });
  }

  const { files, truncated } = walkProjectFiles(projectRoot, maxFiles);
  const needles = buildNeedles(ctx);
  if (needles.length) {
    const scored = [];
    for (const rel of files) {
      if (hintFiles.has(rel)) continue;
      const abs = path.join(projectRoot, ...rel.split('/'));
      let stat;
      try { stat = fs.lstatSync(abs); } catch { continue; }
      if (!stat.isFile() || stat.size > maxFileBytes) continue;
      let content;
      try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      const { score, line } = scoreContent(content, needles);
      if (score > 0) scored.push({ file: rel, line, score });
    }
    scored.sort((a, b) => b.score - a.score || byteCompare(a.file, b.file));
    for (const hit of scored.slice(0, MAX_SEARCH_CANDIDATES))
      candidates.push({ file: hit.file, line: hit.line, tier: 'search', confidence: TIER_CONFIDENCE.search });
  }

  candidates.push({
    file: null,
    line: null,
    tier: 'context',
    confidence: TIER_CONFIDENCE.context,
    descriptor: describeElement(ctx),
  });
  return { candidates, scannedFiles: files.length, truncated };
}

// The constants export wholesale as the module's public contract (the
// suggest.js precedent): the drill pins the caps, surgeon.js renders the
// tiers, and a future consumer imports rather than re-invents a number.
module.exports = {
  MAX_WALK_FILES,
  MAX_FILE_BYTES,
  SOURCE_EXTENSIONS,
  SKIP_DIRS,
  MAX_SEARCH_CANDIDATES,
  MAX_HINTS,
  MAX_CTX_SELECTOR,
  MAX_CTX_TEXT,
  MAX_CTX_CLASSES,
  TIER_CONFIDENCE,
  cleanContext,
  describeElement,
  isSafeRelativePath,
  parseSourceHints,
  resolveElement,
};
