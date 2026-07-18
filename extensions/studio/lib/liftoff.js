// App Builder — Lift-off (slice 8): pure route/preset decision logic for
// "Delegate to the Architect". No fs, no bus, no Electron — main.js is the
// only caller, kept separate so the delegate gate is drillable without a
// fake bus or a real seat/task. Mirrors main/tasks.js's own MAX_ROUTE cap.
'use strict';

const MAX_ROUTE = 8;

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
  MAX_ROUTE,
  findArchitectPreset,
  normalizeRouteInput,
  planDelegateRoute,
};
