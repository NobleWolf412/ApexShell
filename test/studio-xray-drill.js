// App Builder — headless drill for STUDIO v2 slice D1 (the X-ray diagram
// contract): lib/xray.js's mermaid allowlist grammar (every accepted line
// kind, every named refusal), the fail-closed reply contract, the A3-idiom
// provenance + staleness rule, the deterministic no-AI fallback, and the
// fallback's self-consistency against the module's OWN validator.
// No Electron, no network, zero LLM spend. Run: node test/studio-xray-drill.js
'use strict';

const assert = require('assert');

const xray = require('../extensions/studio/lib/xray');

let passed = 0, failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.message); }
}

function fence(source) {
  return 'Here is the diagram.\n\n```mermaid\n' + source + '\n```\nDone.';
}

const GOOD_HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

// One diagram exercising EVERY accepted line kind: header, every node shape
// (bare, [..], (..), ((..)), {..}, [[..]], [(..)], {{..}}), plain/labelled/
// chained edges in all four arrow forms, both subgraph spellings, direction,
// classDef/class/style, quoted and bare labels, indentation, a trailing `;`.
const VALID_DIAGRAM = [
  'flowchart TD',
  '  user(("User"))',
  '  home["Home screen"]',
  '  api(API layer)',
  '  db[("Data store")]',
  '  job[[Worker]]',
  '  hex{{Choice}}',
  '  gate{"Signed in?"}',
  '  user --> home;',
  '  home -->|opens| api',
  '  home --> |spaced label| api',
  '  api --> db --> job',
  '  api -.-> hex',
  '  api ==> gate',
  '  home --- api',
  '  subgraph backend["The backend"]',
  '    direction LR',
  '    api2["Second api"]',
  '  end',
  '  subgraph Plain group',
  '    x["X"]',
  '  end',
  '  classDef hot fill:#0f1115,stroke:#4c8dff,stroke-width:2px',
  '  class api,db hot',
  '  style home fill:#171a20',
].join('\n');

// ==========================================================================
// the allowlist grammar — acceptance
// ==========================================================================

gate('a diagram of every accepted line kind validates clean', () => {
  assert.deepEqual(xray.validateMermaidSource(VALID_DIAGRAM), []);
});

gate('parseLlmReply accepts prose around exactly one valid fence', () => {
  const { source, error } = xray.parseLlmReply(fence(VALID_DIAGRAM));
  assert.equal(error, null);
  assert.strictEqual(source, VALID_DIAGRAM);
});

gate('graph + every direction spelling head a valid diagram', () => {
  for (const header of ['graph LR', 'flowchart TB', 'flowchart BT', 'flowchart RL'])
    assert.deepEqual(xray.validateMermaidSource(header + '\n  a --> b'), [], header);
});

// ==========================================================================
// the named refusals — every forbidden directive, individually
// ==========================================================================

gate('every forbidden keyword is rejected by NAME, even inside a label', () => {
  const vectors = [
    ['  click home callback "doThing"', 'click'],
    ['  click home href "https://evil.example" _blank', 'click'],
    ['  cb["the callback registry"]', 'callback'],
    ['  a["see the href docs"]', 'href'],
    ['%%{init: {"theme":"dark"}}%%', '%%'],
    ['%% an innocent comment', '%%'],
  ];
  for (const [line, keyword] of vectors) {
    const problems = xray.validateMermaidSource('flowchart TD\n  a --> b\n' + line);
    assert.ok(problems.some((p) => p.includes('forbidden mermaid keyword "' + keyword + '"')),
      line + ' → ' + JSON.stringify(problems));
    const reply = xray.parseLlmReply(fence('flowchart TD\n  a --> b\n' + line));
    assert.equal(reply.source, null, line);
    assert.match(reply.error, /forbidden mermaid keyword/);
  }
});

gate('any line outside the allowlist grammar fails the whole diagram', () => {
  const vectors = [
    'linkStyle 0 stroke:red',              // not in the accepted language
    'a["<b>bold</b>"]',                    // HTML in a label
    'a --> b & c',                         // multi-target syntax not allowed
    'accTitle: sneaky',                    // any other mermaid directive
    'a -- text line --> b',                // the --text--> edge form not allowed
  ];
  for (const line of vectors) {
    const problems = xray.validateMermaidSource('flowchart TD\n' + line);
    assert.ok(problems.some((p) => p.includes('not on the allowlist grammar')),
      line + ' → ' + JSON.stringify(problems));
    assert.equal(xray.parseLlmReply(fence('flowchart TD\n' + line)).source, null, line);
  }
});

// ==========================================================================
// structure — header discipline, subgraph balance, caps
// ==========================================================================

gate('the flowchart directive must exist, come first, and come once', () => {
  assert.ok(xray.validateMermaidSource('a --> b')
    .some((p) => p.includes('must open with a flowchart or graph directive')));
  assert.ok(xray.validateMermaidSource('a --> b\nflowchart TD')
    .some((p) => p.includes('must be the first line')));
  assert.ok(xray.validateMermaidSource('flowchart TD\na --> b\ngraph LR')
    .some((p) => p.includes('second flowchart directive')));
});

gate('subgraph/end must balance both ways', () => {
  assert.ok(xray.validateMermaidSource('flowchart TD\nend')
    .some((p) => p.includes('an "end" with no open subgraph')));
  assert.ok(xray.validateMermaidSource('flowchart TD\nsubgraph Open')
    .some((p) => p.includes('never closed')));
});

gate('empty, oversized, and overlong-line diagrams fail closed', () => {
  for (const empty of ['', '   \n  \n', null, undefined, 42])
    assert.deepEqual(xray.validateMermaidSource(empty), ['the diagram is empty'], String(empty));
  // Byte cap: 200 lines of ~250 chars ≈ 50 KB — under the line cap, over 32 KB.
  const fat = 'flowchart TD\n' +
    Array.from({ length: 200 }, (_, i) => 'n' + i + '["' + 'x '.repeat(120) + '"]').join('\n');
  assert.ok(xray.validateMermaidSource(fat).some((p) => p.includes('32 KB limit')));
  assert.match(xray.parseLlmReply(fence(fat)).error, /32 KB limit/);
  // Line-count cap.
  const tall = 'flowchart TD\n' +
    Array.from({ length: xray.MAX_DIAGRAM_LINES + 1 }, (_, i) => 'n' + i).join('\n');
  assert.ok(xray.validateMermaidSource(tall).some((p) => p.includes('-line limit')));
  // Per-line cap.
  const wide = 'flowchart TD\na["' + 'y'.repeat(xray.MAX_LINE_CHARS) + '"]';
  assert.ok(xray.validateMermaidSource(wide).some((p) => p.includes('character line limit')));
});

gate('non-mermaid and multi-block replies fail closed', () => {
  assert.deepEqual(xray.parseLlmReply('Sure! Here is a description with no fence.'),
    { source: null, error: 'no ```mermaid fenced block in the reply' });
  assert.match(xray.parseLlmReply('```json\n{"not": "mermaid"}\n```').error,
    /no ```mermaid fenced block/);
  const two = fence('flowchart TD\na --> b') + '\n' + fence('flowchart TD\nc --> d');
  assert.deepEqual(xray.parseLlmReply(two),
    { source: null, error: 'the reply carries 2 mermaid blocks — the contract is exactly one diagram' });
  for (const junk of [null, undefined, '', 42])
    assert.equal(xray.parseLlmReply(junk).source, null, String(junk));
});

// ==========================================================================
// the prompt builder — deterministic, honest about gaps, carries the contract
// ==========================================================================

gate('buildDiagramPrompt is deterministic and carries the digest + the hard rules', () => {
  const bp = {
    idea: { response: 'A recipe box for one household.' },
    platform: { response: 'Web app in the browser.' },
    architecture: { response: 'A REST API over a Postgres database with a worker queue.' },
  };
  const prompt = xray.buildDiagramPrompt(bp);
  assert.strictEqual(prompt, xray.buildDiagramPrompt(bp), 'two builds differ');
  assert.match(prompt, /- idea: A recipe box for one household\./);
  assert.match(prompt, /- platform: Web app in the browser\./);
  assert.match(prompt, /- architecture: A REST API over a Postgres database/);
  assert.match(prompt, /```mermaid/);
  assert.match(prompt, /flowchart TD/);
  assert.match(prompt, /NO click, callback, or href lines, no %% comments, no %%\{init\} blocks\./);
  assert.match(prompt, /Under 32 KB total\./);
  assert.match(prompt, /discarded whole/);
});

gate('unanswered areas read "(unanswered)" and long areas are capped, never invented', () => {
  const prompt = xray.buildDiagramPrompt({
    architecture: { response: 'core '.repeat(400) + 'ZZZEND' },
  });
  assert.match(prompt, /- idea: \(unanswered\)/);
  assert.match(prompt, /- platform: \(unanswered\)/);
  assert.ok(!prompt.includes('ZZZEND'), 'architecture digest is not capped');
  assert.match(xray.buildDiagramPrompt(undefined), /- architecture: \(unanswered\)/);
});

// ==========================================================================
// provenance — the A3 sidecar idiom on a pure record
// ==========================================================================

gate('provenance carries schema/source/hash/generatedAt/bytes and refuses bad anchors', () => {
  const record = xray.buildProvenance(GOOD_HASH, 'llm', VALID_DIAGRAM);
  assert.equal(record.schema, xray.DIAGRAM_PROVENANCE_SCHEMA);
  assert.equal(record.source, 'llm');
  assert.equal(record.canonicalHash, GOOD_HASH);
  assert.ok(!Number.isNaN(Date.parse(record.generatedAt)), record.generatedAt);
  assert.equal(record.bytes, Buffer.byteLength(VALID_DIAGRAM, 'utf8'));
  assert.equal(xray.buildProvenance(GOOD_HASH, 'derived', 'flowchart TD').source, 'derived');
  assert.throws(() => xray.buildProvenance('not-a-hash', 'llm', 'flowchart TD'), /canonical hash/);
  assert.throws(() => xray.buildProvenance(GOOD_HASH, 'human', 'flowchart TD'), /"llm" or "derived"/);
  assert.throws(() => xray.buildProvenance(GOOD_HASH, 'llm', '  '), /diagram source text/);
});

gate('the drift rule: hash mismatch = stale; no provenance = not generated, not stale', () => {
  const record = xray.buildProvenance(GOOD_HASH, 'llm', VALID_DIAGRAM);
  assert.equal(xray.isDiagramStale(record, GOOD_HASH), false);
  assert.equal(xray.isDiagramStale(record, OTHER_HASH), true);
  assert.equal(xray.isDiagramStale(record, undefined), true, 'source of truth gone = stale');
  for (const junk of [null, undefined, {}, { schema: 99, canonicalHash: GOOD_HASH },
    { schema: 1, canonicalHash: 'zz' }])
    assert.equal(xray.isDiagramStale(junk, GOOD_HASH), false, JSON.stringify(junk));
});

// ==========================================================================
// the deterministic fallback — and its self-consistency vs the validator
// ==========================================================================

gate('fallback determinism: same blueprint in, same bytes out', () => {
  const bp = { architecture: { response: 'A web dashboard over a REST API and a Postgres database, with background workers.' } };
  assert.strictEqual(xray.deriveFallbackDiagram(bp).source, xray.deriveFallbackDiagram(bp).source);
  assert.strictEqual(xray.deriveFallbackDiagram({}).source, xray.deriveFallbackDiagram(undefined).source);
});

gate('fallback detects component nouns and wires tiers deterministically', () => {
  const { source, components } = xray.deriveFallbackDiagram({
    architecture: { response: 'A web dashboard over a REST API and a Postgres database, with background workers.' },
  });
  assert.deepEqual(components, ['ui', 'api', 'db', 'queue']);
  assert.ok(source.includes('user --> ui["User interface"]'), source);
  assert.ok(source.includes('ui --> api["API / services"]'), source);
  assert.ok(source.includes('api --> db["Data store"]'), source);
  assert.ok(source.includes('api --> queue["Jobs / queue"]'), source);
});

gate('fallback with no lower tier wires from the user node; empty area yields the minimal app', () => {
  const dbOnly = xray.deriveFallbackDiagram({ architecture: { response: 'just sqlite storage' } });
  assert.deepEqual(dbOnly.components, ['db']);
  assert.ok(dbOnly.source.includes('user --> db["Data store"]'), dbOnly.source);
  const empty = xray.deriveFallbackDiagram({ architecture: { response: 'qwerty nothing recognizable' } });
  assert.deepEqual(empty.components, ['app']);
  assert.ok(empty.source.includes('user --> app["The app"]'), empty.source);
});

gate('self-consistency: every fallback output passes the module\'s own allowlist', () => {
  const blueprints = [
    undefined,
    {},
    { architecture: { response: 'A web dashboard over a REST API and a Postgres database, with background workers.' } },
    { architecture: { response: 'cli tool with a core engine, redis cache, file uploads, oauth login, and webhooks' } },
    { architecture: { response: 'just sqlite storage' } },
  ];
  for (const bp of blueprints) {
    const { source } = xray.deriveFallbackDiagram(bp);
    assert.deepEqual(xray.validateMermaidSource(source), [],
      JSON.stringify(bp && bp.architecture));
    assert.equal(xray.parseLlmReply(fence(source)).error, null, 'fallback via the reply contract');
  }
});

console.log(`\nSTUDIO XRAY: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
