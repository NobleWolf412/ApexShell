// App Builder (STUDIO) — the header model picker. One choice, persisted in
// state/extensions/studio/model.json, drives both AI levels once they exist
// (slice 6's suggest passes, slice 7's co-designer): it is passed as
// launch.model/launch.effort to a disposable, so it is restricted to the same
// Claude-lane tiers the engine's launch override accepts (App Builder slice
// 5, main/engine/seatHost.js CLAUDE_MODEL_TIERS) — codex/qwen/agy never reach
// the picker. This slice only persists + validates the choice; no disposable
// call exists yet to feed it.
//
// Same discipline as extensions/studio/main.js's workspace.json: schema-
// versioned, same-directory temp + exclusive-flag write, atomic rename.
'use strict';

const fs = require('fs');
const path = require('path');

const MODEL_FILE = 'model.json';
const TIERS = new Set(['fable', 'opus', 'sonnet', 'haiku']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function modelPath(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir))
    throw new Error('App Builder state directory must be absolute.');
  return path.join(stateDir, MODEL_FILE);
}

// Absent file = no pick yet: the AI passes fall back to the disposable's own
// default (today's behavior — unset launch.model/effort).
function readModelPick(stateDir) {
  const file = modelPath(stateDir);
  if (!fs.existsSync(file)) return { model: null, effort: null, error: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schema !== 1) throw new Error('schema must be 1');
    const model = parsed.model === null || parsed.model === undefined ? null : parsed.model;
    const effort = parsed.effort === null || parsed.effort === undefined ? null : parsed.effort;
    if (model !== null && !TIERS.has(model)) throw new Error(`model "${model}" is not a Claude-lane tier`);
    if (effort !== null && !EFFORTS.has(effort)) throw new Error(`effort "${effort}" is unrecognized`);
    return { model, effort, error: null };
  } catch (err) {
    return { model: null, effort: null, error: 'Saved model pick is invalid: ' + err.message };
  }
}

function writeModelPick(stateDir, { model, effort }) {
  const cleanModel = model === null || model === undefined ? null : model;
  const cleanEffort = effort === null || effort === undefined ? null : effort;
  if (cleanModel !== null && !TIERS.has(cleanModel))
    throw new Error(`Model must be a Claude-lane tier (fable | opus | sonnet | haiku) — got "${cleanModel}".`);
  if (cleanEffort !== null && !EFFORTS.has(cleanEffort))
    throw new Error(`Effort must be one of low | medium | high | xhigh | max — got "${cleanEffort}".`);

  fs.mkdirSync(stateDir, { recursive: true });
  const destination = modelPath(stateDir);
  const temporary = path.join(stateDir, `.${MODEL_FILE}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(
      temporary,
      JSON.stringify({ schema: 1, model: cleanModel, effort: cleanEffort }, null, 2) + '\n',
      { encoding: 'utf8', flag: 'wx' }
    );
    fs.renameSync(temporary, destination);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
  return { model: cleanModel, effort: cleanEffort };
}

module.exports = { TIERS, EFFORTS, modelPath, readModelPick, writeModelPick };
