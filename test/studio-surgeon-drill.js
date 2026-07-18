// App Builder — headless drill for STUDIO v2 slice C1 (surgeon + resolver
// contracts): lib/resolver.js's three tiers over the committed fixture
// mini-project (test/studio-fixtures/resolver-app/), hostile-hint refusal,
// determinism, and the walk caps (skip-dirs and cap proofs run against
// drill-built SCRATCH projects, because node_modules/ and dist/ are
// gitignored and a .git DIRECTORY cannot be committed at all); plus
// lib/surgeon.js's fenced apex-surgeon contract — valid/hostile/oversized/
// traversal/absolute-path/7-edits all fail closed — and the
// bigger-than-a-boom demote detector. Pure libs under test: no Electron, no
// bus, zero LLM spend. Run: node test/studio-surgeon-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const resolver = require('../extensions/studio/lib/resolver');
const surgeon = require('../extensions/studio/lib/surgeon');

const FIXTURE = path.join(__dirname, 'studio-fixtures', 'resolver-app');
const NUL = String.fromCharCode(0);

let passed = 0, failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.stack); }
}

// The picker capture the fixture's hero button would produce.
function heroContext(overrides) {
  return {
    selector: 'div.hero > button.hero-cta',
    tag: 'button',
    classes: ['hero-cta', 'primary'],
    text: 'Get started',
    html: '<button class="hero-cta primary" data-source="src/hero.js:6">Get started</button>',
    ...overrides,
  };
}

// A scratch project per gate that needs one — mkdtemp like the mockup drill.
function scratchProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-resolver-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return root;
}

const surgeonFence = (json) =>
  'Work done.\n```apex-surgeon\n' + (typeof json === 'string' ? json : JSON.stringify(json)) + '\n```\n';

const validReport = (overrides) => ({
  summary: 'Recolored the hero CTA per the intent.',
  edits: [{ file: 'styles/site.css', kind: 'modified', hunks: '-  background: #4c8dff;\n+  background: #e0763f;' }],
  ...overrides,
});

// ==========================================================================
// resolver — tier a: framework dev hints
// ==========================================================================

gate('tier a: a data-source hint resolves file+line, high confidence, first', () => {
  const out = resolver.resolveElement(FIXTURE, heroContext());
  const first = out.candidates[0];
  assert.deepEqual(first, { file: 'src/hero.js', line: 6, tier: 'hint', confidence: 'high' });
});

gate('tier a dedupe: a hinted file never re-appears as a search candidate', () => {
  const out = resolver.resolveElement(FIXTURE, heroContext());
  const searchFiles = out.candidates.filter((c) => c.tier === 'search').map((c) => c.file);
  assert.ok(!searchFiles.includes('src/hero.js'), JSON.stringify(searchFiles));
});

gate('tier a: hostile hints (absolute, traversal, colon, missing) are dropped whole', () => {
  const hostile = [
    'C:' + String.fromCharCode(92) + 'evil.js',
    '/etc/passwd',
    '../outside.js',
    'src/../../outside.js',
    'src/hero.js:0',            // line below 1
    'no-such-file.js',          // fails the existence check
    'src' + NUL + 'hero.js',    // control character
  ];
  for (const value of hostile) {
    const html = '<div data-source="' + value + '">x</div>';
    const hints = resolver.parseSourceHints(html, FIXTURE);
    assert.deepEqual(hints, [], value + ' should be dropped');
  }
  // The wall drops without repairing; a legal sibling in the same html survives.
  const mixed = '<a data-source="../out.js">a</a><b data-source="src/hero.js:6">b</b>';
  assert.deepEqual(resolver.parseSourceHints(mixed, FIXTURE),
    [{ file: 'src/hero.js', line: 6 }]);
});

gate('tier a: a symlinked hint target is refused, a linked project root too', () => {
  let canLink = true;
  const root = scratchProject({ 'real.js': 'const x = 1;\n' });
  try { fs.symlinkSync(path.join(root, 'real.js'), path.join(root, 'linked.js')); }
  catch { canLink = false; }  // symlinks need privilege on Windows — skip half
  if (canLink) {
    assert.deepEqual(resolver.parseSourceHints('<i data-source="linked.js">x</i>', root), []);
  }
  assert.throws(() => resolver.resolveElement(path.join(root, 'real.js'), {}),
    /regular directory/);
});

// ==========================================================================
// resolver — tier b: the capped project search
// ==========================================================================

gate('tier b: class+text search ranks by score, path breaks ties, lines pinned', () => {
  const out = resolver.resolveElement(FIXTURE, heroContext({ html: '' }));
  const search = out.candidates.filter((c) => c.tier === 'search');
  // index.html carries both classes AND the text (3+3+4); hero.js one class +
  // text (3+4); site.css one class (3).
  assert.deepEqual(search, [
    { file: 'index.html', line: 8, tier: 'search', confidence: 'medium' },
    { file: 'src/hero.js', line: 6, tier: 'search', confidence: 'medium' },
    { file: 'styles/site.css', line: 2, tier: 'search', confidence: 'medium' },
  ]);
});

gate('tier b: whole-token class matching — "ero" never matches inside "hero"', () => {
  // 'ero' rides inside hero/hero-cta/hero-title in every fixture file but is
  // never a standalone token; a substring matcher would hit all three files.
  const out = resolver.resolveElement(FIXTURE, { classes: ['ero'] });
  assert.deepEqual(out.candidates.filter((c) => c.tier === 'search'), []);
});

gate('tier b: text alone locates the file that renders it', () => {
  const out = resolver.resolveElement(FIXTURE, { text: 'Fixture App' });
  const search = out.candidates.filter((c) => c.tier === 'search');
  assert.deepEqual(search, [{ file: 'index.html', line: 7, tier: 'search', confidence: 'medium' }]);
});

gate('tier b: non-allowlisted extensions never surface (notes.md carries both needles)', () => {
  const out = resolver.resolveElement(FIXTURE, heroContext({ html: '' }));
  assert.ok(out.candidates.every((c) => !c.file || !c.file.endsWith('.md')));
});

gate('tier b: node_modules/.git/dist/build are never walked', () => {
  const root = scratchProject({
    'src/app.js': 'querySelector(".decoy-cls")\n',
    'node_modules/pkg/index.js': 'decoy-cls\n',
    '.git/hooks/junk.js': 'decoy-cls\n',
    'dist/bundle.js': 'decoy-cls\n',
    'build/out.js': 'decoy-cls\n',
  });
  const out = resolver.resolveElement(root, { classes: ['decoy-cls'] });
  const search = out.candidates.filter((c) => c.tier === 'search');
  assert.deepEqual(search.map((c) => c.file), ['src/app.js']);
  assert.equal(out.scannedFiles, 1);
});

gate('tier b caps: the file-count cap flags truncation; oversized files are skipped', () => {
  const root = scratchProject({
    'a.js': 'alpha-cls\n', 'b.js': 'alpha-cls\n', 'c.js': 'alpha-cls\n', 'd.js': 'alpha-cls\n',
  });
  const capped = resolver.resolveElement(root, { classes: ['alpha-cls'] }, { maxFiles: 2 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.scannedFiles, 2);
  assert.deepEqual(capped.candidates.filter((c) => c.tier === 'search').map((c) => c.file),
    ['a.js', 'b.js']);
  const sized = scratchProject({
    'big.js': 'padding '.repeat(64) + 'beta-cls\n',   // > the 64-byte drill cap
    'small.js': 'beta-cls\n',
  });
  const out = resolver.resolveElement(sized, { classes: ['beta-cls'] }, { maxFileBytes: 64 });
  assert.deepEqual(out.candidates.filter((c) => c.tier === 'search').map((c) => c.file),
    ['small.js']);
});

// ==========================================================================
// resolver — tier c + hygiene
// ==========================================================================

gate('tier c: the whole-context descriptor is always present, last, and low', () => {
  const rich = resolver.resolveElement(FIXTURE, heroContext());
  const last = rich.candidates[rich.candidates.length - 1];
  assert.equal(last.tier, 'context');
  assert.equal(last.confidence, 'low');
  assert.equal(last.file, null);
  assert.match(last.descriptor, /<button class="hero-cta primary">/);
  assert.match(last.descriptor, /"Get started"/);
  // A junk context still yields the honest fallback — and nothing else.
  const bare = resolver.resolveElement(FIXTURE, { selector: 42, classes: 'nope', text: null });
  assert.deepEqual(bare.candidates.map((c) => c.tier), ['context']);
});

gate('determinism: same project + same context = deep-equal output, twice', () => {
  const a = resolver.resolveElement(FIXTURE, heroContext());
  const b = resolver.resolveElement(FIXTURE, heroContext());
  assert.deepEqual(a, b);
});

gate('cleanContext: caps applied, junk classes dropped, every field total', () => {
  const ctx = resolver.cleanContext({
    selector: 'x'.repeat(1000),
    tag: 'DIV',
    classes: ['ok-cls', 'has space', '.dot', 'a'.repeat(100), 9, 'also-ok'],
    text: '  padded   whitespace  ',
    html: 'h'.repeat(10000),
  });
  assert.equal(ctx.selector.length, resolver.MAX_CTX_SELECTOR);
  assert.equal(ctx.tag, 'div');
  assert.deepEqual(ctx.classes, ['ok-cls', 'also-ok']);
  assert.equal(ctx.text, 'padded whitespace');
  assert.ok(ctx.html.length <= 4096);
  // Total over junk: never a throw, always the full shape.
  for (const junk of [undefined, null, 42, 'text', [], { classes: { a: 1 } }])
    assert.deepEqual(Object.keys(resolver.cleanContext(junk)),
      ['selector', 'tag', 'classes', 'text', 'html']);
});

gate('resolver root guards: relative or missing roots throw plain messages', () => {
  assert.throws(() => resolver.resolveElement('relative/path', {}), /absolute/);
  assert.throws(() => resolver.resolveElement(path.join(FIXTURE, 'no-such-dir'), {}), /does not exist/);
});

// ==========================================================================
// surgeon — the kickoff builder
// ==========================================================================

gate('kickoff carries element, every candidate with tier+confidence, intent, the law, the contract', () => {
  const { candidates } = resolver.resolveElement(FIXTURE, heroContext());
  const kickoff = surgeon.buildKickoff({
    displayName: 'Fixture App',
    intent: 'Make the get-started button orange.',
    context: heroContext(),
    candidates,
  });
  assert.match(kickoff, /ONE surgical strike/);
  assert.match(kickoff, /"Fixture App"/);
  assert.match(kickoff, /\[hint, high confidence\] src\/hero\.js:6/);
  assert.match(kickoff, /\[search, medium confidence\] index\.html:8/);
  assert.match(kickoff, /\[context, low confidence\] no file resolved — locate the element yourself/);
  assert.match(kickoff, /Make the get-started button orange\./);
  assert.match(kickoff, /ONE-MINIMAL-EDIT LAW/);
  assert.match(kickoff, /```apex-surgeon/);
  assert.match(kickoff, /never absolute, never \.\./);
  assert.match(kickoff, /discarded WHOLE/);
});

gate('kickoff bounds its inputs: oversized intent capped, candidate list capped', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    ({ file: 'f' + i + '.js', line: 1, tier: 'search', confidence: 'medium' }));
  const kickoff = surgeon.buildKickoff({
    intent: 'x'.repeat(5000),
    context: heroContext(),
    candidates: many,
  });
  assert.ok(kickoff.length < 6000, 'kickoff ballooned to ' + kickoff.length);
  assert.ok(!kickoff.includes('f12.js'), 'candidate list not capped');
});

// ==========================================================================
// surgeon — the apex-surgeon reply contract
// ==========================================================================

gate('a valid reply parses; unknown fields are dropped by construction', () => {
  const raw = validReport();
  raw.cwd = 'C:/somewhere';                    // hostile extras on the report
  raw.command = 'rm -rf';
  raw.edits[0].persona = 'architect';          // ... and on an edit
  const { result, error } = surgeon.parseReply(surgeonFence(raw));
  assert.equal(error, null);
  assert.deepEqual(result, {
    summary: 'Recolored the hero CTA per the intent.',
    edits: [{ file: 'styles/site.css', kind: 'modified',
      hunks: '-  background: #4c8dff;\n+  background: #e0763f;' }],
  });
});

gate('last block wins: a reply that corrects itself is judged on its final word', () => {
  const text = surgeonFence(validReport({ summary: 'First attempt.' })) +
    '\nActually, one more check...\n' +
    surgeonFence(validReport({ summary: 'Final word.' }));
  const { result, error } = surgeon.parseReply(text);
  assert.equal(error, null);
  assert.equal(result.summary, 'Final word.');
});

gate('no block / non-JSON / non-object all fail closed', () => {
  assert.deepEqual(surgeon.parseReply('no fence here'), { result: null, error: 'no-report' });
  assert.deepEqual(surgeon.parseReply(surgeonFence('{ not json')), { result: null, error: 'malformed-report' });
  assert.deepEqual(surgeon.parseReply(surgeonFence('[1,2]')), { result: null, error: 'malformed-report' });
  assert.deepEqual(surgeon.parseReply(surgeonFence('"just a string"')), { result: null, error: 'malformed-report' });
});

gate('summary discipline: missing/empty required, oversized fails closed (never truncated)', () => {
  assert.equal(surgeon.parseReply(surgeonFence({ edits: [] })).error, 'missing-summary');
  assert.equal(surgeon.parseReply(surgeonFence(validReport({ summary: '   ' }))).error, 'missing-summary');
  assert.equal(surgeon.parseReply(surgeonFence(validReport({ summary: 'x'.repeat(surgeon.SUMMARY_CAP + 1) }))).error,
    'oversized-summary');
});

gate('7 edits fail closed; 6 pass; edits must be an array', () => {
  const edit = (i) => ({ file: 'src/f' + i + '.js', kind: 'modified' });
  const seven = validReport({ edits: Array.from({ length: 7 }, (_, i) => edit(i)) });
  assert.equal(surgeon.parseReply(surgeonFence(seven)).error, 'too-many-edits');
  const six = validReport({ edits: Array.from({ length: 6 }, (_, i) => edit(i)) });
  assert.equal(surgeon.parseReply(surgeonFence(six)).error, null);
  assert.equal(surgeon.parseReply(surgeonFence(validReport({ edits: 'none' }))).error, 'missing-edits');
});

gate('absolute edit paths fail the whole reply closed — every flavor', () => {
  const absolutes = ['C:' + String.fromCharCode(92) + 'evil.js', '/etc/passwd',
    String.fromCharCode(92) + String.fromCharCode(92) + 'share' + String.fromCharCode(92) + 'x.js',
    'src/file.js:stream', '~/dotfile'];
  for (const file of absolutes) {
    const { result, error } = surgeon.parseReply(surgeonFence(validReport({
      edits: [{ file: 'legit.js', kind: 'modified' }, { file, kind: 'modified' }],
    })));
    assert.equal(result, null, file + ' should fail the reply whole');
    assert.equal(error, 'absolute-edit-path', file);
  }
});

gate('traversal edit paths fail closed', () => {
  for (const file of ['../outside.js', 'src/../../out.js', '..']) {
    assert.equal(surgeon.parseReply(surgeonFence(validReport({
      edits: [{ file, kind: 'modified' }],
    }))).error, 'traversal-edit-path', file);
  }
});

gate('malformed edits fail closed: non-object, control chars, bad kind, bad hunks', () => {
  const cases = [
    [{ edits: ['string-edit'] }, 'malformed-edit'],
    [{ edits: [{ file: 'a' + NUL + '.js', kind: 'modified' }] }, 'malformed-edit'],
    [{ edits: [{ file: '', kind: 'modified' }] }, 'malformed-edit'],
    [{ edits: [{ file: 'a.js', kind: 'deleted' }] }, 'unknown-edit-kind'],
    [{ edits: [{ file: 'a.js', kind: 'modified', hunks: 42 }] }, 'malformed-edit'],
    [{ edits: [{ file: 'a.js', kind: 'modified', hunks: 'x'.repeat(surgeon.HUNKS_CAP + 1) }] }, 'oversized-hunks'],
  ];
  for (const [overrides, expected] of cases)
    assert.equal(surgeon.parseReply(surgeonFence(validReport(overrides))).error, expected,
      JSON.stringify(overrides).slice(0, 80));
});

gate('followup discipline: optional, trimmed, oversized/non-string fail closed', () => {
  const ok = surgeon.parseReply(surgeonFence(validReport({ followup: '  delegate  ' })));
  assert.equal(ok.error, null);
  assert.equal(ok.result.followup, 'delegate');
  assert.equal(surgeon.parseReply(surgeonFence(validReport({ followup: 42 }))).error, 'malformed-followup');
  assert.equal(surgeon.parseReply(surgeonFence(validReport({ followup: '  ' }))).error, 'malformed-followup');
  assert.equal(surgeon.parseReply(surgeonFence(validReport({ followup: 'x'.repeat(501) }))).error,
    'oversized-followup');
});

// ==========================================================================
// surgeon — the bigger-than-a-boom demote detector
// ==========================================================================

gate('demote: above the edit threshold flags with a quotable reason', () => {
  const edit = (i) => ({ file: 'f' + i + '.js', kind: 'modified' });
  const four = surgeon.detectDemote({ summary: 's', edits: [edit(1), edit(2), edit(3), edit(4)] });
  assert.equal(four.demote, true);
  assert.match(four.reasons[0], /4 edits/);
  const three = surgeon.detectDemote({ summary: 's', edits: [edit(1), edit(2), edit(3)] });
  assert.deepEqual(three, { demote: false, reasons: [] });
  // The threshold is injectable (the createPickLimiter seam idiom).
  assert.equal(surgeon.detectDemote({ summary: 's', edits: [edit(1), edit(2)] }, 1).demote, true);
});

gate('demote: followup "delegate" flags even at one edit; null result never demotes', () => {
  const one = surgeon.detectDemote({
    summary: 's', edits: [{ file: 'a.js', kind: 'modified' }], followup: 'delegate',
  });
  assert.equal(one.demote, true);
  assert.match(one.reasons[0], /asked to delegate/);
  assert.equal(surgeon.detectDemote({
    summary: 's', edits: [{ file: 'a.js', kind: 'modified' }], followup: 'check the tests',
  }).demote, false);
  assert.deepEqual(surgeon.detectDemote(null), { demote: false, reasons: [] });
});

gate('never throws: a junk corpus through every entry point', () => {
  const circular = {};
  circular.self = circular;
  const corpus = [undefined, null, true, 42, 'text', [], {}, circular,
    { summary: circular }, { summary: 's', edits: [circular] }];
  for (const junk of corpus) {
    assert.doesNotThrow(() => surgeon.validateReport(junk));
    assert.doesNotThrow(() => surgeon.detectDemote(junk));
    assert.doesNotThrow(() => surgeon.buildKickoff({ context: junk, candidates: junk, intent: junk }));
    assert.doesNotThrow(() => resolver.cleanContext(junk));
    assert.doesNotThrow(() => resolver.parseSourceHints(junk, FIXTURE));
  }
  assert.doesNotThrow(() => surgeon.parseReply(undefined));
  assert.doesNotThrow(() => surgeon.buildKickoff());
});

console.log(`\nSTUDIO SURGEON: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
