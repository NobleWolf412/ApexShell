// App Builder — headless drill for STUDIO v2 slice F3 (the design-mode
// overlay template). extensions/studio/templates/design-mode.js is a template
// ASSET a scaffolded app ships in dev builds — Apex never executes it, so the
// drill validates it STATICALLY: parses as JS, self-contained (the A3
// external-URL vectors re-implemented here on purpose, never imported from
// mockup.js — the template must stay held to the law even if mockup.js's own
// copy drifts), size-capped, and carrying the load-bearing markers
// (shadow-root attach, Escape cancel, fail-soft fetch guards, read-only
// honesty). Every detector also gets a seeded positive control, so a dead
// check cannot pass silently. Read-only fs, no Electron, no network, zero
// LLM spend. Run: node test/studio-designmode-drill.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, '..', 'extensions', 'studio', 'templates', 'design-mode.js');
// Generous for one vanilla-JS overlay (the shipped file is well under half of
// this) while still bounding what a scaffold blindly copies into every app.
const MAX_TEMPLATE_BYTES = 64 * 1024;

const src = fs.readFileSync(TEMPLATE, 'utf8');

let passed = 0, failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.message); }
}

// The A3 external-URL vectors, verbatim from mockup.js's URL_VECTORS —
// deliberately re-written, not required: see the header.
const URL_VECTORS = [
  ['src attribute', /\ssrc\s*=\s*(?:"\s*(?:https?:)?\/\/|'\s*(?:https?:)?\/\/|(?:https?:)?\/\/)/i],
  ['href attribute', /\shref\s*=\s*(?:"\s*(?:https?:)?\/\/|'\s*(?:https?:)?\/\/|(?:https?:)?\/\/)/i],
  ['CSS url()', /url\(\s*(?:"\s*(?:https?:)?\/\/|'\s*(?:https?:)?\/\/|(?:https?:)?\/\/)/i],
  ['@import', /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//i],
];

function urlViolations(text) {
  const out = [];
  for (const [name, re] of URL_VECTORS)
    if (re.test(text)) out.push(name);
  return out;
}

// ==========================================================================
// existence, size, parse
// ==========================================================================

gate('template exists, is non-empty, and fits the 64 KB cap', () => {
  assert.ok(src.trim().length > 0, 'template is empty');
  const bytes = Buffer.byteLength(src, 'utf8');
  assert.ok(bytes <= MAX_TEMPLATE_BYTES,
    'template is ' + bytes + ' bytes, over the ' + MAX_TEMPLATE_BYTES + ' cap');
});

gate('parses as JavaScript — and the parse check bites on a broken copy', () => {
  assert.doesNotThrow(() => new Function(src));
  assert.throws(() => new Function(src + '\nvar ('), SyntaxError);
});

gate('no module plumbing: import/export/require/eval/new Function absent', () => {
  assert.ok(!/^\s*import[\s(]/m.test(src), 'import statement found');
  assert.ok(!/^\s*export\s/m.test(src), 'export statement found');
  assert.ok(!/\brequire\s*\(/.test(src), 'require() found');
  assert.ok(!/\beval\s*\(/.test(src), 'eval() found');
  assert.ok(!/new\s+Function/.test(src), 'new Function found');
});

// ==========================================================================
// self-containment (the A3 law, applied to the template itself)
// ==========================================================================

gate('self-contained: every A3 external-URL vector reads clean, no absolute URL anywhere', () => {
  assert.deepEqual(urlViolations(src), []);
  assert.ok(!/https?:\/\//i.test(src), 'absolute http(s) URL found');
});

gate('the vector checks bite: seeded violations are each caught by name', () => {
  const seeds = [
    ['src attribute', '\nvar z1 = \'<img src="//evil.example/x.png">\';'],
    ['href attribute', '\nvar z2 = \'<link href="//evil.example/x.css">\';'],
    ['CSS url()', "\nvar z3 = 'body{background:url(//evil.example/x.png)}';"],
    ['@import', '\nvar z4 = \'@import "//evil.example/x.css";\';'],
  ];
  for (const [name, seed] of seeds) {
    const hits = urlViolations(src + seed);
    assert.ok(hits.includes(name), name + ' seed not caught (got: ' + hits.join(', ') + ')');
  }
  assert.ok(/https?:\/\//i.test(src + '\nvar z5 = "https://evil.example";'),
    'absolute-URL scan is dead');
});

gate('the relative-base override refuses protocols and protocol-relative paths', () => {
  assert.ok(src.includes("indexOf(':')"), 'protocol guard missing');
  assert.ok(src.includes("indexOf('//')"), 'protocol-relative guard missing');
});

// ==========================================================================
// the load-bearing markers
// ==========================================================================

gate('the panel rides its own shadow root, hosted by one element', () => {
  assert.match(src, /attachShadow\(\s*\{\s*mode:\s*'open'\s*\}\s*\)/);
  assert.ok(src.includes('data-apex-design-mode'), 'host mark missing');
});

gate('one overlay per page: the double-injection guard', () => {
  const hits = src.match(/__apexDesignMode/g) || [];
  assert.ok(hits.length >= 2, 'guard flag not both checked and set');
});

gate('the A5 picker pattern: fixed pointer-events-none box on the max z-index, hover place, click select', () => {
  assert.match(src, /pointer-events:\s*none/);
  assert.ok(src.includes('2147483647'), 'highlight box not on the max z-index');
  assert.ok(src.includes('getBoundingClientRect'), 'bbox placement missing');
  assert.match(src, /document\.addEventListener\('mousemove',\s*pickHandlers\.move,\s*true\)/);
  assert.match(src, /document\.addEventListener\('click',\s*pickHandlers\.click,\s*true\)/);
  assert.ok(src.includes('preventDefault'), 'click select does not preventDefault');
  assert.ok(src.includes('stopPropagation'), 'click select does not stopPropagation');
});

gate('Escape cancels picking, on a capture-phase keydown listener', () => {
  assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /document\.addEventListener\('keydown',\s*pickHandlers\.key,\s*true\)/);
});

gate('all three spine files fetched by relative path, each behind the fail-soft guard', () => {
  for (const file of ["'tokens.json'", "'components.json'", "'manifest.json'"])
    assert.ok(src.includes(file), file + ' not fetched');
  assert.match(src, /\.catch\(/);
  assert.ok(src.includes('panel is disabled.'), 'honest disable note missing');
  assert.match(src, /window\.fetch\(designBase\(\)/);
});

gate('non-schema-1 spines are refused with an honest note, never trusted', () => {
  assert.ok(src.includes('parsed.schema !== 1'), 'schema gate missing');
  assert.ok(src.includes('not a usable schema-1 file'), 'schema note missing');
});

gate('token-role resolution covers the whole contract vocabulary', () => {
  for (const group of ["'color'", "'type'", "'family'", "'space'", "'radius'", "'shadow'", "'motion'"])
    assert.ok(src.includes('group === ' + group), group + ' group unhandled');
  assert.ok(src.includes('type.scale.sizes'), 'type scale path wrong');
  assert.ok(src.includes('space.steps'), 'space steps path wrong');
});

gate('component resolution: data-component mark first, class-name fallback', () => {
  assert.ok(src.includes('data-component'), 'contract mark not read');
  assert.ok(src.includes("via: 'data-component'"), 'mark provenance missing');
  assert.ok(src.includes("via: 'class'"), 'class-fallback provenance missing');
});

gate('the tree walk is bounded', () => {
  assert.match(src, /MAX_TREE_NODES = 200/);
  assert.ok(src.includes('out.length >= MAX_TREE_NODES'), 'cap not enforced in the walk');
});

gate('clipboard path with a legacy fallback, and the one law in the instruction', () => {
  assert.ok(src.includes('navigator.clipboard'), 'async clipboard missing');
  assert.ok(src.includes("execCommand('copy')"), 'legacy fallback missing');
  assert.ok(src.includes('no hard-coded colors or fonts — tokens only'), 'one law not restated');
});

gate('spine strings ride textContent — no innerHTML, no document.write', () => {
  assert.ok(!/\binnerHTML\b/.test(src), 'innerHTML found');
  assert.ok(!/document\.write/.test(src), 'document.write found');
  assert.ok(src.includes('textContent'), 'textContent path missing');
});

gate('read-only honesty documented in the header', () => {
  assert.match(src, /read-only \+ clipboard/i);
  assert.match(src, /dev-server write endpoint/i);
  assert.match(src, /DEV builds only/);
});

console.log(`\nSTUDIO DESIGN-MODE: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
