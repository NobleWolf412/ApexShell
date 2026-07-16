// Apex engine — Codex-lane drill (R33). Same spirit as engine-harness.js:
// drive the REAL seatHost headless through the codex app-server lane and
// gate on observed behavior. Stages:
//   1  spawn + thread start   (init event, codex:-prefixed session id)
//   2  streamed turn          (delta events → final text → result ok)
//   3  approval round-trip    (permission card event → accept → command ran)
//   4  resume + replay        (new seat on the same thread backfills history)
//   5  dispose                (clean close)
// Needs: `codex` CLI signed in. Run: node test/codex-drill.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSeatHost } = require('../main/engine/seatHost');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-codex-drill-'));
console.log('scratch:', scratch);
const wire = [];
const log = (l) => wire.push(l);

let pass = 0, fail = 0;
const ok = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + ' ' + name);
  cond ? pass++ : fail++;
  if (!cond) finish(1);
};

const events = [];
let onEvt = null;
const host = createSeatHost({
  apexRoot: scratch,
  emit: (m) => {
    if (m.type !== 'seatEvt') return;
    events.push(m);
    if (onEvt) onEvt(m);
  },
  log,
});

const waitFor = (pred, ms, why) => new Promise((resolve, reject) => {
  const hit = events.find(pred);
  if (hit) return resolve(hit);
  const t = setTimeout(() => { onEvt = null; reject(new Error('timeout: ' + why)); }, ms);
  onEvt = (m) => {
    if (pred(m)) { clearTimeout(t); onEvt = null; resolve(m); }
  };
});

function finish(code) {
  try { fs.writeFileSync(path.join(scratch, 'wire.log'), wire.join('\n')); } catch {}
  console.log('wire log:', path.join(scratch, 'wire.log'), '(' + wire.length + ' lines)');
  console.log(code ? 'EXIT GATE: FAIL' : 'EXIT GATE: PASS — all stages');
  try { host.disposeAll(); } catch {}
  setTimeout(() => process.exit(code), 800);
}

(async () => {
  // -- 1: spawn + thread start
  const id = host.create(null, 'codex-drill',
    { persona: 'codex-drill', cwd: scratch,
      launch: { model: 'codex', permissionMode: 'manual', effort: 'low' } });
  const init = await waitFor((m) => m.id === id && m.m.type === 'init', 60000, 'init');
  ok('1 thread started — ' + init.m.sessionId + ', model ' + init.m.model,
     String(init.m.sessionId).startsWith('codex:') && !!init.m.model);
  const sessionId = init.m.sessionId;

  // A renderer reload can ask for history immediately after thread/start,
  // before the rollout has its first metadata line. That is an empty replay,
  // never a refusal/error bubble.
  events.length = 0;
  host.handle({ type: 'seatReplay', id });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  ok('1b fresh empty replay is benign', !events.some((m) =>
    m.id === id && ((m.m.type === 'result' && m.m.ok === false) ||
      (m.m.type === 'text' && /codex (refused|error)/i.test(m.m.text)))));

  // -- 2: streamed turn
  events.length = 0;
  host.handle({ type: 'seatSend', id, text: 'Reply with exactly: DRILL-OK — nothing else.' });
  await waitFor((m) => m.id === id && m.m.type === 'result', 90000, 'turn1 result');
  const sawDelta = events.some((m) => m.m.type === 'delta' && m.m.text);
  const finalText = events.filter((m) => m.m.type === 'text').map((m) => m.m.text).join(' ');
  ok('2 streamed turn — deltas + final text', sawDelta && finalText.includes('DRILL-OK'));

  // -- 3: approval round-trip
  // The command must be UNIQUE per run: stage 3c answers with codex's own
  // "remember this approval" choice, which the server PERSISTS as a
  // prefix_rule in ~/.codex/rules/default.rules — a repeated command is then
  // auto-approved and this stage times out waiting for a card that never
  // comes (found 2026-07-16: the drill poisoned its own machine).
  events.length = 0;
  const a = 100 + Math.floor(Math.random() * 900);
  const b = 100 + Math.floor(Math.random() * 900);
  const product = String(a * b);
  host.handle({ type: 'seatSend', id,
    text: 'Run this exact shell command and report its raw output: node -e "console.log(' +
      a + '*' + b + ')"' });
  const perm = await waitFor((m) => m.id === id && m.m.type === 'permission', 90000, 'approval request');
  ok('3a permission card raised — ' + perm.m.tool,
     !!perm.m.requestId && /codex/i.test(perm.m.tool));
  ok('3b host queue holds it (R23)', host.pendingPermissions(id).length === 1);
  const remember = (perm.m.rememberChoices || [])[0];
  ok('3c provider remembered-approval choice exposed', !!(remember && remember.id));
  host.handle({ type: 'seatPerm', id, requestId: perm.m.requestId,
    allow: true, choice: remember.id });
  await waitFor((m) => m.id === id && m.m.type === 'result', 120000, 'turn2 result');
  const answer = events.filter((m) => m.m.type === 'text').map((m) => m.m.text).join(' ');
  ok('3d remembered approval ran command — answer carries ' + product, answer.includes(product));
  ok('3e provider decision rode the wire', wire.some((l) =>
    l.includes('acceptWithExecpolicyAmendment') || l.includes('acceptForSession')));
  ok('3f queue drained after answer', host.pendingPermissions(id).length === 0);

  // -- 4: resume + replay
  host.handle({ type: 'seatClose', id });
  // Past the kill backstop before respawning (same 2.5s the app's seatRelaunch
  // uses): the dying app-server still holds the ~/.codex sqlite state lock,
  // and a resume spawned into that window dies with "failed to initialize
  // sqlite state runtime" (caught 2026-07-16, intermittent).
  await new Promise((r) => setTimeout(r, 2500));
  events.length = 0;
  const id2 = host.create(null, 'codex-drill-resumed',
    { persona: 'codex-drill', cwd: scratch, resume: sessionId,
      launch: { model: 'codex', permissionMode: 'manual', effort: 'low' } });
  await waitFor((m) => m.id === id2 && m.m.type === 'init', 60000, 'resume init');
  await waitFor((m) => m.id === id2 && m.m.type === 'result', 30000, 'replay settle');
  const replayed = events.filter((m) => m.id === id2 && (m.m.type === 'text' || m.m.type === 'user'));
  ok('4 resume replays history — ' + replayed.length + ' items',
     replayed.some((m) => String(m.m.text).includes('DRILL-OK')));

  // -- 5: dispose
  host.handle({ type: 'seatClose', id: id2 });
  ok('5 dispose accepted', true);
  finish(0);
})().catch((e) => { console.error('DRILL ERROR:', e.message); finish(1); });
