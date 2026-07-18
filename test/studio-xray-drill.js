// App Builder — headless drill for STUDIO v2 slices D1 + D2 (the X-ray):
// lib/xray.js's mermaid allowlist grammar (every accepted line kind, every
// named refusal), the fail-closed reply contract, the A3-idiom provenance +
// staleness rule, the deterministic no-AI fallback and its self-consistency
// against the module's OWN validator; D2 adds parseValidated (the
// ARCHITECTURE step's layout input — refuses whatever the validator
// refuses), collectDiagram (the Create-time copy rule), and the
// prepare→approve→run→result bus machinery for the diagram pass — driven
// exactly like test/studio-mockup-drill.js: a fake bus + a stubbed
// ctx.seats.startDisposable, zero real LLM spend.
// Run: node test/studio-xray-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const xray = require('../extensions/studio/lib/xray');
const studio = require('../extensions/studio/main');
const drafts = require('../extensions/studio/lib/drafts');
const blueprint = require('../extensions/studio/lib/blueprint');
const modelPicker = require('../extensions/studio/lib/modelPicker');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-xray-'));

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

// ==========================================================================
// D2: parseValidated — the ARCHITECTURE step's layout input
// ==========================================================================

gate('parseValidated reads every accepted line kind into the layout input', () => {
  const out = xray.parseValidated(VALID_DIAGRAM);
  assert.equal(out.direction, 'TD');
  const byId = new Map(out.nodes.map((n) => [n.id, n]));
  // every node shape, by name
  assert.deepEqual(byId.get('user'), { id: 'user', label: 'User', shape: 'circle' });
  assert.deepEqual(byId.get('home'), { id: 'home', label: 'Home screen', shape: 'rect' });
  assert.deepEqual(byId.get('api'), { id: 'api', label: 'API layer', shape: 'round' });
  assert.deepEqual(byId.get('db'), { id: 'db', label: 'Data store', shape: 'cylinder' });
  assert.deepEqual(byId.get('job'), { id: 'job', label: 'Worker', shape: 'subroutine' });
  assert.deepEqual(byId.get('hex'), { id: 'hex', label: 'Choice', shape: 'hexagon' });
  assert.deepEqual(byId.get('gate'), { id: 'gate', label: 'Signed in?', shape: 'diamond' });
  // plain/labelled/chained edges in all four arrow styles
  const has = (edge) => out.edges.some((e) =>
    e.from === edge.from && e.to === edge.to && e.label === edge.label && e.style === edge.style);
  assert.ok(has({ from: 'user', to: 'home', label: null, style: 'solid' }));
  assert.ok(has({ from: 'home', to: 'api', label: 'opens', style: 'solid' }));
  assert.ok(has({ from: 'home', to: 'api', label: 'spaced label', style: 'solid' }));
  assert.ok(has({ from: 'api', to: 'db', label: null, style: 'solid' }), 'chain first hop');
  assert.ok(has({ from: 'db', to: 'job', label: null, style: 'solid' }), 'chain second hop');
  assert.ok(has({ from: 'api', to: 'hex', label: null, style: 'dotted' }));
  assert.ok(has({ from: 'api', to: 'gate', label: null, style: 'thick' }));
  assert.ok(has({ from: 'home', to: 'api', label: null, style: 'open' }));
  // both subgraph spellings, with the nodes defined inside them
  assert.deepEqual(out.subgraphs, [
    { id: 'backend', label: 'The backend', nodes: ['api2'] },
    { id: null, label: 'Plain group', nodes: ['x'] },
  ]);
  // every edge endpoint is a known node — the layout's own precondition
  for (const e of out.edges) {
    assert.ok(byId.has(e.from), e.from);
    assert.ok(byId.has(e.to), e.to);
  }
});

gate('parseValidated is deterministic and refuses what the validator refuses', () => {
  assert.deepEqual(xray.parseValidated(VALID_DIAGRAM), xray.parseValidated(VALID_DIAGRAM));
  assert.throws(() => xray.parseValidated('a --> b'), /refuses what the validator refuses/);
  assert.throws(() => xray.parseValidated('flowchart TD\n  click a callback "x"'), /refuses/);
  assert.throws(() => xray.parseValidated(''), /refuses/);
  assert.throws(() => xray.parseValidated(null), /refuses/);
});

gate('parseValidated: abutting arrows and arrow-shaped label text never split wrong', () => {
  // `a-->b` backs the greedy ID off the arrow; `---` inside a label stays label
  const tight = xray.parseValidated('flowchart TD\na-->b');
  assert.deepEqual(tight.nodes.map((n) => n.id), ['a', 'b']);
  assert.deepEqual(tight.edges, [{ from: 'a', to: 'b', label: null, style: 'solid' }]);
  const trap = xray.parseValidated('flowchart TD\nn["x --- y"] -->|a --- b| m');
  assert.deepEqual(trap.nodes.map((n) => n.id), ['n', 'm']);
  assert.equal(trap.nodes[0].label, 'x --- y');
  assert.deepEqual(trap.edges, [{ from: 'n', to: 'm', label: 'a --- b', style: 'solid' }]);
});

gate('every fallback source parses: endpoints known, one edge per component', () => {
  const blueprints = [
    undefined,
    {},
    { architecture: { response: 'A web dashboard over a REST API and a Postgres database, with background workers.' } },
    { architecture: { response: 'cli tool with a core engine, redis cache, file uploads, oauth login, and webhooks' } },
    { architecture: { response: 'just sqlite storage' } },
  ];
  for (const bp of blueprints) {
    const { source, components } = xray.deriveFallbackDiagram(bp);
    const parsed = xray.parseValidated(source);
    const ids = new Set(parsed.nodes.map((n) => n.id));
    assert.ok(ids.has('user'));
    for (const c of components) assert.ok(ids.has(c), c);
    assert.equal(parsed.edges.length, components.length, source);
    for (const e of parsed.edges) {
      assert.ok(ids.has(e.from), e.from);
      assert.ok(ids.has(e.to), e.to);
    }
  }
});

// ==========================================================================
// D2: collectDiagram — the Create-time copy rule
// ==========================================================================

gate('collectDiagram: a CURRENT AI diagram rides verbatim; stale or absent falls back derived', () => {
  const preview = {
    generatedCanonicalHash: GOOD_HASH,
    blueprint: { architecture: { response: 'a web dashboard over a REST api' } },
  };
  // no approved preview = nothing to copy into
  assert.equal(xray.collectDiagram(null), null);
  assert.equal(xray.collectDiagram({ preview: null }), null);
  // no stored diagram → the free fallback, anchored to the approved hash
  const derived = xray.collectDiagram({ preview });
  assert.equal(derived.provenance.source, 'derived');
  assert.equal(derived.provenance.canonicalHash, GOOD_HASH);
  assert.strictEqual(derived.mermaid, xray.deriveFallbackDiagram(preview.blueprint).source);
  assert.deepEqual(xray.validateMermaidSource(derived.mermaid), []);
  // a current AI diagram rides verbatim
  const provenance = xray.buildProvenance(GOOD_HASH, 'llm', VALID_DIAGRAM);
  const current = xray.collectDiagram({ preview, diagram: { mermaid: VALID_DIAGRAM, provenance } });
  assert.strictEqual(current.mermaid, VALID_DIAGRAM);
  assert.equal(current.provenance.source, 'llm');
  // a STALE AI diagram never enters a package — the derived fallback rides
  const staleProv = xray.buildProvenance(OTHER_HASH, 'llm', VALID_DIAGRAM);
  const replaced = xray.collectDiagram({ preview, diagram: { mermaid: VALID_DIAGRAM, provenance: staleProv } });
  assert.equal(replaced.provenance.source, 'derived');
  assert.equal(replaced.provenance.canonicalHash, GOOD_HASH);
  assert.notStrictEqual(replaced.mermaid, VALID_DIAGRAM);
});

// ==========================================================================
// D2: main.js bus wiring — prepare/approve/TTL/single-flight/backstop, the
// A3 machinery verb-for-verb, landing on the DRAFT field (not a file).
// ==========================================================================

function fakeBus() {
  const handlers = new Map();
  const posts = [];
  return {
    handlers, posts,
    on(type, fn) { handlers.set(type, fn); },
    post(type, payload) { posts.push({ type, payload }); },
  };
}

function freshHarness(tag, { withPick, withPreview = true } = {}) {
  const stateDir = path.join(scratch, tag + '-state');
  const workspace = path.join(scratch, tag + '-workspace');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  studio.writeWorkspaceConfig(stateDir, workspace);
  if (withPick) modelPicker.writeModelPick(stateDir, withPick);

  let draft = drafts.createDraft(stateDir, workspace, { name: 'SniperSight', pitch: 'Scores entries.' });
  draft = drafts.updateDraft(stateDir, draft.id, draft.revision, {
    answers: {
      idea: 'A trading-intelligence layer that scores liquidity sweeps.',
      platform: 'Windows desktop (Electron).',
      architecture: 'A web dashboard over a REST API and a Postgres database, with background workers.',
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
  return { stateDir, workspace, bus, controllers, draft, latestStarted: () => started };
}

const AI_SOURCE = 'flowchart TD\n  ui["Web UI"] --> api["API"]\n  api --> db[("Postgres")]';

gate('projectsDiagramGet posts the free fallback and no AI diagram before any pass', () => {
  const h = freshHarness('state');
  h.bus.handlers.get('projectsDiagramGet')({ id: h.draft.id });
  const posted = h.bus.posts.find((p) => p.type === 'projectsDiagramState').payload;
  assert.equal(posted.error, null);
  assert.equal(posted.hasPreview, true);
  assert.equal(posted.diagram, null);
  assert.deepEqual(xray.validateMermaidSource(posted.fallback.mermaid), []);
  assert.ok(posted.fallback.parsed.nodes.some((n) => n.id === 'user'), 'parsed layout input rides the post');
});

gate('prepare without a canonical preview is refused — the diagram is drawn FROM the approved blueprint', () => {
  const h = freshHarness('no-preview', { withPreview: false });
  h.bus.handlers.get('projectsDiagramPrepare')({ id: h.draft.id });
  const status = h.bus.posts.find((p) => p.type === 'projectsDiagramStatus').payload;
  assert.equal(status.phase, 'error');
  assert.match(status.error, /canonical preview first/);
});

gate('run without approved:true is rejected — the pass never runs unattended', () => {
  const h = freshHarness('unapproved');
  h.bus.handlers.get('projectsDiagramPrepare')({ id: h.draft.id });
  const prepared = h.bus.posts.at(-1).payload;
  assert.equal(prepared.requiresApproval, true);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsDiagramRun')({
    id: h.draft.id, expectedRevision: prepared.revision, approved: false,
  });
  assert.equal(h.controllers.length, 0, 'no disposable was started');
  assert.match(h.bus.posts.at(-1).payload.error, /explicit approval/);
});

gate('prepare -> approve -> run drives one disposable turn and lands the validated draft field', () => {
  const h = freshHarness('happy', { withPick: { model: 'sonnet', effort: 'high' } });
  h.bus.handlers.get('projectsDiagramPrepare')({ id: h.draft.id });
  const prepared = h.bus.posts.at(-1).payload;
  assert.equal(prepared.usage.session.pct, 5);
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsDiagramRun')({
    id: h.draft.id, expectedRevision: prepared.revision, approved: true,
  });
  assert.equal(h.bus.posts.at(-1).payload.phase, 'running');
  const started = h.latestStarted();
  assert.ok(started.kickoff.includes('web dashboard over a REST API'), 'prompt carries the architecture digest');
  assert.ok(started.kickoff.includes('```mermaid'), 'prompt carries the reply contract');
  assert.deepEqual(started.launch, { model: 'sonnet', effort: 'high' }, 'the picker rides as launch');

  h.bus.posts.length = 0;
  started.onEvent({ type: 'text', text: fence(AI_SOURCE) });
  started.onEvent({ type: 'result', ok: true });
  const result = h.bus.posts.find((p) => p.type === 'projectsDiagramResult').payload;
  assert.equal(result.error, null);
  assert.equal(result.ok, true);
  assert.equal(h.controllers[0].closed, true, 'done() always closes the seat');
  const onDisk = drafts.readDraft(h.stateDir, h.draft.id);
  assert.equal(onDisk.diagram.mermaid, AI_SOURCE, 'the validated source landed on the draft');
  assert.equal(onDisk.diagram.provenance.source, 'llm');
  assert.equal(onDisk.diagram.provenance.canonicalHash, h.draft.preview.generatedCanonicalHash,
    'provenance carries the generating canonical hash');
  assert.ok(h.bus.posts.some((p) => p.type === 'projectsDraftPatched'), 'the fresh draft rides back');
  const refreshed = h.bus.posts.find((p) => p.type === 'projectsDiagramState').payload;
  assert.equal(refreshed.diagram.stale, false);
  assert.deepEqual(refreshed.diagram.parsed.nodes.map((n) => n.id), ['ui', 'api', 'db']);
});

gate('a hostile reply is an error + NO field — fail closed end to end', () => {
  const h = freshHarness('hostile');
  h.bus.handlers.get('projectsDiagramPrepare')({ id: h.draft.id });
  const prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsDiagramRun')({
    id: h.draft.id, expectedRevision: prepared.revision, approved: true,
  });
  h.bus.posts.length = 0;
  const started = h.latestStarted();
  started.onEvent({ type: 'text', text: fence('flowchart TD\n  click a callback "evil"') });
  started.onEvent({ type: 'result', ok: true });
  const result = h.bus.posts.find((p) => p.type === 'projectsDiagramResult').payload;
  assert.match(result.error, /forbidden mermaid keyword/);
  assert.equal(result.ok, false);
  assert.equal(drafts.readDraft(h.stateDir, h.draft.id).diagram, null, 'no field landed');
});

gate('TTL, single-flight, and the backstop hold — the A3 machinery verbatim', () => {
  // expired prepare
  let h = freshHarness('ttl');
  h.bus.handlers.get('projectsDiagramPrepare')({ id: h.draft.id });
  let prepared = h.bus.posts.at(-1).payload;
  const originalNow = Date.now;
  Date.now = () => originalNow() + 6 * 60 * 1000;   // TTL is 5 minutes
  try {
    h.bus.posts.length = 0;
    h.bus.handlers.get('projectsDiagramRun')({
      id: h.draft.id, expectedRevision: prepared.revision, approved: true,
    });
  } finally { Date.now = originalNow; }
  assert.equal(h.controllers.length, 0);
  assert.match(h.bus.posts.at(-1).payload.error, /expired/);
  // single flight
  h = freshHarness('single-flight');
  h.bus.handlers.get('projectsDiagramPrepare')({ id: h.draft.id });
  prepared = h.bus.posts.at(-1).payload;
  h.bus.handlers.get('projectsDiagramRun')({ id: h.draft.id, expectedRevision: prepared.revision, approved: true });
  assert.equal(h.controllers.length, 1);
  h.bus.handlers.get('projectsDiagramPrepare')({ id: h.draft.id });
  prepared = h.bus.posts.at(-1).payload;
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsDiagramRun')({ id: h.draft.id, expectedRevision: prepared.revision, approved: true });
  assert.equal(h.controllers.length, 1, 'a second pass did not start while one is active');
  assert.match(h.bus.posts.at(-1).payload.error, /already running/);
  // backstop
  h = freshHarness('backstop');
  h.bus.handlers.get('projectsDiagramPrepare')({ id: h.draft.id });
  prepared = h.bus.posts.at(-1).payload;
  const originalSetTimeout = global.setTimeout;
  let backstopFn = null;
  global.setTimeout = (fn) => { backstopFn = fn; return 0; };
  try {
    h.bus.handlers.get('projectsDiagramRun')({ id: h.draft.id, expectedRevision: prepared.revision, approved: true });
  } finally { global.setTimeout = originalSetTimeout; }
  assert.ok(typeof backstopFn === 'function', 'a backstop timer was armed');
  h.bus.posts.length = 0;
  backstopFn();
  const result = h.bus.posts.find((p) => p.type === 'projectsDiagramResult').payload;
  assert.match(result.error, /timed out/);
  assert.equal(h.controllers.at(-1).closed, true);
});

gate('a canonical move flips the posted diagram STALE — a badge, never a redraw', () => {
  const h = freshHarness('stale-state');
  const provenance = xray.buildProvenance(h.draft.preview.generatedCanonicalHash, 'llm', AI_SOURCE);
  let draft = drafts.updateDraft(h.stateDir, h.draft.id, h.draft.revision,
    { diagram: { mermaid: AI_SOURCE, provenance } });
  draft = drafts.updateDraft(h.stateDir, draft.id, draft.revision, {
    answers: { idea: 'A completely different idea now, long enough to reshape the canonical.' },
  });
  drafts.updateDraft(h.stateDir, draft.id, draft.revision, {
    preview: blueprint.buildBundle(draft, 'snipersight'),
  });
  h.bus.posts.length = 0;
  h.bus.handlers.get('projectsDiagramGet')({ id: h.draft.id });
  const posted = h.bus.posts.find((p) => p.type === 'projectsDiagramState').payload;
  assert.equal(posted.diagram.stale, true, 'hash moved — the badge flips');
  assert.equal(posted.diagram.mermaid, AI_SOURCE, 'the stored source is untouched — nothing redraws silently');
});

console.log(`\nSTUDIO XRAY: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
