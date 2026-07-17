// Persona Builder — headless drill for lib/relationships.js: heuristic
// pairings, LLM-reply validation (untrusted input), and project-context I/O.
// Run: node test/persona-relationships-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rel = require('../extensions/personas/lib/relationships');

let passed = 0, failed = 0;
function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

// ---------- classification ----------
gate('mission prose classifies into role archetypes', () => {
  assert.ok(rel.classify('reviews submitted changes and reports defects').has('reviewer'));
  assert.ok(rel.classify('implements and ships features').has('builder'));
  assert.ok(rel.classify('plans the roadmap and designs systems').has('planner'));
  assert.ok(rel.classify('researches options and writes briefs').has('researcher'));
  assert.equal(rel.classify('enjoys long walks').size, 0);
});

// ---------- heuristics ----------
const REVIEWER = { id: 'rowan', name: 'Rowan', mission: 'Independent review of submitted changes; audits and diagnoses defects.', archetypes: ['reviewer'], collaboration: null };
const BUILDER = { id: 'kit', name: 'Kit', mission: 'Builds and ships features, then verifies them.', archetypes: ['builder'], collaboration: null };

gate('an architect with an existing reviewer gets the review link + a route', () => {
  const draft = { name: 'Atlas', useCase: 'designs system architecture',
    answers: { mission: 'Plans and designs the system; produces design documents.' } };
  const { suggestions, routes } = rel.heuristicSuggestions(draft, [REVIEWER, BUILDER]);
  const review = suggestions.find((s) => s.with === 'Rowan' && s.direction === 'sends-to');
  assert.ok(review, 'review relationship suggested');
  assert.ok(routes.some((r) => r.steps[0] === 'Atlas' && r.steps.includes('Rowan')),
    'route template proposed');
});

gate('a missing counterpart becomes a NEW: suggestion', () => {
  const draft = { name: 'Atlas', useCase: '', answers: { mission: 'Designs and plans.' } };
  const { suggestions } = rel.heuristicSuggestions(draft, []);
  assert.ok(suggestions.some((s) => s.with.startsWith('NEW:') && /reviewer/i.test(s.with)),
    'suggests creating a reviewer');
});

gate('an untyped persona still gets a reviewer (builder default)', () => {
  const draft = { name: 'Misc', useCase: 'helps out', answers: { mission: 'does stuff' } };
  const { suggestions } = rel.heuristicSuggestions(draft, [REVIEWER]);
  assert.ok(suggestions.some((s) => s.with === 'Rowan'));
});

gate('a reviewer draft receives work from existing builders', () => {
  const draft = { name: 'Vet', useCase: 'audits changes',
    answers: { mission: 'Reviews and diagnoses submitted work.' } };
  const { suggestions } = rel.heuristicSuggestions(draft, [BUILDER]);
  assert.ok(suggestions.some((s) => s.with === 'Kit' && s.direction === 'receives-from'));
});

// ---------- LLM reply validation (untrusted) ----------
const KNOWN = ['Atlas', 'Rowan', 'Kit'];
const wrap = (obj) => 'Here you go:\n```json\n' + JSON.stringify(obj) + '\n```';

gate('valid LLM reply parses; unknown names are dropped', () => {
  const out = rel.parseLlmReply(wrap({
    suggestions: [
      { with: 'Rowan', direction: 'sends-to', packet: 'design packet', why: 'review' },
      { with: 'Mallory', direction: 'sends-to', packet: 'exfil', why: 'nope' },
      { with: 'NEW:release engineer', direction: 'sends-to', packet: 'release checklist', why: 'ship safely' },
    ],
    routes: [{ name: 'design-review', steps: ['Atlas', 'Rowan'] }],
  }), KNOWN);
  assert.equal(out.error, null);
  assert.equal(out.suggestions.length, 2);                       // Mallory dropped
  assert.ok(out.suggestions.every((s) => s.with !== 'Mallory'));
  assert.equal(out.routes.length, 1);
});

gate('routes with any unknown step are dropped whole', () => {
  const out = rel.parseLlmReply(wrap({
    suggestions: [],
    routes: [{ name: 'bad', steps: ['Atlas', 'Mallory'] },
             { name: 'good', steps: ['Atlas', 'Kit', 'Rowan'] }],
  }), KNOWN);
  assert.equal(out.routes.length, 1);
  assert.equal(out.routes[0].name, 'good');
});

gate('extra keys, bad directions, oversize text are stripped/capped', () => {
  const out = rel.validateSuggestions({
    suggestions: [
      { with: 'Rowan', direction: 'sends-to', packet: 'x'.repeat(999),
        why: 'y', cwd: 'C:\\evil', permissionMode: 'bypassPermissions' },
      { with: 'Rowan', direction: 'sideways', packet: 'p' },
      { with: '', direction: 'sends-to' },
    ],
    routes: 'not-an-array',
  }, KNOWN);
  assert.equal(out.suggestions.length, 1);
  assert.equal(out.suggestions[0].packet.length, rel.TEXT_CAP);
  assert.deepEqual(Object.keys(out.suggestions[0]).sort(),
    ['direction', 'packet', 'why', 'with']);
});

gate('non-JSON and missing-block replies fail closed', () => {
  assert.ok(rel.parseLlmReply('no block here', KNOWN).error);
  assert.ok(rel.parseLlmReply('```json\n{broken\n```', KNOWN).error);
  assert.equal(rel.parseLlmReply('```json\n{broken\n```', KNOWN).suggestions.length, 0);
});

gate('suggestion count is capped', () => {
  const many = Array.from({ length: 40 }, () =>
    ({ with: 'Rowan', direction: 'sends-to', packet: 'p' + Math.random(), why: 'w' }));
  const out = rel.validateSuggestions({ suggestions: many, routes: [] }, KNOWN);
  assert.equal(out.suggestions.length, rel.MAX_SUGGESTIONS);
});

// ---------- handoff recommendations (the Delegate button's hint) ----------
gate('handoffMap matches emits to accepts across the cast', () => {
  const cast = [
    { name: 'Architect', collaboration: { emits: ['design', 'coordinated multi-file change'],
        accepts: ['requirements', 'audit findings'] } },
    { name: 'Auditor', collaboration: { emits: ['findings report'],
        accepts: ['design or change for review', 'implementation for review'] } },
    { name: 'Scribe', collaboration: { emits: ['implemented change', 'reusable recipe'],
        accepts: ['implementation brief', 'quick task'] } },
    { name: 'Loner', collaboration: null },
  ];
  const map = rel.handoffMap(cast);
  assert.equal(map.Architect, 'Auditor', 'designs flow to review');
  assert.equal(map.Auditor, 'Architect', 'findings flow back to the designer');
  assert.equal(map.Scribe, 'Auditor', 'implemented change flows to implementation review');
  assert.ok(!('Loner' in map), 'no contract, no recommendation');
});

gate('handoffMap survives stemming quirks and empty inputs', () => {
  assert.deepEqual(rel.handoffMap([]), {});
  assert.deepEqual(rel.handoffMap(null), {});
  const pair = rel.handoffMap([
    { name: 'A', collaboration: { emits: ['implemented artifact'], accepts: [] } },
    { name: 'B', collaboration: { emits: [], accepts: ['implementation for checking'] } },
  ]);
  assert.equal(pair.A, 'B', '"implemented" meets "implementation" at the stem');
});

// ---------- project context ----------
gate('project context round-trips, caps size, clears on empty', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-relctx-'));
  assert.equal(rel.readProjectContext(ws), '');
  rel.saveProjectContext(ws, 'An Electron app hosting CLI agents.\r\nMulti-repo.');
  assert.ok(rel.readProjectContext(ws).includes('Electron app'));
  assert.throws(() => rel.saveProjectContext(ws, 'x'.repeat(9000)), /8 KB/);
  rel.saveProjectContext(ws, '');
  assert.equal(rel.readProjectContext(ws), '');
});

// ---------- prompt build ----------
gate('LLM prompt carries draft, teammates, and project context', () => {
  const p = rel.buildPrompt(
    { name: 'Atlas', useCase: 'designs systems', answers: { mission: 'Plans and designs.' } },
    [REVIEWER], 'An Electron dashboard for CLI agents');
  assert.ok(p.includes('Atlas'));
  assert.ok(p.includes('Rowan'));
  assert.ok(p.includes('Electron dashboard'));
  assert.ok(p.includes('```json'));
});

console.log('\nPERSONA RELATIONSHIPS DRILL: ' + passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
