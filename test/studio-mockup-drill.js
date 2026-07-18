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
// The A4 core seam. Safe to require in plain node: main/bus.js's
// require('electron') resolves to the npm package's path string outside an
// Electron process, and nothing here calls the parts that need a window.
const artifacts = require('../main/artifacts');

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
  const serveCalls = { registered: [], revoked: [] };
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
    // A4: record exactly what the studio asks the served-file gate to admit.
    serve: {
      registerDir(token, dir) { serveCalls.registered.push({ token, dir }); },
      revokeDir(token) { serveCalls.revoked.push(token); },
    },
  });
  const screen = { id: 'home', title: 'Home', purpose: 'The main screen.' };
  return { stateDir, workspace, bus, controllers, draft, screen, serveCalls,
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

// ---------- A4: the served-file gate's directory seam (main/artifacts.js) ---
// The wave's one core touch, drilled against the REAL module: registration is
// scoped to exactly one directory's direct-child .html files; everything else
// — other paths, traversal, sidecars, subdirs, unregistered/revoked tokens —
// refuses, and the C2 exact-file behavior is untouched.
function serveHarness(tag) {
  const dir = path.join(scratch, tag, 'mockups', 'draft-a');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'home.html'), '<!doctype html><html></html>');
  fs.writeFileSync(path.join(dir, 'home.json'), '{}');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'inner.html'), '<!doctype html><html></html>');
  const outside = path.join(scratch, tag, 'outside.html');
  fs.writeFileSync(outside, 'secret');
  return { dir, outside };
}

gate('served-dir gate: registration admits exactly the dir\'s direct-child .html files', () => {
  const h = serveHarness('serve-scope');
  const file = path.join(h.dir, 'home.html');
  assert.equal(artifacts.isServed(file), false, 'nothing serves before registration');
  artifacts.registerServedDir('drill:serve-scope', h.dir);
  assert.equal(artifacts.isServed(file), true, 'a direct-child .html serves');
  // normalization: a path that wanders out and back still lands inside
  assert.equal(artifacts.isServed(path.join(h.dir, '..', 'draft-a', 'home.html')), true);
});

gate('served-dir gate: sidecars, subdirs, traversal, and other paths all refuse', () => {
  const h = serveHarness('serve-refuse');
  artifacts.registerServedDir('drill:serve-refuse', h.dir);
  assert.equal(artifacts.isServed(path.join(h.dir, 'home.json')), false, 'the provenance sidecar never serves');
  assert.equal(artifacts.isServed(path.join(h.dir, 'sub', 'inner.html')), false, 'subdirectories refuse');
  assert.equal(artifacts.isServed(path.join(h.dir, '..', '..', 'outside.html')), false, 'traversal past the root refuses');
  assert.equal(artifacts.isServed(h.outside), false, 'a sibling path refuses');
  assert.equal(artifacts.isServed(path.join(h.dir, 'missing.html')), false, 'a missing file refuses');
  assert.equal(artifacts.isServed(path.join(os.homedir(), '.ssh', 'id_rsa')), false, 'the C2 case still refuses');
});

gate('served-dir gate: revoke closes the door; bad registrations throw', () => {
  const h = serveHarness('serve-revoke');
  const file = path.join(h.dir, 'home.html');
  artifacts.registerServedDir('drill:serve-revoke', h.dir);
  assert.equal(artifacts.isServed(file), true);
  artifacts.revokeServedDir('drill:serve-revoke');
  assert.equal(artifacts.isServed(file), false, 'a revoked dir refuses again');
  assert.throws(() => artifacts.registerServedDir('', h.dir), /token/);
  assert.throws(() => artifacts.registerServedDir('drill:bad', 'relative/dir'), /absolute/);
});

gate('served-dir gate: a symlink parked inside a registered dir never serves its target', () => {
  const h = serveHarness('serve-link');
  artifacts.registerServedDir('drill:serve-link', h.dir);
  const link = path.join(h.dir, 'link.html');
  try { fs.symlinkSync(h.outside, link, 'file'); }
  catch { console.log('      (symlinks unavailable on this box — vector not constructible, skipped)'); return; }
  assert.equal(artifacts.isServed(link), false);
});

// ---------- A4: the studio registers EXACTLY the draft's mockups dir ---------
gate('the studio registers only the draft\'s own mockups dir and serves URIs from it', () => {
  const h = freshHarness('serve-ctx');
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC,
    h.draft.preview.generatedCanonicalHash);
  h.bus.handlers.get('projectsMockupList')({ id: h.draft.id });
  const expectedDir = path.join(h.stateDir, 'mockups', h.draft.id);
  assert.ok(h.serveCalls.registered.length >= 1);
  for (const call of h.serveCalls.registered) {
    assert.equal(call.token, 'studio-mockups:' + h.draft.id);
    assert.equal(call.dir, expectedDir, 'never a broader dir than the draft\'s own mockups');
  }
  const posted = h.bus.posts.find((p) => p.type === 'projectsMockupScreens').payload;
  assert.equal(posted.generated[0].uri,
    'apex://local/' + encodeURIComponent(path.join(expectedDir, 'home.html')));
});

gate('deleting a draft revokes its served-dir registration', () => {
  const h = freshHarness('serve-revoke-on-delete');
  h.bus.handlers.get('projectsDraftDelete')({ id: h.draft.id, confirmed: true });
  assert.deepEqual(h.serveCalls.revoked, ['studio-mockups:' + h.draft.id]);
});

// ---------- A4: APPROVE MOCKUPS — recording, staleness, invalidation ---------
gate('approve refuses when nothing up-to-date is generated', () => {
  const h = freshHarness('approve-empty');
  h.bus.handlers.get('projectsMockupApprove')({ id: h.draft.id, expectedRevision: h.draft.revision });
  const result = h.bus.posts.find((p) => p.type === 'projectsMockupApproveResult').payload;
  assert.equal(result.ok, false);
  assert.match(result.error, /no up-to-date mockup/);
});

gate('approve records {screens, canonicalHash} on the draft; validation warning clears', () => {
  const h = freshHarness('approve-happy');
  const hash = h.draft.preview.generatedCanonicalHash;
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC, hash);

  // Before approval: the review report carries the plain-language warning.
  h.bus.handlers.get('projectsPreviewValidate')({ id: h.draft.id });
  let report = h.bus.posts.find((p) => p.type === 'projectsValidationStatus').payload.report;
  assert.ok(report.warnings.some((w) => w.code === 'missing-mockups' && /approve/i.test(w.message)),
    JSON.stringify(report.warnings));

  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupApprove')({ id: h.draft.id, expectedRevision: h.draft.revision });
  const result = h.bus.posts.find((p) => p.type === 'projectsMockupApproveResult').payload;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.approval.screens, ['home']);
  assert.equal(result.approval.canonicalHash, hash);
  const onDisk = drafts.readDraft(h.stateDir, h.draft.id);
  assert.deepEqual(onDisk.mockupApproval.screens, ['home']);
  assert.equal(onDisk.mockupApproval.canonicalHash, hash);
  assert.equal(mockup.isApprovalCurrent(onDisk), true);
  const screens = h.bus.posts.find((p) => p.type === 'projectsMockupScreens').payload;
  assert.equal(screens.approvalCurrent, true);
  assert.ok(h.bus.posts.some((p) => p.type === 'projectsDraftPatched'), 'the fresh draft rides back');

  // After approval: the warning is gone (the package-to-be carries mockups/).
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsPreviewValidate')({ id: h.draft.id });
  report = h.bus.posts.find((p) => p.type === 'projectsValidationStatus').payload.report;
  assert.ok(!report.warnings.some((w) => w.code === 'missing-mockups'), JSON.stringify(report.warnings));
});

gate('a canonical move makes the approval stale; stale screens never enter a new approval', () => {
  const h = freshHarness('approve-stale');
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC,
    h.draft.preview.generatedCanonicalHash);
  h.bus.handlers.get('projectsMockupApprove')({ id: h.draft.id, expectedRevision: h.draft.revision });
  let draft = drafts.readDraft(h.stateDir, h.draft.id);
  assert.equal(mockup.isApprovalCurrent(draft), true);

  // The blueprint moves on: approval survives on the draft but reads stale.
  draft = drafts.updateDraft(h.stateDir, draft.id, draft.revision, {
    answers: { idea: 'A completely different idea now, long enough to reshape the canonical.' },
  });
  draft = drafts.updateDraft(h.stateDir, draft.id, draft.revision, {
    preview: blueprint.buildBundle(draft, 'snipersight'),
  });
  assert.equal(mockup.isApprovalCurrent(draft), false, 'hash moved — approval is stale');
  // The one generated screen is now stale too, so re-approve refuses.
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupApprove')({ id: draft.id, expectedRevision: draft.revision });
  const result = h.bus.posts.find((p) => p.type === 'projectsMockupApproveResult').payload;
  assert.equal(result.ok, false);
  assert.match(result.error, /no up-to-date mockup/);
});

gate('regenerating a screen clears the recorded approval outright', () => {
  const h = freshHarness('approve-regen');
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC,
    h.draft.preview.generatedCanonicalHash);
  h.bus.handlers.get('projectsMockupApprove')({ id: h.draft.id, expectedRevision: h.draft.revision });
  assert.ok(drafts.readDraft(h.stateDir, h.draft.id).mockupApproval);

  h.bus.handlers.get('projectsMockupPrepare')({ id: h.draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsMockupRun')({
    id: h.draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  const started = h.latestStarted();
  started.onEvent({ type: 'text', text: fence(VALID_DOC) });
  started.onEvent({ type: 'result', ok: true });
  assert.equal(drafts.readDraft(h.stateDir, h.draft.id).mockupApproval, null,
    'fresh pixels need fresh approval');
});

gate('drafts.validateMockupApproval fails closed on malformed shapes', () => {
  const hash = 'a'.repeat(64);
  const good = { screens: ['home'], canonicalHash: hash, approvedAt: new Date().toISOString() };
  assert.doesNotThrow(() => drafts.validateMockupApproval(good));
  assert.doesNotThrow(() => drafts.validateMockupApproval(null));
  const bads = [
    [], 'yes', { ...good, screens: [] }, { ...good, screens: ['../evil'] },
    { ...good, screens: ['home', 'home'] }, { ...good, canonicalHash: 'nope' },
    { ...good, approvedAt: 'not a date' }, { ...good, extra: true },
  ];
  for (const bad of bads)
    assert.throws(() => drafts.validateMockupApproval(bad), /invalid|unknown/i, JSON.stringify(bad));
});

// ---------- A4: the Create-time package copy ---------------------------------
gate('Create copies ONLY approved mockups (html + provenance) inside the atomic stage', () => {
  const h = freshHarness('create-copy');
  const hash = h.draft.preview.generatedCanonicalHash;
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC, hash);
  h.bus.handlers.get('projectsMockupApprove')({ id: h.draft.id, expectedRevision: h.draft.revision });
  const approvedDraft = drafts.readDraft(h.stateDir, h.draft.id);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsCreate')({
    id: approvedDraft.id, expectedRevision: approvedDraft.revision, confirmed: true,
  });
  const result = h.bus.posts.find((p) => p.type === 'projectsCreateResult').payload;
  assert.equal(result.ok, true, JSON.stringify(result));
  const dir = path.join(h.workspace, 'snipersight', 'mockups');
  assert.equal(fs.readFileSync(path.join(dir, 'home.html'), 'utf8'), VALID_DOC);
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, 'home.json'), 'utf8'));
  assert.equal(sidecar.canonicalHash, hash, 'provenance rides along — the proof of what these were built from');
  assert.ok(!result.warnings.some((w) => w.code === 'missing-mockups'), JSON.stringify(result.warnings));
});

gate('without a current approval, Create writes no mockups/ and validation warns', () => {
  const h = freshHarness('create-unapproved');
  // generated but never approved — it stays behind in draft state
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC,
    h.draft.preview.generatedCanonicalHash);
  const current = drafts.readDraft(h.stateDir, h.draft.id);
  h.bus.handlers.get('projectsCreate')({
    id: current.id, expectedRevision: current.revision, confirmed: true,
  });
  const result = h.bus.posts.find((p) => p.type === 'projectsCreateResult').payload;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(!fs.existsSync(path.join(h.workspace, 'snipersight', 'mockups')),
    'unapproved mockups stay behind');
  assert.ok(result.warnings.some((w) => w.code === 'missing-mockups'), JSON.stringify(result.warnings));
  assert.equal(mockup.collectApprovedMockups(h.stateDir, current).length, 0);
});

// ---------- A5: the annotate bridge — validatePickMessage is the drilled
// authority the renderer's mirror is held to. A hostile mockup page can post
// ANYTHING; everything below proves it cannot crash or spoof the studio.
const GOOD_PICK = {
  type: 'apex-mockup-pick',
  selector: '#hero > button.cta',
  text: 'Get started',
  bbox: { x: 12, y: 34.5, w: 120, h: 40 },
};

gate('validatePickMessage: a valid pick passes, REBUILT clean — unknown fields dropped', () => {
  const out = mockup.validatePickMessage(GOOD_PICK);
  assert.deepEqual(out, { kind: 'pick', selector: '#hero > button.cta',
    text: 'Get started', bbox: { x: 12, y: 34.5, w: 120, h: 40 } });
  const spoofed = mockup.validatePickMessage({
    ...GOOD_PICK,
    evil: 'payload', __proto__: { sneaky: true },
    bbox: { ...GOOD_PICK.bbox, extra: 'field' },
  });
  assert.deepEqual(Object.keys(spoofed).sort(), ['bbox', 'kind', 'selector', 'text'],
    'never a spread of the raw message');
  assert.deepEqual(Object.keys(spoofed.bbox).sort(), ['h', 'w', 'x', 'y']);
});

gate('validatePickMessage: wrong type / oversized / bad bbox all drop silently', () => {
  const drops = [
    { ...GOOD_PICK, type: 'apex-mockup-pick2' },
    { ...GOOD_PICK, type: 'seatCreate' },
    { selector: '#a', text: '', bbox: GOOD_PICK.bbox },                       // no type
    { ...GOOD_PICK, selector: 'x'.repeat(mockup.MAX_PICK_SELECTOR + 1) },    // oversized drops, never truncates
    { ...GOOD_PICK, selector: '' },
    { ...GOOD_PICK, selector: 42 },
    { ...GOOD_PICK, text: 'x'.repeat(mockup.MAX_PICK_TEXT + 1) },
    { ...GOOD_PICK, text: null },
    { ...GOOD_PICK, bbox: null },
    { ...GOOD_PICK, bbox: [12, 34, 120, 40] },
    { ...GOOD_PICK, bbox: { x: 12, y: 34, w: 120 } },                        // missing h
    { ...GOOD_PICK, bbox: { x: 12, y: 34, w: 120, h: NaN } },
    { ...GOOD_PICK, bbox: { x: Infinity, y: 34, w: 120, h: 40 } },
    { ...GOOD_PICK, bbox: { x: '12', y: 34, w: 120, h: 40 } },
  ];
  for (const raw of drops)
    assert.equal(mockup.validatePickMessage(raw), null, JSON.stringify(raw));
});

gate('validatePickMessage: never throws on garbage; cancel is the only other shape', () => {
  for (const junk of [null, undefined, '', 'hi', 42, true, [], [GOOD_PICK], () => {}])
    assert.doesNotThrow(() => assert.equal(mockup.validatePickMessage(junk), null, String(junk)));
  assert.deepEqual(mockup.validatePickMessage({ type: 'apex-mockup-pick-cancel' }), { kind: 'cancel' });
  assert.deepEqual(mockup.validatePickMessage({ type: 'apex-mockup-pick-cancel', evil: 1 }),
    { kind: 'cancel' }, 'a cancel carries nothing, whatever rode along');
});

gate('createPickLimiter: 10 picks/s pass, the flood drops, the next window recovers', () => {
  const allow = mockup.createPickLimiter();
  const t0 = 1000000;
  for (let i = 0; i < 10; i++) assert.equal(allow(t0 + i), true, 'pick ' + i + ' within budget');
  for (let i = 10; i < 200; i++) assert.equal(allow(t0 + i), false, 'flood pick ' + i + ' dropped');
  assert.equal(allow(t0 + 1000), true, 'a fresh window has a fresh budget');
});

// ---------- A5: the serve-time derived .annotate.html ------------------------
gate('deriveAnnotateHtml injects the picker; only complete documents derive', () => {
  const derived = mockup.deriveAnnotateHtml(VALID_DOC);
  assert.ok(derived.includes('apex-mockup-pick'), 'the pick message type is in the script');
  assert.ok(derived.includes('apex-mockup-pick-cancel'), 'the Esc cancel shape too');
  assert.match(derived, /<\/html>\s*$/i, 'still a complete document');
  assert.equal(derived.indexOf('Apex STUDIO annotate picker') >= 0, true);
  assert.throws(() => mockup.deriveAnnotateHtml('<!doctype html><body>truncated'), /complete HTML/);
  assert.throws(() => mockup.deriveAnnotateHtml(''), /complete HTML/);
});

gate('serve time writes the derived file beside a byte-identical pristine one', () => {
  const h = freshHarness('annotate-serve');
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC,
    h.draft.preview.generatedCanonicalHash);
  h.bus.handlers.get('projectsMockupList')({ id: h.draft.id });
  const dir = path.join(h.stateDir, 'mockups', h.draft.id);
  const derivedFile = path.join(dir, 'home.annotate.html');
  assert.ok(fs.existsSync(derivedFile), 'the derived file landed');
  assert.ok(fs.readFileSync(derivedFile, 'utf8').includes('apex-mockup-pick'));
  assert.equal(fs.readFileSync(path.join(dir, 'home.html'), 'utf8'), VALID_DOC,
    'the stored mockup stays PRISTINE — injection never mutates the hashed artifact');
  const posted = h.bus.posts.find((p) => p.type === 'projectsMockupScreens').payload;
  assert.equal(posted.generated.length, 1, 'the derivative is never listed as a screen');
  assert.equal(posted.generated[0].annotateUri,
    'apex://local/' + encodeURIComponent(derivedFile));
  assert.equal(posted.generated[0].uri,
    'apex://local/' + encodeURIComponent(path.join(dir, 'home.html')),
    'the pristine URI is unchanged');
});

gate('the annotate derivative can never ride into a package', () => {
  const h = freshHarness('annotate-package');
  const hash = h.draft.preview.generatedCanonicalHash;
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC, hash);
  // serve (writes the derivative), then approve + create — the real flow
  h.bus.handlers.get('projectsMockupList')({ id: h.draft.id });
  h.bus.handlers.get('projectsMockupApprove')({ id: h.draft.id, expectedRevision: h.draft.revision });
  const approvedDraft = drafts.readDraft(h.stateDir, h.draft.id);
  // collectApprovedMockups builds paths from SCREEN_ID_RE-pinned approval ids
  // — a dotted 'home.annotate' can never be one of them.
  for (const m of studio.mockup.collectApprovedMockups(h.stateDir, approvedDraft)) {
    assert.ok(!m.htmlFile.includes('.annotate'), m.htmlFile);
    assert.ok(!m.provenanceFile.includes('.annotate'), m.provenanceFile);
  }
  h.bus.handlers.get('projectsCreate')({
    id: approvedDraft.id, expectedRevision: approvedDraft.revision, confirmed: true,
  });
  const result = h.bus.posts.find((p) => p.type === 'projectsCreateResult').payload;
  assert.equal(result.ok, true, JSON.stringify(result));
  const packaged = fs.readdirSync(path.join(h.workspace, 'snipersight', 'mockups')).sort();
  assert.deepEqual(packaged, ['home.html', 'home.json'],
    'exactly the pristine html + provenance — no .annotate variant rode along');
});

// ---------- A5: note chips on the draft --------------------------------------
const GOOD_NOTE = { selector: '#hero > button.cta', text: 'Get started', note: 'Make this amber.' };

gate('drafts.validateMockupNotes fails closed on malformed shapes', () => {
  assert.doesNotThrow(() => drafts.validateMockupNotes(null));
  assert.doesNotThrow(() => drafts.validateMockupNotes({ home: [GOOD_NOTE] }));
  const bads = [
    [], 'yes', {},                                        // empty map must be null
    { home: [] },                                         // empty list must drop the key
    { home: GOOD_NOTE },                                  // not an array
    { '../evil': [GOOD_NOTE] },                           // unsafe screen id
    { 'UPPER': [GOOD_NOTE] },
    { home: Array.from({ length: 13 }, () => GOOD_NOTE) },// over the 12 cap
    { home: [{ ...GOOD_NOTE, extra: true }] },            // unknown field
    { home: [{ ...GOOD_NOTE, selector: '' }] },
    { home: [{ ...GOOD_NOTE, selector: 'x'.repeat(257) }] },
    { home: [{ ...GOOD_NOTE, text: 'x'.repeat(161) }] },
    { home: [{ ...GOOD_NOTE, note: '' }] },
    { home: [{ ...GOOD_NOTE, note: 'x'.repeat(501) }] },
    { home: [{ ...GOOD_NOTE, note: 42 }] },
    { home: [null] },
  ];
  for (const bad of bads)
    assert.throws(() => drafts.validateMockupNotes(bad), /invalid|unknown|must be|empty|too long/i,
      JSON.stringify(bad));
});

gate('projectsMockupNoteSave records notes under the revision gate; caps refuse', () => {
  const h = freshHarness('notes-save');
  h.bus.handlers.get('projectsMockupNoteSave')({
    id: h.draft.id, expectedRevision: h.draft.revision, screenId: 'home', notes: [GOOD_NOTE],
  });
  let result = h.bus.posts.find((p) => p.type === 'projectsMockupNoteResult').payload;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(h.bus.posts.some((p) => p.type === 'projectsDraftPatched'), 'the fresh draft rides back');
  let onDisk = drafts.readDraft(h.stateDir, h.draft.id);
  assert.deepEqual(onDisk.mockupNotes, { home: [GOOD_NOTE] }, 'notes survive restart on the draft');

  // a stale revision is a conflict, never a silent overwrite
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupNoteSave')({
    id: h.draft.id, expectedRevision: h.draft.revision, screenId: 'home', notes: [],
  });
  result = h.bus.posts.find((p) => p.type === 'projectsMockupNoteResult').payload;
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);

  // the 13th note refuses whole — capped, fail closed, draft untouched
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupNoteSave')({
    id: onDisk.id, expectedRevision: onDisk.revision, screenId: 'home',
    notes: Array.from({ length: 13 }, (_, i) => ({ ...GOOD_NOTE, note: 'note ' + i })),
  });
  result = h.bus.posts.find((p) => p.type === 'projectsMockupNoteResult').payload;
  assert.equal(result.ok, false);
  assert.deepEqual(drafts.readDraft(h.stateDir, h.draft.id).mockupNotes, { home: [GOOD_NOTE] });

  // an over-cap note body refuses too — never truncated into acceptance
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupNoteSave')({
    id: onDisk.id, expectedRevision: onDisk.revision, screenId: 'home',
    notes: [{ ...GOOD_NOTE, note: 'x'.repeat(501) }],
  });
  assert.equal(h.bus.posts.find((p) => p.type === 'projectsMockupNoteResult').payload.ok, false);

  // an empty list clears the screen's key; an empty map lands as null
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsMockupNoteSave')({
    id: onDisk.id, expectedRevision: onDisk.revision, screenId: 'home', notes: [],
  });
  assert.equal(h.bus.posts.find((p) => p.type === 'projectsMockupNoteResult').payload.ok, true);
  assert.equal(drafts.readDraft(h.stateDir, h.draft.id).mockupNotes, null);
});

gate('buildPrompt pins each note to its selector/text context; no notes, no section', () => {
  const base = {
    displayName: 'SniperSight',
    blueprint: draftLike({ idea: 'A trading layer.' }),
    tokensSummary: 'dark',
    kind: 'screens',
    screen: { id: 'home', title: 'Home', purpose: 'Main.' },
  };
  const plain = mockup.buildPrompt(base);
  assert.ok(!plain.includes('pinned notes'), 'no notes section without notes');
  const withNotes = mockup.buildPrompt({ ...base, notes: [
    GOOD_NOTE,
    { selector: 'div.card:nth-of-type(2)', text: '', note: 'Collapse this on mobile.' },
  ] });
  assert.ok(withNotes.includes('pinned notes'));
  assert.ok(withNotes.includes('- the element matching #hero > button.cta ("Get started"): Make this amber.'),
    'the exact pinned line shape');
  assert.ok(withNotes.includes('- the element matching div.card:nth-of-type(2) (no visible text): Collapse this on mobile.'));
});

// ---------- A5: regenerate-with-notes rides the NORMAL A3 verb ---------------
gate('a regen carries the screen\'s notes in the prompt; success consumes notes AND approval', () => {
  const h = freshHarness('notes-regen');
  const hash = h.draft.preview.generatedCanonicalHash;
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC, hash);
  h.bus.handlers.get('projectsMockupApprove')({ id: h.draft.id, expectedRevision: h.draft.revision });
  let draft = drafts.readDraft(h.stateDir, h.draft.id);
  h.bus.handlers.get('projectsMockupNoteSave')({
    id: draft.id, expectedRevision: draft.revision, screenId: 'home', notes: [GOOD_NOTE],
  });
  draft = drafts.readDraft(h.stateDir, h.draft.id);
  assert.ok(draft.mockupApproval && draft.mockupNotes, 'approved + annotated');

  h.bus.handlers.get('projectsMockupPrepare')({ id: draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsMockupRun')({
    id: draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  const started = h.latestStarted();
  assert.ok(started.kickoff.includes('- the element matching #hero > button.cta ("Get started"): Make this amber.'),
    'the regen prompt carries the note pinned to its element');

  started.onEvent({ type: 'text', text: fence(VALID_DOC) });
  started.onEvent({ type: 'result', ok: true });
  const after = drafts.readDraft(h.stateDir, h.draft.id);
  assert.equal(after.mockupApproval, null, 'fresh pixels need fresh approval (A4, still holding)');
  assert.equal(after.mockupNotes, null, 'consumed notes clear on success');
});

gate('a FAILED regen leaves the notes (and approval) untouched — retry without retyping', () => {
  const h = freshHarness('notes-regen-fail');
  const hash = h.draft.preview.generatedCanonicalHash;
  mockup.writeMockup(h.stateDir, h.draft.id, h.screen, VALID_DOC, hash);
  h.bus.handlers.get('projectsMockupApprove')({ id: h.draft.id, expectedRevision: h.draft.revision });
  let draft = drafts.readDraft(h.stateDir, h.draft.id);
  h.bus.handlers.get('projectsMockupNoteSave')({
    id: draft.id, expectedRevision: draft.revision, screenId: 'home', notes: [GOOD_NOTE],
  });
  draft = drafts.readDraft(h.stateDir, h.draft.id);

  h.bus.handlers.get('projectsMockupPrepare')({ id: draft.id, screen: h.screen });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsMockupRun')({
    id: draft.id, screen: h.screen, expectedRevision: prepared.revision, approved: true,
  });
  const started = h.latestStarted();
  started.onEvent({ type: 'text', text: fence(inject('<img src="https://evil.example/x.png">')) });
  started.onEvent({ type: 'result', ok: true });
  const after = drafts.readDraft(h.stateDir, h.draft.id);
  assert.deepEqual(after.mockupNotes, { home: [GOOD_NOTE] }, 'notes survive a failed turn');
  assert.ok(after.mockupApproval, 'no new pixels landed — the recorded approval stands');
});

console.log('\nSTUDIO MOCKUP DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
