// App Builder — Lift-off (slice 8): pure route/preset decision logic for
// "Delegate to the Architect". No fs, no bus, no Electron — main.js is the
// only caller, kept separate so the delegate gate is drillable without a
// fake bus or a real seat/task. Mirrors main/tasks.js's own MAX_ROUTE cap.
// Slice F2 adds the kickoff-brief composition (PROJECT.md + the contract
// addendum) here for the same reason: the truncation order is a contract,
// so it must drill without a bus.
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
  composeKickoffBrief,
  findArchitectPreset,
  normalizeRouteInput,
  planDelegateRoute,
};
