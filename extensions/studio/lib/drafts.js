// App Builder — crash-safe runtime draft store. A draft is the in-progress
// interview (working name + one-sentence pitch + the card answers); it is
// NOT a portable project package and never leaves the extension's ignored state
// directory (§ Guided interview, § Write safety). Pattern-matched from
// extensions/personas/lib/drafts.js: the atomic-write / symlink-refusal /
// revision-gating discipline is identical by design, but the draft SHAPE differs
// (no preview bundle, a pitch instead of a use case), so the module is a sibling,
// not a shared import — sharing would mean speculatively abstracting two shapes
// into one framework this slice does not need.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { KEYS } = require('./interview');
const { BLUEPRINT_AREAS, SCHEMA_VERSION, findRuntimeKeys, hashCanonical, isSafeProjectId } = require('./contract');

const SCHEMA = 1;
// v4 UUID — the draft id is also its filename, so the shape is pinned tight.
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_ANSWER = 12000;
const MAX_NAME = 80;
const MAX_PITCH = 240;

function draftsDir(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir))
    throw new Error('App Builder state directory must be absolute.');
  return path.join(stateDir, 'drafts');
}

function draftPath(stateDir, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Draft ID is invalid.');
  return path.join(draftsDir(stateDir), id + '.json');
}

// A linked drafts directory could redirect writes outside the state tree; refuse
// it before any read or write (mirrors the persona store's link guard).
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
  if (/[\r\n]/.test(text)) throw new Error(label + ' must be single-line text.');
  return text;
}

// The pitch is optional at Start (a working name is enough to begin) but stays
// single-line and bounded when present.
function cleanPitch(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('Pitch must be text.');
  const text = value.trim();
  if (text.length > MAX_PITCH) throw new Error(`Pitch exceeds ${MAX_PITCH} characters.`);
  if (/[\r\n]/.test(text)) throw new Error('Pitch must be single-line text.');
  return text;
}

// The crash-safety primitive: serialize to a uniquely-named temp file opened
// with the exclusive `wx` flag, then rename over the destination. rename() is
// atomic on a single filesystem, so a reader ever sees either the old whole file
// or the new whole file — never a half-written one. An interrupted write leaves
// only an orphan .tmp (ignored by every reader, which keys on `<uuid>.json`).
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
    fs.writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
}

const HASH_RE = /^[0-9a-f]{64}$/;

// The approved Blueprint Review snapshot (slice 4), persisted on the draft so
// hash-drift survives reload/crash — the same discipline personas/lib/drafts.js
// uses for its preview. null means "no canonical generated yet". The drift bit is
// re-derived here and cross-checked, so a tampered file can never claim "no drift"
// while carrying an edited canonical.
function validatePreview(value) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Draft preview is invalid.');
  if (!isSafeProjectId(value.projectId)) throw new Error('Draft preview project ID is invalid.');
  if (typeof value.displayName !== 'string' || !value.displayName.trim())
    throw new Error('Draft preview display name is invalid.');
  if (typeof value.description !== 'string') throw new Error('Draft preview description is invalid.');
  if (typeof value.canonical !== 'string' || !value.canonical.trim() ||
      Buffer.byteLength(value.canonical, 'utf8') > 128 * 1024)
    throw new Error('Draft preview canonical is invalid.');
  if (typeof value.generatedCanonicalHash !== 'string' || !HASH_RE.test(value.generatedCanonicalHash))
    throw new Error('Draft preview canonical hash is invalid.');
  if (typeof value.sourceHash !== 'string' || !HASH_RE.test(value.sourceHash))
    throw new Error('Draft preview source hash is invalid.');
  const drift = hashCanonical(value.canonical) !== value.generatedCanonicalHash;
  if (value.canonicalDrift !== drift) throw new Error('Draft preview drift state is invalid.');
  const blueprint = value.blueprint;
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint) ||
      blueprint.schema_version !== SCHEMA_VERSION || blueprint.canonical_hash !== value.generatedCanonicalHash)
    throw new Error('Draft preview blueprint is invalid.');
  for (const area of BLUEPRINT_AREAS) {
    if (!blueprint[area] || typeof blueprint[area] !== 'object' || Array.isArray(blueprint[area]))
      throw new Error('Draft preview blueprint area is invalid: ' + area);
  }
  if (findRuntimeKeys(blueprint).length)
    throw new Error('Draft preview blueprint contains runtime-only fields.');
  if (value.gaps !== undefined && (!Array.isArray(value.gaps) ||
      value.gaps.some((key) => typeof key !== 'string' || key.length > 40)))
    throw new Error('Draft preview gaps are invalid.');
}

// The SEE step's mockup approval (slice A4), persisted on the draft the same
// way the preview is: { screens: [ids], canonicalHash, approvedAt }, or null
// for "not approved". The hash pins WHICH blueprint the eyes signed off on —
// staleness (hash moved on) is derived at read time, never stored; a screen
// regeneration clears the field outright (main.js). The id regex mirrors
// lib/mockup.js's SCREEN_ID_RE verbatim rather than importing it — mockup.js
// already requires this module, and a validation-only regex is not worth a
// require cycle.
const APPROVAL_SCREEN_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function validateMockupApproval(value) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Draft mockup approval is invalid.');
  // 24 == mockup.MAX_SCREENS, 48 == mockup.MAX_SCREEN_ID — the same one-way
  // mirror as APPROVAL_SCREEN_RE above (mockup.js requires this module).
  if (!Array.isArray(value.screens) || !value.screens.length || value.screens.length > 24 ||
      value.screens.some((id) => typeof id !== 'string' || id.length > 48 || !APPROVAL_SCREEN_RE.test(id)) ||
      new Set(value.screens).size !== value.screens.length)
    throw new Error('Draft mockup approval screens are invalid.');
  if (typeof value.canonicalHash !== 'string' || !HASH_RE.test(value.canonicalHash))
    throw new Error('Draft mockup approval hash is invalid.');
  if (typeof value.approvedAt !== 'string' || !Number.isFinite(Date.parse(value.approvedAt)))
    throw new Error('Draft mockup approval timestamp is invalid.');
  for (const key of Object.keys(value)) {
    if (!['screens', 'canonicalHash', 'approvedAt'].includes(key))
      throw new Error('Draft mockup approval contains an unknown field: ' + key);
  }
}

// The SEE step's per-screen note chips (slice A5), persisted on the draft so
// they survive restart: { <screenId>: [{ selector, text, note }] } or null for
// "no notes". selector/text are the bridge-validated element context (their
// caps mirror lib/mockup.js's MAX_PICK_SELECTOR/MAX_PICK_TEXT, same one-way
// mirror as APPROVAL_SCREEN_RE above); note is the user's own words. A screen
// with no notes has NO key (an empty array is invalid — one representation),
// and an empty map is stored as null (main.js normalizes). Notes clear for a
// screen when its regen SUCCEEDS (they were consumed by that turn); a failed
// regen leaves them so the user never retypes — that clearing lives in
// main.js's projectsMockupRun, like the approval clearing it rides beside.
const MAX_NOTE_SELECTOR = 256;   // == mockup.MAX_PICK_SELECTOR
const MAX_NOTE_TEXT = 160;       // == mockup.MAX_PICK_TEXT
const MAX_NOTE_CHARS = 500;      // == mockup.MAX_NOTE_CHARS
const MAX_NOTES_PER_SCREEN = 12; // == mockup.MAX_NOTES_PER_SCREEN

function validateMockupNotes(value) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Draft mockup notes are invalid.');
  const screens = Object.keys(value);
  if (!screens.length) throw new Error('Empty draft mockup notes must be null.');
  for (const screenId of screens) {
    if (screenId.length > 48 || !APPROVAL_SCREEN_RE.test(screenId))
      throw new Error('Draft mockup notes name an invalid screen: ' + screenId);
    const list = value[screenId];
    if (!Array.isArray(list) || !list.length || list.length > MAX_NOTES_PER_SCREEN)
      throw new Error(`Draft mockup notes for ${screenId} must be 1-${MAX_NOTES_PER_SCREEN} entries.`);
    for (const note of list) {
      if (!note || typeof note !== 'object' || Array.isArray(note))
        throw new Error('Draft mockup note is invalid.');
      if (typeof note.selector !== 'string' || !note.selector.trim() ||
          note.selector.length > MAX_NOTE_SELECTOR)
        throw new Error('Draft mockup note selector is invalid.');
      if (typeof note.text !== 'string' || note.text.length > MAX_NOTE_TEXT)
        throw new Error('Draft mockup note text is invalid.');
      if (typeof note.note !== 'string' || !note.note.trim() ||
          note.note.length > MAX_NOTE_CHARS)
        throw new Error('Draft mockup note is empty or too long.');
      for (const key of Object.keys(note)) {
        if (!['selector', 'text', 'note'].includes(key))
          throw new Error('Draft mockup note contains an unknown field: ' + key);
      }
    }
  }
}

function validateDraft(value, expectedId) {
  if (!value || value.schema !== SCHEMA) throw new Error('Draft schema must be 1.');
  if (!ID_RE.test(value.id) || (expectedId && value.id !== expectedId))
    throw new Error('Draft ID does not match its file.');
  if (typeof value.workspace !== 'string' || !path.isAbsolute(value.workspace))
    throw new Error('Draft workspace must be absolute.');
  const cleanName = cleanText(value.name, 'Working name', MAX_NAME);
  if (value.name !== cleanName)
    throw new Error('Working name must be trimmed, single-line text.');
  if (value.pitch !== cleanPitch(value.pitch))
    throw new Error('Pitch must be trimmed, single-line text.');
  if (!Number.isInteger(value.revision) || value.revision < 1)
    throw new Error('Draft revision is invalid.');
  if (!Number.isInteger(value.currentCard) || value.currentCard < 0 || value.currentCard >= KEYS.length)
    throw new Error('Draft card position is invalid.');
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))
    throw new Error('Draft timestamps are invalid.');
  if (!value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers))
    throw new Error('Draft answers are invalid.');
  for (const key of KEYS) {
    if (typeof value.answers[key] !== 'string' || value.answers[key].length > MAX_ANSWER)
      throw new Error(`Draft answer ${key} is invalid.`);
  }
  for (const key of Object.keys(value.answers)) {
    if (!KEYS.includes(key)) throw new Error('Draft contains an unknown answer: ' + key);
  }
  validatePreview(value.preview === undefined ? null : value.preview);
  validateMockupApproval(value.mockupApproval === undefined ? null : value.mockupApproval);
  validateMockupNotes(value.mockupNotes === undefined ? null : value.mockupNotes);
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
  // Forward migration for drafts written before an interview card existed
  // (schema 2 added `look`). The user's answers are untouched; the new card
  // simply starts unanswered. The persisted preview is different: it is
  // DERIVED data (one deterministic buildBundle away), so an older-schema
  // bundle is dropped rather than half-upgraded — regenerating is free and the
  // alternative (a preview whose blueprint silently lacks an area) is exactly
  // the invented-state this store's validation exists to refuse.
  if (parsed && parsed.answers && typeof parsed.answers === 'object' && !Array.isArray(parsed.answers)) {
    for (const key of KEYS)
      if (parsed.answers[key] === undefined) parsed.answers[key] = '';
  }
  if (parsed && parsed.preview && parsed.preview.blueprint &&
      parsed.preview.blueprint.schema_version !== SCHEMA_VERSION)
    parsed.preview = null;
  return validateDraft(parsed, id);
}

function createDraft(stateDir, workspace, starter) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('Choose a projects workspace first.');
  const root = path.resolve(workspace);
  if (!fs.statSync(root).isDirectory()) throw new Error('Projects workspace is unavailable.');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const draft = {
    schema: SCHEMA,
    id,
    workspace: root,
    name: cleanText(starter && starter.name, 'Working name', MAX_NAME),
    pitch: cleanPitch(starter && starter.pitch),
    revision: 1,
    currentCard: 0,
    answers: Object.fromEntries(KEYS.map((key) => [key, ''])),
    preview: null,
    mockupApproval: null,
    mockupNotes: null,
    createdAt: now,
    updatedAt: now,
  };
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
  if (changes && Object.prototype.hasOwnProperty.call(changes, 'name'))
    next.name = cleanText(changes.name, 'Working name', MAX_NAME);
  if (changes && Object.prototype.hasOwnProperty.call(changes, 'pitch'))
    next.pitch = cleanPitch(changes.pitch);
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
      if (typeof value !== 'string' || value.length > MAX_ANSWER)
        throw new Error(`Draft answer ${key} is invalid.`);
      next.answers[key] = value;
    }
  }
  if (changes && Object.prototype.hasOwnProperty.call(changes, 'preview')) {
    validatePreview(changes.preview);
    next.preview = changes.preview === null || changes.preview === undefined
      ? null
      : JSON.parse(JSON.stringify(changes.preview));
  }
  if (changes && Object.prototype.hasOwnProperty.call(changes, 'mockupApproval')) {
    validateMockupApproval(changes.mockupApproval);
    next.mockupApproval = changes.mockupApproval === null || changes.mockupApproval === undefined
      ? null
      : JSON.parse(JSON.stringify(changes.mockupApproval));
  }
  if (changes && Object.prototype.hasOwnProperty.call(changes, 'mockupNotes')) {
    validateMockupNotes(changes.mockupNotes);
    next.mockupNotes = changes.mockupNotes === null || changes.mockupNotes === undefined
      ? null
      : JSON.parse(JSON.stringify(changes.mockupNotes));
  }
  next.revision += 1;
  next.updatedAt = new Date().toISOString();
  validateDraft(next, id);
  atomicWrite(stateDir, draftPath(stateDir, id), next);
  return next;
}

// List the drafts for one workspace, newest first. A single unreadable or
// half-written file NEVER takes the list down — it is skipped and surfaced as a
// warning, which is what makes the store crash-tolerant in practice.
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

// Draft deletion is a distinct explicit action from project removal (§ Write
// safety): removing a draft never touches a written package, and vice versa.
function deleteDraft(stateDir, id, workspace) {
  const draft = readDraft(stateDir, id);
  if (path.resolve(draft.workspace) !== path.resolve(workspace))
    throw new Error('Draft belongs to a different workspace.');
  fs.unlinkSync(draftPath(stateDir, id));
}

module.exports = {
  SCHEMA,
  ID_RE,
  MAX_DRAFT_BYTES,
  draftsDir,
  draftPath,
  validateDraft,
  validatePreview,
  validateMockupApproval,
  validateMockupNotes,
  readDraft,
  createDraft,
  updateDraft,
  listDrafts,
  deleteDraft,
};
