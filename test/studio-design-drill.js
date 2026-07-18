// App Builder — headless drill for STUDIO v2 slice A2 (the tokens compiler):
// lib/design.js's deterministic look → design/tokens.json compile, the
// documented-house-defaults degradation story, creator.js writing the tokens
// inside its one atomic rename, and validateProjectPackage's tokens rules
// (malformed = error; absent = warning on schema 2, silent on schema 1).
// No Electron, no network, zero LLM spend. Run: node test/studio-design-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const design = require('../extensions/studio/lib/design');
const contract = require('../extensions/studio/lib/contract');
const creator = require('../extensions/studio/lib/creator');
const blueprint = require('../extensions/studio/lib/blueprint');
const { CARDS } = require('../extensions/studio/lib/interview');

const FIXTURES = path.join(__dirname, 'studio-fixtures');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-design-'));
let passed = 0, failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.message); }
}

function stage(fixture, projectId) {
  const workspace = fs.mkdtempSync(path.join(scratch, 'ws-'));
  const dir = path.join(workspace, projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(FIXTURES, fixture), dir, { recursive: true });
  return { workspace, dir };
}

// A complete draft whose look answer exercises every mapping table.
const LOOK_ANSWER = 'Dark, near-black surfaces with one amber accent. ' +
  'Type feels technical: monospace numbers. Dense but calm — tight rows, quiet chrome.';
function fullDraft(name) {
  const d = { name, pitch: 'Scores entries.', answers: {} };
  for (const c of CARDS) d.answers[c.key] = c.key + ' answer '.repeat(20);
  d.answers.look = LOOK_ANSWER;
  return d;
}

// ==========================================================================
// lib/design.js — the deterministic compile
// ==========================================================================

gate('compile determinism: two runs on the same look are byte-for-byte identical', () => {
  for (const look of [{ response: LOOK_ANSWER }, { response: '' }, undefined]) {
    const one = design.serializeTokens(design.compileTokens(look).tokens);
    const two = design.serializeTokens(design.compileTokens(look).tokens);
    assert.strictEqual(one, two, JSON.stringify(look));
    assert.ok(one.endsWith('\n'));
  }
});

gate('serializeTokens is a canonical serializer: insertion order never leaks into the bytes', () => {
  const compiled = design.compileTokens({ response: LOOK_ANSWER }).tokens;
  // Rebuild the same values with a hostile (reversed) key insertion order.
  const shuffle = (obj) => {
    if (Array.isArray(obj)) return obj.map(shuffle);
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const key of Object.keys(obj).reverse()) out[key] = shuffle(obj[key]);
    return out;
  };
  assert.strictEqual(design.serializeTokens(shuffle(compiled)), design.serializeTokens(compiled));
});

gate('keyword mapping: dark/amber/technical/dense/calm words land in the tokens as chosen', () => {
  const { tokens, warnings } = design.compileTokens({ response: LOOK_ANSWER });
  assert.deepEqual(warnings, []);
  assert.deepEqual(tokens.source,
    { palette: 'look', accent: 'look', type: 'look', density: 'look', tone: 'look' });
  assert.equal(tokens.color.bg, '#0f1115');            // dark palette
  assert.equal(tokens.color.accent, '#e3a44a');        // amber, dark variant
  assert.equal(tokens.type.feel, 'technical');
  assert.equal(tokens.type.family.detail, 'monospace');
  assert.deepEqual(tokens.space.steps, [2, 4, 8, 12, 16, 24, 32]);  // dense
  assert.equal(tokens.motion.fast, '140ms');           // calm tone
  for (const role of design.COLOR_ROLES)
    assert.match(tokens.color[role], /^#[0-9a-f]{6}$/, role);
  assert.ok(!/house default/.test(tokens.summary), tokens.summary);
});

gate('the earliest-named hue wins the accent (the one accent that matters)', () => {
  const blueFirst = design.compileTokens({ response: 'light, a blue accent with red error states' });
  assert.equal(blueFirst.tokens.color.accent, '#2458c5'); // blue, light variant
  const dark = design.compileTokens({ response: 'light text on a dark ground' });
  assert.equal(dark.tokens.color.bg, '#0f1115', 'documented tiebreak: dark before light');
});

gate('absent look degrades to the documented house defaults with a warning, never a block', () => {
  for (const look of [undefined, null, { response: '' }, '']) {
    const { tokens, warnings } = design.compileTokens(look);
    assert.deepEqual(warnings,
      ['The look area has no answer — the design tokens use the documented house defaults.']);
    assert.deepEqual(tokens.source,
      { palette: 'default', accent: 'default', type: 'default', density: 'default', tone: 'default' });
    // The house style: dark surfaces, blue accent, plain type, regular, even.
    assert.equal(tokens.color.bg, '#0f1115');
    assert.equal(tokens.color.accent, '#4c8dff');
    assert.equal(tokens.type.feel, 'plain');
    // Honesty: the summary SAYS these are defaults, not choices.
    assert.equal((tokens.summary.match(/\(house default\)/g) || []).length, 5, tokens.summary);
  }
});

gate('unparseable look prose degrades honestly: defaults never presented as chosen', () => {
  const { tokens, warnings } = design.compileTokens({ response: 'qwerty zxcvb 12345 lorem ipsum' });
  assert.deepEqual(warnings,
    ['The look answer contains no palette, type, density, or tone words the token compiler recognizes — the design tokens use the documented house defaults.']);
  assert.deepEqual(tokens.source,
    { palette: 'default', accent: 'default', type: 'default', density: 'default', tone: 'default' });
  assert.match(tokens.summary, /\(house default\)/);
  // A PARTIAL answer keeps what it said and defaults only the rest, silently
  // in the warnings (the source map + summary carry the honesty).
  const partial = design.compileTokens({ response: 'just make it dark please' });
  assert.deepEqual(partial.warnings, []);
  assert.equal(partial.tokens.source.palette, 'look');
  assert.equal(partial.tokens.source.tone, 'default');
  assert.match(partial.tokens.summary, /Dark surfaces with a blue accent \(house default\)/);
});

// ==========================================================================
// creator.js — the tokens ride the one atomic rename
// ==========================================================================

gate('package round-trip: Create writes design/tokens.json inside the atomic package and it validates', () => {
  const ws = fs.mkdtempSync(path.join(scratch, 'rt-'));
  const bundle = blueprint.buildBundle(fullDraft('SniperSight'), 'snipersight');
  const created = creator.createProjectPackage(ws, bundle);
  const tokensFile = path.join(created.projectDir, 'design', 'tokens.json');
  assert.ok(fs.existsSync(tokensFile));
  // The written bytes ARE the deterministic compile — round-trip exact.
  assert.strictEqual(fs.readFileSync(tokensFile, 'utf8'),
    design.serializeTokens(design.compileTokens(bundle.blueprint.look).tokens));
  assert.equal(created.design.summary, JSON.parse(fs.readFileSync(tokensFile, 'utf8')).summary);
  // The create-time digest carries the compiled summary (never the canonical).
  assert.match(fs.readFileSync(path.join(created.projectDir, 'project-context.md'), 'utf8'),
    new RegExp('## Design\\n' + created.design.summary.replace(/[()]/g, '\\$&')));
  assert.ok(!fs.readFileSync(path.join(created.projectDir, 'PROJECT.md'), 'utf8')
    .includes(created.design.summary), 'canonical stays approved-answers-only');
  const report = contract.validateProjectPackage(ws, 'snipersight');
  assert.equal(report.valid, true, JSON.stringify(report.errors));
  assert.ok(!report.warnings.some((w) => w.code === 'missing-tokens'), JSON.stringify(report.warnings));
});

// ==========================================================================
// contract.js — validateProjectPackage learns design/tokens.json
// ==========================================================================

gate('malformed tokens.json is an error: bad JSON, wrong schema, missing role', () => {
  const broken = [
    ['not json at all {', 'invalid-json', /Cannot parse tokens\.json/],
    [JSON.stringify({ schema: 99 }), 'invalid-tokens', /tokens schema 99, but this builder only understands schema 1/],
    [(() => { // valid schema, but the accent role is gone
      const t = JSON.parse(design.serializeTokens(design.compileTokens({ response: LOOK_ANSWER }).tokens));
      delete t.color.accent;
      return JSON.stringify(t);
    })(), 'invalid-tokens', /"accent" color role is missing or is not a "#rrggbb" value/],
  ];
  for (const [content, code, message] of broken) {
    const { workspace, dir } = stage('valid', 'valid-project');
    fs.writeFileSync(path.join(dir, 'design', 'tokens.json'), content);
    const result = contract.validateProjectPackage(workspace, 'valid-project');
    assert.equal(result.valid, false, content.slice(0, 30));
    const hit = result.errors.find((e) => e.code === code);
    assert.ok(hit, JSON.stringify(result.errors));
    assert.match(hit.message, message);
  }
});

gate('absent tokens.json: a warning on schema 2, never a block', () => {
  const { workspace, dir } = stage('valid', 'valid-project');
  fs.rmSync(path.join(dir, 'design'), { recursive: true });
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const hit = result.warnings.find((w) => w.code === 'missing-tokens');
  assert.ok(hit, JSON.stringify(result.warnings));
  assert.equal(hit.message,
    'This project has no design/tokens.json yet — run Create again (regenerating the package) to add the compiled design tokens.');
});

gate('absent tokens.json on a schema-1 package stays SILENT (it predates the contract)', () => {
  const { workspace } = stage('valid-v1', 'valid-project');
  const imported = contract.validateProjectPackage(workspace, 'valid-project', { mode: 'import' });
  assert.equal(imported.valid, true, JSON.stringify(imported.errors));
  assert.ok(!imported.warnings.some((w) => w.code === 'missing-tokens'), JSON.stringify(imported.warnings));
  const native = contract.validateProjectPackage(workspace, 'valid-project');
  assert.ok(!native.warnings.some((w) => w.code === 'missing-tokens'), JSON.stringify(native.warnings));
});

gate('an unparseable look answer surfaces as a validation warning, not an error', () => {
  const { workspace, dir } = stage('valid', 'valid-project');
  const bp = JSON.parse(fs.readFileSync(path.join(dir, 'blueprint.json'), 'utf8'));
  bp.look = { response: 'zzz gibberish nothing usable' };
  fs.writeFileSync(path.join(dir, 'blueprint.json'), JSON.stringify(bp, null, 2));
  const result = contract.validateProjectPackage(workspace, 'valid-project');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.ok(result.warnings.some((w) => w.code === 'unparsed-look' &&
    /no palette, type, density, or tone words/.test(w.message)), JSON.stringify(result.warnings));
});

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\nSTUDIO DESIGN TOKENS: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
