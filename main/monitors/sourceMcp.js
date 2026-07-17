// Apex — MCP tracker source (2026-07-16). A read-only status surface for the
// Model-Context-Protocol servers the seats can use. Two tiers, per the operator:
//   ACTIVE     — the MCP servers live for the project in focus (the focused
//                seat's cwd). Health comes from `claude mcp list` run in that
//                cwd, which is Claude Code's own truth (✓ Connected / ✗ Failed /
//                ! Needs auth) and already folds in global + project + connectors.
//   AVAILABLE  — the full inventory of everything CONFIGURED anywhere the user
//                works: claude global (~/.claude.json), codex global
//                (~/.codex/config.toml), and every project's .mcp.json known to
//                ~/.claude.json's projects map — so a project-scoped server
//                (e.g. graphify in snipersight-trading) is visible even from a
//                different repo, tagged with its scope.
// Status only (v1): no toggles, no restarts, no config writes. It reads and
// reports. It NEVER emits env/secrets — only server name, transport, scope,
// lane, and health glyph. `claude mcp list` is spawned on a slow cadence and on
// focus change (debounced), never per-tick, because it fans out network health
// checks to the connector endpoints.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const bus = require('./../bus');

const HOME = os.homedir();
const CLAUDE_JSON = path.join(HOME, '.claude.json');
const CODEX_TOML = path.join(HOME, '.codex', 'config.toml');

const GLYPH = { good: '✓', warning: '!', critical: '✗', idle: '·' };
const SEV_RANK = { good: 0, idle: 0, warning: 1, critical: 2 };

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const repoName = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || '(app)';
const transportOf = (detail) => (/^https?:\/\//i.test(String(detail || '')) ? 'http' : 'stdio');
function transportOfServer(v) {
  if (!v || typeof v !== 'object') return 'stdio';
  if (v.url || v.type === 'http' || v.type === 'sse') return v.type || 'http';
  return 'stdio';
}

// ---- config inventory (no health; just what's declared) ----
function claudeGlobal() {
  const j = readJson(CLAUDE_JSON), out = [];
  if (j && j.mcpServers) for (const [k, v] of Object.entries(j.mcpServers))
    out.push({ name: k, lane: 'claude', scope: 'global', transport: transportOfServer(v) });
  return out;
}
function codexGlobal() {
  const out = [];
  try {
    const t = fs.readFileSync(CODEX_TOML, 'utf8');
    // [mcp_servers.NAME] headers only — skip sub-tables like [...NAME.env]
    const re = /^\s*\[mcp_servers\.([^\].]+)\]\s*$/gm;
    let m; while ((m = re.exec(t))) out.push({ name: m[1], lane: 'codex', scope: 'global', transport: 'stdio' });
  } catch { /* no codex config */ }
  return out;
}
function projectsInventory() {
  const j = readJson(CLAUDE_JSON), out = [];
  if (!j || !j.projects) return out;
  for (const p of Object.keys(j.projects)) {
    const base = repoName(p);
    const pj = j.projects[p];
    if (pj && pj.mcpServers) for (const [k, v] of Object.entries(pj.mcpServers))
      out.push({ name: k, lane: 'claude', scope: 'project:' + base, project: p, transport: transportOfServer(v) });
    const mj = readJson(path.join(p, '.mcp.json'));
    const servers = mj && (mj.mcpServers || mj);
    if (servers && typeof servers === 'object') for (const [k, v] of Object.entries(servers))
      if (v && typeof v === 'object')
        out.push({ name: k, lane: 'claude', scope: 'project:' + base, project: p, transport: transportOfServer(v) });
  }
  return out;
}

// ---- live health for the focused project (Claude Code's own view) ----
function probeClaude(cwd) {
  return new Promise((resolve) => {
    exec('claude mcp list', { cwd, timeout: 45000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
      const map = {};
      for (const line of String(stdout || '').split(/\r?\n/)) {
        const i = line.indexOf(': '), j = line.lastIndexOf(' - ');
        if (i < 0 || j < 0 || j <= i) continue;            // header/blank lines
        const name = line.slice(0, i).trim();
        const detail = line.slice(i + 2, j).trim();
        const status = line.slice(j + 3).trim();
        let sev;
        if (/✗|Failed|error/i.test(status)) sev = 'critical';
        else if (/!|auth/i.test(status)) sev = 'warning';
        else if (/✓|Connected/i.test(status)) sev = 'good';
        else continue;
        map[name] = { sev, transport: transportOf(detail) };
      }
      // an exec failure that parsed NOTHING is a real problem (claude off PATH,
      // auth-broken, timeout) — surface it, don't render a false "0 active".
      const failed = !!err && Object.keys(map).length === 0;
      resolve({ map, failed, err: err ? (err.message || String(err)) : null });
    });
  });
}

// ---- assembly ----
function buildActive(probe, codex) {
  const by = new Map();  // name -> { name, sev, transport, lanes:Set }
  for (const [name, h] of Object.entries(probe))
    by.set(name, { name, sev: h.sev, transport: h.transport, lanes: new Set(['claude']) });
  for (const s of codex) {
    const hit = by.get(s.name);
    if (hit) hit.lanes.add('codex');
    // codex-only servers: configured, no health probe for that lane → idle
    else by.set(s.name, { name: s.name, sev: 'idle', transport: s.transport, lanes: new Set(['codex']) });
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function buildAvailable(probe) {
  const by = new Map();  // name -> { name, scope, transport }
  const put = (name, scope, transport) => {
    const hit = by.get(name);
    // 'global' wins as the label; otherwise keep the first scope seen
    if (!hit) by.set(name, { name, scope, transport });
    else if (scope === 'global') hit.scope = 'global';
  };
  for (const s of claudeGlobal()) put(s.name, 'global', s.transport);
  for (const s of codexGlobal()) put(s.name, 'global', s.transport);
  for (const s of projectsInventory()) put(s.name, s.scope, s.transport);
  for (const [name, h] of Object.entries(probe))
    if (!by.has(name)) put(name, 'connector', h.transport);   // claude.ai connectors etc.
  return [...by.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
}

// ---- source lifecycle ----
// '' = no chat focused yet. The Available inventory reads configs (cwd-free)
// and always renders; Active needs a project, so with no focus it stays empty
// with an honest note rather than probing the app's own launch directory.
let currentCwd = '';
let latestRefresh = null;     // always the current pane's refresh (survives reload)
let focusBound = false;

function start(pane, ctx) {
  currentCwd = (pane.source && pane.source.cwd) || currentCwd;
  let timer = null, disposed = false, inflight = false;

  const refresh = async () => {
    if (inflight) return;
    inflight = true;
    const probedCwd = currentCwd;   // remember what THIS pass reflects
    try {
      // Available is cwd-independent — always compute it. Active needs a focused
      // project; probe only when we have one.
      const probeRes = probedCwd ? await probeClaude(probedCwd) : { map: {}, failed: false };
      const available = buildAvailable(probeRes.map);
      if (disposed) return;
      if (!probedCwd) {
        ctx.emit({
          status: 'idle', activeText: '—', availText: available.length + ' available',
          project: '(no chat focused)',
          active: [{ name: 'focus a chat', value: 'to see its project\'s live servers' }],
          available: available.map((s) => ({ name: s.name, value: s.scope + ' · ' + s.transport })),
        });
      } else if (probeRes.failed) {
        ctx.log('mcp: `claude mcp list` failed — ' + probeRes.err);
        ctx.emit({
          status: 'critical', activeText: 'probe failed', availText: available.length + ' available',
          project: repoName(probedCwd),
          active: [{ name: 'claude mcp list failed', value: probeRes.err || 'is the CLI on PATH & signed in?' }],
          available: available.map((s) => ({ name: s.name, value: s.scope + ' · ' + s.transport })),
        });
      } else {
        const active = buildActive(probeRes.map, codexGlobal());
        const worst = active.reduce((w, s) => (SEV_RANK[s.sev] > SEV_RANK[w] ? s.sev : w), 'good');
        ctx.emit({
          status: active.length ? worst : 'idle',
          activeText: active.length + ' active',
          availText: available.length + ' available',
          project: repoName(probedCwd),
          active: active.map((s) => ({
            name: s.name,
            value: (GLYPH[s.sev] || '·') + ' ' + [...s.lanes].join('+') + ' · ' + s.transport,
          })),
          available: available.map((s) => ({ name: s.name, value: s.scope + ' · ' + s.transport })),
        });
      }
    } catch (e) { ctx.log('mcp source error: ' + e.message); }
    finally {
      inflight = false;
      // a focus that arrived mid-probe changed currentCwd — the pane still
      // shows the OLD project. Re-run so it catches up (C12: trailing refresh).
      if (!disposed && currentCwd !== probedCwd) refresh();
    }
  };

  latestRefresh = refresh;
  // one focus listener for the life of the process (the bus has no off());
  // it drives whichever pane is current via latestRefresh. Empty cwd is a real
  // signal ("no chat focused" — last chat closed), not something to ignore.
  if (!focusBound) {
    focusBound = true;
    bus.on('seatFocus', (m) => {
      const cwd = m && typeof m.cwd === 'string' ? m.cwd : '';
      if (cwd !== currentCwd) { currentCwd = cwd; if (latestRefresh) latestRefresh(); }
    });
  }

  refresh();
  timer = setInterval(refresh, Math.max(20, pane.refreshSecs || 60) * 1000);
  return () => { disposed = true; clearInterval(timer); };
}

function action(pane, actionId, ctx) {
  // v1 is status-only — no verbs. (Toggle/restart would live here in v2.)
  ctx.log('MCP tracker is read-only in this version — no actions.');
}

module.exports = { start, action };
