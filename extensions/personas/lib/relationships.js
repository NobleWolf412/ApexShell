// Persona Builder — relationship recommendations. When a persona is being
// built, suggest WHO it should work with: heuristic pairings from role
// archetypes (always available, no model call), plus an optional richer pass
// through a disposable seat (main.js owns the seat; this module builds the
// prompt and validates the reply). Accepted suggestions fill the
// collaboration contract's accepts/emits and can save a Task Board route
// template — persona creation and delegation become one connected system.
//
// LLM output is UNTRUSTED: validateSuggestions is a strict allowlist — a
// suggestion can only reference an existing persona by name or propose a
// clearly-marked NEW role; every other key and any oversize text is dropped.
'use strict';

const fs = require('fs');
const path = require('path');

const TEXT_CAP = 240;              // per drafts.js collaboration line caps
const MAX_SUGGESTIONS = 12;
const MAX_ROUTES = 6;
const MAX_ROUTE_STEPS = 8;
const CONTEXT_FILE = 'project-context.md';
const MAX_CONTEXT_BYTES = 8 * 1024;

// ---------- project context (workspace-portable, one small file) ----------
function contextPath(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('Persona workspace must be an absolute path.');
  return path.join(path.resolve(workspace), CONTEXT_FILE);
}

function readProjectContext(workspace) {
  const file = contextPath(workspace);
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return '';
    if (stat.size > MAX_CONTEXT_BYTES) return '';
    return fs.readFileSync(file, 'utf8').trim();
  } catch { return ''; }
}

function saveProjectContext(workspace, text) {
  const file = contextPath(workspace);
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (Buffer.byteLength(normalized, 'utf8') > MAX_CONTEXT_BYTES)
    throw new Error('Project context exceeds the 8 KB limit.');
  if (!normalized) { try { fs.rmSync(file, { force: true }); } catch { /* gone */ } return ''; }
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, normalized + '\n', { encoding: 'utf8', flag: 'wx' });
  try { fs.renameSync(tmp, file); }
  finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ } }
  return normalized;
}

// ---------- role archetypes (keyed to the mission card's own vocabulary) ----------
const ARCHETYPES = [
  { key: 'builder', label: 'builder',
    match: /\b(build\w*|implement\w*|cod(e|ing)|develop\w*|fix\w*|ship\w*|construct\w*|writes? (code|features))\b/i },
  { key: 'reviewer', label: 'independent reviewer',
    match: /\b(review\w*|audit\w*|diagnos\w*|inspect\w*|assess\w*|critique\w*|second opinion|verif\w+ (other|another|submitted))\b/i },
  { key: 'researcher', label: 'researcher',
    match: /\b(research\w*|investigat\w*|brief\w*|analy[sz]\w*|explor\w*|survey\w*)\b/i },
  { key: 'planner', label: 'planner/architect',
    match: /\b(plan\w*|coordinat\w*|architect\w*|design\w*|roadmap|prioriti[sz]\w*)\b/i },
];

function classify(text) {
  const found = new Set();
  const s = String(text || '');
  for (const a of ARCHETYPES) if (a.match.test(s)) found.add(a.key);
  return found;
}

// Canonical pairings: [from-archetype, to-archetype, what flows, why].
const PAIRINGS = [
  ['planner', 'reviewer', 'design packet for independent review',
    'a design should never ship on its author\'s word alone — route it through an independent review'],
  ['planner', 'builder', 'approved design brief',
    'plans need a hands-on role to implement them'],
  ['builder', 'reviewer', 'change set with evidence for independent review',
    'built work needs a second opinion before it counts as done'],
  ['reviewer', 'builder', 'prioritized findings for rework',
    'confirmed defects go back to the role that owns the fix'],
  ['researcher', 'planner', 'research brief with sources',
    'findings should land with the role that turns them into direction'],
];

/** Summaries of the workspace's existing persona packages: display name,
 *  archetypes (from the blueprint's mission prose), collaboration contract. */
function personaSummaries(workspace, creator) {
  const out = [];
  let root;
  try { root = path.resolve(workspace); } catch { return out; }
  const personasDir = path.join(root, 'personas');
  let entries;
  try { entries = fs.readdirSync(personasDir, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = creator.packageDisplayName(root, entry.name);
    if (!name) continue;
    let mission = '';
    let collaboration = null;
    try {
      const blueprint = JSON.parse(
        fs.readFileSync(path.join(personasDir, entry.name, 'blueprint.json'), 'utf8'));
      const area = blueprint && (blueprint.mission ||
        (blueprint.areas && blueprint.areas.mission));
      if (area && typeof area.response === 'string') mission = area.response.slice(0, 600);
    } catch { /* mission stays empty — classification just gets less signal */ }
    try {
      const file = path.join(personasDir, entry.name, 'collaboration.json');
      if (fs.existsSync(file)) collaboration = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* optional */ }
    out.push({ id: entry.name, name, mission,
               archetypes: [...classify(mission + ' ' + name)], collaboration });
  }
  return out;
}

/** Deterministic pairings — no model call. Returns { suggestions, routes }. */
function heuristicSuggestions(draft, summaries) {
  const draftText = [draft && draft.name, draft && draft.useCase,
    draft && draft.answers && draft.answers.mission].filter(Boolean).join(' ');
  const mine = classify(draftText);
  if (!mine.size) mine.add('builder');   // an untyped persona still deserves a reviewer
  const draftName = String((draft && draft.name) || 'this persona').trim();
  const byArchetype = (key) => summaries.filter((s) => s.archetypes.includes(key));
  const label = (key) => (ARCHETYPES.find((a) => a.key === key) || { label: key }).label;

  const suggestions = [];
  const routes = [];
  const seen = new Set();
  const add = (s) => {
    const dedupe = s.with + '|' + s.direction + '|' + s.packet;
    if (seen.has(dedupe) || suggestions.length >= MAX_SUGGESTIONS) return;
    seen.add(dedupe);
    suggestions.push(s);
  };

  for (const [from, to, packet, why] of PAIRINGS) {
    if (mine.has(from)) {
      const partners = byArchetype(to).filter((s) => s.name !== draftName);
      if (partners.length) {
        for (const p of partners.slice(0, 2))
          add({ with: p.name, direction: 'sends-to', packet, why });
        routes.push({
          name: (draftName + '-' + label(to)).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
          steps: [draftName, partners[0].name],
        });
      } else {
        add({ with: 'NEW:' + label(to), direction: 'sends-to', packet,
              why: why + ' — no ' + label(to) + ' persona exists in this workspace yet' });
      }
    }
    if (mine.has(to)) {
      const partners = byArchetype(from).filter((s) => s.name !== draftName);
      if (partners.length) {
        for (const p of partners.slice(0, 2))
          add({ with: p.name, direction: 'receives-from', packet, why });
      } else {
        add({ with: 'NEW:' + label(from), direction: 'receives-from', packet,
              why: why + ' — no ' + label(from) + ' persona exists in this workspace yet' });
      }
    }
  }
  return { suggestions, routes: routes.slice(0, MAX_ROUTES) };
}

// ---------- the LLM pass (main.js runs the disposable seat) ----------
function buildPrompt(draft, summaries, projectContext) {
  const lines = [
    'You are helping design a TEAM of AI personas that hand work to each other.',
    projectContext ? 'The user is building: ' + projectContext : null,
    '',
    'A NEW persona is being created:',
    'Name: ' + ((draft && draft.name) || '(unnamed)'),
    'Purpose: ' + ((draft && draft.useCase) || '(not given)'),
    'Mission: ' + (((draft && draft.answers && draft.answers.mission) || '(not written yet)').slice(0, 1500)),
    '',
    'Existing personas in the workspace:',
    summaries.length
      ? summaries.map((s) => '- ' + s.name + ': ' + (s.mission ? s.mission.slice(0, 200) : '(no mission on file)')).join('\n')
      : '(none yet)',
    '',
    'Recommend working relationships for the new persona. Reply with ONLY one fenced block:',
    '```json',
    '{ "suggestions": [ { "with": "<existing persona name, or NEW:<role>>",',
    '    "direction": "sends-to" | "receives-from",',
    '    "packet": "<what flows between them, under 200 chars>",',
    '    "why": "<one sentence>" } ],',
    '  "routes": [ { "name": "<kebab-case>", "steps": ["<persona name>", "..."] } ] }',
    '```',
    'Rules: reference existing personas by their exact names; use NEW:<role> for a persona',
    'worth creating; routes are ordered handoff chains that may include the new persona',
    'by its name; at most 8 suggestions and 4 routes; independent review relationships',
    'are strongly preferred for any persona that produces work products.',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** Strict allowlist over an untrusted LLM reply. knownNames includes the
 *  draft's own name. Returns { suggestions, routes, error }. */
function parseLlmReply(text, knownNames) {
  const match = String(text || '').match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (!match) return { suggestions: [], routes: [], error: 'no JSON block in the reply' };
  let raw;
  try { raw = JSON.parse(match[1]); }
  catch { return { suggestions: [], routes: [], error: 'reply JSON did not parse' }; }
  return { ...validateSuggestions(raw, knownNames), error: null };
}

function validateSuggestions(raw, knownNames) {
  const known = new Set((knownNames || []).map((n) => String(n).toLowerCase()));
  const cap = (v) => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, TEXT_CAP) : '';
  const suggestions = [];
  const routes = [];
  if (raw && Array.isArray(raw.suggestions)) {
    for (const s of raw.suggestions) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      if (!s || typeof s !== 'object') continue;
      const withRaw = cap(s.with);
      const direction = s.direction === 'sends-to' || s.direction === 'receives-from'
        ? s.direction : null;
      const isNew = /^NEW:/.test(withRaw);
      const isKnown = known.has(withRaw.toLowerCase());
      if (!withRaw || !direction || (!isNew && !isKnown)) continue;
      suggestions.push({ with: withRaw, direction,
                         packet: cap(s.packet), why: cap(s.why) });
    }
  }
  if (raw && Array.isArray(raw.routes)) {
    for (const r of raw.routes) {
      if (routes.length >= MAX_ROUTES) break;
      if (!r || typeof r !== 'object' || !Array.isArray(r.steps)) continue;
      const name = cap(r.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      const steps = r.steps.map(cap).filter((p) => p && known.has(p.toLowerCase()));
      if (!name || steps.length < 1 || steps.length > MAX_ROUTE_STEPS ||
          steps.length !== r.steps.length) continue;   // any unknown step kills the route
      routes.push({ name, steps });
    }
  }
  return { suggestions, routes };
}

// ---------- handoff recommendations (the Delegate button's hint) ----------
// Match each persona's EMITS against every other persona's ACCEPTS from their
// collaboration contracts — the natural next persona is the one whose contract
// consumes what this one produces. Crude 6-char stemming so "implemented" and
// "implementation" meet in the middle.
const stemWord = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
function overlapScore(emits, accepts) {
  const acceptStems = new Set((accepts || [])
    .flatMap((s) => String(s).split(/\s+/).map(stemWord))
    .filter((w) => w.length > 3));
  let score = 0;
  for (const e of emits || [])
    for (const w of String(e).split(/\s+/).map(stemWord))
      if (w.length > 3 && acceptStems.has(w)) score++;
  return score;
}

/** { <persona name>: <recommended next persona name> } for every persona whose
 *  emits overlap another's accepts. No contract or no match = no entry. */
function handoffMap(summaries) {
  const map = {};
  for (const s of summaries || []) {
    if (!s.collaboration || !Array.isArray(s.collaboration.emits)) continue;
    let best = null;
    let bestScore = 0;
    for (const t of summaries) {
      if (t === s || !t.collaboration || !Array.isArray(t.collaboration.accepts)) continue;
      const score = overlapScore(s.collaboration.emits, t.collaboration.accepts);
      if (score > bestScore) { best = t.name; bestScore = score; }
    }
    if (best) map[s.name] = best;
  }
  return map;
}

module.exports = {
  readProjectContext,
  saveProjectContext,
  classify,
  personaSummaries,
  heuristicSuggestions,
  handoffMap,
  buildPrompt,
  parseLlmReply,
  validateSuggestions,
  TEXT_CAP, MAX_SUGGESTIONS, MAX_ROUTES,
};
