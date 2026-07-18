// App Builder — the mockup pass (STUDIO v2, Wave A slice A3). Three pure jobs
// plus one disciplined store, all extension-owned, no Electron anywhere:
//
//   1. Screen derivation (deriveScreens): a DETERMINISTIC pass over the
//      blueprint proposing the screen list — no AI, no randomness; the user
//      renames/removes/adds in the renderer before generating anything.
//      Platform-adaptive per § Wave A: web/desktop/mobile answers get screen
//      mockups, a CLI gets a terminal storyboard, an API gets one endpoint-map
//      page.
//   2. The prompt builder (buildPrompt): blueprint digest + Look area + the
//      A2 tokens summary + ONE screen's purpose. The tokens summary comes
//      from lib/design.js's compiler — never a re-implementation.
//   3. The untrusted-reply contract (parseLlmReply/checkSelfContained):
//      exactly ONE complete, self-contained HTML document in a ```html fence,
//      size-capped, every external-URL vector rejected, fail-closed to an
//      error + no file on any violation. Same allowlist philosophy as
//      suggest.js/codesigner.js — the fence choice is documented below.
//
// The store: mockup HTML never enters the draft JSON (drafts.js has a 256 KB
// whole-draft cap; one mockup can be twice that). Files live under the
// extension's OWN state — state/extensions/studio/mockups/<draftId>/
// <screen>.html — with a small provenance sidecar (<screen>.json) carrying
// the generating canonical hash. Drift discipline is blueprint.js's, applied
// to files: a later blueprint change flips isMockupStale() true and the UI
// shows a STALE badge; nothing is ever regenerated silently. The dir
// discipline (symlink refusal, atomic same-dir temp + rename, id-pinned
// filenames) mirrors drafts.js byte-for-byte on purpose.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ID_RE } = require('./drafts');
const { BLUEPRINT_AREAS } = require('./contract');

// ---- caps and shapes --------------------------------------------------------
// One mockup document. 512 KB is generous for a single self-contained page
// (the hand-made mockup that designed this very feature is under 100 KB) while
// still bounding a hostile reply; the reply-side cap and the write-side cap
// are the same number so nothing parseable is ever unwritable.
const MAX_MOCKUP_BYTES = 512 * 1024;
// Screen identity: the id is also the filename stem, so it is pinned exactly
// like a project id — lowercase kebab, bounded. Title/purpose are prompt
// text, capped like every other untrusted-adjacent string in this extension.
const SCREEN_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_SCREEN_ID = 48;
const MAX_SCREEN_TITLE = 80;
const MAX_SCREEN_PURPOSE = 500;
const MAX_SCREENS = 24;
// Prompt inputs: per-area digest excerpt + the look area ride whole-ish but
// bounded, same philosophy as suggest.js's MAX_ANSWER_CHARS.
const DIGEST_AREA_CHARS = 700;
const LOOK_CHARS = 1500;
const PROVENANCE_SCHEMA = 1;
const HASH_RE = /^[0-9a-f]{64}$/;

// ---- screen derivation (deterministic, documented) --------------------------
// Platform kind from the blueprint's platform answer (lowercased, whole-word).
// Precedence is deliberate and documented: an explicit UI word (web/desktop/
// mobile…) wins over cli which wins over api — "a web dashboard over a REST
// API" is a screens project; "a CLI that calls an API" is a storyboard. No
// match at all defaults to screens (the golden path renders SOMETHING).
const PLATFORM_KINDS = [
  ['screens', ['web', 'website', 'webapp', 'browser', 'desktop', 'electron', 'tauri', 'mobile', 'ios', 'android', 'gui', 'app', 'dashboard', 'ui']],
  ['cli', ['cli', 'terminal', 'tui', 'console', 'command-line', 'commandline', 'shell']],
  ['api', ['api', 'service', 'backend', 'server', 'headless', 'endpoint', 'endpoints', 'daemon', 'microservice']],
];

// The conditional screens, per kind. Each rule is: id/title/purpose plus the
// whole-word trigger list matched against the JOINED blueprint text (all
// areas — a login mentioned in scope counts as much as one in architecture).
// The base screens (no trigger) always appear first. The user edits the list
// before generating, so these are proposals, not verdicts.
const SCREEN_RULES = {
  screens: {
    base: [
      { id: 'home', title: 'Home', purpose: 'The main screen — the first thing a user sees and the primary job front and center.' },
    ],
    conditional: [
      { id: 'auth', title: 'Sign in', purpose: 'Authentication — sign in / account entry.', words: ['login', 'log-in', 'signin', 'sign-in', 'auth', 'authentication', 'account', 'accounts', 'register', 'signup', 'sign-up', 'password'] },
      { id: 'dashboard', title: 'Dashboard', purpose: 'The overview — key metrics, charts, and status at a glance.', words: ['dashboard', 'overview', 'analytics', 'metrics', 'charts', 'stats', 'monitor', 'monitoring', 'tracker', 'trackers'] },
      { id: 'settings', title: 'Settings', purpose: 'Settings and configuration — the dials the user can turn.', words: ['settings', 'config', 'configuration', 'configurable', 'preferences', 'options'] },
    ],
  },
  cli: {
    base: [
      { id: 'invocation', title: 'Invocation', purpose: 'Storyboard frame: the command being invoked — name, arguments, and the help text.' },
      { id: 'session', title: 'Session', purpose: 'Storyboard frame: a representative successful run, start to finish, as terminal output.' },
    ],
    conditional: [
      { id: 'errors', title: 'Errors', purpose: 'Storyboard frame: how a failure reads — clear, plain-language error output.', words: ['error', 'errors', 'fail', 'fails', 'failure', 'failures', 'invalid', 'recover', 'recovery'] },
      { id: 'config', title: 'Config', purpose: 'Storyboard frame: configuring the tool — flags, config file, or interactive setup.', words: ['settings', 'config', 'configuration', 'configurable', 'preferences', 'options'] },
    ],
  },
  api: {
    base: [
      { id: 'endpoints', title: 'Endpoint map', purpose: 'One page mapping the API surface: endpoints/operations, grouped by resource, with method, purpose, and the data each owns.' },
    ],
    conditional: [],
  },
};

// Mirror of contract.areaText's string-leaf walk, applied to one area.
function areaProse(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const parts = [];
  const walk = (node) => {
    if (typeof node === 'string') parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(value);
  return parts.join(' ').trim();
}

function hasWord(text, word) {
  // Escape nothing: every trigger word above is [a-z-] only. Hyphenated
  // triggers still need \b anchoring on their ends, which works because
  // - is a non-word char.
  return new RegExp('(?:^|[^a-z0-9])' + word + '(?:[^a-z0-9]|$)').test(text);
}

/** Deterministic screen-list proposal from a blueprint (any object carrying
 *  the BLUEPRINT_AREAS; draft.preview.blueprint or blueprintFromDraft output).
 *  Returns { kind, screens: [{ id, title, purpose }] }. Pure — same blueprint
 *  in, same list out; the user edits the result before generating. */
function deriveScreens(blueprint) {
  const source = blueprint && typeof blueprint === 'object' ? blueprint : {};
  const platformText = areaProse(source.platform).toLowerCase();
  let kind = 'screens';
  outer:
  for (const [name, words] of PLATFORM_KINDS) {
    for (const word of words) {
      if (hasWord(platformText, word)) { kind = name; break outer; }
    }
  }
  const allText = BLUEPRINT_AREAS
    .map((area) => areaProse(source[area]))
    .join(' ')
    .toLowerCase();
  const rules = SCREEN_RULES[kind];
  const screens = rules.base.map((s) => ({ ...s }));
  for (const rule of rules.conditional) {
    if (rule.words.some((word) => hasWord(allText, word)))
      screens.push({ id: rule.id, title: rule.title, purpose: rule.purpose });
  }
  return { kind, screens };
}

/** Validate one user-shaped screen descriptor (the list is user-editable, so
 *  every entry that reaches the generator is untrusted input). Throws with a
 *  plain message; returns the cleaned { id, title, purpose }. */
function cleanScreen(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Screen descriptor is invalid.');
  const id = value.id;
  if (typeof id !== 'string' || id.length > MAX_SCREEN_ID || !SCREEN_ID_RE.test(id))
    throw new Error('Screen name must be lowercase kebab-case, at most ' + MAX_SCREEN_ID + ' characters.');
  const title = String(value.title || id).trim().slice(0, MAX_SCREEN_TITLE) || id;
  const purpose = String(value.purpose || '').trim().slice(0, MAX_SCREEN_PURPOSE);
  return { id, title, purpose };
}

// ---- the prompt builder -----------------------------------------------------
/** One screen's generation prompt: blueprint digest + Look area + the A2
 *  tokens summary + this ONE screen's purpose, then the reply contract. */
function buildPrompt({ displayName, blueprint, tokensSummary, kind, screen }) {
  const cleaned = cleanScreen(screen);
  const digest = ['BLUEPRINT DIGEST for "' + String(displayName || '(untitled)') + '":'];
  for (const area of BLUEPRINT_AREAS) {
    if (area === 'look') continue; // the look area rides in full below
    const prose = areaProse(blueprint && blueprint[area]);
    digest.push('- ' + area + ': ' + (prose ? prose.slice(0, DIGEST_AREA_CHARS) : '(unanswered)'));
  }
  const look = areaProse(blueprint && blueprint.look).slice(0, LOOK_CHARS);
  const what = kind === 'cli'
    ? 'ONE terminal-storyboard frame (render a styled terminal window as HTML)'
    : kind === 'api'
      ? 'ONE endpoint-map page (the API surface as a readable, styled reference page)'
      : 'ONE application screen mockup';
  return [
    'You are generating a clickable HTML mockup for one screen of an app that does',
    'not exist yet. This is a visual proposal, not production code.',
    '',
    digest.join('\n'),
    '',
    'Look and feel (the user\'s own words): ' + (look || '(no look answer — use the compiled defaults below)'),
    'Compiled design tokens summary: ' + String(tokensSummary || '(none)'),
    '',
    'Generate ' + what + ':',
    'Screen: ' + cleaned.title + ' (' + cleaned.id + ')',
    'Purpose: ' + (cleaned.purpose || '(none stated — infer the obvious purpose from the digest)'),
    '',
    'Reply with exactly ONE fenced block and nothing else outside it:',
    '```html',
    '<!doctype html>',
    '... one complete HTML document ...',
    '```',
    'Hard rules — a reply that breaks any of them is discarded whole:',
    '- Exactly one complete HTML document (doctype through </html>), in one ```html fence.',
    '- Fully self-contained: ALL CSS and JS inline. No external URL of any kind —',
    '  no http:// or https://, no protocol-relative //, in src, href, CSS url(),',
    '  or @import. Inline SVG or data: URIs for imagery; #fragment links for nav.',
    '- Under ' + Math.floor(MAX_MOCKUP_BYTES / 1024) + ' KB total.',
    '- Honor the look words and token summary above: this screen should FEEL like',
    '  the design language, not a generic template.',
  ].join('\n');
}

// ---- the untrusted-reply contract -------------------------------------------
// Fence choice, documented (§ slice brief: "fence vs whole-reply — document
// the choice"): FENCED, like every other untrusted contract in this extension
// (suggest.js ```json, codesigner.js ```apex-studio). A whole-reply extraction
// would have to guess where prose ends and document begins; a fence makes the
// boundary the model's explicit claim, and anything outside it is ignored.
// Unlike codesigner's last-block-wins, MULTIPLE ```html fences are an error:
// the contract is "exactly one complete document", and picking one of two
// candidate documents would be the silent guess this discipline exists to
// refuse. Everything fails CLOSED: error + no html + (upstream) no file.
const HTML_FENCE_RE = /```html\s*\n([\s\S]*?)```/g;

// The static external-URL vectors, each with its own name so the error (and
// the drill) can prove every one individually. Anchored to their syntactic
// context — a bare "//" in a JS comment is NOT an external URL; one in a src
// attribute is. http(s):// and protocol-relative // are both rejected in
// every vector; data:, #fragment, and relative refs never match (that IS the
// allowlist: self-contained means inline or data:).
const URL_VECTORS = [
  ['src attribute', /\ssrc\s*=\s*(?:"\s*(?:https?:)?\/\/|'\s*(?:https?:)?\/\/|(?:https?:)?\/\/)/i],
  ['href attribute', /\shref\s*=\s*(?:"\s*(?:https?:)?\/\/|'\s*(?:https?:)?\/\/|(?:https?:)?\/\/)/i],
  ['CSS url()', /url\(\s*(?:"\s*(?:https?:)?\/\/|'\s*(?:https?:)?\/\/|(?:https?:)?\/\/)/i],
  ['@import', /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//i],
];

/** Scan one HTML document for the static external-URL vectors. Returns an
 *  array of violation names (empty = self-contained). Pure, never throws. */
function checkSelfContained(html) {
  const text = String(html || '');
  const violations = [];
  for (const [name, re] of URL_VECTORS)
    if (re.test(text)) violations.push('external URL in ' + name);
  return violations;
}

/** Strict contract over an untrusted LLM reply. Returns { html, error } —
 *  exactly one of them set. Never throws; every violation fails closed. */
function parseLlmReply(text) {
  const s = String(text || '');
  HTML_FENCE_RE.lastIndex = 0;
  const blocks = [];
  for (let m; (m = HTML_FENCE_RE.exec(s)) !== null;) blocks.push(m[1]);
  if (blocks.length === 0) return { html: null, error: 'no ```html fenced block in the reply' };
  if (blocks.length > 1)
    return { html: null, error: 'the reply carries ' + blocks.length + ' html blocks — the contract is exactly one complete document' };
  const html = blocks[0].trim();
  if (!/^<!doctype\s+html/i.test(html))
    return { html: null, error: 'the reply is not a complete HTML document (no doctype)' };
  if (!/<\/html\s*>\s*$/i.test(html))
    return { html: null, error: 'the reply is not a complete HTML document (no closing </html>)' };
  if (Buffer.byteLength(html, 'utf8') > MAX_MOCKUP_BYTES)
    return { html: null, error: 'the reply exceeds the ' + Math.floor(MAX_MOCKUP_BYTES / 1024) + ' KB mockup limit' };
  const violations = checkSelfContained(html);
  if (violations.length)
    return { html: null, error: 'the mockup is not self-contained: ' + violations.join(', ') };
  return { html, error: null };
}

// ---- the mockup store (draft-side files, drafts.js discipline) --------------
function mockupsRoot(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir))
    throw new Error('App Builder state directory must be absolute.');
  return path.join(stateDir, 'mockups');
}

function draftMockupsDir(stateDir, draftId) {
  if (typeof draftId !== 'string' || !ID_RE.test(draftId))
    throw new Error('Draft ID is invalid.');
  return path.join(mockupsRoot(stateDir), draftId);
}

// Same link guard as drafts.ensureDraftsDir: a linked dir could redirect
// writes outside the state tree; refuse it before any read or write. Applied
// at BOTH levels (mockups/ and mockups/<draftId>/).
function ensureDir(dir, create) {
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Mockup store must be a regular directory, not a link.');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    if (!create) return null;
    fs.mkdirSync(dir);
  }
  return dir;
}

function ensureDraftDir(stateDir, draftId, create) {
  const root = ensureDir(mockupsRoot(stateDir), create);
  if (!root) return null;
  return ensureDir(draftMockupsDir(stateDir, draftId), create);
}

function screenFile(stateDir, draftId, screenId, ext) {
  if (typeof screenId !== 'string' || screenId.length > MAX_SCREEN_ID || !SCREEN_ID_RE.test(screenId))
    throw new Error('Screen name must be lowercase kebab-case, at most ' + MAX_SCREEN_ID + ' characters.');
  // Both ids are regex-pinned (no dot, no separator), so traversal is
  // impossible by construction; the resolve check is belt-and-braces.
  const file = path.join(draftMockupsDir(stateDir, draftId), screenId + ext);
  if (path.dirname(file) !== draftMockupsDir(stateDir, draftId))
    throw new Error('Mockup path escapes the mockup store.');
  return file;
}

// drafts.js's crash-safety primitive, verbatim: exclusive-flag temp in the
// SAME dir, then atomic rename — a reader sees the old file or the new one,
// never a half-written mockup.
function atomicWriteFile(file, content) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
}

/** Persist one validated mockup + its provenance sidecar. `html` must already
 *  have passed parseLlmReply (this re-checks the caps anyway — the store
 *  refuses what the contract refuses, so no caller ordering bug can smuggle a
 *  violation to disk). Returns { file, provenance }. */
function writeMockup(stateDir, draftId, screen, html, canonicalHash) {
  const cleaned = cleanScreen(screen);
  if (typeof html !== 'string' || !html.trim())
    throw new Error('Mockup document is empty.');
  if (Buffer.byteLength(html, 'utf8') > MAX_MOCKUP_BYTES)
    throw new Error('Mockup exceeds the ' + Math.floor(MAX_MOCKUP_BYTES / 1024) + ' KB limit.');
  const violations = checkSelfContained(html);
  if (violations.length)
    throw new Error('Mockup is not self-contained: ' + violations.join(', '));
  if (typeof canonicalHash !== 'string' || !HASH_RE.test(canonicalHash))
    throw new Error('Mockup provenance requires the generating canonical hash.');
  ensureDraftDir(stateDir, draftId, true);
  const file = screenFile(stateDir, draftId, cleaned.id, '.html');
  const provenance = {
    schema: PROVENANCE_SCHEMA,
    screen: cleaned,
    canonicalHash,
    generatedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(html, 'utf8'),
  };
  atomicWriteFile(file, html);
  atomicWriteFile(screenFile(stateDir, draftId, cleaned.id, '.json'),
    JSON.stringify(provenance, null, 2) + '\n');
  return { file, provenance };
}

/** Read one screen's provenance record. Fail-soft: a missing, linked, or
 *  malformed sidecar reads as null (no provenance = not generated). */
function readProvenance(stateDir, draftId, screenId) {
  let file;
  try { file = screenFile(stateDir, draftId, screenId, '.json'); }
  catch { return null; }
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schema !== PROVENANCE_SCHEMA ||
        !parsed.screen || parsed.screen.id !== screenId ||
        typeof parsed.canonicalHash !== 'string' || !HASH_RE.test(parsed.canonicalHash))
      return null;
    if (!fs.existsSync(screenFile(stateDir, draftId, screenId, '.html'))) return null;
    return parsed;
  } catch { return null; }
}

/** The drift rule (§ Wave A): a mockup is STALE when its recorded generating
 *  canonical hash no longer matches the draft's approved canonical hash —
 *  i.e. the blueprint moved on after this screen was generated. A screen with
 *  no provenance is not stale (it is simply not generated); a draft with no
 *  preview leaves every generated mockup stale (its source of truth is gone).
 *  Never regenerates anything — a badge, not an action. */
function isMockupStale(stateDir, draft, screenId) {
  const record = readProvenance(stateDir, draft && draft.id, screenId);
  if (!record) return false;
  const currentHash = draft && draft.preview && draft.preview.generatedCanonicalHash;
  return record.canonicalHash !== currentHash;
}

/** Every generated screen for a draft, with its staleness bit. Fail-soft like
 *  drafts.listDrafts: one unreadable sidecar never takes the list down. */
function listMockups(stateDir, draft) {
  const draftId = draft && draft.id;
  let dir;
  try { dir = ensureDraftDir(stateDir, draftId, false); }
  catch { return []; }
  if (!dir) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const screenId = entry.name.slice(0, -5);
    const record = readProvenance(stateDir, draftId, screenId);
    if (!record) continue;
    out.push({
      screen: record.screen,
      canonicalHash: record.canonicalHash,
      generatedAt: record.generatedAt,
      bytes: record.bytes,
      stale: isMockupStale(stateDir, draft, screenId),
    });
  }
  out.sort((a, b) => a.screen.id.localeCompare(b.screen.id));
  return out;
}

// ---- mockup approval (slice A4) ---------------------------------------------
/** The approval drift rule, mirroring isMockupStale: an approval recorded on
 *  the draft (drafts.js's validated `mockupApproval` field) is CURRENT only
 *  while its recorded canonical hash still matches the draft's approved
 *  canonical hash. A blueprint move makes it stale (re-approve); a screen
 *  regeneration clears the field outright (main.js), so it never reaches this
 *  check. Pure over the draft — no disk read. */
function isApprovalCurrent(draft) {
  const approval = draft && draft.mockupApproval;
  if (!approval || !draft.preview) return false;
  return approval.canonicalHash === draft.preview.generatedCanonicalHash;
}

/** The Create-time copy list (§ Wave F/A package layout): the approved,
 *  still-current screens' html + provenance sidecar files. Empty unless the
 *  draft carries a CURRENT approval; within one, a screen whose provenance no
 *  longer matches the approved hash (or vanished) is skipped, fail-soft like
 *  listMockups — only approved, non-stale mockups ever enter a package. */
function collectApprovedMockups(stateDir, draft) {
  if (!isApprovalCurrent(draft)) return [];
  const out = [];
  for (const screenId of draft.mockupApproval.screens) {
    const record = readProvenance(stateDir, draft.id, screenId);
    if (!record || record.canonicalHash !== draft.mockupApproval.canonicalHash) continue;
    out.push({
      id: screenId,
      htmlFile: screenFile(stateDir, draft.id, screenId, '.html'),
      provenanceFile: screenFile(stateDir, draft.id, screenId, '.json'),
    });
  }
  return out;
}

/** Remove a draft's whole mockup dir — draft deletion's cleanup hook. The
 *  link guard runs first so a swapped-in symlink is refused, never recursed
 *  into. Missing dir is a no-op. */
function deleteDraftMockups(stateDir, draftId) {
  // Guard the ROOT first: with a file/link squatting at mockups/, the draft
  // dir's own lstat reads as ENOENT and the tampering would no-op silently.
  ensureDir(mockupsRoot(stateDir), false);
  const dir = draftMockupsDir(stateDir, draftId);
  let stat;
  try { stat = fs.lstatSync(dir); }
  catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error('Mockup store must be a regular directory, not a link.');
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = {
  MAX_MOCKUP_BYTES,
  MAX_SCREENS,
  SCREEN_ID_RE,
  MAX_SCREEN_ID,
  MAX_SCREEN_TITLE,
  MAX_SCREEN_PURPOSE,
  deriveScreens,
  cleanScreen,
  buildPrompt,
  checkSelfContained,
  parseLlmReply,
  mockupsRoot,
  draftMockupsDir,
  writeMockup,
  readProvenance,
  isMockupStale,
  listMockups,
  isApprovalCurrent,
  collectApprovedMockups,
  deleteDraftMockups,
};
