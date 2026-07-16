// Persona Builder — deterministic blueprint/canonical preview rendering.
'use strict';

const {
  ACCESS_MODES,
  ACTION_CATEGORIES,
  ACTION_DECISIONS,
  ACTION_POSTURES,
  hashCanonical,
  isSafePersonaId,
} = require('./contract');
const { KEYS } = require('./interview');

const SECTION_HEADINGS = {
  identity: 'Identity and Background',
  mission: 'Role and Mission',
  communication: 'Communication Style',
  boundaries: 'Persona-Specific Boundaries',
  working_method: 'Working Method',
  action_posture: 'Action and Tool Use',
};

function normalizePersonaId(displayName) {
  const ascii = String(displayName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let id = ascii || 'persona';
  if (!/^[a-z]/.test(id)) id = 'persona-' + id;
  id = id.slice(0, 64).replace(/-+$/g, '');
  return id || 'persona';
}

function validatePreviewChoices(draft, choices) {
  const personaId = choices && choices.personaId;
  if (!isSafePersonaId(personaId))
    throw new Error('Persona ID must be lowercase kebab-case and at most 64 characters.');
  const mode = choices && choices.mode;
  if (!ACTION_POSTURES.has(mode)) throw new Error('Choose an action posture.');
  const actions = choices && choices.actions;
  if (!actions || typeof actions !== 'object' || Array.isArray(actions))
    throw new Error('Choose a decision for every action category.');
  const normalizedActions = {};
  for (const category of ACTION_CATEGORIES) {
    if (!ACTION_DECISIONS.has(actions[category]))
      throw new Error('Choose allowed, ask, or blocked for ' + category + '.');
    normalizedActions[category] = actions[category];
  }
  for (const key of KEYS) {
    if (!draft.answers[key] || !draft.answers[key].trim())
      throw new Error('Complete the interview card: ' + SECTION_HEADINGS[key] + '.');
  }
  let collaboration = null;
  if (choices && choices.collaboration && choices.collaboration.enabled) {
    const input = choices.collaboration;
    if (!ACCESS_MODES.has(input.default_access))
      throw new Error('Collaboration access must be read-only or read-write.');
    collaboration = { schema_version: 1, default_access: input.default_access };
    for (const field of ['capabilities', 'accepts', 'emits']) {
      if (!Array.isArray(input[field]) || !input[field].length ||
          input[field].some((item) => typeof item !== 'string' || !item.trim()))
        throw new Error('Collaboration ' + field + ' must contain at least one item.');
      if (input[field].length > 100 || input[field].some((item) => item.trim().length > 240))
        throw new Error('Collaboration ' + field + ' is limited to 100 items of 240 characters.');
      collaboration[field] = [...new Set(input[field].map((item) => item.trim()))];
    }
  }
  return { personaId, mode, actions: normalizedActions, collaboration };
}

function sectionBlock(key, answer) {
  return [
    `<!-- persona-builder:${key}:start -->`,
    `## ${SECTION_HEADINGS[key]}`,
    '',
    answer.trim(),
    `<!-- persona-builder:${key}:end -->`,
  ].join('\n');
}

function draftSourceHash(draft) {
  return hashCanonical(JSON.stringify({
    name: draft.name,
    useCase: draft.useCase,
    answers: Object.fromEntries(KEYS.map((key) => [key, draft.answers[key]])),
  }));
}

function renderCanonical(draft, personaId, modules = []) {
  if (!isSafePersonaId(personaId)) throw new Error('Persona ID is invalid.');
  const lines = [
    '---',
    'schema_version: 1',
    'name: ' + personaId,
    'display_name: ' + JSON.stringify(draft.name),
    'description: ' + JSON.stringify(draft.useCase),
    'aliases: []',
  ];
  if (modules.length) {
    lines.push('modules:', ...modules.map((moduleName) => '  - ' + moduleName));
  } else {
    lines.push('modules: []');
  }
  lines.push(
    '---',
    '',
    '# ' + draft.name,
    '',
    draft.useCase,
    '',
  );
  for (const key of KEYS) {
    lines.push(sectionBlock(key, draft.answers[key]), '');
  }
  return lines.join('\n').replace(/\n+$/g, '\n');
}

function renderBundle(draft, choices) {
  const selected = validatePreviewChoices(draft, choices);
  const canonical = renderCanonical(draft, selected.personaId,
    selected.collaboration ? ['collaboration'] : []);
  const generatedCanonicalHash = hashCanonical(canonical);
  const blueprint = {
    schema_version: 1,
    canonical_hash: generatedCanonicalHash,
    persona_id: selected.personaId,
    display_name: draft.name,
    description: draft.useCase,
    identity: { response: draft.answers.identity.trim() },
    mission: { response: draft.answers.mission.trim() },
    communication: { response: draft.answers.communication.trim() },
    boundaries: { response: draft.answers.boundaries.trim() },
    working_method: { response: draft.answers.working_method.trim() },
    action_posture: {
      response: draft.answers.action_posture.trim(),
      mode: selected.mode,
      actions: selected.actions,
    },
  };
  return {
    personaId: selected.personaId,
    canonical,
    blueprint,
    collaboration: selected.collaboration,
    generatedCanonicalHash,
    sourceHash: draftSourceHash(draft),
    canonicalDrift: false,
  };
}

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

function regenerateSection(bundle, key, answer) {
  if (!KEYS.includes(key)) throw new Error('Unknown canonical section: ' + key);
  if (typeof answer !== 'string' || !answer.trim())
    throw new Error('Canonical section answer cannot be empty.');
  const start = `<!-- persona-builder:${key}:start -->`;
  const end = `<!-- persona-builder:${key}:end -->`;
  const from = bundle.canonical.indexOf(start);
  const to = bundle.canonical.indexOf(end);
  if (from < 0 || to < from)
    throw new Error('Section markers are missing; regenerate the full canonical or restore the markers.');
  const after = to + end.length;
  const canonical = bundle.canonical.slice(0, from) + sectionBlock(key, answer) +
    bundle.canonical.slice(after);
  const edited = withCanonicalEdit({
    ...bundle,
    blueprint: {
      ...bundle.blueprint,
      [key]: { ...bundle.blueprint[key], response: answer.trim() },
    },
  }, canonical);
  if (bundle.canonicalDrift) return edited;
  const generatedCanonicalHash = hashCanonical(edited.canonical);
  return {
    ...edited,
    generatedCanonicalHash,
    blueprint: { ...edited.blueprint, canonical_hash: generatedCanonicalHash },
    canonicalDrift: false,
  };
}

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
  SECTION_HEADINGS,
  normalizePersonaId,
  draftSourceHash,
  validatePreviewChoices,
  renderCanonical,
  renderBundle,
  withCanonicalEdit,
  regenerateSection,
  acceptCanonical,
};

