// App Builder — headless drill for the per-card AI suggest pass (slice 6):
// lib/suggest.js's untrusted-reply parser + prompt builder as pure functions,
// plus the prepare -> approve/run -> result bus wiring's preflight/TTL/
// single-flight/backstop state machine, driven the same way
// test/persona-extension.js drives personaTestPrepare/personaRelSuggestLlm —
// a fake bus + a stubbed ctx.seats.startDisposable, zero real LLM spend.
// Run: node test/studio-suggest-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const suggest = require('../extensions/studio/lib/suggest');
const studio = require('../extensions/studio/main');
const drafts = require('../extensions/studio/lib/drafts');
const modelPicker = require('../extensions/studio/lib/modelPicker');
const { CARDS } = require('../extensions/studio/lib/interview');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-suggest-'));
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

const wrap = (obj) => 'Here:\n```json\n' + JSON.stringify(obj) + '\n```';

// ---------- suggest.js: pure prompt builder ----------
gate('prompt builder carries the card, the answer, and existing project digests', () => {
  const card = { title: 'The idea', question: 'What is this thing, and why now?' };
  const prompt = suggest.buildPrompt(card, 'A trading tool.', [{ id: 'other-app', text: 'A CLI dashboard.' }]);
  assert.ok(prompt.includes('The idea'));
  assert.ok(prompt.includes('What is this thing'));
  assert.ok(prompt.includes('A trading tool.'));
  assert.ok(prompt.includes('other-app'));
  assert.ok(prompt.includes('A CLI dashboard.'));
  assert.ok(prompt.includes('```json'));
});

gate('prompt builder handles an empty answer and no sibling projects', () => {
  const card = { title: 'Scope', question: 'What does v1 do?' };
  const prompt = suggest.buildPrompt(card, '', []);
  assert.ok(prompt.includes('(nothing written yet)'));
  assert.ok(prompt.includes('(none yet)'));
});

// ---------- suggest.js: untrusted reply parser ----------
gate('a valid reply parses correctly', () => {
  const out = suggest.parseLlmReply(wrap({ suggestions: ['Name the user.', 'Add a why-now line.'] }));
  assert.equal(out.error, null);
  assert.deepEqual(out.suggestions, ['Name the user.', 'Add a why-now line.']);
});

gate('an oversized reply is capped, not rejected', () => {
  const many = Array.from({ length: 40 }, (_, i) => 'suggestion ' + i);
  const out = suggest.parseLlmReply(wrap({ suggestions: many }));
  assert.equal(out.error, null);
  assert.equal(out.suggestions.length, suggest.MAX_SUGGESTIONS);
  const long = suggest.parseLlmReply(wrap({ suggestions: ['x'.repeat(999)] }));
  assert.equal(long.suggestions[0].length, suggest.TEXT_CAP);
});

gate('a hostile reply drops unknown fields, wrong types, and nested junk cleanly', () => {
  const out = suggest.validateSuggestions({
    suggestions: [
      'A real suggestion.',
      42,                                  // wrong type — dropped
      { nested: 'junk' },                  // wrong type — dropped
      ['array', 'in', 'array'],             // wrong type — dropped
      '   ',                                // blank after trim — dropped
      null,
      undefined,
    ],
    // unexpected top-level fields never read by the parser
    patches: [{ card: 'scope', field: 'x', proposal: 'evil' }],
    cwd: 'C:\\evil', permissionMode: 'bypassPermissions', __proto__: { polluted: true },
  });
  assert.deepEqual(out, ['A real suggestion.']);
});

gate('non-JSON, missing-block, and empty replies fail closed — never throw', () => {
  assert.doesNotThrow(() => suggest.parseLlmReply(''));
  assert.doesNotThrow(() => suggest.parseLlmReply('no fenced block anywhere'));
  assert.doesNotThrow(() => suggest.parseLlmReply('```json\n{not valid json\n```'));
  assert.doesNotThrow(() => suggest.parseLlmReply(undefined));
  assert.doesNotThrow(() => suggest.parseLlmReply({ weird: true }));

  const empty = suggest.parseLlmReply('');
  assert.equal(empty.suggestions.length, 0);
  assert.ok(empty.error);

  const noBlock = suggest.parseLlmReply('The model just talked instead of replying with JSON.');
  assert.equal(noBlock.suggestions.length, 0);
  assert.ok(noBlock.error);

  const badJson = suggest.parseLlmReply('```json\n{not valid json\n```');
  assert.equal(badJson.suggestions.length, 0);
  assert.ok(badJson.error);

  // a reply that IS a fenced block but whose payload is not the expected
  // shape (an array, not an object with `.suggestions`) still fails closed
  const wrongShape = suggest.parseLlmReply(wrap(['just', 'an', 'array']));
  assert.equal(wrongShape.suggestions.length, 0);
  assert.equal(wrongShape.error, null);   // valid JSON, just carries nothing usable
});

// ---------- main.js bus wiring: preflight, TTL, approval, single-flight,
// backstop, launch passthrough — the same harness shape as
// test/persona-extension.js's personaTestPrepare/personaRelSuggestLlm gates.
function freshHarness(tag, { withPick } = {}) {
  const stateDir = path.join(scratch, tag + '-state');
  const workspace = path.join(scratch, tag + '-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  studio.writeWorkspaceConfig(stateDir, workspace);
  if (withPick) modelPicker.writeModelPick(stateDir, withPick);

  const draft = drafts.createDraft(stateDir, workspace, { name: 'SniperSight', pitch: 'Scores entries.' });
  drafts.updateDraft(stateDir, draft.id, draft.revision, {
    answers: { idea: 'A trading-intelligence layer that scores liquidity sweeps.' },
  });

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
  return { stateDir, workspace, bus, controllers, draftId: draft.id, card: CARDS[0].key,
           latestStarted: () => started };
}

gate('run without approved:true is rejected — the pass never runs unattended', () => {
  const h = freshHarness('unapproved');
  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  const prepared = h.bus.posts.at(-1).payload;
  assert.equal(prepared.requiresApproval, true);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsCardSuggestRun')({
    id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: false,
  });
  assert.equal(h.controllers.length, 0, 'no disposable was started');
  assert.match(h.bus.posts.at(-1).payload.error, /explicit approval/);
});

gate('prepare -> approve -> run drives one disposable turn and parses the result', () => {
  const h = freshHarness('happy');
  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  const prepared = h.bus.posts.at(-1).payload;
  assert.equal(prepared.usage.session.pct, 5);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsCardSuggestRun')({
    id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.bus.posts.at(-1).payload.phase, 'running');
  const started = h.latestStarted();
  assert.ok(started.kickoff.includes('trading-intelligence layer'), 'prompt carries the draft answer');
  assert.equal(started.launch, undefined, 'no model pick yet — omitted, byte-identical to legacy');

  h.bus.posts.length = 0;
  started.onEvent({ type: 'text', text: wrap({ suggestions: ['Name the user explicitly.'] }) });
  started.onEvent({ type: 'result', ok: true });
  const result = h.bus.posts.find((p) => p.type === 'projectsCardSuggestResult').payload;
  assert.equal(result.error, null);
  assert.deepEqual(result.suggestions, ['Name the user explicitly.']);
  assert.equal(h.controllers[0].closed, true, 'done() always closes the seat');
});

gate('an expired prepare (past the TTL) is rejected at run, never silently reused', () => {
  const h = freshHarness('ttl');
  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  const prepared = h.bus.posts.at(-1).payload;
  const originalNow = Date.now;
  Date.now = () => originalNow() + 6 * 60 * 1000;   // TTL is 5 minutes
  try {
    h.bus.posts.length = 0;
    h.bus.handlers.get('projectsCardSuggestRun')({
      id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: true,
    });
  } finally { Date.now = originalNow; }
  assert.equal(h.controllers.length, 0);
  assert.match(h.bus.posts.at(-1).payload.error, /expired/);
});

gate('a stale prepare (draft revision moved on) is rejected at run', () => {
  const h = freshHarness('stale-revision');
  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  const prepared = h.bus.posts.at(-1).payload;
  drafts.updateDraft(h.stateDir, h.draftId, prepared.revision, { answers: { idea: 'Changed my mind.' } });
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsCardSuggestRun')({
    id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.controllers.length, 0);
  assert.match(h.bus.posts.at(-1).payload.error, /prepare the AI suggestion pass again|Prepare the AI/i);
});

gate('only one AI suggestion pass runs at a time', () => {
  const h = freshHarness('single-flight');
  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  let prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsCardSuggestRun')({
    id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.controllers.length, 1);   // first pass now active, unresolved

  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  prepared = h.bus.posts.at(-1).payload;
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsCardSuggestRun')({
    id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.controllers.length, 1, 'a second pass did not start while one is active');
  assert.match(h.bus.posts.at(-1).payload.error, /already running/);
});

gate('a dead seat resolves to an error result, never hangs the caller', () => {
  const h = freshHarness('dead-seat');
  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsCardSuggestRun')({
    id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: true,
  });
  h.bus.posts.length = 0;
  h.latestStarted().onEvent({ type: 'dead' });
  const result = h.bus.posts.find((p) => p.type === 'projectsCardSuggestResult').payload;
  assert.ok(result.error);
  assert.equal(h.controllers.at(-1).closed, true);
});

gate('the backstop force-finishes with an error if the seat never answers', () => {
  const h = freshHarness('backstop');
  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  const prepared = h.bus.posts.at(-1).payload;

  const originalSetTimeout = global.setTimeout;
  let backstopFn = null;
  global.setTimeout = (fn, ms) => { backstopFn = fn; return 0; };
  try {
    h.bus.handlers.get('projectsCardSuggestRun')({
      id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: true,
    });
  } finally { global.setTimeout = originalSetTimeout; }
  assert.ok(typeof backstopFn === 'function', 'a backstop timer was armed');

  h.bus.posts.length = 0;
  backstopFn();   // simulate the timer firing — the seat never emitted 'result'/'dead'
  const result = h.bus.posts.find((p) => p.type === 'projectsCardSuggestResult').payload;
  assert.match(result.error, /timed out/);
  assert.equal(h.controllers.at(-1).closed, true);
});

gate('a persisted model pick rides the disposable as launch.{model,effort}', () => {
  const h = freshHarness('with-pick', { withPick: { model: 'sonnet', effort: 'high' } });
  h.bus.handlers.get('projectsCardSuggestPrepare')({ id: h.draftId, card: h.card });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsCardSuggestRun')({
    id: h.draftId, card: h.card, expectedRevision: prepared.revision, approved: true,
  });
  assert.deepEqual(h.latestStarted().launch, { model: 'sonnet', effort: 'high' });
});

console.log('\nSTUDIO SUGGEST DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
