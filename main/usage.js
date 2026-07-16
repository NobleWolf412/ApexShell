// Apex — usage module (main side). Real provider numbers only, never estimates
// (the operator's accuracy ruling, 2026-07-13): Claude = Anthropic's own OAuth usage
// endpoint (what /usage renders); Codex = OpenAI's rate_limits telemetry in the
// newest session rollout (truth as-of-last-run, staleness shown honestly);
// agy = locally-observed user turns vs the documented 200-req/24h cap (a floor,
// labeled approximate — provider truth has no reachable surface, TTY-only wall);
// Qwen = exact Ollama token counts relayed from the local seat (no cap — volume).
// All bars render USED %, one direction everywhere (Codex's own UI shows
// "remaining" — we deliberately do not copy that; it read opposite to Claude).
'use strict';

const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bus = require('./bus');
const store = require('./store');

// failure trail (debug-ready): "claude had no bars for a while" was
// undiagnosable — every failed poll vanished silently (2026-07-14)
let wlog = () => {};

const HOME = os.homedir();
const CLAUDE_CREDS = path.join(HOME, '.claude', '.credentials.json');
const CODEX_SESSIONS = path.join(HOME, '.codex', 'sessions');
const AGY_BRAIN = path.join(HOME, '.gemini', 'antigravity-cli', 'brain');
const QWEN_STATE = path.join(__dirname, '..', 'state', 'usage-local.json');

// agy's OAuth lane cap — documented 200 requests / 24h rolling (verified live
// web 2026-07-13; volatile, re-verify if the number ever matters at the edge).
const AGY_CAP = 200;

const state = {
  claude: null,   // { session:{pct,resetsAt}, weekly:{pct,resetsAt}, scoped:[], stale, asOf }
  codex: null,    // { session:{pct,resetsAt}|null, weekly:{pct,resetsAt}, plan, stale, asOf }
  agy: null,      // { turns24h, cap, lastActivity, asOf }  (locally observed)
  qwen: null,     // { session:{...}, today:{...}, week:{...} }  (exact, no cap)
};
let timers = [];
let codexWatch = null;
let emitPending = null;
let disposed = false;

function post() {
  // collapse bursts — one usageData per second is plenty for 26px bars
  if (emitPending || disposed) return;
  emitPending = setTimeout(() => {
    emitPending = null;
    bus.post('usageData', { usage: state, ts: Date.now() });
  }, 1000);
}

// ---- last-good-read cache (2026-07-14, the operator: "still annoying slow") ----
// Every restart started from zero, and the OAuth endpoint 429s under tonight's
// restart cadence — so the Claude row sat blank for minutes. The last good
// numbers (percentages + reset times only — never tokens) persist and paint
// IMMEDIATELY at boot, honestly dimmed when older than the 5-min grace.
const USAGE_CACHE = path.join(__dirname, '..', 'state', 'usage-cache.json');
function saveUsageCache() {
  // MERGE, never clobber (2026-07-15 bug, caught by the operator's "not instant"):
  // this ran on ANY provider's success and wrote the whole state — a codex
  // success while claude was 429ing overwrote claude's cached good read with
  // its stale marker, so boot had nothing to paint. An entry is cache-worthy
  // only if it carries a real read (asOf); otherwise the previous one stays.
  try {
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(USAGE_CACHE, 'utf8')); } catch { /* none */ }
    const keep = (k) => (state[k] && state[k].asOf) ? state[k]
                      : (prev[k] && prev[k].asOf) ? prev[k] : undefined;
    fs.writeFileSync(USAGE_CACHE, JSON.stringify({ claude: keep('claude'), codex: keep('codex') }));
  } catch { /* best-effort */ }
}
function loadUsageCache() {
  try {
    const c = JSON.parse(fs.readFileSync(USAGE_CACHE, 'utf8'));
    for (const k of ['claude', 'codex']) {
      if (c[k] && c[k].asOf) {
        state[k] = c[k];
        state[k].stale = (Date.now() - c[k].asOf) > 5 * 60e3;
      }
    }
    post();
  } catch { /* first run — no cache yet */ }
}

// ---- Claude — the OAuth usage endpoint (Anthropic's own /usage numbers) ----
// Token is read fresh from the CLI's credential store on every poll and lives
// only in the request header — never logged, never stored, never re-emitted.
let claudeRetryAt = 0;   // 429 backoff — hammering a throttled endpoint only extends the throttle
function pollClaude() {
  if (Date.now() < claudeRetryAt) return;
  let tok;
  try {
    const creds = JSON.parse(fs.readFileSync(CLAUDE_CREDS, 'utf8'));
    tok = (creds.claudeAiOauth || {}).accessToken || creds.accessToken;
  } catch { /* no creds — leave stale */ }
  if (!tok) { markStale('claude', 'no OAuth token in the CLI credential store'); return; }

  const req = https.request({
    hostname: 'api.anthropic.com', path: '/api/oauth/usage', method: 'GET',
    headers: { Authorization: 'Bearer ' + tok, 'anthropic-beta': 'oauth-2025-04-20' },
    timeout: 15000,
  }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      if (res.statusCode === 429) {
        const ra = Number(res.headers['retry-after']) || 0;
        const wait = Math.max(ra * 1000, 5 * 60e3);
        claudeRetryAt = Date.now() + wait;
        markStale('claude', 'HTTP 429 (rate-limited) — backing off ' + Math.round(wait / 60000) + 'm');
        return;
      }
      if (res.statusCode !== 200) { markStale('claude', 'HTTP ' + res.statusCode); return; }
      try {
        const j = JSON.parse(body);
        const out = { session: null, weekly: null, scoped: [], stale: false, asOf: Date.now() };
        for (const l of j.limits || []) {
          const entry = { pct: Number(l.percent) || 0, resetsAt: l.resets_at || null };
          if (l.kind === 'session') out.session = entry;
          else if (l.kind === 'weekly_all') out.weekly = entry;
          else out.scoped.push(Object.assign({ kind: l.kind,
            name: (l.scope && l.scope.model && l.scope.model.display_name) || l.kind }, entry));
        }
        // older response shape fallback — utilization floats
        if (!out.session && j.five_hour)
          out.session = { pct: Number(j.five_hour.utilization) || 0, resetsAt: j.five_hour.resets_at };
        if (!out.weekly && j.seven_day)
          out.weekly = { pct: Number(j.seven_day.utilization) || 0, resetsAt: j.seven_day.resets_at };
        // recoveries get a log line so the failure trail shows both edges
        // (successes were invisible — the 429 picture read worse than it was)
        if (!state.claude || state.claude.stale || !state.claude.asOf)
          wlog('claude poll OK — session ' + (out.session ? out.session.pct : '—') +
               '% · weekly ' + (out.weekly ? out.weekly.pct : '—') + '%');
        state.claude = out;
        ledgerPeak('claude', out.session && out.session.pct,
                   out.weekly && out.weekly.pct);
        saveUsageCache();
        post();
      } catch (e) { markStale('claude', 'unparseable response — ' + e.message); }
    });
  });
  req.on('error', (e) => markStale('claude', 'request error — ' + e.message));
  req.on('timeout', () => { req.destroy(); markStale('claude', 'timeout (15s)'); });
  req.end();
}

function markStale(key, reason) {
  // One blip must not dim the unit (the operator, 2026-07-14: "why does claude go
  // dim but codex stays bright?" — Claude polls an unofficial endpoint every
  // 60s and a single failed poll dimmed it, while codex reads local rollouts
  // and never blips). A number a few minutes old is still the truth: dim only
  // once the last GOOD read has aged past 5 minutes of failures.
  const age = state[key] && state[key].asOf ? Date.now() - state[key].asOf : null;
  const inGrace = age != null && age < 5 * 60e3;
  wlog(key + ' poll failed: ' + (reason || 'unknown') +
       (inGrace ? ' (grace — showing ' + Math.round(age / 1000) + 's-old read)'
                : ' → STALE'));
  if (inGrace) return;
  if (state[key]) { state[key].stale = true; post(); }
  else { state[key] = { stale: true, asOf: null }; post(); }
}

// ---- Codex — rate_limits from the newest session rollout JSONL ----
// OpenAI writes its own used_percent/resets_at into every rollout event; the
// newest event on disk IS the provider's number, just as-of-last-run. free-plan
// relic files are skipped (the pre-Plus account's 30-day window would lie).
function findIn(obj, key, depth) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (obj[key] && typeof obj[key] === 'object') return obj[key];
  for (const k of Object.keys(obj)) {
    const hit = findIn(obj[k], key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function newestRollouts(limit) {
  const files = [];
  try {
    for (const y of fs.readdirSync(CODEX_SESSIONS).sort().reverse().slice(0, 1)) {
      const yd = path.join(CODEX_SESSIONS, y);
      for (const m of fs.readdirSync(yd).sort().reverse().slice(0, 2)) {
        const md = path.join(yd, m);
        for (const d of fs.readdirSync(md).sort().reverse().slice(0, 7)) {
          const dd = path.join(md, d);
          for (const f of fs.readdirSync(dd)) {
            if (!f.endsWith('.jsonl')) continue;
            const p = path.join(dd, f);
            try { files.push({ p, mtime: fs.statSync(p).mtimeMs }); } catch { /* gone */ }
          }
        }
      }
    }
  } catch { /* no codex store */ }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

function scanCodex() {
  for (const f of newestRollouts(6)) {
    let text;
    try {
      const size = fs.statSync(f.p).size;
      if (size > 4 * 1024 * 1024) {
        const fd = fs.openSync(f.p, 'r');
        const buf = Buffer.alloc(256 * 1024);
        fs.readSync(fd, buf, 0, buf.length, size - buf.length);
        fs.closeSync(fd);
        text = buf.toString('utf8');
      } else text = fs.readFileSync(f.p, 'utf8');
    } catch { continue; }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      let rl;
      try { rl = findIn(JSON.parse(lines[i]), 'rate_limits', 0); } catch { continue; }
      if (!rl || !rl.primary) continue;
      if (rl.plan_type === 'free') break;   // pre-Plus relic file — try an older file? no: skip file
      const windows = [rl.primary, rl.secondary].filter(Boolean).map((w) => ({
        pct: Number(w.used_percent) || 0,
        resetsAt: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null,
        minutes: w.window_minutes,
      }));
      const weekly = windows.find((w) => w.minutes >= 7000) || null;
      const session = windows.find((w) => w.minutes <= 600) || null;
      state.codex = { session, weekly, plan: rl.plan_type || '?', stale: false, asOf: f.mtime };
      ledgerPeak('codex', session && session.pct, weekly && weekly.pct);
      saveUsageCache();
      post();
      return;
    }
  }
  markStale('codex', 'no rate_limits telemetry in any recent rollout');
}

// ---- codex ACCOUNT truth — server-side, all machines (2026-07-14) ----
// the operator: "what if I used codex on another machine?" Rollout telemetry is
// as-of-the-last-LOCAL-run, blind to other machines. The app-server's
// account/rateLimits/read returns the server's own numbers (probe-proven:
// usedPercent + window + resetsAt + planType) — an initialize-only session,
// no thread started, so no rollout lands and transcript intake sees nothing.
// Rollout scanning stays: it updates instantly after local runs (fs.watch)
// and is the fallback when this probe can't run.
function pollCodexAccount() {
  if (disposed) return;
  let settled = false;
  let child;
  try {
    child = require('child_process').spawn('codex app-server',
      { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { scanCodex(); return; }
  const done = () => { settled = true; try { child.kill(); } catch { /* gone */ } };
  const fail = (why) => {
    if (settled) return;
    wlog('codex account read failed: ' + why + ' — falling back to rollout scan');
    done();
    scanCodex();
  };
  let buf = ''; let rid = 0;
  const rpc = (m, p) => {
    rid++;
    try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method: m, params: p }) + '\n'); }
    catch { /* dying pipe → exit path fails it */ }
  };
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id === 1) rpc('account/rateLimits/read', {});
      else if (m.id === 2) {
        const rl = m.result && m.result.rateLimits;
        if (rl && rl.primary) {
          const win = (w) => w ? { pct: Number(w.usedPercent) || 0,
            resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : null,
            minutes: w.windowDurationMins } : null;
          const wins = [win(rl.primary), win(rl.secondary)].filter(Boolean);
          const weekly = wins.find((w) => w.minutes >= 7000) || null;
          const session = wins.find((w) => w.minutes <= 600) || null;
          state.codex = { session, weekly, plan: rl.planType || '?',
                          stale: false, asOf: Date.now(), live: true };
          ledgerPeak('codex', session && session.pct, weekly && weekly.pct);
          saveUsageCache();
          post();
          settled = true;
          done();
        } else fail('response carried no rateLimits');
      }
    }
  });
  child.on('error', (e) => fail('spawn — ' + e.message));
  child.on('exit', () => { if (!settled) fail('app-server exited early'); });
  rpc('initialize', { clientInfo: { name: 'apex-usage', title: 'Apex', version: '0.1.0' } });
  const t = setTimeout(() => fail('timeout (15s)'), 15000);
  if (t.unref) t.unref();
}

// ---- agy — locally observed user turns vs the documented 24h cap ----
function scanAgy() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let turns = 0, last = 0;
  const perDay = {};    // observed ground truth per calendar day → the ledger
  try {
    for (const conv of fs.readdirSync(AGY_BRAIN)) {
      const t = path.join(AGY_BRAIN, conv, '.system_generated', 'logs', 'transcript.jsonl');
      if (!fs.existsSync(t)) continue;
      for (const line of fs.readFileSync(t, 'utf8').split('\n')) {
        if (!line.includes('"USER_INPUT"')) continue;
        try {
          const j = JSON.parse(line);
          if (j.type !== 'USER_INPUT' || !j.created_at) continue;
          const ts = Date.parse(j.created_at);
          if (ts > last) last = ts;
          if (ts >= cutoff) turns++;
          const day = new Date(ts).toISOString().slice(0, 10);
          perDay[day] = (perDay[day] || 0) + 1;
        } catch { /* partial line */ }
      }
    }
    state.agy = { turns24h: turns, cap: AGY_CAP, lastActivity: last || null, asOf: Date.now() };
    if (qwenLedger) {
      // overwrite only days the scan actually saw — brain dirs age out, and an
      // absent day must not zero history already banked
      for (const [day, n] of Object.entries(perDay))
        qwenDay(day).agyTurns = Math.max(qwenDay(day).agyTurns || 0, n);
      saveQwen();
    }
  } catch {
    state.agy = { turns24h: null, cap: AGY_CAP, lastActivity: null, asOf: Date.now() };
  }
  post();
}

// ---- Qwen — exact token counts, BOTH local lanes, per-day ledger forever ----
// Two lanes burn Ollama tokens on this box: app seats (engine localUsage
// events) and delegate.py (the Atrium Phase-4 workhorse — where EVERY token
// went the week the tracker read zero; the operator's 2026-07-14 catch). The ledger
// (`days` in usage-local.json) keeps one tiny record per calendar day forever
// — weekly/monthly/yearly are derived, and the file is the log the operator can
// inspect for any range. Claude/Codex daily peak percents and agy daily turns
// are recorded into the same days map (history for every tracker).
const DELEGATE_EVENTS = path.resolve(__dirname, '..', '..', '..', 'Atrium',
  'experiments', 'home-grown', 'results', 'usage-events.jsonl');

let qwenLedger = null;        // { cursor, days: { 'YYYY-MM-DD': {...} } }
let qwenSession = null;       // { prompt, eval, turns } — this app run only
let qwenSaveTimer = null;

const todayStr = () => new Date().toISOString().slice(0, 10);

function qwenDay(day) {
  const d = qwenLedger.days;
  return d[day] || (d[day] = {});
}

function addTok(dayObj, lane, p, e) {
  const b = dayObj[lane] || (dayObj[lane] = { prompt: 0, eval: 0, n: 0 });
  b.prompt += p || 0;
  b.eval += e || 0;
  b.n += 1;
}

function loadQwen() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(QWEN_STATE, 'utf8')); } catch { /* fresh */ }
  qwenLedger = { cursor: Number(saved.cursor) || 0, days: saved.days || {} };
  // one-time migration from the pre-ledger {today, week} shape
  if (!saved.days && saved.today && saved.today.date &&
      (saved.today.prompt || saved.today.eval)) {
    qwenLedger.days[saved.today.date] = {
      seat: { prompt: saved.today.prompt, eval: saved.today.eval,
              n: saved.today.turns || 0 },
    };
  }
  qwenSession = { prompt: 0, eval: 0, turns: 0 };
  recomputeQwen();
}

function saveQwen() {
  clearTimeout(qwenSaveTimer);
  qwenSaveTimer = setTimeout(flushQwen, 5000);
}

function flushQwen() {
  clearTimeout(qwenSaveTimer);
  if (!qwenLedger) return;
  try {
    fs.mkdirSync(path.dirname(QWEN_STATE), { recursive: true });
    fs.writeFileSync(QWEN_STATE, JSON.stringify(
      { cursor: qwenLedger.cursor, days: qwenLedger.days }, null, 2));
  } catch { /* state dir gone — non-fatal */ }
}

// Rolling calendar-day windows (today / last 7 / last 30 / last 365, today
// inclusive) summed from the ledger into the view the renderer reads.
function recomputeQwen() {
  const windows = { today: 1, week: 7, month: 30, year: 365 };
  const view = { session: qwenSession };
  const cut = {};
  for (const [k, n] of Object.entries(windows)) {
    const d = new Date(Date.now() - (n - 1) * 86400000);
    cut[k] = d.toISOString().slice(0, 10);
    view[k] = { tok: 0, seatTok: 0, delTok: 0, turns: 0, calls: 0 };
  }
  for (const [day, rec] of Object.entries(qwenLedger.days)) {
    const seat = rec.seat, del = rec.delegate;
    for (const k of Object.keys(windows)) {
      if (day < cut[k]) continue;
      const w = view[k];
      if (seat) {
        w.seatTok += (seat.prompt || 0) + (seat.eval || 0);
        w.turns += seat.n || 0;
      }
      if (del) {
        w.delTok += (del.prompt || 0) + (del.eval || 0);
        w.calls += del.n || 0;
      }
      w.tok = w.seatTok + w.delTok;
    }
  }
  state.qwen = view;
}

function localTokens(promptTokens, evalTokens) {
  if (!qwenLedger) loadQwen();
  qwenSession.prompt += promptTokens || 0;
  qwenSession.eval += evalTokens || 0;
  qwenSession.turns += 1;
  addTok(qwenDay(todayStr()), 'seat', promptTokens, evalTokens);
  recomputeQwen();
  saveQwen();
  post();
}

// delegate.py appends usage-events.jsonl; we consume from a persisted byte
// cursor and never truncate (concurrent appends stay safe).
function ingestDelegateEvents() {
  if (!qwenLedger) loadQwen();
  let st;
  try { st = fs.statSync(DELEGATE_EVENTS); } catch { return; }
  if (st.size < qwenLedger.cursor) qwenLedger.cursor = 0;   // file rewritten
  if (st.size === qwenLedger.cursor) return;
  let text;
  try {
    const fd = fs.openSync(DELEGATE_EVENTS, 'r');
    const buf = Buffer.alloc(st.size - qwenLedger.cursor);
    fs.readSync(fd, buf, 0, buf.length, qwenLedger.cursor);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return; }
  const lastNl = text.lastIndexOf('\n');
  if (lastNl < 0) return;                       // partial line — next pass
  qwenLedger.cursor += Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
  let added = false;
  for (const line of text.slice(0, lastNl).split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      addTok(qwenDay(String(e.ts || '').slice(0, 10) || todayStr()),
             'delegate', e.prompt, e.eval);
      added = true;
    } catch { /* malformed line — cursor is already past it */ }
  }
  if (added) { recomputeQwen(); post(); }
  saveQwen();                                    // cursor moved either way
}

// Daily peak percents for the provider-truth trackers — history in the same
// ledger (the bars stay live provider numbers; this is the log).
function ledgerPeak(key, sessionPct, weeklyPct) {
  if (!qwenLedger) return;
  const d = qwenDay(todayStr());
  const b = d[key] || (d[key] = { session: 0, weekly: 0 });
  if (sessionPct != null) b.session = Math.max(b.session, Math.round(sessionPct));
  if (weeklyPct != null) b.weekly = Math.max(b.weekly, Math.round(weeklyPct));
  saveQwen();
}

// ---- wiring ----
function register() {
  wlog = store.openLog('usage');
  loadUsageCache();   // last good read paints the bars before any poll answers
  loadQwen();
  bus.on('usageRefresh', () => { pollClaude(); pollCodexAccount(); scanAgy(); ingestDelegateEvents(); });
  // a (re)loaded renderer needs the current picture without waiting a tick
  bus.on('ready', () => post());
  pollClaude(); pollCodexAccount(); scanAgy(); ingestDelegateEvents();
  timers.push(setInterval(pollClaude, 60 * 1000));
  // account truth every 5 min (covers other machines); the rollout watcher
  // below still refreshes instantly after local runs
  timers.push(setInterval(pollCodexAccount, 300 * 1000));
  timers.push(setInterval(scanAgy, 300 * 1000));
  timers.push(setInterval(ingestDelegateEvents, 60 * 1000));
  try {
    codexWatch = fs.watch(CODEX_SESSIONS, { recursive: true }, () => {
      clearTimeout(codexWatch._deb);
      codexWatch._deb = setTimeout(scanCodex, 2000);
    });
    codexWatch.on('error', () => { /* store vanished — interval still covers */ });
  } catch { /* no codex install */ }
}

function dispose() {
  disposed = true;
  for (const t of timers) clearInterval(t);
  timers = [];
  clearTimeout(emitPending);
  if (codexWatch) { try { codexWatch.close(); } catch { /* closed */ } }
  // flush the ledger synchronously — a quit must not lose the day
  flushQwen();
}

function claudeSnapshot() {
  if (!state.claude) return null;
  return JSON.parse(JSON.stringify(state.claude));
}

module.exports = { register, dispose, localTokens, claudeSnapshot };

