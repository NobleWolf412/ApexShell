// App Builder — the X-ray diagram contract (STUDIO v2, Wave D slice D1). Pure
// lib code, no Electron, no writes, no bus, no AI wiring (D2 adds the
// disposable pass + the ARCHITECTURE step). Four jobs:
//
//   1. The prompt builder (buildDiagramPrompt): blueprint architecture/platform
//      digest in, the mermaid-flowchart reply contract out. Deterministic —
//      same blueprint, same prompt bytes.
//   2. The untrusted-reply contract (parseLlmReply/validateMermaidSource):
//      exactly ONE ```mermaid fence, then EVERY line of the block must match
//      the allowlist grammar below — flowchart/graph directive, node/edge
//      lines, subgraph/end/direction, classDef/class/style. click/callback/
//      href/%%{init} (and all %% comments) are rejected by NAME, and any line
//      the grammar does not recognize fails the whole reply. Size-capped,
//      fail-closed to { source: null, error } — the mockup.js discipline
//      applied to diagram source. There is no "mostly valid": the diagram
//      renders in the studio, so a line the validator cannot read is a line
//      nobody vouched for.
//   3. The provenance shape (buildProvenance/isDiagramStale): { schema,
//      source, canonicalHash, generatedAt, bytes } — A3's sidecar idiom, with
//      `source` naming WHO drew it ('llm' | 'derived'). Drift is mockup.js's
//      rule verbatim: a later blueprint approval flips the diagram stale; a
//      badge, never a silent regeneration.
//   4. The fallback builder (deriveFallbackDiagram): no AI, no quota — parse
//      the architecture area's prose for component nouns (the design.js
//      keyword-table style) and emit a valid flowchart of them, always
//      available, marked source 'derived'. Its output must pass THIS module's
//      own validator — the drill pins that self-consistency.
//
// Why an allowlist grammar and not a mermaid parse: the diagram source is
// untrusted LLM output that the studio will hand to a renderer. Mermaid's own
// grammar is huge and carries interaction directives (click/href/callback)
// and an init block (%%{init}) that reconfigures the renderer — exactly the
// class of thing a hostile reply would reach for. A validator that understands
// a SUBSET and refuses the rest cannot be surprised by the rest.
'use strict';

const { areaText } = require('./contract');
const { HASH_RE } = require('./blueprint');

// ---- caps and shapes --------------------------------------------------------
// One diagram's mermaid source. 32 KB is roomy for a flowchart (the fallback
// emits well under 1 KB; a hand-drawn plan of a big app is a few KB) while
// bounding a hostile reply; reply-side and provenance-side use the same
// number, the mockup.js pairing. The line caps bound the per-line regex work
// the validator does on hostile input.
const MAX_DIAGRAM_BYTES = 32 * 1024;
const MAX_DIAGRAM_LINES = 300;
const MAX_LINE_CHARS = 300;
const DIAGRAM_PROVENANCE_SCHEMA = 1;
const DIAGRAM_SOURCES = ['llm', 'derived'];
// Prompt inputs: per-area digest excerpts, bounded like mockup.js's
// DIGEST_AREA_CHARS — architecture rides largest because it IS the diagram's
// subject matter.
const IDEA_CHARS = 400;
const PLATFORM_CHARS = 400;
const ARCH_CHARS = 1500;

// ---- the allowlist grammar --------------------------------------------------
// Assembled from named pieces so the accepted language is readable here and
// pinnable in the drill. Every pattern anchors the WHOLE (trimmed) line.
//
//   ID     a node/class name: letter first, then letters/digits/_/-
//   TXT    label text: letters, digits, space, and a short punctuation set.
//          Deliberately absent: < > (no HTML in labels), " (only as the
//          label's own quotes), ` | ; % and every bracket (shape/edge syntax
//          only). A label cannot smuggle markup or a second statement.
//   INNER  one label: "TXT..." or bare TXT...
//
// Accepted line kinds (the entire language):
//   header     flowchart TD | graph LR   (TB/TD/BT/RL/LR; first line, once)
//   node       id, id["label"], id("label"), id(("label")), id{"label"},
//              id[["label"]], id[("label")], id{{"label"}}   (bare labels ok)
//   edge       node ARROW node [ARROW node ...], ARROW one of --> --- -.-> ==>
//              with an optional |label| after the arrow
//   subgraph   subgraph id["label"] | subgraph label      end closes it
//   direction  direction TD (etc.) inside a subgraph
//   classDef   classDef name[,name...] prop:value[,prop:value...]
//   class      class id[,id...] name
//   style      style id prop:value[,prop:value...]
// Everything else — click, linkStyle, comments, interpolation, HTML — is not
// in the language and fails the reply whole.
const ID = '[A-Za-z][A-Za-z0-9_-]*';
const TXT = "[A-Za-z0-9 _.,:'!?&/+*=-]";
const INNER = `(?:"${TXT}+"|${TXT}+)`;
// Alternation is longest-bracket-first so [[..]] never half-matches as [..].
const SHAPE = `(?:\\[\\[${INNER}\\]\\]|\\[\\(${INNER}\\)\\]|\\(\\(${INNER}\\)\\)|\\{\\{${INNER}\\}\\}|\\[${INNER}\\]|\\(${INNER}\\)|\\{${INNER}\\})`;
const NODE = `${ID}${SHAPE}?`;
const ARROW = '(?:-->|---|-\\.->|==>)';
// prop:value pairs for classDef/style. The value class has no comma — commas
// separate declarations, and a greedy value would eat them.
const STYLE_DECL = `[A-Za-z-]+:[#A-Za-z0-9. %-]+`;
const STYLE_DECLS = `${STYLE_DECL}(?:\\s*,\\s*${STYLE_DECL})*`;

const HEADER_RE = new RegExp('^(?:flowchart|graph)\\s+(?:TB|TD|BT|RL|LR)$');
const SUBGRAPH_RE = new RegExp(`^subgraph\\s+(?:${ID}\\[${INNER}\\]|${INNER})$`);
const END_RE = /^end$/;
const LINE_PATTERNS = [
  ['header', HEADER_RE],
  ['node', new RegExp(`^${NODE}$`)],
  ['edge', new RegExp(`^${NODE}(?:\\s*${ARROW}(?:\\s*\\|${INNER}\\|)?\\s*${NODE})+$`)],
  ['subgraph', SUBGRAPH_RE],
  ['end', END_RE],
  ['direction', new RegExp('^direction\\s+(?:TB|TD|BT|RL|LR)$')],
  ['classDef', new RegExp(`^classDef\\s+${ID}(?:,${ID})*\\s+${STYLE_DECLS}$`)],
  ['class', new RegExp(`^class\\s+${ID}(?:\\s*,\\s*${ID})*\\s+${ID}$`)],
  ['style', new RegExp(`^style\\s+${ID}\\s+${STYLE_DECLS}$`)],
];

// The named refusals (§ Wave D: reject click/callback/href/%%{init}). Word-
// bounded and checked ANYWHERE in the line — even inside a label — because a
// validator that reasons about context is a validator with holes; a diagram
// that wants the word "callback" in a label loses it, and that trade is the
// point. %% covers both the init block and plain comments (comments are not
// in the accepted language: unreadable-by-the-validator text has no business
// riding a validated artifact).
const FORBIDDEN = [
  ['click', /(?:^|[^A-Za-z0-9_])click(?:[^A-Za-z0-9_]|$)/i],
  ['callback', /(?:^|[^A-Za-z0-9_])callback(?:[^A-Za-z0-9_]|$)/i],
  ['href', /(?:^|[^A-Za-z0-9_])href(?:[^A-Za-z0-9_]|$)/i],
  ['%%', /%%/],
];

/** Validate one mermaid source against the allowlist grammar. Pure and total:
 *  returns an array of plain-language problems (empty = valid), never throws.
 *  Trailing `;` per line is stripped first (mermaid statement sugar the
 *  models emit); indentation is insignificant; blank lines pass. */
function validateMermaidSource(source) {
  if (typeof source !== 'string' || !source.trim())
    return ['the diagram is empty'];
  if (Buffer.byteLength(source, 'utf8') > MAX_DIAGRAM_BYTES)
    return ['the diagram exceeds the ' + Math.floor(MAX_DIAGRAM_BYTES / 1024) + ' KB limit'];
  const rawLines = source.split('\n');
  if (rawLines.length > MAX_DIAGRAM_LINES)
    return ['the diagram exceeds the ' + MAX_DIAGRAM_LINES + '-line limit'];

  const problems = [];
  let headers = 0;
  let sawContent = false;
  let depth = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const at = 'line ' + (i + 1);
    if (rawLines[i].length > MAX_LINE_CHARS) {
      problems.push(at + ' exceeds the ' + MAX_LINE_CHARS + '-character line limit');
      continue;
    }
    const line = rawLines[i].trim().replace(/;$/, '');
    if (!line) continue;

    let forbidden = false;
    for (const [name, re] of FORBIDDEN) {
      if (re.test(line)) {
        problems.push(at + ' carries the forbidden mermaid keyword "' + name +
          '" — interaction and init directives never enter the studio');
        forbidden = true;
        break;
      }
    }
    if (forbidden) continue;

    const isHeader = HEADER_RE.test(line);
    if (isHeader) {
      headers += 1;
      if (sawContent)
        problems.push(at + ': the flowchart directive must be the first line of the diagram');
      if (headers > 1)
        problems.push(at + ': the diagram declares a second flowchart directive — exactly one');
    } else if (!sawContent) {
      problems.push(at + ': the diagram must open with a flowchart or graph directive');
    }
    sawContent = true;
    if (isHeader) continue;

    if (SUBGRAPH_RE.test(line)) depth += 1;
    else if (END_RE.test(line)) {
      if (depth === 0) { problems.push(at + ': an "end" with no open subgraph'); continue; }
      depth -= 1;
    }

    if (!LINE_PATTERNS.some(([, re]) => re.test(line)))
      problems.push(at + ' is not on the allowlist grammar: "' + line.slice(0, 60) + '"');
  }
  if (!sawContent) return ['the diagram is empty'];
  if (headers === 0) problems.push('the diagram never declares a flowchart or graph directive');
  if (depth > 0) problems.push('a subgraph is never closed with "end"');
  return problems;
}

// ---- the prompt builder -----------------------------------------------------
// Digest excerpt for one area, in the mockup.js buildPrompt voice: prose or an
// honest "(unanswered)" — the prompt never papers over a gap.
function areaDigest(blueprint, area, cap) {
  const prose = areaText(blueprint && blueprint[area]).trim();
  return prose ? prose.slice(0, cap) : '(unanswered)';
}

/** The one-turn diagram pass's prompt (D2 wires the pass itself): blueprint
 *  architecture/platform digest in, one mermaid flowchart out, under the
 *  reply contract above. Pure and deterministic — no Date, no randomness. */
function buildDiagramPrompt(blueprint) {
  return [
    'You are drawing the PLANNED architecture of an app that may not exist yet,',
    'as ONE mermaid flowchart. Diagram what the blueprint SAYS — components,',
    'data stores, integrations, and the arrows between them. Never invent a',
    'component the text does not name.',
    '',
    'BLUEPRINT DIGEST:',
    '- idea: ' + areaDigest(blueprint, 'idea', IDEA_CHARS),
    '- platform: ' + areaDigest(blueprint, 'platform', PLATFORM_CHARS),
    '- architecture: ' + areaDigest(blueprint, 'architecture', ARCH_CHARS),
    '',
    'Reply with exactly ONE fenced block and nothing else outside it:',
    '```mermaid',
    'flowchart TD',
    '... node and edge lines ...',
    '```',
    'Hard rules — a reply that breaks any of them is discarded whole:',
    '- Exactly one ```mermaid fence; its first line is flowchart TD (or LR).',
    '- Only these line kinds: node definitions like id["Label"], edges like',
    '  a --> b (an optional |label| after the arrow; --- , -.-> and ==> also',
    '  allowed), subgraph/end, direction, and classDef/class/style lines.',
    '- Labels are plain text: letters, digits, spaces, simple punctuation.',
    '  No HTML, no angle brackets, no backticks.',
    '- NO click, callback, or href lines, no %% comments, no %%{init} blocks.',
    '- Under ' + Math.floor(MAX_DIAGRAM_BYTES / 1024) + ' KB total.',
  ].join('\n');
}

// ---- the untrusted-reply contract -------------------------------------------
// Fence choice: FENCED, the mockup.js reasoning verbatim — the fence makes the
// boundary the model's explicit claim, and multiple fences are an error, not
// a pick (choosing one of two candidate diagrams would be the silent guess
// this discipline refuses). Everything fails CLOSED: error + no source.
const MERMAID_FENCE_RE = /```mermaid\s*\n([\s\S]*?)```/g;

/** Strict contract over an untrusted LLM reply. Returns { source, error } —
 *  exactly one of them set. Never throws; every violation fails closed. */
function parseLlmReply(text) {
  const s = String(text || '');
  MERMAID_FENCE_RE.lastIndex = 0;
  const blocks = [];
  for (let m; (m = MERMAID_FENCE_RE.exec(s)) !== null;) blocks.push(m[1]);
  if (blocks.length === 0)
    return { source: null, error: 'no ```mermaid fenced block in the reply' };
  if (blocks.length > 1)
    return { source: null, error: 'the reply carries ' + blocks.length + ' mermaid blocks — the contract is exactly one diagram' };
  const source = blocks[0].trim();
  const problems = validateMermaidSource(source);
  if (problems.length)
    return { source: null, error: 'the diagram fails the studio allowlist: ' + problems.join('; ') };
  return { source, error: null };
}

// ---- provenance (the A3 sidecar idiom) --------------------------------------
/** Build one diagram's provenance record: who drew it, from which approved
 *  canonical, when, and how big. Throws on a malformed hash or an unknown
 *  source — provenance without a real anchor is worse than none. */
function buildProvenance(canonicalHash, source, mermaid) {
  if (typeof canonicalHash !== 'string' || !HASH_RE.test(canonicalHash))
    throw new Error('Diagram provenance requires the generating canonical hash.');
  if (!DIAGRAM_SOURCES.includes(source))
    throw new Error('Diagram provenance source must be "llm" or "derived".');
  if (typeof mermaid !== 'string' || !mermaid.trim())
    throw new Error('Diagram provenance requires the diagram source text.');
  return {
    schema: DIAGRAM_PROVENANCE_SCHEMA,
    source,
    canonicalHash,
    generatedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(mermaid, 'utf8'),
  };
}

/** The drift rule, mockup.js's isMockupStale semantics on a pure record: a
 *  diagram is STALE when its recorded generating hash no longer matches the
 *  current approved canonical hash. No (or malformed) provenance is not stale
 *  — it is simply not generated; no current hash leaves a generated diagram
 *  stale (its source of truth is gone). A badge, never an action. */
function isDiagramStale(provenance, currentCanonicalHash) {
  if (!provenance || typeof provenance !== 'object' ||
      provenance.schema !== DIAGRAM_PROVENANCE_SCHEMA ||
      typeof provenance.canonicalHash !== 'string' ||
      !HASH_RE.test(provenance.canonicalHash))
    return false;
  return provenance.canonicalHash !== currentCanonicalHash;
}

// ---- the deterministic fallback ---------------------------------------------
// The keyword → component tables (the design.js style: whole-word matching on
// lowercased prose, table order = emit order, every mapping visible here).
// Each component sits in a TIER, and the wiring rule is fixed: the user node
// (tier 0, always present) feeds tier 1, tier 1's FIRST detected component
// feeds tier 2, and so on — each component draws its edge from the first
// detected component of the nearest lower non-empty tier. Deterministic and
// documented, not clever: this is the always-available sketch the AI pass
// (D2) improves on, never a rival architect.
const COMPONENT_RULES = [
  // tier 1 — what the user touches
  { id: 'ui', title: 'User interface', tier: 1, words: ['ui', 'frontend', 'front-end', 'renderer', 'interface', 'dashboard', 'screen', 'screens', 'page', 'pages', 'view', 'views', 'web', 'browser', 'electron', 'mobile', 'app'] },
  { id: 'cli', title: 'Command line', tier: 1, words: ['cli', 'terminal', 'tui', 'console', 'command-line', 'commandline', 'shell'] },
  // tier 2 — the middle
  { id: 'api', title: 'API / services', tier: 2, words: ['api', 'backend', 'back-end', 'server', 'service', 'services', 'endpoint', 'endpoints', 'rest', 'graphql', 'routes'] },
  { id: 'engine', title: 'Core engine', tier: 2, words: ['engine', 'core', 'pipeline', 'processor', 'parser', 'compiler', 'scheduler', 'logic'] },
  // tier 3 — behind the middle
  { id: 'auth', title: 'Auth', tier: 3, words: ['auth', 'authentication', 'login', 'oauth', 'session', 'sessions', 'account', 'accounts'] },
  { id: 'db', title: 'Data store', tier: 3, words: ['database', 'db', 'postgres', 'postgresql', 'sqlite', 'mysql', 'mongo', 'mongodb', 'sql', 'store', 'storage', 'persistence'] },
  { id: 'cache', title: 'Cache', tier: 3, words: ['cache', 'caching', 'redis', 'memcached'] },
  { id: 'queue', title: 'Jobs / queue', tier: 3, words: ['queue', 'queues', 'worker', 'workers', 'jobs', 'cron', 'background'] },
  { id: 'files', title: 'File storage', tier: 3, words: ['file', 'files', 'upload', 'uploads', 'assets', 'blob', 's3'] },
  { id: 'integrations', title: 'Integrations', tier: 3, words: ['integration', 'integrations', 'webhook', 'webhooks', 'third-party', 'external'] },
];

// design.js's whole-word test — [a-z-] trigger words only, so no escaping.
function hasWord(text, word) {
  return new RegExp('(?:^|[^a-z0-9])' + word + '(?:[^a-z0-9]|$)').test(text);
}

/** The no-AI fallback: parse the architecture area's prose for component
 *  nouns and emit a valid flowchart of them. Total and deterministic — same
 *  blueprint in, same bytes out; an empty or unreadable architecture area
 *  still yields a minimal valid diagram. Returns { source, components };
 *  provenance for it is buildProvenance(hash, 'derived', source). The drill
 *  holds the output to validateMermaidSource — this module must never emit
 *  what it would refuse. */
function deriveFallbackDiagram(blueprint) {
  const prose = areaText(blueprint && blueprint.architecture).toLowerCase();
  const found = COMPONENT_RULES.filter((rule) => rule.words.some((word) => hasWord(prose, word)));
  const lines = ['flowchart TD', '  user(("User"))'];
  if (!found.length) {
    lines.push('  user --> app["The app"]');
    return { source: lines.join('\n') + '\n', components: ['app'] };
  }
  // First detected component of the nearest lower non-empty tier; the user
  // node is tier 0 and always present, so every component has an upstream.
  const firstOfTier = new Map();
  for (const rule of found)
    if (!firstOfTier.has(rule.tier)) firstOfTier.set(rule.tier, rule.id);
  const upstream = (tier) => {
    for (let t = tier - 1; t >= 1; t--)
      if (firstOfTier.has(t)) return firstOfTier.get(t);
    return 'user';
  };
  for (const rule of found)
    lines.push('  ' + upstream(rule.tier) + ' --> ' + rule.id + '["' + rule.title + '"]');
  return { source: lines.join('\n') + '\n', components: found.map((rule) => rule.id) };
}

// ---- the validated-source parser (slice D2) ---------------------------------
// Feeds the ARCHITECTURE step's own renderer: the studio draws diagrams as
// plain HTML boxes + SVG arrows (§ Wave D — no external mermaid library, no
// new deps), so the validated source must first become a plain structure.
// parseValidated re-runs the validator and REFUSES whatever it refuses — one
// accepted language in this module, never a strict validator shadowed by a
// looser parser — then reads only the allowlist grammar, mechanically:
// node tokens are consumed ANCHORED (id, then longest-bracket-first shape),
// so an arrow-shaped substring inside a label can never split an edge.
const NODE_SHAPES = [
  ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'cylinder'],
  ['((', '))', 'circle'],
  ['{{', '}}', 'hexagon'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
];
const ARROW_STYLES = { '-->': 'solid', '---': 'open', '-.->': 'dotted', '==>': 'thick' };
// Anchored token readers. The lookahead after a node token forces the greedy
// ID (which may legally contain '-') to back off an abutting arrow: `a-->b`
// reads as node `a`, arrow `-->`, node `b`, matching the validator's own
// backtracking reading of the edge pattern.
const NODE_TOKEN_RE = new RegExp(`^(${ID})(${SHAPE})?(?=\\s|$|-->|---|-\\.->|==>)`);
const ARROW_TOKEN_RE = new RegExp(`^\\s*(${ARROW})(?:\\s*\\|(${INNER})\\|)?\\s*`);
const SUBGRAPH_ID_RE = new RegExp(`^(${ID})\\[(${INNER})\\]$`);

function stripQuotes(text) {
  const t = String(text).trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/** Parse a source that passes validateMermaidSource into the layout input:
 *  { direction, nodes: [{ id, label, shape }], edges: [{ from, to, label,
 *  style }], subgraphs: [{ id, label, nodes }] }. Throws on anything the
 *  validator refuses; deterministic — same source, same structure. Styling
 *  lines (classDef/class/style) and `direction` draw no boxes or arrows and
 *  are skipped; subgraph membership is every node defined or referenced
 *  inside the open subgraph(s), the mermaid reading. */
function parseValidated(source) {
  const problems = validateMermaidSource(source);
  if (problems.length)
    throw new Error('parseValidated refuses what the validator refuses: ' + problems[0]);
  const nodes = new Map();
  const edges = [];
  const subgraphs = [];
  const open = [];   // the subgraph stack — membership for defined/referenced nodes
  let direction = 'TD';

  const touch = (token) => {
    const id = new RegExp(`^${ID}`).exec(token)[0];
    const rest = token.slice(id.length).trim();
    let label = null;
    let shape = 'plain';
    if (rest) {
      for (const [openB, closeB, name] of NODE_SHAPES) {
        if (rest.startsWith(openB) && rest.endsWith(closeB)) {
          label = stripQuotes(rest.slice(openB.length, rest.length - closeB.length));
          shape = name;
          break;
        }
      }
    }
    const known = nodes.get(id);
    if (!known) nodes.set(id, { id, label: label === null ? id : label, shape });
    else if (label !== null && known.shape === 'plain') {
      known.label = label;
      known.shape = shape;
    }
    for (const sg of open) if (!sg.nodes.includes(id)) sg.nodes.push(id);
    return id;
  };

  for (const raw of source.split('\n')) {
    const line = raw.trim().replace(/;$/, '');
    if (!line) continue;
    if (HEADER_RE.test(line)) { direction = line.split(/\s+/)[1]; continue; }
    // subgraph/end before the node pattern — `end` would otherwise read as a
    // node named end, exactly the shadow the validator's own structural pass
    // (depth tracking before the .some()) refuses to cast.
    if (SUBGRAPH_RE.test(line)) {
      const body = line.replace(/^subgraph\s+/, '');
      const idMatch = SUBGRAPH_ID_RE.exec(body);
      const sg = idMatch
        ? { id: idMatch[1], label: stripQuotes(idMatch[2]), nodes: [] }
        : { id: null, label: stripQuotes(body), nodes: [] };
      subgraphs.push(sg);
      open.push(sg);
      continue;
    }
    if (END_RE.test(line)) { open.pop(); continue; }
    if (LINE_PATTERNS.some(([kind, re]) =>
      (kind === 'direction' || kind === 'classDef' || kind === 'class' || kind === 'style') && re.test(line)))
      continue;
    if (new RegExp(`^${NODE}$`).test(line)) { touch(line); continue; }
    // An edge line: NODE (ARROW [|label|] NODE)+, consumed anchored.
    let rest = line;
    const first = NODE_TOKEN_RE.exec(rest);
    if (!first) continue;   // unreachable on validated input; bail safe
    let from = touch(first[0]);
    rest = rest.slice(first[0].length);
    while (rest.trim()) {
      const a = ARROW_TOKEN_RE.exec(rest);
      if (!a) break;
      rest = rest.slice(a[0].length);
      const n = NODE_TOKEN_RE.exec(rest);
      if (!n) break;
      const to = touch(n[0]);
      edges.push({ from, to, label: a[2] ? stripQuotes(a[2]) : null, style: ARROW_STYLES[a[1]] });
      rest = rest.slice(n[0].length);
      from = to;
    }
  }
  return { direction, nodes: [...nodes.values()], edges, subgraphs };
}

// ---- the Create-time copy (slice D2) ----------------------------------------
/** The package's diagram, the collectApprovedMockups idiom on one artifact:
 *  the draft's stored AI-drawn diagram when it is still CURRENT against the
 *  approved canonical hash; otherwise the free fallback, derived fresh from
 *  the approved blueprint and anchored to that same hash as source 'derived'.
 *  A stale AI diagram never enters a package — the STALE badge in the studio
 *  is the review prompt, and the provenance names WHO drew what actually
 *  rode. Returns { mermaid, provenance } or null without an approved preview
 *  (no package exists to copy into anyway). Pure over the draft. */
function collectDiagram(draft) {
  const preview = draft && draft.preview;
  const hash = preview && preview.generatedCanonicalHash;
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) return null;
  const stored = draft.diagram;
  if (stored && stored.provenance &&
      stored.provenance.schema === DIAGRAM_PROVENANCE_SCHEMA &&
      stored.provenance.canonicalHash === hash)
    return { mermaid: stored.mermaid, provenance: stored.provenance };
  const { source } = deriveFallbackDiagram(preview.blueprint);
  return { mermaid: source, provenance: buildProvenance(hash, 'derived', source) };
}

// The cap/shape constants export wholesale as the module's public contract
// (the suggest.js precedent): the drill pins the grammar through
// validateMermaidSource rather than the regexes, so a grammar change must
// answer to the drilled acceptance/rejection vectors, not to a mirrored
// pattern string.
module.exports = {
  MAX_DIAGRAM_BYTES,
  MAX_DIAGRAM_LINES,
  MAX_LINE_CHARS,
  DIAGRAM_PROVENANCE_SCHEMA,
  buildDiagramPrompt,
  validateMermaidSource,
  parseValidated,
  parseLlmReply,
  buildProvenance,
  isDiagramStale,
  deriveFallbackDiagram,
  collectDiagram,
};
