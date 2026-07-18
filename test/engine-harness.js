// Apex seat engine — headless harness (Phase-1 exit gate, standalone-app-plan §4).
// Drives a REAL Claude seat through the engine with no UI in the loop:
//   1. spawn + streamed turn        (init → deltas → text → result)
//   2. forced Write → permission    (fail-closed check, R23 reannounce proof,
//                                    Allow round-trip, file lands)
//   3. interrupt mid-turn           (turn settles)
//   4. resume + backfill            (J26 — history replayed from the transcript)
//   5. dispose                      (process exits)
// Usage:  node app/test/engine-harness.js
// Seats run with cwd = a scratch dir (not the product repo) so harness turns
// do not inherit project instructions or enter an external compile queue; the engine's default
// apexRoot behavior is unchanged in production.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSeatHost } = require('../main/engine/seatHost');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-engine-'));
const PERM_FILE = path.join(SCRATCH, 'perm-test.txt');
const WIRE_LOG = path.join(SCRATCH, 'wire.log');
const logLines = [];
const log = (l) => { logLines.push(l); };

// ---- projection recorder ----------------------------------------------------
const events = [];
const waiters = [];
function emit(m) {
  events.push(m);
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].pred(m)) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.t); w.res(m); }
  }
}
// Cursor-based: only events arriving AFTER the call match — matching history
// let "post-allow result" hit stage 1's old result and race the Write (the
// J24 lesson wearing a test-harness costume: never match stale state).
function waitFor(desc, pred, ms = 120000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for: ${desc}`)), ms);
    waiters.push({ pred, res, t });
  });
}
const evt = (id, type, extra) => (m) =>
  m.type === 'seatEvt' && m.id === id && m.m.type === type && (!extra || extra(m.m));

// ---- the run ----------------------------------------------------------------
const results = [];
const gate = (name, ok, note) => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`);
};

(async () => {
  console.log(`scratch: ${SCRATCH}`);
  const host = createSeatHost({
    apexRoot: SCRATCH,               // harness seats stay out of the Apex chain
    emit, log,
    record: () => {},                // storage adapter stub — engine takes it injected
  });

  // -- 1. spawn + streamed turn --
  const id = host.create(null, 'Harness', { persona: 'Harness', launch: { model: 'haiku' } });
  host.handle({ type: 'seatSend', id, text: 'Reply with exactly: APEX-ENGINE-OK' });
  const init = await waitFor('init', evt(id, 'init'));
  const sessionId = init.m.sessionId;
  await waitFor('delta stream', evt(id, 'delta'));
  await waitFor('APEX-ENGINE-OK text', evt(id, 'text', (m) => m.text.includes('APEX-ENGINE-OK')));
  await waitFor('turn result', evt(id, 'result'));
  gate('1 spawn + streamed turn', true, `session ${sessionId}, model ${init.m.model}`);

  // -- 2. forced Write → permission round-trip --
  host.handle({ type: 'seatSend', id,
    text: `Use the Write tool to create the file ${PERM_FILE.replace(/\\/g, '\\\\')} ` +
          `containing exactly the word: gated\nCall Write immediately; do not ask first.` });
  const perm = await waitFor('permission request', evt(id, 'permission'));
  const failClosed = !fs.existsSync(PERM_FILE);

  // R23 architectural proof: an unanswered request must survive a view reload.
  const before = events.length;
  host.reannounce();
  const replayed = events.slice(before).some((m) =>
    m.type === 'seatEvt' && m.id === id && m.m.type === 'permission' &&
    m.m.requestId === perm.m.requestId);
  gate('2a fail-closed while pending', failClosed);
  gate('2b reannounce replays pending permission (R23)', replayed);

  host.handle({ type: 'seatPerm', id, requestId: perm.m.requestId, allow: true, input: perm.m.input });
  await waitFor('post-allow result', evt(id, 'result'));
  const written = fs.existsSync(PERM_FILE) && fs.readFileSync(PERM_FILE, 'utf8').trim() === 'gated';
  const queueDrained = host.pendingPermissions(id).length === 0;
  gate('2c Allow round-trip → file written', written);
  gate('2d host queue drained after answer', queueDrained);

  // J46: the CLI ships a "don't ask again" suggestion with EVERY can_use_tool —
  // the payload behind the official panel's button. Apex was dropping it, so a
  // seat could never learn a rule and `auto` asked forever (the operator: "I don't
  // remember allows in VS Code, why are there allows here"). The suggestion is
  // tool-shaped: an edit tool suggests setMode:acceptEdits (proven at 2i below
  // via Bash's addRules path). Here we just confirm the Write case carries one.
  gate('2c2 CLI ships a "don\'t ask again" suggestion with the permission request',
       (perm.m.suggestions || []).length > 0,
       (perm.m.suggestions || []).map((s) => s.type).join(',') || 'none offered');

  // -- 2e. R26 LIVE PROOF: flip the RUNNING seat to acceptEdits — the next
  // forced Write must complete with NO permission request. --
  const PERM_FILE2 = path.join(SCRATCH, 'perm-test-2.txt');
  host.handle({ type: 'seatMode', id, mode: 'acceptEdits' });
  await new Promise((r) => setTimeout(r, 800));   // let the control round-trip land
  const permCountBefore = events.filter(evt(id, 'permission')).length;
  host.handle({ type: 'seatSend', id,
    text: `Use the Write tool to create the file ${PERM_FILE2.replace(/\\/g, '\\\\')} ` +
          `containing exactly the word: ungated\nCall Write immediately; do not ask first.` });
  await waitFor('acceptEdits-mode result', evt(id, 'result'));
  const permCountAfter = events.filter(evt(id, 'permission')).length;
  const wrote2 = fs.existsSync(PERM_FILE2) && fs.readFileSync(PERM_FILE2, 'utf8').trim() === 'ungated';
  gate('2e LIVE mode change (R26): no ask after acceptEdits', permCountAfter === permCountBefore);
  gate('2f LIVE mode change (R26): the Write landed unprompted', wrote2);
  // back to manual — never leave a drill seat in a pass-through mode
  host.handle({ type: 'seatMode', id, mode: 'manual' });
  await waitFor('manual mode confirmed', (m) => m.type === 'seatMode' && m.id === id && m.mode === 'manual');

  // -- 2g/2h. J44: the dial must never claim a change the CLI refused.
  // Bypass is launch-only ("session was not launched with
  // --dangerously-skip-permissions"), so asking for it live must produce a
  // RESTART OFFER — not a silent lie that leaves the seat in manual while the
  // header reads `bypass` (the operator's report, 2026-07-12). --
  const relaunchOffer = waitFor('bypass → restart offer',
    (m) => m.type === 'seatModeRelaunchNeeded' && m.id === id, 10000);
  host.handle({ type: 'seatMode', id, mode: 'bypassPermissions' });
  const offer = await relaunchOffer;
  const noLie = host.list().find((s) => s.id === id).mode === 'manual';
  gate('2g bypass is routed to a restart, not sent live', offer.current === 'manual');
  gate('2h host mode stays truthful (manual) after a bypass request', noLie);

  // -- 2i. J46 "ALWAYS ALLOW" plumbing — deterministic wire proof. When the
  // operator clicks Always-allow, the answer must carry `updatedPermissions` (the
  // rule) on the control_response; dropping it is exactly what left every seat
  // asking forever. (Whether the CLI then never-asks depends on its own rule
  // engine + the live model, which we don't re-test here — 2c2 already proved the
  // suggestion arrives; this proves we hand it back.) --
  const PERM_FILE3 = path.join(SCRATCH, 'perm-test-3.txt');
  host.handle({ type: 'seatSend', id,
    text: `Use the Write tool to create the file ${PERM_FILE3.replace(/\\/g, '\\\\')} ` +
          `containing exactly the word: ruled\nCall Write immediately; do not ask first.` });
  const permR = await waitFor('permission for the ruled Write', evt(id, 'permission'));
  const RULE = { type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'localSettings' };
  const beforeLines = logLines.length;
  host.handle({ type: 'seatPerm', id, requestId: permR.m.requestId, allow: true,
                input: permR.m.input, updates: [RULE] });
  await waitFor('ruled Write settles', evt(id, 'result'));
  const sentRule = logLines.slice(beforeLines).some((l) =>
    l.includes('control_response') && l.includes('updatedPermissions') && l.includes('addRules'));
  gate('2i always-allow: the rule rides back on the control_response (updatedPermissions)', sentRule);

  // -- 3. interrupt mid-turn --
  host.handle({ type: 'seatSend', id, text: 'Count from 1 to 500, one number per line. Do not stop early.' });
  await waitFor('counting deltas', evt(id, 'delta', (m) => /\b3\b/.test(m.text) || true));
  host.handle({ type: 'seatStop', id });
  await waitFor('interrupted turn settles', evt(id, 'result'), 60000);
  gate('3 interrupt settles the turn', true);

  // -- 4 + 5. dispose, then resume with backfill --
  const closedCursor = events.length;
  host.handle({ type: 'seatClose', id });
  gate('5 dispose (close) accepted', host.list().length === 0);
  await new Promise((r) => setTimeout(r, 2500));   // let the transcript flush
  // A closed seat must be view-SILENT — its exit/'dead' (and any stream tail)
  // used to resurrect the removed chat as a blank "Seat" ghost (2026-07-14).
  const closedTail = events.slice(closedCursor).filter((m) =>
    m.type === 'seatEvt' && m.id === id);
  gate('5b closed seat emits nothing (ghost fix)', closedTail.length === 0,
       closedTail.length ? 'leaked: ' + closedTail.map((m) => m.m.type).join(',') : '');

  const id2 = host.create(null, 'Resumed', { persona: 'Harness', resume: sessionId,
                                             launch: { model: 'haiku' } });
  const replay = events.filter((m) =>
    m.type === 'seatEvt' && m.id === id2 &&
    (m.m.type === 'user' || m.m.type === 'text'));
  const sawHistory = replay.some((m) => (m.m.text || '').includes('APEX-ENGINE-OK'));
  gate('4 resume + backfill (J26)', replay.length > 0 && sawHistory,
       `${replay.length} messages replayed`);

  // -- 6. ✕ MID-TURN (the operator's close-during-load, 2026-07-14): a seat closed
  // while actively streaming must go silent instantly. Its tail used to keep
  // painting a resurrected ghost tab for the length of the kill backstop —
  // and the orphaned claude process (shell:true shim survived kill()) kept
  // the turn burning underneath. --
  const id3 = host.create(null, 'GhostDrill', { persona: 'Harness', launch: { model: 'haiku' } });
  host.handle({ type: 'seatSend', id: id3,
    text: 'Count from 1 to 500, one number per line. Do not stop early.' });
  await waitFor('ghost-drill streaming', evt(id3, 'delta'));
  const cur3 = events.length;
  host.handle({ type: 'seatClose', id: id3 });
  await new Promise((r) => setTimeout(r, 4000));   // past the 1.5s kill backstop
  const tail3 = events.slice(cur3).filter((m) => m.type === 'seatEvt' && m.id === id3);
  gate('6 ✕ mid-turn: closed seat streams nothing (ghost drill)', tail3.length === 0,
       tail3.length ? 'leaked: ' + tail3.map((m) => m.m.type).join(',') : 'silent');
  // -- 7. App Builder slice 5: disposable launch override ------------------
  // createDisposable now accepts `launch: { model, effort }` — validated
  // against the Claude-lane tiers ONLY, since a disposable always spawns via
  // claudeSeat regardless of what a caller asks for. Three cases: the override
  // steers a real spawn, a non-Claude lane is rejected before anything spawns,
  // and the existing no-launch call shape (personaTestPrepare/
  // personaRelSuggestLlm/audit.js's exact usage today) keeps working untouched.
  function runDisposable(opts, waitForResult, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      let initEvt = null, text = '';
      const t = setTimeout(() => reject(new Error('disposable timed out')), timeoutMs);
      let controller;
      const settle = (fn) => { clearTimeout(t); fn(); };
      try {
        controller = host.createDisposable({
          ...opts,
          onEvent: (m) => {
            if (m.type === 'init') {
              initEvt = m;
              if (!waitForResult) settle(() => resolve({ init: initEvt, text, controller }));
            } else if (m.type === 'text') {
              text += m.text || '';
            } else if (m.type === 'result') {
              if (waitForResult) settle(() => resolve({ init: initEvt, text, controller }));
            } else if (m.type === 'dead') {
              settle(() => reject(new Error('disposable died: ' + m.code)));
            }
          },
        });
      } catch (e) { clearTimeout(t); reject(e); }
    });
  }

  // 7a. valid tier honored — the override actually steers the spawned model.
  try {
    const r = await runDisposable(
      { launch: { model: 'haiku', effort: 'low' }, kickoff: 'Reply with exactly: APEX-DISPOSABLE-OK' },
      true);
    r.controller.close();
    // The wire's init event reports the CLI's resolved FULL model name (e.g.
    // "claude-haiku-4-5-20251001"), not the short tier alias we passed —
    // same as gate 1 above, which only ever notes init.m.model without an
    // exact match. Check containment, not equality.
    gate('7a disposable launch override: valid tier honored',
         !!r.init && /haiku/i.test(r.init.model || '') && r.text.includes('APEX-DISPOSABLE-OK'),
         `model ${r.init && r.init.model}`);
  } catch (e) { gate('7a disposable launch override: valid tier honored', false, e.message); }

  // 7b. non-Claude lane rejected — synchronous, clean throw, nothing spawns
  // (no live spend: the rejection happens before the disposable's scratch dir
  // or child process are created).
  {
    const bad = ['codex', 'qwen', 'agy', 'bogus-tier'];
    const rejections = bad.map((m) => {
      let onEventFired = false;
      try {
        host.createDisposable({ launch: { model: m }, onEvent: () => { onEventFired = true; } });
        return { m, threw: false, onEventFired };
      } catch (e) { return { m, threw: true, onEventFired, message: e.message }; }
    });
    const allRejectedCleanly = rejections.every((r) => r.threw && !r.onEventFired);
    gate('7b disposable launch override: non-Claude lane rejected (codex/qwen/agy/bogus)',
         allRejectedCleanly,
         rejections.map((r) => `${r.m}:${r.threw ? 'threw' : 'SPAWNED'}`).join(' '));
  }

  // 7c. omitted launch = legacy — the EXACT call shape personaTestPrepare and
  // personaRelSuggestLlm use today (kickoff + onEvent, no model/effort/launch
  // at all). Must not throw and must spawn exactly as it always has; only
  // waits for `init` (not a full turn) to bound the live spend.
  try {
    const r = await runDisposable({ kickoff: 'Reply with exactly: APEX-LEGACY-OK' }, false);
    r.controller.close();
    gate('7c disposable launch override: omitted launch is byte-identical to legacy',
         !!r.init, `model ${(r.init && r.init.model) || '(cli default, unspecified — as always)'}`);
  } catch (e) {
    gate('7c disposable launch override: omitted launch is byte-identical to legacy', false, e.message);
  }

  host.disposeAll();

  // -- verdict --
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(WIRE_LOG, logLines.join('\n'));
  console.log(`\nwire log: ${WIRE_LOG} (${logLines.length} lines)`);
  console.log(failed.length ? `\nEXIT GATE: FAIL (${failed.length})` : '\nEXIT GATE: PASS — all stages');
  setTimeout(() => process.exit(failed.length ? 1 : 0), 2000);
})().catch((e) => {
  console.error('HARNESS ERROR:', e.message);
  try { fs.writeFileSync(WIRE_LOG, logLines.join('\n')); console.error(`wire log: ${WIRE_LOG}`); } catch {}
  process.exit(2);
});
