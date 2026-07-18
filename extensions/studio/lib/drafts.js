// App Builder — crash-safe runtime draft store. A draft is the in-progress
// interview (working name + one-sentence pitch + the six card answers); it is
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
  readDraft,
  createDraft,
  updateDraft,
  listDrafts,
  deleteDraft,
};
