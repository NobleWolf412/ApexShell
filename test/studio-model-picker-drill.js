// STUDIO model-picker drill — hermetic, no LLM spend. Proves the header
// picker's persisted-config logic (App Builder slice 5): default (no file)
// resolves to nulls, a valid Claude-lane tier round-trips, a bad tier/effort
// is rejected at write (never silently coerced), and a corrupted file fails
// closed (nulls + a surfaced error, never a thrown crash for a caller that
// only wants the current pick).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const modelPicker = require('../extensions/studio/lib/modelPicker');

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apex-studio-modelpick-'));
}

check('no file yet — default pick is all-null, no error', () => {
  const dir = scratch();
  const pick = modelPicker.readModelPick(dir);
  assert.deepEqual(pick, { model: null, effort: null, error: null });
});

check('a valid Claude-lane tier + effort round-trips through write/read', () => {
  const dir = scratch();
  modelPicker.writeModelPick(dir, { model: 'sonnet', effort: 'high' });
  const pick = modelPicker.readModelPick(dir);
  assert.deepEqual(pick, { model: 'sonnet', effort: 'high', error: null });
});

check('every Claude-lane tier is accepted', () => {
  const dir = scratch();
  for (const model of ['fable', 'opus', 'sonnet', 'haiku']) {
    modelPicker.writeModelPick(dir, { model, effort: null });
    assert.equal(modelPicker.readModelPick(dir).model, model);
  }
});

check('a non-Claude lane (codex/qwen/agy) is rejected at write, nothing persisted', () => {
  const dir = scratch();
  for (const bad of ['codex', 'qwen', 'agy', 'bogus']) {
    assert.throws(() => modelPicker.writeModelPick(dir, { model: bad, effort: null }), /Claude-lane tier/);
  }
  assert.equal(fs.existsSync(modelPicker.modelPath(dir)), false, 'no file written on rejection');
});

check('an unrecognized effort is rejected at write', () => {
  const dir = scratch();
  assert.throws(() => modelPicker.writeModelPick(dir, { model: 'haiku', effort: 'ludicrous' }), /Effort must be/);
});

check('null model/effort clears the pick and persists cleanly', () => {
  const dir = scratch();
  modelPicker.writeModelPick(dir, { model: 'opus', effort: 'max' });
  modelPicker.writeModelPick(dir, { model: null, effort: null });
  assert.deepEqual(modelPicker.readModelPick(dir), { model: null, effort: null, error: null });
});

check('a corrupted file fails closed: nulls + a surfaced error, never a throw', () => {
  const dir = scratch();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(modelPicker.modelPath(dir), '{ not json', 'utf8');
  const pick = modelPicker.readModelPick(dir);
  assert.equal(pick.model, null);
  assert.equal(pick.effort, null);
  assert.ok(pick.error, 'error surfaced');
});

check('a stale schema is treated as invalid, not silently upgraded', () => {
  const dir = scratch();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(modelPicker.modelPath(dir), JSON.stringify({ schema: 2, model: 'haiku' }), 'utf8');
  const pick = modelPicker.readModelPick(dir);
  assert.equal(pick.model, null);
  assert.ok(pick.error);
});

check('a hand-edited non-tier value in the file is rejected on read (fails closed)', () => {
  const dir = scratch();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(modelPicker.modelPath(dir), JSON.stringify({ schema: 1, model: 'codex', effort: null }), 'utf8');
  const pick = modelPicker.readModelPick(dir);
  assert.equal(pick.model, null);
  assert.ok(pick.error);
});

console.log('\nSTUDIO MODEL PICKER: ' + passed + ' checks passed');
