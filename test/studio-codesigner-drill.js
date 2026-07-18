// App Builder — headless drill for the co-designer (slice 7): the
// apex-studio patch-block contract (lib/codesigner.js) as pure functions, the
// digest composer, and the long-lived-controller lifecycle wiring in main.js
// (codesignerOpen/Send/Close/PatchAccept/PatchReject), driven the same way
// test/studio-suggest-drill.js drives the suggest pass — a fake bus + a
// stubbed ctx.seats.startDisposable, zero real LLM spend.
// Run: node test/studio-codesigner-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codesigner = require('../extensions/studio/lib/codesigner');
const studio = require('../extensions/studio/main');
const drafts = require('../extensions/studio/lib/drafts');
const modelPicker = require('../extensions/studio/lib/modelPicker');
const { CARDS } = require('../extensions/studio/lib/interview');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-codesigner-'));
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

const wrap = (obj) => 'Here is my reply.\n```apex-studio\n' + JSON.stringify(obj) + '\n```';

// ==========================================================================
// lib/codesigner.js — pure functions
// ==========================================================================

gate('a valid patch block (1-4 patches, known card) parses correctly', () => {
  const out = codesigner.parsePatchReply(wrap({
    patches: [
      { card: 'scope', proposal: 'Non-goals: no mobile app.', why: 'keeps v1 shippable' },
      { card: 'idea', field: 'answer', proposal: 'Name the user in the pitch.', why: 'grounds the pitch' },
    ],
  }));
  assert.equal(out.error, null);
  assert.equal(out.patches.length, 2);
  assert.equal(out.patches[0].card, 'scope');
  assert.equal(out.patches[0].field, 'answer');
  assert.equal(out.patches[0].proposal, 'Non-goals: no mobile app.');
  assert.equal(out.patches[0].why, 'keeps v1 shippable');
});

gate('unknown card is dropped from a block that also has valid patches', () => {
  const out = codesigner.parsePatchReply(wrap({
    patches: [
      { card: 'not-a-real-card', proposal: 'should be dropped', why: 'x' },
      { card: 'delivery', proposal: 'Add a paper-trade gate.', why: 'evidence not vibes' },
    ],
  }));
  assert.equal(out.error, null);
  assert.equal(out.patches.length, 1);
  assert.equal(out.patches[0].card, 'delivery');
  assert.ok(out.notes.some((n) => /unknown card/.test(n)));
});

gate('an unknown field on an otherwise valid card is dropped, not silently accepted', () => {
  const out = codesigner.validatePatches({
    patches: [{ card: 'scope', field: 'nonGoals', proposal: 'x', why: 'y' }],
  });
  assert.equal(out.patches.length, 0);
  assert.ok(out.notes.some((n) => /unknown field/.test(n)));
});

gate('5+ patches are TRIMMED to MAX_PATCHES, not dropped as a whole block', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ card: 'idea', proposal: 'p' + i, why: 'w' + i }));
  const out = codesigner.validatePatches({ patches: many });
  assert.equal(out.patches.length, codesigner.MAX_PATCHES);
  assert.equal(out.patches[0].proposal, 'p0', 'kept the first N, in order');
  assert.ok(out.notes.some((n) => /capped at/.test(n)));
});

gate('an oversized proposal/why is capped, not rejected', () => {
  const out = codesigner.validatePatches({
    patches: [{ card: 'idea', proposal: 'x'.repeat(9999), why: 'y'.repeat(9999) }],
  });
  assert.equal(out.patches.length, 1);
  assert.equal(out.patches[0].proposal.length, codesigner.PROPOSAL_CAP);
  assert.equal(out.patches[0].why.length, codesigner.WHY_CAP);
});

gate('nested junk, wrong types, and extra unknown fields inside a patch entry are dropped cleanly', () => {
  const out = codesigner.validatePatches({
    patches: [
      'just a string',                                        // wrong type — dropped
      42,                                                       // wrong type — dropped
      ['array', 'not', 'object'],                               // wrong type — dropped
      { card: 'users', proposal: '' },                          // empty proposal — dropped
      { card: 'platform', proposal: null, why: 'y' },           // wrong-typed proposal — dropped
      {                                                          // valid, plus junk the parser never reads
        card: 'architecture', proposal: 'One owner per data.', why: 'clarity',
        cwd: 'C:\\evil', permissionMode: 'bypassPermissions', nested: { a: [1, 2, { b: 3 }] },
        __proto__: { polluted: true },
      },
    ],
  });
  assert.equal(out.patches.length, 1);
  assert.equal(out.patches[0].card, 'architecture');
  assert.deepEqual(Object.keys(out.patches[0]).sort(), ['card', 'field', 'proposal', 'why']);
});

gate('missing block / non-JSON / empty reply parse to an empty list — never throws', () => {
  assert.doesNotThrow(() => codesigner.parsePatchReply(''));
  assert.doesNotThrow(() => codesigner.parsePatchReply(undefined));
  assert.doesNotThrow(() => codesigner.parsePatchReply('just talked, no fenced block at all'));
  assert.doesNotThrow(() => codesigner.parsePatchReply('```apex-studio\n{not valid json\n```'));
  assert.doesNotThrow(() => codesigner.parsePatchReply({ weird: true }));

  const noBlock = codesigner.parsePatchReply('The model just talked instead of proposing a patch.');
  assert.equal(noBlock.patches.length, 0);
  assert.ok(noBlock.error);

  const badJson = codesigner.parsePatchReply('```apex-studio\n{not valid json\n```');
  assert.equal(badJson.patches.length, 0);
  assert.ok(badJson.error);

  // valid JSON, wrong shape (an array, not {patches:[...]}) — fails closed with
  // no error (there IS a parseable block, it just carries nothing usable)
  const wrongShape = codesigner.parsePatchReply(wrap(['just', 'an', 'array']));
  assert.equal(wrongShape.patches.length, 0);
  assert.equal(wrongShape.error, null);

  // a block naming zero patches is valid and empty, not an error
  const zero = codesigner.parsePatchReply(wrap({ patches: [] }));
  assert.equal(zero.patches.length, 0);
  assert.equal(zero.error, null);
});

gate('last apex-studio block wins when a reply contains more than one', () => {
  const text = 'first thought\n```apex-studio\n' + JSON.stringify({ patches: [{ card: 'idea', proposal: 'first', why: 'x' }] }) +
    '\n```\nactually, on reflection\n```apex-studio\n' + JSON.stringify({ patches: [{ card: 'idea', proposal: 'second', why: 'y' }] }) + '\n```';
  const out = codesigner.parsePatchReply(text);
  assert.equal(out.patches.length, 1);
  assert.equal(out.patches[0].proposal, 'second');
});

gate('the digest is a structured card-state summary, not the transcript', () => {
  const draft = { name: 'SniperSight', pitch: 'Scores entries.', answers: {
    idea: 'A'.repeat(200), users: '', scope: 'short', platform: '', architecture: '', delivery: '',
  } };
  const digest = codesigner.buildDigest(draft, CARDS);
  // every card key shows up as a titled, statused line
  for (const card of CARDS) assert.ok(digest.includes(card.title), 'missing card: ' + card.key);
  assert.ok(digest.includes('ANSWERED'));
  assert.ok(digest.includes('EMPTY'));
  assert.ok(digest.includes('THIN'));
  assert.ok(digest.includes('SniperSight'));
  // structured, not a transcript: it never carries any assistant/user turn text
  assert.ok(!digest.includes('A'.repeat(200)), 'the full 200-char answer text must not appear — only its status');
  assert.ok(!/user:/i.test(digest), 'the digest itself carries no conversational turns');
});

gate('the patch allowlist and contract prompt DERIVE from the interview module (look included)', () => {
  // Slice A1: a new interview card must join the co-designer automatically.
  assert.ok(codesigner.CARD_KEYS.has('look'), 'CARD_KEYS derives from interview KEYS');
  assert.ok(codesigner.contractText().includes('look'), 'the prompt names every card, look included');
  const out = codesigner.parsePatchReply(wrap({
    patches: [{ card: 'look', proposal: 'Dark, one amber accent; dense but calm.', why: 'grounds the mockups' }],
  }));
  assert.equal(out.error, null);
  assert.equal(out.patches.length, 1);
  assert.equal(out.patches[0].card, 'look');
});

gate('the kickoff carries the digest and the patch contract; a later turn carries the digest and the user text only', () => {
  const draft = { name: 'X', pitch: '', answers: Object.fromEntries(CARDS.map((c) => [c.key, ''])) };
  const kickoff = codesigner.buildKickoff(draft, CARDS);
  assert.ok(kickoff.includes('BLUEPRINT DIGEST'));
  assert.ok(kickoff.includes('apex-studio'));
  const turn = codesigner.buildTurn('What about scope?', draft, CARDS);
  assert.ok(turn.includes('BLUEPRINT DIGEST'));
  assert.ok(turn.includes('User: What about scope?'));
  assert.ok(!turn.includes('apex-studio'), 'the patch contract is only restated in the kickoff, not every turn');
});

// ==========================================================================
// main.js bus wiring — the long-lived controller lifecycle
// ==========================================================================

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
  const starts = [];   // one entry per ctx.seats.startDisposable call
  studio.register({
    bus, stateDir,
    async pickDirectory() { return null; },
    seats: {
      startDisposable(options) {
        const controller = {
          closed: false, sends: [],
          send(text) { this.sends.push(text); },
          close() { this.closed = true; },
        };
        starts.push({ options, controller });
        return controller;
      },
    },
  });
  return { stateDir, workspace, bus, starts, draftId: draft.id,
           latest: () => starts[starts.length - 1] };
}

gate('opening the panel starts exactly one disposable controller', () => {
  const h = freshHarness('open-one');
  h.bus.handlers.get('codesignerOpen')({ id: h.draftId });
  assert.equal(h.starts.length, 1);
  assert.equal(h.starts[0].options.kickoff.includes('BLUEPRINT DIGEST'), true);
  const status = h.bus.posts.find((p) => p.type === 'codesignerStatus');
  assert.equal(status.payload.phase, 'open');
});

gate('sending multiple turns reuses the SAME controller — no new disposable per turn', () => {
  const h = freshHarness('reuse');
  h.bus.handlers.get('codesignerOpen')({ id: h.draftId });
  assert.equal(h.starts.length, 1);
  const controller = h.starts[0].controller;

  h.bus.handlers.get('codesignerSend')({ id: h.draftId, text: 'First question' });
  h.bus.handlers.get('codesignerSend')({ id: h.draftId, text: 'Second question' });
  h.bus.handlers.get('codesignerSend')({ id: h.draftId, text: 'Third question' });

  assert.equal(h.starts.length, 1, 'still only one startDisposable call after three sends');
  assert.equal(controller.sends.length, 3, 'three send() calls landed on the one controller');
  assert.ok(controller.sends[0].includes('First question'));
  assert.ok(controller.sends[1].includes('Second question'));
  assert.ok(!controller.closed);
});

gate('closing the panel closes the controller and rejects a further send', () => {
  const h = freshHarness('close');
  h.bus.handlers.get('codesignerOpen')({ id: h.draftId });
  const controller = h.starts[0].controller;
  h.bus.handlers.get('codesignerClose')({ id: h.draftId });
  assert.equal(controller.closed, true);

  h.bus.posts.length = 0;
  h.bus.handlers.get('codesignerSend')({ id: h.draftId, text: 'too late' });
  assert.equal(h.starts.length, 1, 'no disposable was started for the rejected send');
  assert.equal(controller.sends.length, 0);
  const status = h.bus.posts.find((p) => p.type === 'codesignerStatus');
  assert.match(status.payload.error, /open the co-designer panel/i);
});

gate('reopening starts a fresh controller and closes the old one — no session resumption', () => {
  const h = freshHarness('reopen');
  h.bus.handlers.get('codesignerOpen')({ id: h.draftId });
  const first = h.starts[0].controller;
  h.bus.handlers.get('codesignerOpen')({ id: h.draftId });
  assert.equal(h.starts.length, 2, 'a second startDisposable call happened');
  assert.notEqual(h.starts[1].controller, first, 'a distinct controller instance');
  assert.equal(first.closed, true, 'the old controller was torn down, not left running');
});

gate('a patch reply is parsed and posted; accepting one mutates the draft, not before', () => {
  const h = freshHarness('accept');
  h.bus.handlers.get('codesignerOpen')({ id: h.draftId });
  const started = h.starts[0];
  h.bus.posts.length = 0;
  started.options.onEvent({ type: 'text', text: wrap({
    patches: [{ card: 'scope', proposal: 'Non-goals: no auto-execution.', why: 'keeps v1 shippable' }],
  }) });
  started.options.onEvent({ type: 'result', ok: true });

  const patchesPost = h.bus.posts.find((p) => p.type === 'codesignerPatches');
  assert.ok(patchesPost, 'a codesignerPatches post followed the parsed reply');
  assert.equal(patchesPost.payload.patches.length, 1);
  const patchId = patchesPost.payload.patches[0].id;

  const draftBefore = drafts.readDraft(h.stateDir, h.draftId);
  assert.equal(draftBefore.answers.scope, '', 'the draft is untouched until an explicit accept');

  h.bus.handlers.get('codesignerPatchAccept')({ id: h.draftId, patchId, expectedRevision: draftBefore.revision });
  const draftAfter = drafts.readDraft(h.stateDir, h.draftId);
  assert.ok(draftAfter.answers.scope.includes('Non-goals: no auto-execution.'));

  const cleared = h.bus.posts.filter((p) => p.type === 'codesignerPatches').at(-1);
  assert.equal(cleared.payload.patches.length, 0, 'the accepted patch is no longer pending');
});

gate('rejecting a patch drops it without touching the draft', () => {
  const h = freshHarness('reject');
  h.bus.handlers.get('codesignerOpen')({ id: h.draftId });
  const started = h.starts[0];
  started.options.onEvent({ type: 'text', text: wrap({
    patches: [{ card: 'delivery', proposal: 'Add a paper-trade gate.', why: 'evidence not vibes' }],
  }) });
  started.options.onEvent({ type: 'result', ok: true });
  const patchId = h.bus.posts.find((p) => p.type === 'codesignerPatches').payload.patches[0].id;

  h.bus.handlers.get('codesignerPatchReject')({ id: h.draftId, patchId });
  const draft = drafts.readDraft(h.stateDir, h.draftId);
  assert.equal(draft.answers.delivery, '');
  const cleared = h.bus.posts.filter((p) => p.type === 'codesignerPatches').at(-1);
  assert.equal(cleared.payload.patches.length, 0);
});

gate('a dead seat closes the session and reports an error, never hangs', () => {
  const h = freshHarness('dead-seat');
  h.bus.handlers.get('codesignerOpen')({ id: h.draftId });
  const controller = h.starts[0].controller;
  h.bus.posts.length = 0;
  h.starts[0].options.onEvent({ type: 'dead' });
  assert.equal(controller.closed, true);
  const status = h.bus.posts.find((p) => p.type === 'codesignerStatus');
  assert.equal(status.payload.phase, 'error');

  h.bus.posts.length = 0;
  h.bus.handlers.get('codesignerSend')({ id: h.draftId, text: 'anyone there?' });
  assert.equal(h.starts.length, 1, 'a dead session is not silently reused');
});

gate('a persisted model pick rides the disposable as launch.{model,effort}; unset is omitted', () => {
  const h1 = freshHarness('no-pick');
  h1.bus.handlers.get('codesignerOpen')({ id: h1.draftId });
  assert.equal(h1.starts[0].options.launch, undefined);

  const h2 = freshHarness('with-pick', { withPick: { model: 'opus', effort: 'high' } });
  h2.bus.handlers.get('codesignerOpen')({ id: h2.draftId });
  assert.deepEqual(h2.starts[0].options.launch, { model: 'opus', effort: 'high' });
});

console.log('\nSTUDIO CODESIGNER DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
