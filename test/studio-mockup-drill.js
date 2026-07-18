// App Builder — headless drill for the mockup pass (STUDIO v2, Wave A slice
// A3): lib/mockup.js's deterministic screen derivation, prompt builder, and
// the one-HTML-document untrusted-reply contract (every external-URL vector
// individually proven, oversize/non-HTML/missing-fence fail closed), the
// draft-side mockup store's provenance/staleness discipline, plus the
// prepare -> approve/run -> result bus wiring's preflight/TTL/single-flight/
// backstop state machine — driven exactly like test/studio-suggest-drill.js:
// a fake bus + a stubbed ctx.seats.startDisposable, zero real LLM spend.
// Run: node test/studio-mockup-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockup = require('../extensions/studio/lib/mockup');
const blueprint = require('../extensions/studio/lib/blueprint');
const studio = require('../extensions/studio/main');
const drafts = require('../extensions/studio/lib/drafts');
const modelPicker = require('../extensions/studio/lib/modelPicker');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-mockup-'));
let passed = 0, failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
}

function fakeBus() {
  const handlers = new Map();
  const posts = [];
  return {
    handlers, posts,
    on(type, fn) { handlers.set(type, fn); },
    post(type, payload) { posts.push({ type, payload }); },
  };
}

// A complete, legal, self-contained document — including the shapes the
// contract must NOT flag: a data: URI, a #fragment link, a relative href,
// and a JS line comment whose "//" is not an external URL.
const VALID_DOC = [
  '<!doctype html>',
  '<html><head><meta charset="utf-8"><title>Home</title>',
  '<style>body { background: #0f1115; color: #e6e9ee; } .hero { background-image: url(#grad); }</style>',
  '</head><body>',
  '<a href="#main">skip</a><a href="other.html">relative is fine</a>',
  '<img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22a%22%2F%3E" alt="">',
  '<script>// a comment with // double slashes is not a URL\nconst x = 1;</script>',
  '</body></html>',
].join('\n');

const fence = (doc) => 'Here is the mockup:\n```html\n' + doc + '\n```\nDone.';

// ---------- screen derivation (deterministic, platform-adaptive) ------------
const draftLike = (answers) => {
  const bp = {};
  for (const [k, v] of Object.entries(answers)) bp[k] = { response: v };
  return bp;
};

gate('web/desktop platform derives screens, home always first', () => {
  const out = mockup.deriveScreens(draftLike({ platform: 'Windows desktop first (Electron or Tauri).' }));
  assert.equal(out.kind, 'screens');
  assert.equal(out.screens[0].id, 'home');
});

gate('auth/dashboard/settings screens appear only when the blueprint mentions them', () => {
  const bare = mockup.deriveScreens(draftLike({ platform: 'web' }));
  assert.deepEqual(bare.screens.map((s) => s.id), ['home']);
  const rich = mockup.deriveScreens(draftLike({
    platform: 'A web app.',
    scope: 'Users sign in with a password; a dashboard of metrics; a settings page for channels.',
  }));
  assert.deepEqual(rich.screens.map((s) => s.id), ['home', 'auth', 'dashboard', 'settings']);
});

gate('a CLI platform derives terminal storyboard frames', () => {
  const out = mockup.deriveScreens(draftLike({
    platform: 'A command-line tool, runs in the terminal.',
    delivery: 'Clear error output when a feed fails.',
  }));
  assert.equal(out.kind, 'cli');
  assert.deepEqual(out.screens.map((s) => s.id), ['invocation', 'session', 'errors']);
});

gate('an API platform derives the single endpoint-map page', () => {
  const out = mockup.deriveScreens(draftLike({ platform: 'A REST API service, headless.' }));
  assert.equal(out.kind, 'api');
  assert.deepEqual(out.screens.map((s) => s.id), ['endpoints']);
});

gate('an explicit UI word outranks cli/api words (documented precedence)', () => {
  const out = mockup.deriveScreens(draftLike({ platform: 'A web dashboard over a REST api.' }));
  assert.equal(out.kind, 'screens');
});

gate('no platform answer defaults to screens; derivation is deterministic', () => {
  const empty = mockup.deriveScreens(draftLike({}));
  assert.equal(empty.kind, 'screens');
  assert.deepEqual(empty.screens.map((s) => s.id), ['home']);
  const a = mockup.deriveScreens(draftLike({ platform: 'web', scope: 'login and settings' }));
  const b = mockup.deriveScreens(draftLike({ platform: 'web', scope: 'login and settings' }));
  assert.deepEqual(a, b);
});

// ---------- the prompt builder ----------------------------------------------
gate('prompt carries digest, look, tokens summary, and ONE screen purpose', () => {
  const bp = draftLike({
    idea: 'A trading-intelligence layer.',
    look: 'Dark, one amber accent, dense and calm.',
  });
  const prompt = mockup.buildPrompt({
    displayName: 'SniperSight',
    blueprint: bp,
    tokensSummary: 'Dark surfaces with an amber accent; technical type.',
    kind: 'screens',
    screen: { id: 'home', title: 'Home', purpose: 'The ranked setup list.' },
  });
  assert.ok(prompt.includes('SniperSight'));
  assert.ok(prompt.includes('trading-intelligence layer'));
  assert.ok(prompt.includes('Dark, one amber accent'));
  assert.ok(prompt.includes('amber accent; technical type'));
  assert.ok(prompt.includes('The ranked setup list.'));
  assert.ok(prompt.includes('```html'));
});

gate('prompt builder rejects an invalid screen descriptor', () => {
  assert.throws(() => mockup.buildPrompt({
    blueprint: {}, tokensSummary: '', kind: 'screens', screen: { id: '../evil' },
  }), /kebab-case/);
});

// ---------- the untrusted-reply contract -------------------------------------
gate('a valid fenced document parses; allowed refs (data:, #fragment, relative) pass', () => {
  const out = mockup.parseLlmReply(fence(VALID_DOC));
  assert.equal(out.error, null);
  assert.ok(out.html.startsWith('<!doctype html>'));
  assert.deepEqual(mockup.checkSelfContained(VALID_DOC), []);
});

// Every static external-URL vector, individually: absolute http, absolute
// https, and protocol-relative //, in src / href / CSS url() / @import.
const inject = (payload) => VALID_DOC.replace('</body>', payload + '</body>');
const HOSTILE_VECTORS = [
  ['img src https', inject('<img src="https://evil.example/x.png">'), 'src'],
  ['script src http', inject('<script src="http://evil.example/x.js"></script>'), 'src'],
  ['img src protocol-relative', inject('<img src="//evil.example/x.png">'), 'src'],
  ['unquoted src protocol-relative', inject('<img src=//evil.example/x.png>'), 'src'],
  ['link href https', VALID_DOC.replace('<head>', '<head><link rel="stylesheet" href="https://evil.example/x.css">'), 'href'],
  ['a href protocol-relative', inject('<a href="//evil.example/page">go</a>'), 'href'],
  ["single-quoted href http", inject("<a href='http://evil.example'>go</a>"), 'href'],
  ['CSS url() https', VALID_DOC.replace('</style>', '.x { background: url(https://evil.example/x.png); }</style>'), 'url()'],
  ["CSS url('//…')", VALID_DOC.replace('</style>', ".x { background: url('//evil.example/x.png'); }</style>"), 'url()'],
  ['@import url(https)', VALID_DOC.replace('<style>', '<style>@import url(https://evil.example/x.css);'), '@import'],
  ['@import "https…"', VALID_DOC.replace('<style>', '<style>@import "https://evil.example/x.css";'), '@import'],
];
for (const [name, doc, vector] of HOSTILE_VECTORS) {
  gate('external URL rejected — ' + name, () => {
    const violations = mockup.checkSelfContained(doc);
    assert.ok(violations.length, 'checkSelfContained flags the document');
    assert.ok(violations.join(' ').includes(vector), 'names the ' + vector + ' vector');
    const out = mockup.parseLlmReply(fence(doc));
    assert.equal(out.html, null, 'no html escapes the parser');
    assert.match(out.error, /not self-contained/);
  });
}

gate('an oversized reply fails closed', () => {
  const big = VALID_DOC.replace('</body>', '<p>' + 'x'.repeat(mockup.MAX_MOCKUP_BYTES) + '</p></body>');
  const out = mockup.parseLlmReply(fence(big));
  assert.equal(out.html, null);
  assert.match(out.error, /exceeds/);
});

gate('a non-HTML reply fails closed (fenced non-document, and no fence at all)', () => {
  const notDoc = mockup.parseLlmReply('```html\n{ "not": "a document" }\n```');
  assert.equal(notDoc.html, null);
  assert.match(notDoc.error, /no doctype/);
  const unclosed = mockup.parseLlmReply('```html\n<!doctype html>\n<html><body>truncated\n```');
  assert.equal(unclosed.html, null);
  assert.match(unclosed.error, /closing <\/html>/);
  const jsonOnly = mockup.parseLlmReply('```json\n{"suggestions":[]}\n```');
  assert.equal(jsonOnly.html, null);
  assert.match(jsonOnly.error, /no ```html fenced block/);
});

gate('a missing fence fails closed even when the reply IS a bare document', () => {
  const out = mockup.parseLlmReply(VALID_DOC);
  assert.equal(out.html, null);
  assert.match(out.error, /no ```html fenced block/);
});

gate('two html fences fail closed — the contract is exactly one document', () => {
  const out = mockup.parseLlmReply(fence(VALID_DOC) + '\n' + fence(VALID_DOC));
  assert.equal(out.html, null);
  assert.match(out.error, /exactly one/);
});

gate('the parser never throws on garbage', () => {
  for (const junk of ['', null, undefined, 42, { weird: true }, '```html\n```'])
    assert.doesNotThrow(() => mockup.parseLlmReply(junk));
});

// ---------- the mockup store: provenance, staleness, containment -------------
function storeHarness(tag) {
  const stateDir = path.join(scratch, tag + '-state');
  const workspace = path.join(scratch, tag + '-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  let draft = drafts.createDraft(stateDir, workspace, { name: 'SniperSight', pitch: 'Scores entries.' });
  draft = drafts.updateDraft(stateDir, draft.id, draft.revision, {
    answers: { idea: 'A trading-intelligence layer that scores liquidity sweeps.', platform: 'Windows desktop (Electron).' },
  });
  const bundle = blueprint.buildBundle(draft, 'snipersight');
  draft = drafts.updateDraft(stateDir, draft.id, draft.revision, { preview: bundle });
  return { stateDir, workspace, draft };
}

gate('writeMockup lands the html + provenance sidecar under the draft store', () => {
  const h = storeHarness('store-write');
  const hash = h.draft.preview.generatedCanonicalHash;
  const { file, provenance } = mockup.writeMockup(h.stateDir, h.draft.id,
    { id: 'home', title: 'Home', purpose: 'Main screen.' }, VALID_DOC, hash);
  assert.equal(file, path.join(h.stateDir, 'mockups', h.draft.id, 'home.html'));
  assert.equal(fs.readFileSync(file, 'utf8'), VALID_DOC);
  assert.equal(provenance.canonicalHash, hash);
  const sidecar = JSON.parse(fs.readFileSync(path.join(h.stateDir, 'mockups', h.draft.id, 'home.json'), 'utf8'));
  assert.equal(sidecar.canonicalHash, hash);
  assert.equal(sidecar.screen.id, 'home');
});

gate('a blueprint change flips isMockupStale true — a badge, never a regen', () => {
  const h = storeHarness('store-stale');
  mockup.writeMockup(h.stateDir, h.draft.id, { id: 'home', title: 'Home', purpose: '' },
    VALID_DOC, h.draft.preview.generatedCanonicalHash);
  assert.equal(mockup.isMockupStale(h.stateDir, h.draft, 'home'), false);
  assert.equal(mockup.listMockups(h.stateDir, h.draft)[0].stale, false);

  let draft = drafts.updateDraft(h.stateDir, h.draft.id, h.draft.revision, {
    answers: { idea: 'Completely different idea now.' },
  });
  draft = drafts.updateDraft(h.stateDir, draft.id, draft.revision, {
    preview: blueprint.buildBundle(draft, 'snipersight'),
  });
  assert.equal(mockup.isMockupStale(h.stateDir, draft, 'home'), true);
  const listed = mockup.listMockups(h.stateDir, draft);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].stale, true);
  assert.equal(fs.readFileSync(path.join(h.stateDir, 'mockups', draft.id, 'home.html'), 'utf8'),
    VALID_DOC, 'the stale file is untouched — nothing regenerates silently');
});

gate('an ungenerated screen is not stale; a missing store lists empty', () => {
  const h = storeHarness('store-empty');
  assert.equal(mockup.isMockupStale(h.stateDir, h.draft, 'home'), false);
  assert.deepEqual(mockup.listMockups(h.stateDir, h.draft), []);
});

gate('the store refuses what the contract refuses — no file on any violation', () => {
  const h = storeHarness('store-refuse');
  const hash = h.draft.preview.generatedCanonicalHash;
  const hostile = inject('<img src="https://evil.example/x.png">');
  assert.throws(() => mockup.writeMockup(h.stateDir, h.draft.id,
    { id: 'home', title: 'Home', purpose: '' }, hostile, hash), /not self-contained/);
  assert.throws(() => mockup.writeMockup(h.stateDir, h.draft.id,
    { id: 'home', title: 'Home', purpose: '' }, VALID_DOC, 'not-a-hash'), /canonical hash/);
  for (const bad of ['../evil', 'UPPER', 'has space', '..', 'a'.repeat(80)])
    assert.throws(() => mockup.writeMockup(h.stateDir, h.draft.id,
      { id: bad, title: 'x', purpose: '' }, VALID_DOC, hash), /kebab-case/);
  assert.ok(!fs.existsSync(path.join(h.stateDir, 'mockups', h.draft.id, 'home.html')));
});

gate('a non-directory (or linked) mockup store is refused, never written through', () => {
  const h = storeHarness('store-link');
  fs.writeFileSync(path.join(h.stateDir, 'mockups'), 'not a directory');
  assert.throws(() => mockup.writeMockup(h.stateDir, h.draft.id,
    { id: 'home', title: 'Home', purpose: '' }, VALID_DOC, h.draft.preview.generatedCanonicalHash),
    /regular directory/);
  assert.throws(() => mockup.deleteDraftMockups(h.stateDir, h.draft.id), /regular directory/);
});

gate('deleteDraftMockups removes the draft dir; a missing dir is a no-op', () => {
  const h = storeHarness('store-delete');
  mockup.writeMockup(h.stateDir, h.draft.id, { id: 'home', title: 'Home', purpose: '' },
    VALID_DOC, h.draft.preview.generatedCanonicalHash);
  const dir = path.join(h.stateDir, 'mockups', h.draft.id);
  assert.ok(fs.existsSync(dir));
  mockup.deleteDraftMockups(h.stateDir, h.draft.id);
  assert.ok(!fs.existsSync(dir));
  assert.doesNotThrow(() => mockup.deleteDraftMockups(h.stateDir, h.draft.id));
});

// ---------- main.js bus wiring: preflight, TTL, approval, single-flight,
// backstop, launch passthrough — verb-for-verb the suggest pass's machine.
function freshHarness(tag, { withPick, withPreview = true } = {}) {
  const stateDir = path.join(scratch, tag + '-bus-state');
  const workspace = path.join(scratch, tag + '-bus-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  studio.writeWorkspaceConfig(stateDir, workspace);
  if (withPick) modelPicker.writeModelPick(stateDir, withPick);

  let draft = drafts.createDraft(stateDir, workspace, { name: 'SniperSight', pitch: 'Scores entries.' });
  draft = drafts.updateDraft(stateDir, draft.id, draft.revision, {
    answers: {
      idea: 'A trading-intelligence layer that scores liquidity sweeps.',
      platform: 'Windows desktop (Electron).',
      look: 'Dark, one amber accent, dense and calm.',
    },
  });
  if (withPreview) {
    draft = drafts.updateDraft(stateDir, draft.id, draft.revision, {
      preview: blueprint.buildBundle(draft, 'snipersight'),
    });
  }

  const bus = fakeBus();
  const controllers = [];
  let started = null;
  studio.register({
    bus, stateDir,
    async pickDirectory() { return null; },
    usage: { claudeSnapshot() { return { session: { pct: 5 }, weekly: { pct: 12 }, stale: false, asOf: Date.now() }; } },
    seats: { startDisposable(options) {
      started = options;
      const controller = { closed: false, close() { this.closed = true; } };
      controllers.push(controller);
      return controller;
    } },
  });
  const screen = { id: 'home', title: 'Home', purpose: 'The main screen.' };
  return { stateDir, workspace, bus, controllers, draft, screen,
           latestStarted: () => started };
}

gate('projectsMockupList posts the derived proposal + generated inventory', () => {
  const h = freshHarness('list');
  h.bus.handlers.get('projectsMockupList')({ id: h.draft.id });
  const posted = h.bus.posts.find((p) => p.type === 'projectsMockupScreens').payload;
  assert.equal(posted.error, null);
  assert.equal(posted.kind, 'screens');
  assert.deepEqual(posted.proposed.map((s) => s.id), ['home']);
  assert.deepEqual(posted.generated, []);
  assert.equal(posted.hasPreview, true);
});

gate('prepare without a canonical preview is refused — mockups need the approved blueprint', () => {
  const h = freshHarness('no-preview', { withPreview: false });
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const status = h.bus.posts.find((p) => p.type === 'projectsMockupStatus').payload;
  assert.equal(status.phase, 'error');
  assert.match(status.error, /canonical preview first/);
});

gate('run without approved:true is rejected — the pass never runs unattended', () => {
  const h = freshHarness('unapproved');
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  assert.equal(prepared.requiresApproval, true);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: false,
  });
  assert.equal(h.controllers.length, 0, 'no disposable was started');
  assert.match(h.bus.posts.at(-1).payload.error, /explicit approval/);
});

gate('prepare -> approve -> run drives one disposable turn and writes the validated file', () => {
  const h = freshHarness('happy');
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  assert.equal(prepared.usage.session.pct, 5);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.bus.posts.at(-1).payload.phase, 'running');
  const started = h.latestStarted();
  assert.ok(started.kickoff.includes('trading-intelligence layer'), 'prompt carries the blueprint digest');
  assert.ok(started.kickoff.includes('The main screen.'), 'prompt carries the one screen purpose');
  assert.ok(started.kickoff.includes('amber accent'), 'prompt carries the A2 tokens summary / look');
  assert.equal(started.launch, undefined, 'no model pick yet — omitted, byte-identical to legacy');

  h.bus.posts.length = 0;
  started.onEvent({ type: 'text', text: fence(VALID_DOC) });
  started.onEvent({ type: 'result', ok: true });
  const result = h.bus.posts.find((p) => p.type === 'projectsMockupResult').payload;
  assert.equal(result.error, null);
  assert.equal(result.ok, true);
  const file = path.join(h.stateDir, 'mockups', h.draft.id, 'home.html');
  assert.equal(result.file, file);
  assert.equal(fs.readFileSync(file, 'utf8'), VALID_DOC);
  const sidecar = JSON.parse(fs.readFileSync(path.join(h.stateDir, 'mockups', h.draft.id, 'home.json'), 'utf8'));
  assert.equal(sidecar.canonicalHash, h.draft.preview.generatedCanonicalHash,
    'provenance carries the generating canonical hash');
  assert.equal(h.controllers[0].closed, true, 'done() always closes the seat');
  const refreshed = h.bus.posts.find((p) => p.type === 'projectsMockupScreens').payload;
  assert.equal(refreshed.generated.length, 1);
  assert.equal(refreshed.generated[0].stale, false);
});

gate('a hostile reply is an error + NO file — fail closed end to end', () => {
  const h = freshHarness('hostile');
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  h.bus.posts.length = 0;
  const started = h.latestStarted();
  started.onEvent({ type: 'text', text: fence(inject('<script src="https://evil.example/x.js"></script>')) });
  started.onEvent({ type: 'result', ok: true });
  const result = h.bus.posts.find((p) => p.type === 'projectsMockupResult').payload;
  assert.match(result.error, /not self-contained/);
  assert.equal(result.ok, false);
  assert.ok(!fs.existsSync(path.join(h.stateDir, 'mockups', h.draft.id, 'home.html')),
    'no file landed');
});

gate('an expired prepare (past the TTL) is rejected at run, never silently reused', () => {
  const h = freshHarness('ttl');
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  const originalNow = Date.now;
  Date.now = () => originalNow() + 6 * 60 * 1000;   // TTL is 5 minutes
  try {
    h.bus.posts.length = 0;
    h.bus.handlers.get('projectsMockupRun')({
      id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
    });
  } finally { Date.now = originalNow; }
  assert.equal(h.controllers.length, 0);
  assert.match(h.bus.posts.at(-1).payload.error, /expired/);
});

gate('a stale prepare (draft revision moved on) is rejected at run', () => {
  const h = freshHarness('stale-revision');
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  drafts.updateDraft(h.stateDir, h.draft.id, h.draft.revision, { answers: { idea: 'Changed my mind entirely.' } });
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.controllers.length, 0);
  assert.match(h.bus.posts.at(-1).payload.error, /[Pp]repare the mockup pass again/);
});

gate('only one mockup pass runs at a time', () => {
  const h = freshHarness('single-flight');
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  let prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.controllers.length, 1);   // first pass now active, unresolved

  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  prepared = h.bus.posts.at(-1).payload;
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.controllers.length, 1, 'a second pass did not start while one is active');
  assert.match(h.bus.posts.at(-1).payload.error, /already running/);
});

gate('a dead seat resolves to an error result, never hangs the caller', () => {
  const h = freshHarness('dead-seat');
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  h.bus.posts.length = 0;
  h.latestStarted().onEvent({ type: 'dead' });
  const result = h.bus.posts.find((p) => p.type === 'projectsMockupResult').payload;
  assert.ok(result.error);
  assert.equal(h.controllers.at(-1).closed, true);
});

gate('the backstop force-finishes with an error if the seat never answers', () => {
  const h = freshHarness('backstop');
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;

  const originalSetTimeout = global.setTimeout;
  let backstopFn = null;
  global.setTimeout = (fn, ms) => { backstopFn = fn; return 0; };
  try {
    h.bus.handlers.get('projectsMockupRun')({
      id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
    });
  } finally { global.setTimeout = originalSetTimeout; }
  assert.ok(typeof backstopFn === 'function', 'a backstop timer was armed');

  h.bus.posts.length = 0;
  backstopFn();   // simulate the timer firing — the seat never emitted 'result'/'dead'
  const result = h.bus.posts.find((p) => p.type === 'projectsMockupResult').payload;
  assert.match(result.error, /timed out/);
  assert.equal(h.controllers.at(-1).closed, true);
});

gate('a persisted model pick rides the disposable as launch.{model,effort}', () => {
  const h = freshHarness('with-pick', { withPick: { model: 'sonnet', effort: 'high' } });
  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  assert.deepEqual(h.latestStarted().launch, { model: 'sonnet', effort: 'high' });
});

gate('deleting a draft over the bus cleans its mockup files too', () => {
  const h = freshHarness('bus-delete');
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC,
    h.draft.preview.generatedCanonicalHash);
  const dir = path.join(h.stateDir, 'mockups', h.draft.id);
  assert.ok(fs.existsSync(dir));
  h.bus.handlers.get('projectsDraftDelete')({ id: h.draft.id, confirmed: true });
  const result = h.bus.posts.find((p) => p.type === 'projectsDraftResult').payload;
  assert.equal(result.ok, true);
  assert.ok(!fs.existsSync(dir), 'the draft\'s mockup dir died with the draft');
});

console.log('\nSTUDIO MOCKUP DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
