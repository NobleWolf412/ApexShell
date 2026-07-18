// App Builder — the design-tokens compiler (STUDIO v2, Wave A slice A2). The
// blueprint's `look` answer — portable WORDS only (§ Look card) — compiles into
// the first Wave F contract artifact, design/tokens.json. DETERMINISTIC by law:
// no AI, no randomness, no Date, no locale-dependent call anywhere — the same
// look words always produce the same BYTES. serializeTokens re-walks a fixed
// key order, so byte stability is a property of the serializer, never of
// construction luck. Isolated library: no Electron, no writes, and no require
// of ./contract (contract.js requires THIS module for validateTokens, so the
// one shared helper — flattening an area to prose — is mirrored locally).
//
// tokens.json, schema 1 (§ Wave F — the scaffold contract). Portable by the
// same law as the blueprint: no machine paths, no provider anything, no font
// FILES — type families are feel words a scaffold resolves however it likes.
//   {
//     "schema":  1,
//     "summary": "<one human-readable line of what compiled>",
//     "source":  { palette | accent | type | density | tone: "look"|"default" },
//     "color":   { bg, surface, text, dim, accent, good, warning },   #rrggbb
//     "type":    { feel, family: { body, detail },
//                  scale: { base, ratio, sizes: { xs sm md lg xl xxl } } },  px
//     "space":   { unit, steps: [...] },                                    px
//     "radius":  { sm, md, lg, pill },                                      px
//     "shadow":  { low, mid, high },                        CSS box-shadow text
//     "motion":  { fast, slow, easing }                CSS duration/easing text
//   }
// `source` is the honesty ledger (§ A2: never an invented value presented as
// chosen): a group marked "default" means the look answer said nothing the
// tables below recognize for that group, so the documented house default was
// used. The summary spells the same thing out in words — every defaulted part
// carries "(house default)".
//
// The house defaults (the ONE opinionated house style, § Wave F): dark
// near-black surfaces, blue accent, plain sans type, regular density, even
// tone. Unparseable or absent look input degrades to exactly these, with a
// warning — never a block, never a silent pretence of choice.
'use strict';

const TOKENS_SCHEMA_VERSION = 1;
const COLOR_ROLES = ['bg', 'surface', 'text', 'dim', 'accent', 'good', 'warning'];

// ---- the keyword → token mapping tables ------------------------------------
// Matching is whole-word on the lowercased look prose. Paired tables resolve
// first-entry-in-table-order (dark is checked before light, so "light text on
// a dark ground" reads as dark — a documented tiebreak, not a guess presented
// as parsing). Accent hues resolve earliest-occurrence-in-text, because the
// hue named first is "the one accent that matters" (the Look card's own
// heuristic); ties fall back to table order. All of it is deterministic.

const MODES = [
  ['dark', ['dark', 'black', 'midnight', 'charcoal', 'night']],
  ['light', ['light', 'white', 'paper', 'cream', 'bright']],
];

// Per-mode base palette: everything except the accent hue.
const PALETTES = {
  dark: { bg: '#0f1115', surface: '#171a20', text: '#e6e9ee', dim: '#8a919c', good: '#43b06c', warning: '#e0a63c' },
  light: { bg: '#fbfbf9', surface: '#ffffff', text: '#20242a', dim: '#6a7280', good: '#1e7a44', warning: '#8a5d12' },
};

// Accent hue words → per-mode hex. The key IS the keyword.
const ACCENTS = {
  amber: { dark: '#e3a44a', light: '#8a5d1a' },
  orange: { dark: '#e0763f', light: '#a34714' },
  gold: { dark: '#d9b13c', light: '#8a6d0f' },
  yellow: { dark: '#d9c33c', light: '#7a6a0f' },
  red: { dark: '#e05252', light: '#b02e2e' },
  crimson: { dark: '#d94a6a', light: '#a3244a' },
  pink: { dark: '#e05c9c', light: '#b03071' },
  magenta: { dark: '#d14ad9', light: '#8f24a3' },
  purple: { dark: '#9a6ce8', light: '#6d3fc4' },
  violet: { dark: '#8a5ce0', light: '#5f35b8' },
  blue: { dark: '#4c8dff', light: '#2458c5' },
  cyan: { dark: '#3fb8d8', light: '#0e7490' },
  teal: { dark: '#3fb8af', light: '#0f766e' },
  green: { dark: '#43b06c', light: '#1e7a44' },
};
const DEFAULT_ACCENT = 'blue';

const TYPES = [
  ['technical', ['technical', 'mono', 'monospace', 'monospaced', 'code', 'terminal', 'instrument', 'engineering']],
  ['editorial', ['editorial', 'serif', 'literary', 'reading', 'elegant', 'classic', 'bookish']],
  ['friendly', ['friendly', 'rounded', 'playful', 'warm', 'approachable', 'humanist', 'readable']],
];
// Type feel → family feel-words + modular size scale. Sizes are px, rounded
// (Math.round is IEEE-deterministic for identical inputs on every platform).
const TYPE_STYLES = {
  technical: { family: { body: 'compact sans-serif', detail: 'monospace' }, base: 14, ratio: 1.2 },
  editorial: { family: { body: 'serif', detail: 'sans-serif' }, base: 16, ratio: 1.333 },
  friendly: { family: { body: 'rounded sans-serif', detail: 'sans-serif' }, base: 15, ratio: 1.25 },
  plain: { family: { body: 'sans-serif', detail: 'monospace' }, base: 15, ratio: 1.25 },
};

const DENSITIES = [
  ['dense', ['dense', 'compact', 'tight', 'packed', 'efficient', 'crowded']],
  ['airy', ['airy', 'spacious', 'roomy', 'generous', 'breathe', 'breathing', 'open', 'relaxed']],
];
const DENSITY_STYLES = {
  dense: { space: { unit: 4, steps: [2, 4, 8, 12, 16, 24, 32] }, radius: { sm: 2, md: 4, lg: 8, pill: 999 } },
  airy: { space: { unit: 8, steps: [8, 16, 24, 32, 48, 64, 96] }, radius: { sm: 4, md: 10, lg: 16, pill: 999 } },
  regular: { space: { unit: 4, steps: [4, 8, 12, 16, 24, 32, 48] }, radius: { sm: 3, md: 6, lg: 12, pill: 999 } },
};

const TONES = [
  ['calm', ['calm', 'quiet', 'minimal', 'focused', 'serious', 'muted', 'subtle', 'unhurried', 'professional', 'restrained']],
  ['bold', ['bold', 'energetic', 'vivid', 'lively', 'punchy', 'snappy', 'loud', 'expressive', 'fun']],
];
const TONE_STYLES = {
  calm: {
    shadow: { low: '0 1px 2px rgba(0,0,0,0.12)', mid: '0 2px 6px rgba(0,0,0,0.14)', high: '0 6px 18px rgba(0,0,0,0.18)' },
    motion: { fast: '140ms', slow: '260ms', easing: 'ease-out' },
  },
  bold: {
    shadow: { low: '0 1px 3px rgba(0,0,0,0.18)', mid: '0 4px 10px rgba(0,0,0,0.22)', high: '0 10px 28px rgba(0,0,0,0.30)' },
    motion: { fast: '90ms', slow: '180ms', easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  },
  even: {
    shadow: { low: '0 1px 2px rgba(0,0,0,0.15)', mid: '0 3px 8px rgba(0,0,0,0.18)', high: '0 8px 22px rgba(0,0,0,0.24)' },
    motion: { fast: '120ms', slow: '220ms', easing: 'ease-out' },
  },
};

// The two degradation warnings, verbatim (drilled): honest, plain, never a
// block. "Nothing recognized" and "nothing said" are different sentences on
// purpose — the first is fixable by rewording, the second by answering.
const ABSENT_LOOK_WARNING =
  'The look area has no answer — the design tokens use the documented house defaults.';
const UNPARSED_LOOK_WARNING =
  'The look answer contains no palette, type, density, or tone words the token compiler recognizes — the design tokens use the documented house defaults.';

// Mirror of contract.areaText (see the header for why it is not imported):
// join the string leaves of a free-form area object, so the compiler survives
// an interview that renames its fields ({response} today, richer tomorrow).
function lookText(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const parts = [];
  const walk = (node) => {
    if (typeof node === 'string') parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(value);
  return parts.join(' ').trim();
}

function wordRe(word) {
  return new RegExp('\\b' + word + '\\b');
}

// First entry in table order whose any keyword appears whole-word, else null.
function matchTable(text, table) {
  for (const [name, words] of table)
    for (const word of words)
      if (wordRe(word).test(text)) return name;
  return null;
}

// Earliest hue occurrence in the text wins; ties fall back to table order.
function matchAccent(text) {
  let best = null;
  let bestAt = Infinity;
  for (const hue of Object.keys(ACCENTS)) {
    const at = text.search(wordRe(hue));
    if (at >= 0 && at < bestAt) { best = hue; bestAt = at; }
  }
  return best;
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// The honest phrase: derived groups read plainly, defaulted groups SAY so.
function withOrigin(phrase, origin) {
  return origin === 'look' ? phrase : phrase + ' (house default)';
}

// Compile the blueprint's look area into a full token set. Total and
// deterministic: any input (undefined, prose, nonsense) yields a complete
// token object plus zero or one degradation warning — never a throw, never a
// block. Returns { tokens, warnings }.
function compileTokens(lookArea) {
  const text = lookText(lookArea).toLowerCase();
  const warnings = [];

  const mode = matchTable(text, MODES);
  const accent = matchAccent(text);
  const typeFeel = matchTable(text, TYPES);
  const density = matchTable(text, DENSITIES);
  const tone = matchTable(text, TONES);

  if (!text) warnings.push(ABSENT_LOOK_WARNING);
  else if (!mode && !accent && !typeFeel && !density && !tone)
    warnings.push(UNPARSED_LOOK_WARNING);

  const source = {
    palette: mode ? 'look' : 'default',
    accent: accent ? 'look' : 'default',
    type: typeFeel ? 'look' : 'default',
    density: density ? 'look' : 'default',
    tone: tone ? 'look' : 'default',
  };

  const paletteName = mode || 'dark';
  const accentName = accent || DEFAULT_ACCENT;
  const feelName = typeFeel || 'plain';
  const densityName = density || 'regular';
  const toneName = tone || 'even';

  const palette = PALETTES[paletteName];
  const color = {
    bg: palette.bg,
    surface: palette.surface,
    text: palette.text,
    dim: palette.dim,
    accent: ACCENTS[accentName][paletteName],
    good: palette.good,
    warning: palette.warning,
  };

  const style = TYPE_STYLES[feelName];
  const sizes = {};
  const steps = [['xs', -2], ['sm', -1], ['md', 0], ['lg', 1], ['xl', 2], ['xxl', 3]];
  for (const [name, power] of steps)
    sizes[name] = Math.round(style.base * Math.pow(style.ratio, power));
  const type = {
    feel: feelName,
    family: { body: style.family.body, detail: style.family.detail },
    scale: { base: style.base, ratio: style.ratio, sizes },
  };

  const densityStyle = DENSITY_STYLES[densityName];
  const toneStyle = TONE_STYLES[toneName];

  const summary = [
    withOrigin(capitalize(paletteName) + ' surfaces', source.palette) +
      ' with ' + withOrigin((/^[aeiou]/.test(accentName) ? 'an ' : 'a ') + accentName + ' accent', source.accent),
    withOrigin(feelName + ' type', source.type),
    withOrigin(densityName + ' spacing', source.density),
    withOrigin(toneName + ' tone', source.tone),
  ].join('; ') + '.';

  return {
    tokens: {
      schema: TOKENS_SCHEMA_VERSION,
      summary,
      source,
      color,
      type,
      space: { unit: densityStyle.space.unit, steps: densityStyle.space.steps.slice() },
      radius: { ...densityStyle.radius },
      shadow: { ...toneStyle.shadow },
      motion: { ...toneStyle.motion },
    },
    warnings,
  };
}

// The canonical serializer — the determinism guarantee lives HERE. It rebuilds
// the object through a fixed key walk (never Object.keys of the input) and
// stringifies with a fixed indent, so two compiles of the same look words are
// byte-for-byte identical regardless of how the object was assembled.
function serializeTokens(tokens) {
  const pick = (obj, keys) => {
    const out = {};
    for (const key of keys) out[key] = obj[key];
    return out;
  };
  const ordered = {
    schema: tokens.schema,
    summary: tokens.summary,
    source: pick(tokens.source, ['palette', 'accent', 'type', 'density', 'tone']),
    color: pick(tokens.color, COLOR_ROLES),
    type: {
      feel: tokens.type.feel,
      family: pick(tokens.type.family, ['body', 'detail']),
      scale: {
        base: tokens.type.scale.base,
        ratio: tokens.type.scale.ratio,
        sizes: pick(tokens.type.scale.sizes, ['xs', 'sm', 'md', 'lg', 'xl', 'xxl']),
      },
    },
    space: { unit: tokens.space.unit, steps: tokens.space.steps.slice() },
    radius: pick(tokens.radius, ['sm', 'md', 'lg', 'pill']),
    shadow: pick(tokens.shadow, ['low', 'mid', 'high']),
    motion: pick(tokens.motion, ['fast', 'slow', 'easing']),
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

// Validate a parsed tokens.json. Deterministic and total: returns an array of
// plain-language problems (empty = usable). The caller decides severity —
// contract.validateProjectPackage makes every problem an ERROR, because a
// broken token file would poison every scaffold read (§ A2).
function validateTokens(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['it is not a JSON object'];
  const problems = [];
  if (value.schema === undefined)
    problems.push('it declares no "schema" field');
  else if (value.schema !== TOKENS_SCHEMA_VERSION)
    problems.push(`it declares tokens schema ${value.schema}, but this builder only understands schema ${TOKENS_SCHEMA_VERSION}`);
  if (typeof value.summary !== 'string' || !value.summary.trim())
    problems.push('it has no "summary" line saying what compiled');
  if (!value.source || typeof value.source !== 'object')
    problems.push('it has no "source" map saying which values came from the look answer');
  if (!value.color || typeof value.color !== 'object') {
    problems.push('it has no "color" role map');
  } else {
    for (const role of COLOR_ROLES) {
      const hex = value.color[role];
      if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex))
        problems.push(`its "${role}" color role is missing or is not a "#rrggbb" value`);
    }
  }
  for (const group of ['type', 'space', 'radius', 'shadow', 'motion'])
    if (!value[group] || typeof value[group] !== 'object')
      problems.push(`its "${group}" group is missing`);
  return problems;
}

module.exports = {
  ABSENT_LOOK_WARNING,
  UNPARSED_LOOK_WARNING,
  COLOR_ROLES,
  TOKENS_SCHEMA_VERSION,
  compileTokens,
  serializeTokens,
  validateTokens,
};
