// Apex — headless drill for the Claude lane's CLI argument builder. Guards the
// permission-mode compatibility mapping: the `claude` CLI renamed the old
// `manual` mode to `default` and now REJECTS `manual`, so buildArgs must never
// emit it. No Electron, no spawn.
'use strict';

const assert = require('assert');
const { buildArgs } = require('../main/engine/claudeSeat');

let pass = 0;
const ok = (label) => { console.log('PASS  ' + label); pass++; };

// The CLI's own allowlist (from its error message when an invalid value is passed).
const VALID = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan']);
const modeOf = (opts) => {
  const a = buildArgs(Object.assign({ tools: '' }, opts));
  return a[a.indexOf('--permission-mode') + 1];
};

// 1. the bug: internal `manual` must translate to the CLI's `default`
assert.equal(modeOf({ permissionMode: 'manual' }), 'default', 'manual -> default');
ok('1 internal `manual` maps to the CLI `default` (never the rejected `manual`)');

// 2. absent permissionMode also falls back to a valid mode
assert.equal(modeOf({}), 'default', 'undefined -> default');
ok('2 missing permission mode falls back to `default`');

// 3. every other Apex mode is already a valid CLI value and passes through untouched
for (const m of ['auto', 'acceptEdits', 'dontAsk', 'bypassPermissions']) {
  assert.equal(modeOf({ permissionMode: m }), m, m + ' passes through');
}
ok('3 auto/acceptEdits/dontAsk/bypassPermissions pass through unchanged');

// 4. whatever buildArgs emits is ALWAYS a value the CLI accepts
for (const m of ['manual', undefined, 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions']) {
  assert.ok(VALID.has(modeOf({ permissionMode: m })), 'emitted mode for ' + m + ' is CLI-valid');
}
ok('4 buildArgs never emits a permission-mode the CLI would reject');

console.log('\nclaudeseat args drill: PASS (' + pass + '/4)');
