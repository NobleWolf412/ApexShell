// App Builder — Lift-off (slice 8): pure route/preset decision logic for
// "Delegate to the Architect". No fs, no bus, no Electron — main.js is the
// only caller, kept separate so the delegate gate is drillable without a
// fake bus or a real seat/task. Mirrors main/tasks.js's own MAX_ROUTE cap.
// Slice F2 adds the kickoff-brief composition (PROJECT.md + the contract
// addendum) here for the same reason: the truncation order is a contract,
// so it must drill without a bus. Slice E1 adds the BUILD step's milestone
// machinery — deterministic delivery-prose parsing and the derived (never
// stored) open/building/done status — as the drilled authority the
// renderer's mirror is held to.
'use strict';

const MAX_ROUTE = 8;

// F2 (§ Wave F): the composed kickoff brief — the verbatim PROJECT.md text
// first, then spines.js's contract addendum behind a separator no canonical
// heading can collide with. BRIEF_CAP mirrors main/tasks.js's own taskCreate
// cap (`.trim().slice(0, 20000)`) exactly the way MAX_ROUTE above mirrors its
// route cap: composing past it would let tasks.js cut the tail SILENTLY —
// mid-sentence, marker and all — so the trim happens here, where the order
// can be chosen. PROJECT.md wins whole; the addendum (the tail of the text)
// absorbs the entire overflow and says so with an honest marker. A PROJECT.md
// that alone leaves no room for even the marker drops the addendum whole —
// that file is already at tasks.js's own truncation edge, and a marker the
// cap would eat is not honesty, it is noise.
const BRIEF_CAP = 20000;
const ADDENDUM_SEPARATOR =
  '\n\n===== CONTRACT ADDENDUM (rides the kickoff; not part of PROJECT.md) =====\n\n';
const ADDENDUM_TRUNCATED_MARKER = '\n[addendum truncated]';

function composeKickoffBrief(projectText, addendum) {
  const project = typeof projectText === 'string' ? projectText : '';
  const extra = typeof addendum === 'string' ? addendum : '';
  if (!extra) return project;
  const combined = project + ADDENDUM_SEPARATOR + extra;
  if (combined.length <= BRIEF_CAP) return combined;
  const room = BRIEF_CAP - project.length - ADDENDUM_SEPARATOR.length - ADDENDUM_TRUNCATED_MARKER.length;
  if (room <= 0) return project;
  return project + ADDENDUM_SEPARATOR + extra.slice(0, room) + ADDENDUM_TRUNCATED_MARKER;
}

// An "Architect-shaped" preset: an exact case-insensitive name match wins;
// failing that, any live preset whose name CONTAINS "architect" — the same
// loose read a human scanning the rail would make. No match returns null,
// never a guess (§ spec: "with no matching preset the button explains itself").
function findArchitectPreset(presetNames) {
  const names = Array.isArray(presetNames) ? presetNames.filter((n) => typeof n === 'string') : [];
  const exact = names.find((n) => n.toLowerCase() === 'architect');
  if (exact) return exact;
  return names.find((n) => n.toLowerCase().includes('architect')) || null;
}

// ---- E1 (§ Wave E): the BUILD step's milestone track --------------------
// Milestones parse DETERMINISTICALLY from the delivery section's prose —
// numbered/bulleted lines plus 'milestone'-marked sentences. Imperfect
// parsing is fine by spec: the list is user-visible and the delivery card is
// the fix, so the parser optimizes for being predictable, never clever.
// Status is DERIVED, never stored: a board task in the project's folder
// whose title carries the milestone slug IS the milestone's state. The
// renderer holds a mirror of the derive logic (it cannot require this file);
// this side is the drilled authority the mirror is held to.
const MILESTONE_LIST_CAP = 30;
const MILESTONE_TEXT_CAP = 200;
const MILESTONE_SLUG_CAP = 48;

// The same fold normalizeProjectId (lib/render.js) applies, minus its
// leading-letter/fallback rules — a slug is a match key, not an identifier,
// so an empty result is honest (the caller drops the milestone).
function milestoneSlug(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MILESTONE_SLUG_CAP)
    .replace(/-+$/g, '');
}

// The delivery section, sliced between the canonical's stable app-builder
// markers (the regenerateSection discipline — heading text is free, the
// marker carries identity). Missing/garbled markers = '' — the track shows
// its empty state instead of guessing at the whole document.
const DELIVERY_START = '<!-- app-builder:delivery:start -->';
const DELIVERY_END = '<!-- app-builder:delivery:end -->';
function extractDeliverySection(canonicalText) {
  if (typeof canonicalText !== 'string') return '';
  const from = canonicalText.indexOf(DELIVERY_START);
  const to = canonicalText.indexOf(DELIVERY_END);
  if (from < 0 || to <= from) return '';
  return canonicalText.slice(from + DELIVERY_START.length, to);
}

function parseMilestones(deliveryText) {
  if (typeof deliveryText !== 'string' || !deliveryText.trim()) return [];
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const text = String(raw).replace(/\s+/g, ' ').trim().slice(0, MILESTONE_TEXT_CAP);
    const slug = milestoneSlug(text);
    // no slug (all punctuation) or a duplicate = dropped, never a blank row
    if (!slug || seen.has(slug) || out.length >= MILESTONE_LIST_CAP) return;
    seen.add(slug);
    out.push({ text, slug });
  };
  for (const line of deliveryText.split(/\r?\n/)) {
    const t = line.trim();
    // headings and HTML comments (the section's own '## …' line and the
    // '<!-- delivery not yet drafted -->' placeholder) are never milestones
    if (!t || t.startsWith('#') || t.startsWith('<!--')) continue;
    const listItem = t.match(/^(?:\d+[.)]\s+|[-*•]\s+)(.+)$/);
    if (listItem) { push(listItem[1]); continue; }
    if (/milestone/i.test(t)) {
      // plain prose: only the sentences that SAY milestone count
      for (const sentence of t.split(/(?<=[.!?])\s+/))
        if (/milestone/i.test(sentence)) push(sentence);
    }
  }
  return out;
}

// Derived status. Matching is slug-in-slugified-title on TOKEN boundaries
// (the '-' wrap): 'auth' must not match 'author', but a delegate title of
// 'Delegate: App — user-auth' and a hand-typed 'User auth' task both match
// 'user-auth'. cwd comparison is a plain normalized-string check — both
// sides originate from the same projectDir string in practice, and this
// must run in the renderer mirror where path.resolve does not exist.
// Precedence: any live task wins ('building' — a re-delegated done milestone
// honestly reopens), else a done task ('done'), else 'open'. A 'failed' task
// counts as neither: not done, and not still building.
const ACTIVE_TASK_STATUSES = ['open', 'running', 'paused', 'needs-attention'];
function normalizeDirKey(dir) {
  return String(dir || '').replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}
function deriveMilestoneStatus(slug, tasks, projectDir) {
  const wantDir = normalizeDirKey(projectDir);
  if (!slug || !wantDir) return 'open';
  let done = false;
  for (const t of (Array.isArray(tasks) ? tasks : [])) {
    if (!t || typeof t.title !== 'string' || typeof t.cwd !== 'string') continue;
    if (normalizeDirKey(t.cwd) !== wantDir) continue;
    if (!('-' + milestoneSlug(t.title) + '-').includes('-' + slug + '-')) continue;
    if (ACTIVE_TASK_STATUSES.includes(t.status)) return 'building';
    if (t.status === 'done') done = true;
  }
  return done ? 'done' : 'open';
}

// User-typed route (or none, which falls back to the Architect alone).
function normalizeRouteInput(input, fallbackPersona) {
  const steps = Array.isArray(input)
    ? input.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
    : [];
  if (steps.length) return steps.slice(0, MAX_ROUTE);
  return fallbackPersona ? [fallbackPersona] : [];
}

// Route ↔ live presets. main/tasks.js's own taskCreate already TOASTS a
// warning for a route step that names an unregistered preset, but still
// creates the task anyway — Lift-off's contract is stricter: refuse BEFORE
// ever calling taskCreate, so a broken route never reaches the board.
function planDelegateRoute({ presetNames, route }) {
  const known = new Set(Array.isArray(presetNames) ? presetNames : []);
  const steps = Array.isArray(route) ? route : [];
  if (!steps.length)
    return { ok: false, unknownPresets: [], error: 'Choose at least one persona for the route.' };
  if (steps.length > MAX_ROUTE)
    return { ok: false, unknownPresets: [], error: `A route holds at most ${MAX_ROUTE} personas.` };
  const unknownPresets = steps.filter((p) => !known.has(p));
  if (unknownPresets.length)
    return { ok: false, unknownPresets, error: null };
  return { ok: true, unknownPresets: [] };
}

module.exports = {
  ADDENDUM_SEPARATOR,
  ADDENDUM_TRUNCATED_MARKER,
  BRIEF_CAP,
  MAX_ROUTE,
  MILESTONE_LIST_CAP,
  MILESTONE_TEXT_CAP,
  composeKickoffBrief,
  deriveMilestoneStatus,
  extractDeliverySection,
  findArchitectPreset,
  milestoneSlug,
  normalizeRouteInput,
  parseMilestones,
  planDelegateRoute,
};
