// App Builder — Blueprint Review + canonical preview primitives (slice 4). Pure
// functions, no Electron, no AI, no writes: the deterministic core the PROJECTS
// builder's review/canonical steps drive over the bus. Pattern-matched from
// extensions/personas/lib/render.js's bundle seam (renderBundle / withCanonicalEdit
// / regenerateSection / acceptCanonical) so the two builders behave identically
// where the shape is identical. It USES the slice-2 primitives (renderCanonical,
// sectionBlock, hashCanonical, isSafeProjectId, areaText) rather than duplicating
// them.
'use strict';

const {
  SECTION_KEYS,
  sectionBlock,
  renderCanonical,
} = require('./render');
const { BLUEPRINT_AREAS, SCHEMA_VERSION, hashCanonical, isSafeProjectId } = require('./contract');
const { KEYS } = require('./interview');

// Which approved interview answers feed each canonical section. Each of the
// seven interview cards (BLUEPRINT_AREAS) has exactly one destination section;
// the idea and users cards collapse into "Vision and Users", which leaves one
// section — `risks` — with no dedicated card. That section is therefore
// authored by hand (a visible gap until then); the generator never SPLITS the
// delivery answer to fill it, because inventing a boundary between "milestones"
// and "risks" prose is exactly the invention the spec forbids. This is the only
// card→section partition that gives each card one home without splitting an
// answer. (design/app-builder-v1.md § PROJECT.md template — see REPORT §11.)
// Schema 2 adds look → "Design Language" (design/studio-v2.md § Wave A).
const SECTION_SOURCES = {
  vision: ['idea', 'users'],
  scope: ['scope'],
  platform: ['platform'],
  architecture: ['architecture'],
  delivery: ['delivery'],
  look: ['look'],
  risks: [],
};

// A gap is rendered VISIBLY incomplete (§ Canonical Draft): an explicit marker in
// the section body, never invented prose. Distinctive enough to survive a re-read
// of the canonical and to be matched by a drill.
const INCOMPLETE_PLACEHOLDER =
  '> _Incomplete: no approved answer for this area yet — the builder never invents one._';

const HASH_RE = /^[0-9a-f]{64}$/;

// The blueprint area an interview answer becomes: a single free-text response per
// card (§ Blueprint shape — sub-answers preserved per card so targeted revision
// stays possible; the v1 interview captures one response field per area).
function blueprintFromDraft(draft) {
  const answers = (draft && draft.answers) || {};
  const blueprint = { schema_version: SCHEMA_VERSION, canonical_hash: '' };
  for (const area of BLUEPRINT_AREAS)
    blueprint[area] = { response: String(answers[area] || '').trim() };
  return blueprint;
}

// The approved text for one canonical section, joined from its source areas'
// responses. Empty when every source area is unanswered — that emptiness is what
// makes the section a gap; the caller decides how to mark it.
function sectionBody(blueprint, sectionKey) {
  const sources = SECTION_SOURCES[sectionKey] || [];
  return sources
    .map((area) => (blueprint[area] && typeof blueprint[area].response === 'string'
      ? blueprint[area].response.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

// Map the blueprint onto the section bodies renderCanonical expects; a gap
// gets the visible incomplete placeholder (never invented content) and is
// reported so the review can highlight it.
function sectionMap(blueprint) {
  const sections = {};
  const gaps = [];
  for (const key of SECTION_KEYS) {
    const body = sectionBody(blueprint, key);
    if (body) sections[key] = body;
    else { sections[key] = INCOMPLETE_PLACEHOLDER; gaps.push(key); }
  }
  return { sections, gaps };
}

// A hash of only the interview inputs a canonical is generated FROM, so the review
// can tell when the interview moved on after a preview was approved (staleness),
// exactly like the persona builder's draftSourceHash.
function draftSourceHash(draft) {
  return hashCanonical(JSON.stringify({
    name: (draft && draft.name) || '',
    pitch: (draft && draft.pitch) || '',
    answers: Object.fromEntries(KEYS.map((key) => [key, String(((draft && draft.answers) || {})[key] || '')])),
  }));
}

// Render the whole canonical + blueprint bundle from a draft's APPROVED answers
// only. Mirrors personas/lib/render.renderBundle. The generated hash is recorded
// on the blueprint (the approved snapshot); drift is measured against it.
function buildBundle(draft, projectId) {
  if (!isSafeProjectId(projectId))
    throw new Error('Project ID must be lowercase kebab-case and at most 64 characters.');
  const displayName = String((draft && draft.name) || '').trim();
  if (!displayName) throw new Error('Project display name cannot be empty.');
  const description = String((draft && draft.pitch) || '').trim();

  const blueprint = blueprintFromDraft(draft);
  const { sections, gaps } = sectionMap(blueprint);
  const canonical = renderCanonical({ projectId, displayName, description, sections });
  const generatedCanonicalHash = hashCanonical(canonical);
  blueprint.canonical_hash = generatedCanonicalHash;
  return {
    projectId,
    displayName,
    description,
    blueprint,
    gaps,
    canonical,
    generatedCanonicalHash,
    sourceHash: draftSourceHash(draft),
    canonicalDrift: false,
  };
}

// A manual canonical edit. Recomputes drift against the approved snapshot hash;
// it NEVER re-approves silently — the review prompt (accept vs regenerate) is the
// user's decision. Byte-for-byte the persona withCanonicalEdit contract.
function withCanonicalEdit(bundle, canonical) {
  if (!bundle || typeof bundle !== 'object') throw new Error('Generate a preview first.');
  if (typeof canonical !== 'string' || !canonical.trim())
    throw new Error('Canonical Markdown cannot be empty.');
  if (Buffer.byteLength(canonical, 'utf8') > 128 * 1024)
    throw new Error('Canonical Markdown exceeds the 128 KB limit.');
  const normalized = canonical.replace(/\r\n?/g, '\n');
  const finalCanonical = normalized.endsWith('\n') ? normalized : normalized + '\n';
  return {
    ...bundle,
    canonical: finalCanonical,
    canonicalDrift: hashCanonical(finalCanonical) !== bundle.generatedCanonicalHash,
  };
}

// Regenerate ONE section from its approved answer, splicing between the stable
// markers and leaving every other section — including manual edits elsewhere —
// untouched. If the bundle is under manual drift, the regenerate keeps the review
// pending (no silent re-approval); otherwise it re-baselines the hash.
function regenerateSection(bundle, sectionKey) {
  if (!bundle || typeof bundle !== 'object' || typeof bundle.canonical !== 'string')
    throw new Error('Generate a preview first.');
  if (!SECTION_KEYS.includes(sectionKey)) throw new Error('Unknown canonical section: ' + sectionKey);
  const start = `<!-- app-builder:${sectionKey}:start -->`;
  const end = `<!-- app-builder:${sectionKey}:end -->`;
  const from = bundle.canonical.indexOf(start);
  const to = bundle.canonical.indexOf(end);
  if (from < 0 || to < from)
    throw new Error('Section markers are missing; regenerate the full canonical or restore the markers.');
  const body = sectionBody(bundle.blueprint, sectionKey) || INCOMPLETE_PLACEHOLDER;
  const after = to + end.length;
  const canonical = bundle.canonical.slice(0, from) + sectionBlock(sectionKey, body) +
    bundle.canonical.slice(after);
  const edited = withCanonicalEdit(bundle, canonical);
  const gaps = sectionMap(bundle.blueprint).gaps;
  if (bundle.canonicalDrift) return { ...edited, gaps };
  const generatedCanonicalHash = hashCanonical(edited.canonical);
  return {
    ...edited,
    gaps,
    generatedCanonicalHash,
    blueprint: { ...edited.blueprint, canonical_hash: generatedCanonicalHash },
    canonicalDrift: false,
  };
}

// Adopt a manually-edited canonical as the new approved baseline: rehash and
// clear drift. The affirmative arm of the drift review prompt (the other arm is
// buildBundle, which discards the edit).
function acceptCanonical(bundle) {
  if (!bundle || typeof bundle !== 'object' || typeof bundle.canonical !== 'string')
    throw new Error('Generate a canonical preview first.');
  const generatedCanonicalHash = hashCanonical(bundle.canonical);
  return {
    ...bundle,
    generatedCanonicalHash,
    blueprint: { ...bundle.blueprint, canonical_hash: generatedCanonicalHash },
    canonicalDrift: false,
  };
}

module.exports = {
  SECTION_SOURCES,
  INCOMPLETE_PLACEHOLDER,
  HASH_RE,
  blueprintFromDraft,
  sectionBody,
  sectionMap,
  draftSourceHash,
  buildBundle,
  withCanonicalEdit,
  regenerateSection,
  acceptCanonical,
};
