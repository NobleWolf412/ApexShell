// Persona Builder — crash-safe runtime draft store. Drafts are not portable
// persona packages and remain under the extension's ignored state directory.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { KEYS } = require('./interview');
const {
  ACTION_CATEGORIES,
  ACTION_DECISIONS,
  ACTION_POSTURES,
  BLUEPRINT_AREAS,
  ACCESS_MODES,
  findRuntimeKeys,
  hashCanonical,
  isSafePersonaId,
  parseFrontmatter,
} = require('./contract');

const SCHEMA = 1;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DRAFT_BYTES = 256 * 1024;

function draftsDir(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir))
    throw new Error('Persona Builder state directory must be absolute.');
  return path.join(stateDir, 'drafts');
}

function draftPath(stateDir, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Draft ID is invalid.');
  return path.join(draftsDir(stateDir), id + '.json');
}

function ensureDraftsDir(stateDir, create) {
  const dir = draftsDir(stateDir);
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Draft store must be a regular directory, not a link.');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    if (!create) return null;
    fs.mkdirSync(dir);
  }
  return dir;
}

function cleanText(value, label, max) {
  if (typeof value !== 'string') throw new Error(label + ' must be text.');
  const text = value.trim();
  if (!text) throw new Error(label + ' is required.');
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  return text;
}

function validatePreview(value) {
  if (value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Draft preview is invalid.');
  if (!isSafePersonaId(value.personaId)) throw new Error('Draft preview persona ID is invalid.');
  if (typeof value.canonical !== 'string' || !value.canonical.trim() ||
      Buffer.byteLength(value.canonical, 'utf8') > 128 * 1024)
    throw new Error('Draft preview canonical is invalid.');
  if (typeof value.generatedCanonicalHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.generatedCanonicalHash))
    throw new Error('Draft preview canonical hash is invalid.');
  if (typeof value.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.sourceHash))
    throw new Error('Draft preview source hash is invalid.');
  const drift = hashCanonical(value.canonical) !== value.generatedCanonicalHash;
  if (value.canonicalDrift !== drift) throw new Error('Draft preview drift state is invalid.');
  const blueprint = value.blueprint;
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint) ||
      blueprint.schema_version !== 1 || blueprint.canonical_hash !== value.generatedCanonicalHash ||
      blueprint.persona_id !== value.personaId)
    throw new Error('Draft preview blueprint is invalid.');
  for (const area of BLUEPRINT_AREAS) {
    if (!blueprint[area] || typeof blueprint[area] !== 'object' || Array.isArray(blueprint[area]))
      throw new Error('Draft preview blueprint area is invalid: ' + area);
  }
  if (!ACTION_POSTURES.has(blueprint.action_posture.mode))
    throw new Error('Draft preview action posture is invalid.');
  const actions = blueprint.action_posture.actions;
  if (!actions || typeof actions !== 'object' || Array.isArray(actions))
    throw new Error('Draft preview action decisions are invalid.');
  for (const category of ACTION_CATEGORIES) {
    if (!ACTION_DECISIONS.has(actions[category]))
      throw new Error('Draft preview action decision is invalid: ' + category);
  }
  if (findRuntimeKeys(blueprint).length)
    throw new Error('Draft preview blueprint contains runtime-only fields.');
  const collaborationEnabled = value.collaboration !== null && value.collaboration !== undefined;
  const modules = parseFrontmatter(value.canonical).attributes.modules || [];
  if (!Array.isArray(modules))
    throw new Error('Draft preview canonical modules must be a list.');
  if (collaborationEnabled !== modules.includes('collaboration'))
    throw new Error('Draft preview collaboration does not match canonical modules.');
  if (collaborationEnabled) {
    const collaboration = value.collaboration;
    if (!collaboration || typeof collaboration !== 'object' || Array.isArray(collaboration) ||
        collaboration.schema_version !== 1 || !ACCESS_MODES.has(collaboration.default_access))
      throw new Error('Draft preview collaboration contract is invalid.');
    for (const field of ['capabilities', 'accepts', 'emits']) {
      if (!Array.isArray(collaboration[field]) || !collaboration[field].length ||
          collaboration[field].some((item) => typeof item !== 'string' || !item.trim()))
        throw new Error('Draft preview collaboration field is invalid: ' + field);
      if (collaboration[field].length > 100 ||
          collaboration[field].some((item) => item.trim().length > 240))
        throw new Error('Draft preview collaboration field is too large: ' + field);
    }
    if (findRuntimeKeys(collaboration).length)
      throw new Error('Draft preview collaboration contains runtime-only fields.');
  }
}

function atomicWrite(stateDir, file, value) {
  ensureDraftsDir(stateDir, true);
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_DRAFT_BYTES)
    throw new Error('Draft exceeds the 256 KB limit.');
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    fs.writeFileSync(temporary, serialized, {
      encoding: 'utf8',
      flag: 'wx',
    });
    fs.renameSync(temporary, file);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
}

function validateDraft(value, expectedId) {
  if (!value || value.schema !== SCHEMA) throw new Error('Draft schema must be 1.');
  if (!ID_RE.test(value.id) || (expectedId && value.id !== expectedId))
    throw new Error('Draft ID does not match its file.');
  if (typeof value.workspace !== 'string' || !path.isAbsolute(value.workspace))
    throw new Error('Draft workspace must be absolute.');
  const cleanName = cleanText(value.name, 'Persona name', 80);
  const cleanUseCase = cleanText(value.useCase, 'Use case', 240);
  if (value.name !== cleanName || /[\r\n]/.test(value.name))
    throw new Error('Persona name must be trimmed, single-line text.');
  if (value.useCase !== cleanUseCase)
    throw new Error('Use case must not have leading or trailing whitespace.');
  if (!Number.isInteger(value.revision) || value.revision < 1)
    throw new Error('Draft revision is invalid.');
  if (!Number.isInteger(value.currentCard) || value.currentCard < 0 || value.currentCard >= KEYS.length)
    throw new Error('Draft card position is invalid.');
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))
    throw new Error('Draft timestamps are invalid.');
  // A draft reopened from an existing package remembers which package it
  // replaces on permanent creation. Absent = a brand-new persona.
  if (value.editsPersonaId !== undefined && !isSafePersonaId(value.editsPersonaId))
    throw new Error('Draft editsPersonaId is invalid.');
  if (!value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers))
    throw new Error('Draft answers are invalid.');
  for (const key of KEYS) {
    if (typeof value.answers[key] !== 'string' || value.answers[key].length > 12000)
      throw new Error(`Draft answer ${key} is invalid.`);
  }
  for (const key of Object.keys(value.answers)) {
    if (!KEYS.includes(key)) throw new Error('Draft contains an unknown answer: ' + key);
  }
  validatePreview(value.preview === undefined ? null : value.preview);
  return value;
}

function readDraft(stateDir, id) {
  ensureDraftsDir(stateDir, false);
  const file = draftPath(stateDir, id);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error('Draft file must be a regular file, not a link.');
  if (stat.size > MAX_DRAFT_BYTES) throw new Error('Draft file exceeds the 256 KB limit.');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return validateDraft(parsed, id);
}

function createDraft(stateDir, workspace, starter) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('Choose a persona workspace first.');
  const root = path.resolve(workspace);
  if (!fs.statSync(root).isDirectory()) throw new Error('Persona workspace is unavailable.');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const draft = {
    schema: SCHEMA,
    id,
    workspace: root,
    name: cleanText(starter && starter.name, 'Persona name', 80),
    useCase: cleanText(starter && starter.useCase, 'Use case', 240),
    revision: 1,
    currentCard: 0,
    answers: Object.fromEntries(KEYS.map((key) => [key, ''])),
    preview: null,
    createdAt: now,
    updatedAt: now,
  };
  // reopen-as-draft (edit an existing package) tags the source id so permanent
  // creation replaces it instead of colliding.
  if (starter && starter.editsPersonaId !== undefined)
    draft.editsPersonaId = starter.editsPersonaId;
  validateDraft(draft, id);
  const dir = ensureDraftsDir(stateDir, true);
  if (fs.readdirSync(dir).filter((name) => name.endsWith('.json')).length >= 100)
    throw new Error('Draft limit reached; remove an older draft first.');
  const file = draftPath(stateDir, id);
  if (fs.existsSync(file)) throw new Error('Draft ID collision; try again.');
  atomicWrite(stateDir, file, draft);
  return draft;
}

function updateDraft(stateDir, id, expectedRevision, changes) {
  const current = readDraft(stateDir, id);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
    const conflict = new Error('Draft changed since it was loaded; reopen it before editing.');
    conflict.code = 'DRAFT_CONFLICT';
    throw conflict;
  }
  const next = { ...current, answers: { ...current.answers } };
  if (changes && Object.prototype.hasOwnProperty.call(changes, 'currentCard')) {
    if (!Number.isInteger(changes.currentCard) || changes.currentCard < 0 || changes.currentCard >= KEYS.length)
      throw new Error('Draft card position is invalid.');
    next.currentCard = changes.currentCard;
  }
  if (changes && changes.answers !== undefined) {
    if (!changes.answers || typeof changes.answers !== 'object' || Array.isArray(changes.answers))
      throw new Error('Draft answer patch is invalid.');
    for (const [key, value] of Object.entries(changes.answers)) {
      if (!KEYS.includes(key)) throw new Error('Unknown draft answer: ' + key);
      if (typeof value !== 'string' || value.length > 12000)
        throw new Error(`Draft answer ${key} is invalid.`);
      next.answers[key] = value;
    }
  }
  if (changes && Object.prototype.hasOwnProperty.call(changes, 'preview')) {
    validatePreview(changes.preview);
    next.preview = changes.preview === null
      ? null
      : JSON.parse(JSON.stringify(changes.preview));
  }
  next.revision += 1;
  next.updatedAt = new Date().toISOString();
  validateDraft(next, id);
  atomicWrite(stateDir, draftPath(stateDir, id), next);
  return next;
}

function listDrafts(stateDir, workspace) {
  const dir = ensureDraftsDir(stateDir, false);
  if (!dir) return { drafts: [], warnings: [] };
  const root = path.resolve(workspace);
  const drafts = [];
  const warnings = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -5);
    try {
      const draft = readDraft(stateDir, id);
      if (path.resolve(draft.workspace) !== root) continue;
      drafts.push(draft);
    } catch (err) {
      warnings.push(`${entry.name}: ${err.message}`);
    }
  }
  drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { drafts, warnings };
}

function deleteDraft(stateDir, id, workspace) {
  const draft = readDraft(stateDir, id);
  if (path.resolve(draft.workspace) !== path.resolve(workspace))
    throw new Error('Draft belongs to a different workspace.');
  fs.unlinkSync(draftPath(stateDir, id));
}

module.exports = {
  SCHEMA,
  ID_RE,
  draftsDir,
  draftPath,
  validateDraft,
  readDraft,
  createDraft,
  updateDraft,
  listDrafts,
  deleteDraft,
  validatePreview,
};

