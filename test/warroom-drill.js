// War Room — headless drill for the deliberation core. No model, no Electron:
// a scripted "seat" (canned replies) drives the pure scheduler/governor/contract,
// proving round order, delta digests, interjection, the budget ceiling, the idea
// contract + merge/rank, the fetch guard, the report, and backstop survival.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSession } = require('../extensions/warroom/lib/session');
const ideas = require('../extensions/warroom/lib/ideas');
const pack = require('../extensions/warroom/lib/pack');

let pass = 0;
const ok = (label) => { console.log('PASS  ' + label); pass++; };

const IDEAS_BLOCK = (arr) => '```apex-ideas\n' + JSON.stringify({ ideas: arr }) + '\n```';
const stubPack = { forRole: () => 'TREEDATA' };

// Drive a session to completion. replyFor(step) -> string | {fail:true}.
function drive(session, replyFor) {
  const steps = [];
  let guard = 0;
  while (guard++ < 500) {
    const step = session.nextStep();
    if (step.type === 'done') return { steps, done: step };
    if (step.type === 'converge-now') { steps.push({ type: 'converge-now' }); continue; }
    steps.push(step);
    const r = replyFor(step);
    if (r && r.fail) session.recordFailure();
    else session.recordReply(r == null ? 'ok' : r);
  }
  throw new Error('drive did not terminate');
}

// 1. round order: diverge (no contrarian) → clash (contrarian leads) → converge (all)
{
  const s = createSession({ topic: 'T', config: { rounds: 3, budget: 999999, models: {}, pack: stubPack } });
  const conv = (st) => (st.phase === 'converge' ? IDEAS_BLOCK([{ id: st.persona, title: 'idea ' + st.persona }]) : 'MARK_' + st.persona + '_' + st.phase);
  const { steps, done } = drive(s, conv);
  const seq = steps.filter((x) => x.type === 'send').map((x) => x.persona + '@' + x.phase);
  assert.deepEqual(seq, [
    'brainstormer@diverge', 'architect@diverge', 'auditor@diverge', 'advocate@diverge',
    'contrarian@clash', 'brainstormer@clash', 'architect@clash', 'auditor@clash', 'advocate@clash',
    'brainstormer@converge', 'architect@converge', 'auditor@converge', 'advocate@converge', 'contrarian@converge',
  ], 'contrarian skips diverge, leads clash, and all five converge');
  assert.equal(done.reason, 'complete');
  ok('1 round order: diverge → clash (contrarian-led) → converge');
}

// 2. delta digest: a seat sees others' fresh statements, never its own, never repeats
{
  const s = createSession({ topic: 'T', config: { rounds: 3, budget: 999999, models: {}, pack: stubPack } });
  const seen = {};
  drive(s, (st) => {
    if (st.persona === 'brainstormer' && st.phase === 'clash') seen.bClash = st.prompt;
    return st.phase === 'converge' ? IDEAS_BLOCK([{ id: st.persona, title: 't' }]) : 'MARK_' + st.persona + '_' + st.phase;
  });
  assert.ok(seen.bClash.includes('MARK_architect_diverge'), 'sees another seat it had not caught up on');
  assert.ok(seen.bClash.includes('MARK_contrarian_clash'), 'sees the contrarian who spoke just before it this round');
  assert.ok(!seen.bClash.includes('MARK_brainstormer_diverge'), 'never re-shown its own words');
  ok('2 delta digest shows others fresh, filters self');
}

// 3. interjection lands in exactly the next prompt, once
{
  const s = createSession({ topic: 'T', config: { rounds: 3, budget: 999999, models: {}, pack: stubPack } });
  let injected = false; const caught = [];
  drive(s, (st) => {
    if (!injected && st.phase === 'clash') { s.interject('OPERATOR_PING'); injected = true; }
    if (injected) caught.push({ persona: st.persona, has: st.prompt.includes('OPERATOR_PING') });
    return st.phase === 'converge' ? IDEAS_BLOCK([{ id: st.persona, title: 't' }]) : 'x';
  });
  // the interjection is queued during a turn; the FIRST prompt built after it carries it, and only that one
  const withPing = caught.filter((c) => c.has).length;
  assert.equal(withPing, 1, 'exactly one prompt carried the interjection');
  ok('3 operator interjection lands in exactly the next prompt, once');
}

// 4a. budget ceiling forces convergence then a budget stop
{
  const s = createSession({ topic: 'T', config: { rounds: 3, budget: 500, models: {}, pack: stubPack } });
  const { steps, done } = drive(s, (st) => (st.phase === 'converge' ? IDEAS_BLOCK([{ id: 'a', title: 'A' }]) : 'x'));
  assert.ok(steps.some((x) => x.type === 'converge-now'), 'a tiny budget trips the governor to converge');
  assert.equal(done.reason, 'budget', 'and the session stops for budget');
  ok('4a budget governor: over-ceiling collapses to converge, then stops for budget');
}
// 4b. est-token accounting moves with real spend
{
  const s = createSession({ topic: 'T', config: { rounds: 2, budget: 999999, models: {}, pack: stubPack } });
  const before = s.estTokens;
  s.nextStep(); s.recordReply('a reply of some length');
  assert.ok(s.estTokens > before, 'estTokens accrues prompt + reply cost');
  ok('4b est-token accounting accrues on send + reply');
}

// 5. contract: malformed converge → one repair → still bad → zero ideas, no crash
{
  const s = createSession({ topic: 'T', config: { rounds: 2, budget: 999999, models: {}, pack: stubPack } });
  let repaired = 0;
  let guard = 0;
  while (guard++ < 200) {
    const step = s.nextStep();
    if (step.type === 'done') break;
    if (step.type === 'converge-now') continue;
    if (step.persona === 'brainstormer' && step.phase === 'converge') {
      const info = s.recordReply('no fenced block here at all');
      if (info.needsRepair) { const rp = s.repair('brainstormer'); if (rp) { repaired++; s.recordReply('still no block'); } }
    } else {
      s.recordReply(step.phase === 'converge' ? IDEAS_BLOCK([{ id: step.persona, title: 't ' + step.persona }]) : 'x');
    }
  }
  assert.equal(repaired, 1, 'exactly one repair re-ask');
  assert.ok(s.cards.every((c) => c.champions.indexOf('brainstormer') === -1), 'the un-parseable seat contributed no ideas');
  assert.ok(s.cards.length > 0, 'the room still produced ideas from the others');
  ok('5 malformed converge → one repair → contributes nothing, room survives');
}

// 6. validation caps
{
  const many = Array.from({ length: 8 }, (_, i) => ({ id: 'x' + i, title: 'Idea ' + i }));
  const v = ideas.validateIdeas({ ideas: many });
  assert.equal(v.length, 6, '8 ideas capped to 6');
  const q = ideas.validateIdeas({ ideas: [
    { title: 'T', feasibility: 'bogus' }, { pitch: 'no title dropped' },
    { title: 'Long', pitch: 'p'.repeat(999) },
  ] });
  assert.equal(q[0].feasibility, 'medium', 'bad feasibility coerced to medium');
  assert.ok(q.every((c) => c.title), 'titleless idea dropped');
  assert.ok(q.find((c) => c.title === 'Long').pitch.length <= ideas.CAP.pitch, 'pitch capped');
  ok('6 idea validation: 6-cap, feasibility coerce, titleless drop, field caps');
}

// 7. merge + rank: shared idea across two personas outranks singletons; exists demotes
{
  const merged = ideas.mergeIdeas({
    brainstormer: [{ id: 'undo', title: 'Global undo', feasibility: 'high', exists: false, builds_on: [] }],
    architect: [{ id: 'undo', title: 'Global undo stack', feasibility: 'medium', exists: false, builds_on: [] }],
    auditor: [{ id: 'log', title: 'Audit log', feasibility: 'high', exists: true, builds_on: [] }],
  });
  const ranked = ideas.rankIdeas(merged);
  const undo = ranked.find((c) => c.id === 'undo');
  assert.equal(undo.champions.length, 2, 'two personas merged onto one card');
  assert.equal(undo.feasibility, 'medium', 'merged feasibility takes the more conservative value');
  assert.equal(ranked[0].id, 'undo', 'the two-champion idea ranks first');
  assert.ok(ranked.findIndex((c) => c.exists) > 0, 'an already-existing idea is demoted below a novel one');
  ok('7 merge unions champions + worst-feasibility; rank favors consensus, demotes exists');
}

// 8. fetch guard (real fs, temp repo)
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-repo-'));
  fs.writeFileSync(path.join(repo, 'real.js'), 'REAL_CONTENT');
  fs.writeFileSync(path.join(repo, 'big.js'), 'B'.repeat(pack.FETCH_CAP + 5000));
  const got = pack.readFetch(repo, ['real.js', '../../etc/passwd', 'nope.js', 'real.js', 'big.js']);
  assert.equal(got.length, pack.FETCH_MAX, 'fetch capped to the batch max');
  assert.ok(got.find((f) => f.path === 'real.js').content.includes('REAL_CONTENT'), 'reads a real in-repo file');
  const evil = pack.readFetch(repo, ['../../etc/passwd']);
  assert.ok(/unavailable/.test(evil[0].content), 'traversal path is refused, not read');
  const big = pack.readFetch(repo, ['big.js']);
  assert.ok(big[0].content.length <= pack.FETCH_CAP + 40, 'oversize file is truncated to the cap');
  assert.equal(pack.safeResolve(repo, '../../etc/passwd'), null, 'safeResolve rejects escapes');
  fs.rmSync(repo, { recursive: true, force: true });
  ok('8 fetch guard: batch cap, in-repo read, traversal refused, size cap');
}

// 9. auditor fetch round-trip: request → provide → next prompt is grounded
{
  const s = createSession({ topic: 'T', config: { rounds: 3, budget: 999999, models: {}, pack: stubPack } });
  let auditorClashPrompt = null;
  drive(s, (st) => {
    if (st.persona === 'auditor' && st.phase === 'diverge') {
      const info = s.recordReply('let me check ```apex-fetch\n{"files":["main/x.js"]}\n```');
      const pf = s.pendingFetch();
      if (pf) s.provideFetch([{ path: 'main/x.js', content: 'GROUNDING_BYTES' }]);
      return undefined; // already recorded
    }
    if (st.persona === 'auditor' && st.phase === 'clash') auditorClashPrompt = st.prompt;
    return st.phase === 'converge' ? IDEAS_BLOCK([{ id: st.persona, title: 't' }]) : 'x';
  });
  assert.ok(auditorClashPrompt && auditorClashPrompt.includes('GROUNDING_BYTES'), 'fetched file contents reach the Auditor next turn');
  ok('9 auditor apex-fetch round-trips real file bytes into its next prompt');
}

// 10. backstop: a dead seat mid-round is skipped, room still converges
{
  const s = createSession({ topic: 'T', config: { rounds: 3, budget: 999999, models: {}, pack: stubPack } });
  const { done } = drive(s, (st) => {
    if (st.persona === 'architect' && st.phase === 'diverge') return { fail: true };
    return st.phase === 'converge' ? IDEAS_BLOCK([{ id: st.persona, title: 't' }]) : 'x';
  });
  assert.equal(done.reason, 'complete', 'the room finished despite a dead seat');
  assert.ok(s.snapshot().failures.some((f) => f.persona === 'architect'), 'the failure was recorded');
  ok('10 backstop: a failed seat is skipped and the room still converges');
}

// 11. report render: ranked, badged, champions, transcript
{
  const cards = ideas.rankIdeas(ideas.mergeIdeas({
    brainstormer: [{ id: 'a', title: 'Alpha', pitch: 'p', novelty: 'n', feasibility: 'high', evidence: 'e', exists: false, builds_on: [] }],
    architect: [{ id: 'a', title: 'Alpha', feasibility: 'high', exists: false, builds_on: [] }],
  }));
  cards[0].status = 'approved';
  const md = ideas.renderReport({
    topic: 'Ideas for X', date: '2026-07-22', models: { brainstormer: 'haiku' }, estTokens: 21000,
    budget: 55000, rounds: 3, stopReason: 'complete', cards,
    statements: [{ round: 1, phase: 'diverge', persona: 'brainstormer', text: 'said stuff' }],
  });
  assert.ok(md.includes('# War Room — Ideas for X'), 'title present');
  assert.ok(md.includes('1. Alpha') && md.includes('APPROVED'), 'ranked idea with status badge');
  assert.ok(md.includes('Brainstormer, Architect') || md.includes('argued by'), 'champions listed');
  assert.ok(md.includes('How the room argued'), 'transcript section present');
  ok('11 report renders ranked ideas, badges, champions, transcript');
}

console.log('\nwar room drill: PASS (' + pass + '/12)');
