// App Builder — headless drill for STUDIO v2 slice F1 (the product-contract
// spines): lib/spines.js's components.json / manifest.json schema-1
// validators (valid, hostile, and oversized shapes — fail-closed, never a
// throw), the manifest↔library drift check, and the kickoff addendum's
// determinism and load-bearing content. Pure lib under test: no Electron, no
// fs, no network, zero LLM spend. Run: node test/studio-spines-drill.js
'use strict';

const assert = require('assert');

const spines = require('../extensions/studio/lib/spines');
const design = require('../extensions/studio/lib/design');

let passed = 0, failed = 0;

function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + ' — ' + err.message); }
}

// Fresh valid fixtures per call — gates mutate them freely.
function library() {
  return {
    schema: 1,
    components: [
      {
        name: 'button', purpose: 'The one action control.',
        variants: ['primary', 'ghost', 'danger'], effects: ['hover-lift'],
        tokens: { background: 'color.accent', label: 'color.text', corner: 'radius.md' },
      },
      {
        name: 'card', variants: ['default', 'raised'],
        tokens: { surface: 'color.surface', edge: 'radius.lg', depth: 'shadow.low' },
      },
    ],
  };
}
function manifest() {
  return {
    schema: 1,
    screens: [
      { id: 'home', title: 'Home', uses: [
        { component: 'button', variants: ['primary', 'ghost'] },
        { component: 'card', variants: ['default'] },
      ] },
      { id: 'settings', uses: [{ component: 'button', variants: ['ghost'] }] },
    ],
  };
}

const GOOD_TOKENS = design.compileTokens({ response:
  'Dark surfaces, one amber accent, technical monospace type, dense and calm.' }).tokens;

// ==========================================================================
// validateComponents — valid, hostile, oversized
// ==========================================================================

gate('a well-formed component library validates clean: no errors, no warnings', () => {
  const result = spines.validateComponents(library());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

gate('hostile top-level shapes fail closed with plain-language errors, never a throw', () => {
  const circular = { schema: 1 };
  circular.components = [circular];
  const hostiles = [
    [null, 'not-an-object'], [undefined, 'not-an-object'], ['text', 'not-an-object'],
    [42, 'not-an-object'], [[], 'not-an-object'],
    [{ components: [] }, 'schema-version'],
    [{ schema: 2, components: [] }, 'schema-version'],
    [{ schema: 1 }, 'component-list'],
    [{ schema: 1, components: 'nope' }, 'component-list'],
    [circular, 'component-shape'],
  ];
  for (const [value, code] of hostiles) {
    const result = spines.validateComponents(value);
    assert.equal(result.valid, false, JSON.stringify(value && value.schema));
    const hit = result.errors.find((e) => e.code === code);
    assert.ok(hit, code + ' — got ' + JSON.stringify(result.errors));
  }
});

gate('component shape breakage is an error: names, duplicates, variants, bindings', () => {
  const broken = [
    [(l) => { l.components[0].name = 'Button'; }, 'component-shape', /no usable name/],
    [(l) => { l.components[0].name = 'x'.repeat(49); }, 'component-shape', /at most 48 characters/],
    [(l) => { l.components[1].name = 'button'; }, 'duplicate-component', /"button" twice/],
    [(l) => { l.components.push('not an object'); }, 'component-shape', /not a JSON object/],
    [(l) => { delete l.components[0].variants; }, 'component-shape', /no "variants" array/],
    [(l) => { l.components[0].variants = ['primary', 42]; }, 'bad-variant', /unusable variant name/],
    [(l) => { l.components[0].variants = ['primary', 'primary']; }, 'duplicate-variant', /"primary" twice/],
    [(l) => { l.components[0].effects = 'shiny'; }, 'component-shape', /"effects" field that is not an array/],
    [(l) => { l.components[0].effects = ['ok', 'ok']; }, 'duplicate-effect', /"ok" twice/],
    [(l) => { l.components[0].tokens = ['color.accent']; }, 'component-shape', /"tokens" field that is not an object/],
    [(l) => { l.components[0].tokens = { 'Bad Part': 'color.accent' }; }, 'component-shape', /unusable binding part name/],
    [(l) => { l.components[0].purpose = 'p'.repeat(201); }, 'component-shape', /at most 200 characters/],
  ];
  for (const [mutate, code, message] of broken) {
    const lib = library();
    mutate(lib);
    const result = spines.validateComponents(lib);
    assert.equal(result.valid, false, code);
    const hit = result.errors.find((e) => e.code === code);
    assert.ok(hit, code + ' — got ' + JSON.stringify(result.errors));
    assert.match(hit.message, message);
  }
});

gate('token bindings: every role in the table accepted, anything else refused by name', () => {
  for (const [group, roles] of Object.entries(spines.TOKEN_ROLES)) {
    for (const role of roles) {
      const lib = library();
      lib.components[0].tokens = { part: `${group}.${role}` };
      const result = spines.validateComponents(lib);
      assert.equal(result.valid, true, `${group}.${role}: ` + JSON.stringify(result.errors));
    }
  }
  for (const bad of ['color.zap', 'zap.accent', 'color', '.accent', 'color.', 42, null, {}]) {
    const lib = library();
    lib.components[0].tokens = { part: bad };
    const result = spines.validateComponents(lib);
    assert.equal(result.valid, false, String(bad));
    const hit = result.errors.find((e) => e.code === 'unknown-token-role');
    assert.ok(hit, String(bad) + ' — got ' + JSON.stringify(result.errors));
    assert.match(hit.message, /not a token role this contract knows/);
  }
  // The color roles ARE design.js's — the two files can never disagree.
  assert.deepEqual(spines.TOKEN_ROLES.color, design.COLOR_ROLES);
});

gate('oversized libraries are refused whole, never truncated into acceptance', () => {
  const many = library();
  many.components = Array.from({ length: spines.MAX_COMPONENTS + 1 },
    (_, i) => ({ name: `c-${i}`, variants: ['default'], tokens: { fill: 'color.bg' } }));
  const overCount = spines.validateComponents(many);
  assert.equal(overCount.valid, false);
  assert.ok(overCount.errors.some((e) => e.code === 'component-count' && /cap is 40/.test(e.message)),
    JSON.stringify(overCount.errors));

  const wide = [
    [(l) => { l.components[0].variants = Array.from({ length: spines.MAX_VARIANTS + 1 }, (_, i) => `v-${i}`); }, 'variant-count', /cap is 12/],
    [(l) => { l.components[0].effects = Array.from({ length: spines.MAX_EFFECTS + 1 }, (_, i) => `e-${i}`); }, 'effect-count', /cap is 8/],
    [(l) => {
      const tokens = {};
      for (let i = 0; i <= spines.MAX_BINDINGS; i++) tokens[`part-${i}`] = 'color.bg';
      l.components[0].tokens = tokens;
    }, 'binding-count', /cap is 16/],
  ];
  for (const [mutate, code, message] of wide) {
    const lib = library();
    mutate(lib);
    const result = spines.validateComponents(lib);
    assert.equal(result.valid, false, code);
    const hit = result.errors.find((e) => e.code === code);
    assert.ok(hit, code + ' — got ' + JSON.stringify(result.errors));
    assert.match(hit.message, message);
  }
});

gate('reviewable-not-broken shapes stay warnings: empty library, no variants, no bindings', () => {
  const empty = spines.validateComponents({ schema: 1, components: [] });
  assert.equal(empty.valid, true);
  assert.ok(empty.warnings.some((w) => w.code === 'empty-library'), JSON.stringify(empty.warnings));

  const bare = library();
  bare.components[0].variants = [];
  delete bare.components[1].tokens;
  const result = spines.validateComponents(bare);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.ok(result.warnings.some((w) => w.code === 'no-variants' && /"default"/.test(w.message)),
    JSON.stringify(result.warnings));
  assert.ok(result.warnings.some((w) => w.code === 'no-bindings' && /the one law/.test(w.message)),
    JSON.stringify(result.warnings));
});

// ==========================================================================
// validateManifest — valid, hostile, oversized, drift
// ==========================================================================

gate('a well-formed manifest validates clean: no errors, no warnings', () => {
  const result = spines.validateManifest(manifest());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

gate('hostile manifest shapes fail closed, never a throw', () => {
  const hostiles = [
    [null, 'not-an-object'], ['text', 'not-an-object'], [[], 'not-an-object'],
    [{ screens: [] }, 'schema-version'],
    [{ schema: 9, screens: [] }, 'schema-version'],
    [{ schema: 1 }, 'screen-list'],
    [{ schema: 1, screens: {} }, 'screen-list'],
  ];
  for (const [value, code] of hostiles) {
    const result = spines.validateManifest(value);
    assert.equal(result.valid, false, code);
    assert.ok(result.errors.some((e) => e.code === code), code + ' — got ' + JSON.stringify(result.errors));
  }
  const broken = [
    [(m) => { m.screens.push(null); }, 'screen-shape', /not a JSON object/],
    [(m) => { m.screens[0].id = 'Home!'; }, 'screen-shape', /no usable id/],
    [(m) => { m.screens[1].id = 'home'; }, 'duplicate-screen', /"home" twice/],
    [(m) => { m.screens[0].title = 't'.repeat(81); }, 'screen-shape', /at most 80 characters/],
    [(m) => { delete m.screens[0].uses; }, 'screen-shape', /no "uses" array/],
    [(m) => { m.screens[0].uses.push('button'); }, 'use-shape', /not a JSON object/],
    [(m) => { m.screens[0].uses.push({ variants: ['ghost'] }); }, 'use-shape', /names no usable component/],
    [(m) => { m.screens[0].uses.push({ component: 'button' }); }, 'duplicate-use', /one entry per component/],
    [(m) => { m.screens[0].uses[0].variants = 'primary'; }, 'use-shape', /"variants" field that is not an array/],
    [(m) => { m.screens[0].uses[0].variants = ['primary', 'primary']; }, 'duplicate-variant', /"primary" twice/],
  ];
  for (const [mutate, code, message] of broken) {
    const mf = manifest();
    mutate(mf);
    const result = spines.validateManifest(mf);
    assert.equal(result.valid, false, code);
    const hit = result.errors.find((e) => e.code === code);
    assert.ok(hit, code + ' — got ' + JSON.stringify(result.errors));
    assert.match(hit.message, message);
  }
});

gate('oversized manifests are refused whole: screen and use caps', () => {
  const tall = { schema: 1, screens: Array.from({ length: spines.MAX_MANIFEST_SCREENS + 1 },
    (_, i) => ({ id: `s-${i}`, uses: [{ component: 'button' }] })) };
  const overScreens = spines.validateManifest(tall);
  assert.equal(overScreens.valid, false);
  assert.ok(overScreens.errors.some((e) => e.code === 'screen-count' && /cap is 24/.test(e.message)),
    JSON.stringify(overScreens.errors));

  const wide = manifest();
  wide.screens[0].uses = Array.from({ length: spines.MAX_USES + 1 },
    (_, i) => ({ component: `c-${i}` }));
  const overUses = spines.validateManifest(wide);
  assert.equal(overUses.valid, false);
  assert.ok(overUses.errors.some((e) => e.code === 'use-count' && /cap is 32/.test(e.message)),
    JSON.stringify(overUses.errors));
});

gate('drift check: unknown components and undeclared variants warn, never block', () => {
  const mf = manifest();
  mf.screens[0].uses.push({ component: 'hero-card', variants: ['tall'] });
  mf.screens[1].uses[0].variants = ['ghost', 'inverted'];
  const result = spines.validateManifest(mf, library());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.ok(result.warnings.some((w) => w.code === 'unknown-component' &&
    /"hero-card", which the component library never declares/.test(w.message)),
    JSON.stringify(result.warnings));
  assert.ok(result.warnings.some((w) => w.code === 'unknown-variant' &&
    /"inverted"/.test(w.message)), JSON.stringify(result.warnings));
  // Clean pair: no drift findings at all.
  assert.deepEqual(spines.validateManifest(manifest(), library()).warnings, []);
});

gate('a broken library performs NO drift check — no misleading findings', () => {
  const mf = manifest();
  mf.screens[0].uses.push({ component: 'hero-card' });
  for (const badLibrary of [null, 'junk', { schema: 1 }, { schema: 2, components: [] }]) {
    const result = spines.validateManifest(mf, badLibrary);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.deepEqual(result.warnings, [], JSON.stringify(badLibrary));
  }
});

// ==========================================================================
// renderContractAddendum — determinism + content
// ==========================================================================

gate('addendum determinism: same inputs, same bytes — key order never leaks in', () => {
  const one = spines.renderContractAddendum(GOOD_TOKENS, library(), manifest());
  const two = spines.renderContractAddendum(GOOD_TOKENS, library(), manifest());
  assert.strictEqual(one, two);
  assert.ok(one.endsWith('\n'));
  // Hostile (reversed) key insertion order changes nothing.
  const shuffle = (obj) => {
    if (Array.isArray(obj)) return obj.map(shuffle);
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const key of Object.keys(obj).reverse()) out[key] = shuffle(obj[key]);
    return out;
  };
  assert.strictEqual(
    spines.renderContractAddendum(shuffle(GOOD_TOKENS), shuffle(library()), shuffle(manifest())),
    one);
});

gate('addendum at scaffold time: tokens exist, the other two spines MUST be created', () => {
  const text = spines.renderContractAddendum(GOOD_TOKENS);
  assert.match(text, /## The product contract \(the three spines\)/);
  for (const file of ['design/tokens.json', 'design/components.json', 'design/manifest.json'])
    assert.ok(text.includes(file), file);
  // The tokens honesty ledger rides in: the summary plus the derived-groups line.
  assert.ok(text.includes(GOOD_TOKENS.summary), 'tokens summary');
  assert.match(text, /Every group was derived from the Look answer\./);
  // Both absent spines are stated as scaffold obligations, pointed at the doc.
  assert.equal((text.match(/does not exist yet\. The scaffold MUST create/g) || []).length, 2, text);
  assert.equal((text.match(/design\/contract-spines\.md/g) || []).length >= 3, true);
  // The one law, verbatim where it matters.
  assert.match(text, /No hard-coded colors or fonts — tokens only\./);
});

gate('addendum with living spines: counts and names, no MUST-create obligations', () => {
  const text = spines.renderContractAddendum(GOOD_TOKENS, library(), manifest());
  assert.match(text, /`design\/components\.json` — EXISTS with 2 components: button, card\./);
  assert.match(text, /`design\/manifest\.json` — EXISTS with 2 screens: home, settings\./);
  assert.ok(!/does not exist yet/.test(text), text);
});

gate('addendum honesty: defaulted tokens say so; junk tokens read as missing', () => {
  const defaults = design.compileTokens(undefined).tokens;
  const text = spines.renderContractAddendum(defaults);
  assert.match(text, /Every group is the documented house default/);
  assert.match(text, /placeholders to refine, not choices to defend/);
  const partial = design.compileTokens({ response: 'dark with an amber accent' }).tokens;
  assert.match(spines.renderContractAddendum(partial),
    /Derived from the Look answer: palette, accent\. House defaults: type, density, tone\./);
  for (const junk of [undefined, null, 'words', 42, [], { schema: 99 }]) {
    const missing = spines.renderContractAddendum(junk);
    assert.match(missing, /`design\/tokens\.json` — MISSING or not usable/);
    assert.match(missing, /nothing to bind to/);
  }
  // A present-but-unusable spine file is named as repairable, not skipped.
  const broken = spines.renderContractAddendum(GOOD_TOKENS, { schema: 1 }, { schema: 2, screens: [] });
  assert.match(broken, /`design\/components\.json` — present but not a usable schema-1 library\./);
  assert.match(broken, /`design\/manifest\.json` — present but not a usable schema-1 manifest\./);
});

gate('never throws: a junk corpus through all three functions', () => {
  const circular = {};
  circular.self = circular;
  const corpus = [undefined, null, true, 42, 'text', [], [[]], {}, circular,
    { schema: circular }, { schema: 1, components: [circular] },
    { schema: 1, screens: [{ id: circular, uses: [circular] }] },
    { schema: 1, components: [{ name: 'a', variants: circular, tokens: circular }] },
    () => {}, Symbol('junk'), new Date(0)];
  for (const junk of corpus) {
    assert.doesNotThrow(() => spines.validateComponents(junk));
    assert.doesNotThrow(() => spines.validateManifest(junk));
    assert.doesNotThrow(() => spines.validateManifest(junk, junk));
    assert.doesNotThrow(() => spines.renderContractAddendum(junk, junk, junk));
  }
});

console.log(`\nSTUDIO SPINES: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
