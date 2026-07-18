// Apex — hermetic launch-args drill. The most safety-relevant pure logic in the
// app is WHAT FLAGS A SEAT LAUNCHES WITH, and it had no test — which is exactly
// how the read-only wall's deny-list shipped inert (external audit C1/H4,
// 2026-07-18: startSeat hand-picked a subset of opts for buildArgs and dropped
// disallowedTools). This drill pins the argv contract so that can't regress.
'use strict';

const assert = require('assert');
const { buildArgs } = require('../main/engine/claudeSeat');

let pass = 0;
function gate(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

// helper: the value following a flag in the argv, or null
function valOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

gate('a walled persona\'s opts emit BOTH --tools and --disallowed-tools', () => {
  const argv = buildArgs({
    model: 'fable', effort: 'high', permissionMode: 'manual',
    tools: 'Read,Glob,Grep,WebSearch,WebFetch,Write,Bash,TodoWrite',
    disallowedTools: 'mcp__serena__replace_symbol_body,Edit,NotebookEdit',
  });
  assert.strictEqual(valOf(argv, '--tools'), 'Read,Glob,Grep,WebSearch,WebFetch,Write,Bash,TodoWrite',
    '--tools allowlist must reach the wire');
  assert.strictEqual(valOf(argv, '--disallowed-tools'), 'mcp__serena__replace_symbol_body,Edit,NotebookEdit',
    '--disallowed-tools deny-list must reach the wire (C1 regression guard)');
});

gate('in-place code editors are denied for a walled persona', () => {
  const argv = buildArgs({
    tools: 'Read,Glob,Grep,Write,Bash', permissionMode: 'manual',
    disallowedTools: 'Edit,NotebookEdit',
  });
  const deny = valOf(argv, '--disallowed-tools') || '';
  assert.ok(deny.includes('Edit'), 'Edit must be denied');
  assert.ok(deny.includes('NotebookEdit'), 'NotebookEdit must be denied');
});

gate('an unwalled persona (no tools/disallowedTools) emits neither flag', () => {
  const argv = buildArgs({ model: 'opus', effort: 'medium', permissionMode: 'auto' });
  assert.ok(!argv.includes('--tools'), 'no --tools when unset');
  assert.ok(!argv.includes('--disallowed-tools'), 'no --disallowed-tools when unset');
});

gate('empty tools string still emits the flag (disable-all is a real value)', () => {
  const argv = buildArgs({ tools: '', permissionMode: 'manual' });
  const i = argv.indexOf('--tools');
  assert.ok(i >= 0, '--tools present');
  assert.strictEqual(argv[i + 1], '', 'empty value preserved (means: no built-in tools)');
});

gate('permission mode always explicit; manual maps to the CLI default', () => {
  const argv = buildArgs({ permissionMode: 'manual' });
  assert.strictEqual(valOf(argv, '--permission-mode'), 'default', 'manual → default at the wire');
  const argv2 = buildArgs({});
  assert.strictEqual(valOf(argv2, '--permission-mode'), 'default', 'fallback is default, never a don\'t-ask mode');
});

console.log(`\nLAUNCH-ARGS DRILL: ${pass}/5 passed`);
if (pass !== 5) process.exitCode = 1;
