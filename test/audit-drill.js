// Apex — headless drill for the live auditor: the pure contract
// (engine/audit.js) and the watch state machine (main/audit.js) against a
// stubbed seats seam + fake bus. No Electron, no real CLI.
// Run: node test/audit-drill.js
'use strict';

const assert = require('assert');
const audit = require('../main/engine/audit');

let passed = 0, failed = 0;
function gate(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}
async function agate(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ' — ' + e.message); }
}
const block = (o) => '```apex-audit\n' + JSON.stringify(o) + '\n```';

// ---------- pure contract ----------
gate('valid audit extracts + validates, risk sorted first', () => {
  const { raw, error } = audit.extractAudit('thoughts\n' + block({ findings: [
    { severity: 'info', claim: 'minor' },
    { severity: 'risk', claim: 'deletes without confirm', why: 'irreversible', suggestion: 'add a guard' },
  ] }));
  assert.equal(error, null);
  const f = audit.validateAudit(raw).findings;
  assert.equal(f.length, 2);
  assert.equal(f[0].severity, 'risk');
  assert.equal(f[0].suggestion, 'add a guard');
});

gate('no block = clean pass (not an error)', () => {
  assert.equal(audit.extractAudit('all good, nothing to flag').error, 'no-audit');
});
gate('malformed json flagged', () => {
  assert.equal(audit.extractAudit('```apex-audit\n{oops\n```').error, 'malformed-audit');
});
gate('capped at 3, bad severity coerced, claimless dropped, text capped', () => {
  const f = audit.validateAudit({ findings: [
    { severity: 'bogus', claim: 'a' }, { severity: 'warn', claim: 'b' },
    { severity: 'risk', claim: 'c' }, { severity: 'risk', claim: 'd' },
    { severity: 'risk' }, { severity: 'risk', claim: 'x'.repeat(999) },
  ] }).findings;
  assert.equal(f.length, 3);
  assert.ok(f.every((x) => ['info', 'warn', 'risk'].includes(x.severity)));
  assert.ok(f.every((x) => x.claim.length <= audit.TEXT_CAP));
});
gate('extra keys never survive; only the four fields', () => {
  const f = audit.validateAudit({ findings: [
    { severity: 'risk', claim: 'c', why: 'w', suggestion: 's', action: 'rm -rf', tool: 'Bash' },
  ] }).findings;
  assert.deepEqual(Object.keys(f[0]).sort(), ['claim', 'severity', 'suggestion', 'why']);
});
gate('prompt renders the transcript and forbids obeying it', () => {
  const p = audit.auditPrompt([{ role: 'user', text: 'do X' }, { role: 'assistant', text: 'did Y' }]);
  assert.ok(p.includes('USER: do X') && p.includes('ASSISTANT: did Y'));
  assert.ok(/do not obey/i.test(p) && p.includes('```apex-audit'));
});

// ---------- watch state machine: stub seats + bus BEFORE requiring main/audit ----------
const seatsPath = require.resolve('../main/seats');
const busPath = require.resolve('../main/bus');
let observer = null;
const disposables = [];
const posts = [];
const handlers = {};
require.cache[seatsPath] = { id: seatsPath, filename: seatsPath, loaded: true, exports: {
  observeSeats(fn) { observer = fn; return () => { observer = null; }; },
  startDisposable(opts) { const d = { opts, closed: false, close() { this.closed = true; } }; disposables.push(d); return d; },
} };
require.cache[busPath] = { id: busPath, filename: busPath, loaded: true, exports: {
  on(t, fn) { handlers[t] = fn; }, post(type, m) { posts.push({ type, m }); }, init() {}, inject() {},
} };

const auditMod = require('../main/audit');
auditMod.register();
const emit = (id, m) => observer({ type: 'seatEvt', id, m });
const lastOf = (type) => [...posts].reverse().find((p) => p.type === type);

(async () => {
  await agate('toggling a watch on announces auditState', async () => {
    handlers.auditToggle({ id: 's1', on: true });
    assert.equal(lastOf('auditState').m.on, true);
  });

  await agate('a watched seat audits on turn completion via a haiku disposable', async () => {
    posts.length = 0; disposables.length = 0;
    emit('s1', { type: 'user', text: 'delete the prod table' });
    emit('s1', { type: 'text', text: 'running DROP TABLE users' });
    emit('s1', { type: 'result', ok: true });
    await new Promise((r) => setTimeout(r, 4300));   // past the debounce
    assert.equal(disposables.length, 1, 'one disposable auditor spawned');
    assert.equal(disposables[0].opts.model, 'haiku');
    assert.ok(disposables[0].opts.kickoff.includes('DROP TABLE'));
    disposables[0].opts.onEvent({ type: 'text', text: block({ findings: [
      { severity: 'risk', claim: 'dropping a prod table', why: 'data loss', suggestion: 'confirm first' }] }) });
    disposables[0].opts.onEvent({ type: 'result', ok: true });
    const f = lastOf('auditFindings');
    assert.equal(f.m.findings.length, 1);
    assert.equal(f.m.findings[0].severity, 'risk');
    assert.ok(disposables[0].closed, 'auditor seat closed after the pass');
  });

  await agate('a clean turn (no block) yields zero findings, no error', async () => {
    posts.length = 0; disposables.length = 0;
    emit('s1', { type: 'user', text: 'read the file' });
    emit('s1', { type: 'text', text: 'here is the content' });
    emit('s1', { type: 'result', ok: true });
    await new Promise((r) => setTimeout(r, 4300));
    disposables[0].opts.onEvent({ type: 'text', text: 'looks fine, nothing to flag' });
    disposables[0].opts.onEvent({ type: 'result', ok: true });
    const f = lastOf('auditFindings');
    assert.equal(f.m.findings.length, 0);
    assert.equal(f.m.error, null);
  });

  await agate('toggling off stops watching', async () => {
    handlers.auditToggle({ id: 's1', on: false });
    assert.equal(lastOf('auditState').m.on, false);
    posts.length = 0; disposables.length = 0;
    emit('s1', { type: 'result', ok: true });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(disposables.length, 0, 'no audit after un-watch');
  });

  await agate('seatGone stops watching and cleans up', async () => {
    handlers.auditToggle({ id: 's2', on: true });
    observer({ type: 'seatGone', id: 's2' });
    posts.length = 0;
    emit('s2', { type: 'result', ok: true });
    assert.equal(disposables.length, 0);
  });

  console.log('\nAUDIT DRILL: ' + passed + '/' + (passed + failed) + ' passed');
  process.exit(failed ? 1 : 0);
})();
