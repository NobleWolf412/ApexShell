// Apex — seats module (main side). Adopts the Phase-1 engine into the app:
// registers the bus verbs, injects the storage adapter (history index), and
// re-announces on every renderer (re)load — the R23 architecture doing its
// job: the view is a projection, the engine owns the truth.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { dialog, BrowserWindow } = require('electron');
const bus = require('./bus');
const store = require('./store');
const artifacts = require('./artifacts');
const { createSeatHost } = require('./engine/seatHost');

// ---- seat presets: the shell ships ZERO named seats. Extensions register a
// named rail button + kickoff prompt + optional working directory/wrap prompt.
const presets = new Map();   // name -> { name, letter, title, kickoff, cwd }
let cwdOverride = null;      // extension-set default cwd
let wrapOverride = null;     // extension-set End-Session wrap prompt
let announcePresets = () => {};

function presetNameConflict(owner, name) {
  const normalized = name.toLowerCase();
  if (normalized === 'seat')
    return { name, reason: 'reserved by Apex' };
  for (const [existingName, preset] of presets) {
    if (existingName.toLowerCase() === normalized && preset.owner !== owner)
      return { name, reason: 'owned by another extension' };
  }
  return null;
}

function validatePresetNames(owner, names) {
  if (typeof owner !== 'string' || !owner) throw new Error('Preset owner is required.');
  if (!Array.isArray(names)) throw new Error('Preset names must be an array.');
  return names.map((name) => {
    if (typeof name !== 'string' || !name.trim())
      throw new Error('Preset name must be a non-empty string.');
    return name.trim();
  });
}

// A preset that loses a name conflict must not vanish silently (it did — the
// second extension's persona just never appeared). Queue the story; replayed
// as toasts once a renderer exists, same pattern as the extension-load
// failures (R32).
const presetConflicts = [];

const extensionApi = {
  registerPreset(p, owner) {
    if (!p || typeof p.name !== 'string' || !p.name || p.name.toLowerCase() === 'seat') return;
    const who = (typeof owner === 'string' && owner) ? owner : 'unknown';
    const conflict = presetNameConflict(who, p.name);
    if (conflict) {
      // First registration wins — extension load order is readdir(), which is
      // deterministic. Losing is fine; losing SILENTLY was the bug.
      const text = 'Persona "' + p.name + '" from ' + who + ' skipped: ' + conflict.reason + '.';
      presetConflicts.push(text);
      console.error('[seats] ' + text);
      return;
    }
    presets.set(p.name, { ...p, owner: who });
    announcePresets();
  },
  checkPresetNames(owner, names) {
    return validatePresetNames(owner, names)
      .map((name) => presetNameConflict(owner, name))
      .filter(Boolean);
  },
  // A read-only list of live persona/seat preset names (App Builder slice 8,
  // Lift-off's Delegate-to-Architect gate). A bus verb can't answer this: the
  // bus is post()=main→renderer / on()=renderer→main only, so a value posted
  // back never reaches another main-side module — the same reason
  // checkPresetNames/replacePresetGroup already sit here as plain methods
  // instead of on the wire. Read-only, no state change.
  presetNames() { return presetNames(); },
  replacePresetGroup(owner, items) {
    if (!Array.isArray(items)) throw new Error('Preset group must be an array.');
    const names = validatePresetNames(owner, items.map((preset) => preset && preset.name));
    const accepted = [];
    const skipped = [];
    const seen = new Set();
    for (let index = 0; index < items.length; index++) {
      const preset = items[index];
      if (!preset || typeof preset !== 'object')
        throw new Error('Preset group contains an invalid preset.');
      const name = names[index];
      const normalized = name.toLowerCase();
      const conflict = presetNameConflict(owner, name);
      if (conflict) {
        skipped.push(conflict);
      } else if (seen.has(normalized)) {
        skipped.push({ name, reason: 'duplicated in this preset group' });
      } else {
        accepted.push({ ...preset, name, owner });
        seen.add(normalized);
      }
    }
    for (const [name, preset] of presets) {
      if (preset.owner === owner) presets.delete(name);
    }
    for (const preset of accepted) presets.set(preset.name, preset);
    announcePresets();
    return {
      registered: accepted.map((preset) => preset.name),
      skipped,
    };
  },
  setDefaultCwd(dir) { if (dir && fs.existsSync(dir)) cwdOverride = dir; },
  setWrapPrompt(text) { if (typeof text === 'string' && text) wrapOverride = text; },
  // Register {name, path} into `_workspaces` — collision (same name OR same
  // path) WARNS and never clobbers the existing entry; every other seatconfig
  // key is untouched (App Builder slice 8, Lift-off's "Register workspace").
  // The picker's own workspaceBrowse/workspaceAdd bus verb silently REPLACES
  // a same-path entry (last-writer-wins, no warning) — fine for the picker's
  // own "re-browse the same folder" flow, wrong for Lift-off's contract, so
  // this is a distinct, narrow method beside it rather than a behavior change
  // to workspaceAdd. Plain ctx.seats method, not a bus verb, for the same
  // reason presetNames() above is: post() cannot answer back to a caller
  // that is itself main-side, only to the renderer.
  registerWorkspace({ name, path: workspacePath } = {}) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || !fs.existsSync(workspacePath))
      return { ok: false, error: 'That path is not a folder we can register.' };
    const cleanName = (typeof name === 'string' && name.trim())
      ? name.trim() : (path.basename(workspacePath) || workspacePath);
    const cur = readWorkspaces();
    const collision = cur.list.find((w) => w.name === cleanName ||
      path.resolve(w.path) === path.resolve(workspacePath));
    if (collision) {
      return {
        ok: false, warning: true, existing: collision,
        error: `A workspace already uses this ${collision.name === cleanName ? 'name' : 'path'}: ${collision.name}`,
      };
    }
    const list = cur.list.concat([{ name: cleanName, path: workspacePath }]);
    writeWorkspaces({ list, defaultPath: cur.defaultPath || workspacePath });
    postWorkspaces();
    return { ok: true, name: cleanName, path: workspacePath };
  },
  startDisposable(options) {
    if (!host) throw new Error('Seat engine is unavailable.');
    // A straight passthrough: `options.launch = { model, effort }` (App Builder
    // slice 5) rides along untouched — the engine's createDisposable is the
    // single validation gate (a bad tier throws there), so every caller of
    // this seam, extension or core module, is covered without duplicating
    // the Claude-tier allowlist here.
    return host.createDisposable(options || {});
  },
};

// Bare default: the configured workspace folder (seatconfig `_workspace`),
// else the user's home. Extensions may override it.
function defaultCwd() {
  if (cwdOverride) return cwdOverride;
  try {
    const ws = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))._workspace;
    if (typeof ws === 'string' && ws && fs.existsSync(ws)) return ws;
  } catch { /* no config yet */ }
  return os.homedir();
}
const seatCwd = (persona) => (presets.get(persona) || {}).cwd || defaultCwd();

// ---- workspaces: named project roots the picker + tab chip work off of.
// Shape in seatconfig.json: `_workspaces: [{ name, path }]`, `_workspace`
// keeps its role as the default project path.
function readWorkspaces() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* no cfg */ }
  const list = Array.isArray(cfg._workspaces) ? cfg._workspaces : [];
  const clean = list
    .filter((w) => w && typeof w.name === 'string' && typeof w.path === 'string'
                   && path.isAbsolute(w.path) && fs.existsSync(w.path))
    .map((w) => ({ name: w.name.trim() || path.basename(w.path), path: w.path }));
  // First-run migration: an existing `_workspace` seeds the list so the picker
  // isn't empty on the first render.
  if (!clean.length && typeof cfg._workspace === 'string' && cfg._workspace
      && fs.existsSync(cfg._workspace)) {
    clean.push({ name: path.basename(cfg._workspace) || cfg._workspace, path: cfg._workspace });
  }
  const defPath = (typeof cfg._workspace === 'string' && cfg._workspace) ? cfg._workspace
                  : (clean[0] ? clean[0].path : null);
  return { list: clean, defaultPath: defPath };
}

function writeWorkspaces(next) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* fresh */ }
  cfg._workspaces = next.list.map((w) => ({ name: w.name, path: w.path }));
  if (next.defaultPath) cfg._workspace = next.defaultPath;
  store.writeJsonAtomic(CONFIG_FILE, cfg);
}

function postWorkspaces() {
  bus.post('workspaces', readWorkspaces());
}

// Per-persona launch config (J21/J23): `current` = live dials for the next
// launch, `default` = that persona's saved default. Moved home to app/ when
// the extension era was archived (2026-07-12, the operator's "proven").
const CONFIG_FILE = path.resolve(__dirname, '..', 'seatconfig.json');
// Last-good seatconfig, so a hand-edit typo can't silently DROP the tool wall
// (external audit H2: launchFor failed OPEN — an unparseable file read as {},
// dropping tools/disallowedTools and launching walled personas with the full
// toolset). Absent = fresh install (fine, defaults). Present-but-corrupt =
// keep the last parse that worked; if none, fail closed on permissions (manual)
// and warn loudly rather than fail open.
let lastGoodCfg = null;
function launchFor(persona) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    lastGoodCfg = cfg;
  } catch (e) {
    if (fs.existsSync(CONFIG_FILE)) {
      console.error('[seats] seatconfig.json is unparseable (' + e.message +
        ') — using last-good config; walled personas keep their wall. FIX THE FILE.');
      cfg = lastGoodCfg || {};       // never fail OPEN by dropping the wall
    } else {
      cfg = {};                      // absent — a fresh install, defaults are correct
    }
  }
  // File shape (J21/J23, flat): { "<persona>": {current, default}, "_default": {...} }
  const p = cfg[persona] || {};
  const base = cfg._default || {};
  // 'default' anywhere in the layer stack means "not set here — fall through"
  const val = (x) => (x && x !== 'default') ? x : undefined;
  const pick = (k) =>
    val(p.current && p.current[k]) || val(p.default && p.default[k]) || val(base[k]);
  const launch = {};
  const model = pick('model'), effort = pick('effort');
  // Defaults store the codex TIER as a composite ('codex-sol' etc., J80):
  // split here so 'codex' stays the lane marker downstream — a tier in
  // launch.model would spawn `claude --model sol` (the J69 trap).
  if (model && model.startsWith('codex-')) {
    launch.model = 'codex';
    launch.codexModel = model.slice('codex-'.length);
  } else if (model) launch.model = model;
  if (effort) launch.effort = effort;
  // Explicit always; `manual` unless the config really says otherwise (J28).
  launch.permissionMode = pick('permissions') || 'manual';
  // Per-persona toolset wall (claude lane only; other lanes ignore these).
  // TOP-LEVEL keys, deliberately outside the current/default layer machinery:
  // seatConfigDefault/Reset REPLACE whole layers via resolve() and would wipe
  // anything extra stored inside them. `tools` = the CLI's built-in allowlist
  // ("Read,Glob,…"); `disallowedTools` = hard deny-rules (reaches MCP tools,
  // which --tools does not).
  if (typeof p.tools === 'string' && p.tools.trim()) launch.tools = p.tools.trim();
  if (typeof p.disallowedTools === 'string' && p.disallowedTools.trim())
    launch.disallowedTools = p.disallowedTools.trim();
  return launch;
}

let host = null;
let createFromMessage = null;

// ---- workflow-layer internal API (main/tasks.js) ----------------------------
// The chain engine must observe every seat projection event, create seats and
// learn their ids, and drive seat verbs — none of which the extension ctx
// exposes (deliberately: that surface is a public commitment; this one is a
// narrow in-house seam).
const seatObservers = new Set();
function observeSeats(fn) {
  if (typeof fn !== 'function') return () => {};
  seatObservers.add(fn);
  return () => seatObservers.delete(fn);
}
function notifyObservers(m) {
  for (const fn of seatObservers) {
    try { fn(m); } catch (e) { console.error('[seats] observer:', e.message); }
  }
}

/** Create a chain-step seat and RETURN its id (createFromMessage discards it).
 *  Launch dials come from the persona's own config; `launch` overrides win. */
function createTaskSeat({ persona, title, cwd, kickoff, resume, launch }) {
  if (!host) throw new Error('Seat engine is unavailable.');
  const name = persona || 'Seat';
  const merged = Object.assign(launchFor(name), launch || {});
  const dir = (cwd && fs.existsSync(cwd)) ? cwd : seatCwd(name);
  const seatTitle = title || name;
  // Same lane routing as createFromMessage: codex ids are "codex:"-prefixed.
  const codexResume = resume && String(resume).startsWith('codex:');
  if (codexResume || (merged.model === 'codex' && !resume)) {
    return host.create(resume ? null : (kickoff || null), seatTitle,
      { persona: name, cwd: dir, resume,
        launch: { model: 'codex', codexModel: merged.codexModel,
                  effort: merged.effort, permissionMode: merged.permissionMode } });
  }
  if (resume && merged.model === 'codex') delete merged.model;   // dial must not leak
  return host.create(resume ? null : (kickoff || null), seatTitle,
    { persona: name, cwd: dir, launch: merged, resume });
}

/** Hidden, tool-disabled seat for bounded core workflows (the live auditor).
 *  Same plumbing extensions get via startDisposable, exposed to core modules. */
function startDisposable(opts) {
  if (!host) throw new Error('Seat engine is unavailable.');
  return host.createDisposable(opts || {});
}

const presetInfo = (name) => {
  const p = presets.get(name);
  return p ? { name: p.name, cwd: p.cwd || null, kickoff: p.kickoff || null,
               letter: p.letter || null } : null;
};
const presetNames = () => [...presets.keys()];
const seatCommand = (msg) => { if (host) host.handle(msg); };
const seatEntry = (id) => host ? host.list().find((s) => s.id === id) || null : null;
/** All live seats — the workflow layer uses this to find reuse candidates so a
 *  delegation to a persona the user already has open doesn't spawn a duplicate. */
const listSeats = () => host ? host.list().slice() : [];
/** Close a seat the way the renderer's ✕ does — artifact cleanup included. */
function closeSeat(id) {
  if (!host) return;
  artifacts.seatClosed(id);
  host.handle({ type: 'seatClose', id });
  bus.post('seatGone', { id });
}

function register() {
  const wireLog = store.openLog('seats');
  host = createSeatHost({
    apexRoot: defaultCwd(),          // fallback only — every create passes cwd
    wrapPrompt: () => wrapOverride,  // lazy: extensions register after us
    emit: (m) => {
      // workflow-layer tap: observers see EVERY projection message (they need
      // text/result/dead for packet parsing). Try-wrapped and cheap — a
      // broken observer must never take the wire down.
      notifyObservers(m);
      if (m.type === 'seatEvt' && m.m.type === 'artifactCandidate') {
        artifacts.candidate(m.id, m.m.path);       // app-level concern, not engine
        return;
      }
      if (m.type === 'seatEvt' && m.m.type === 'localUsage') {
        // exact Ollama token counts → the usage trackers (app-level, like artifacts)
        require('./usage').localTokens(m.m.promptTokens, m.m.evalTokens);
        return;
      }
      bus.post(m.type, m);
    },
    log: (l) => wireLog(l),
    record: (persona, sessionId, title, cwd) => {
      store.recordChat(persona, sessionId, title, cwd);
      // push, don't wait for a reload — the rail dropdown reads live state
      bus.post('seatHistory', { history: store.chatHistory() });
    },
    onChange: () => bus.post('seatList', { seats: host.list() }),
    // learned context windows survive a restart — without this, resumed chats'
    // meters stay blank until the first completed turn (the operator, 2026-07-13)
    windowsFile: path.join(__dirname, '..', 'state', 'model-windows.json'),
    // the HOST owns storage paths (audit M4): the engine must not compute an
    // app-relative __dirname path for transcripts — inject it, like windowsFile.
    transcriptsDir: path.join(__dirname, '..', 'state', 'transcripts'),
  });

  // view → engine (exact types — the engine validates its own set again).
  // seatPtyInput/seatPtyResize were in the ENGINE's claim set but never
  // registered here — every terminal keystroke died at the bus (2026-07-12).
  for (const t of ['seatSend', 'seatPerm', 'seatStop', 'seatMode',
                   'seatModel', 'seatPtyInput', 'seatPtyResize', 'seatReplay',
                   'seatWrap'])
    bus.on(t, (msg) => {
      // a normal seatSend never echoes a view 'user' event (the view draws its
      // own bubble). Observers (the live auditor) still need the user's words —
      // give them a synthetic, non-view tap so the auditor sees both sides.
      if (t === 'seatSend' && msg && typeof msg.text === 'string' && msg.text)
        notifyObservers({ type: 'seatUserSend', id: msg.id, text: msg.text });
      host.handle(msg);
    });
  bus.on('seatClose', (msg) => { artifacts.seatClosed(msg.id); host.handle(msg); });

  createFromMessage = (msg) => {
    if (msg.terminal) {
      // The PTY lane (R25). Known tenants only — a bus message must never
      // pick an arbitrary executable to spawn.
      const t = { agy: { command: 'agy', title: 'agy — Gemini' },
                  claude: { command: 'claude', title: 'claude — terminal' },
                  codex: { command: 'codex', title: 'codex — terminal' },
                  cmd: { command: 'cmd.exe', title: 'cmd — shell' } }[msg.terminal];
      if (!t) return;
      host.create(null, t.title,
        { persona: t.title, cwd: defaultCwd(), launch: { mode: 'pty', command: t.command } });
      return;
    }
    const persona = msg.persona || '';
    const launch = Object.assign(launchFor(persona || 'Seat'), msg.launch || {});
    // Repo-faithful resume: a chat that ran in repo X must reopen in repo X,
    // not the persona's default home — otherwise the session's relative work
    // (and the persona's project-scoped memory rules) silently jump repos.
    // The renderer passes the history entry's recorded cwd; validate before
    // trusting anything off the wire.
    const msgCwd = (typeof msg.cwd === 'string' && path.isAbsolute(msg.cwd) &&
                    fs.existsSync(msg.cwd)) ? msg.cwd : null;
    // blank seat configured to `agy` = the Gemini terminal (PTY is agy's only
    // viable shape — issue #76). The permissions dial maps to agy's OWN
    // verified flags (platform-watch, v1.1.1): manual = ask in-terminal
    // (agy's default), acceptEdits = --mode accept-edits, bypass =
    // --dangerously-skip-permissions. No live switch exists — launch-time only.
    // `codex` on the model dial = the OWNED Codex clean-view seat (R33 — the
    // app-server lane in engine/codexSeat.js: streamed chat, our permission
    // cards, resume, wrap). Works for blank AND persona seats — a persona
    // rides the Codex substrate via the ~/.codex/AGENTS.md chain (proven
    // 2026-07-14): cwd puts the thread in the tree, the kickoff goes in as
    // the first turn, the persona seats itself. Codex session ids are
    // namespaced ("codex:<threadId>") so history resume routes back here.
    // The raw TUI stays available under (+) → TERMINALS as the escape hatch.
    const codexResume = msg.resume && String(msg.resume).startsWith('codex:');
    if (codexResume || (launch.model === 'codex' && !msg.resume)) {
      const p = presets.get(persona);
      // resumed chats carry their earned title back in (the J-era "wall of
      // generic persona-name reset lesson applies to this lane too)
      let ctitle = (typeof msg.title === 'string' && msg.title) ? msg.title : (persona || 'Seat');
      if (msg.resume && !msg.title) {
        const hit = (store.chatHistory()[persona] || []).find((e) => e.sessionId === msg.resume);
        if (hit && hit.title) ctitle = hit.title;
      }
      host.create(
        (p && !msg.resume) ? (p.kickoff || null) : null,
        ctitle,
        { persona: persona || 'Seat', cwd: msgCwd || seatCwd(persona), resume: msg.resume,
          launch: { model: 'codex', codexModel: launch.codexModel,
                    effort: launch.effort,
                    permissionMode: launch.permissionMode } });
      return;
    }
    // resuming a CLAUDE session while the dial sits on codex — the dial value
    // must not leak onto `claude --model`
    if (msg.resume && launch.model === 'codex') delete launch.model;
    if (!persona && launch.model === 'agy') {
      const agyArgs = launch.permissionMode === 'bypassPermissions'
        ? ['--dangerously-skip-permissions']
        : launch.permissionMode === 'acceptEdits' ? ['--mode', 'accept-edits'] : [];
      host.create(null, 'agy — Gemini',
        { persona: 'agy — Gemini', cwd: defaultCwd(),
          launch: { mode: 'pty', command: 'agy', args: agyArgs } });
      return;
    }
    // A RESUMED session already carries its persona in-history — re-sending
    // the seat-launch kickoff made it re-run the whole seating ritual
    // (the operator's report). Kickoff is for FRESH persona seats only.
    //
    // A resumed seat must also carry its EARNED TITLE back in. It used to start
    // at the bare persona name, and the engine records the starting title to
    // history on `init` — so every resume ERASED the chat's real name, and
    // `autoTitled` (true on resume) meant it never recovered. the operator's history was
    // a wall of repeated persona names.
    let title = (typeof msg.title === 'string' && msg.title) ? msg.title : (persona || 'Seat');
    if (msg.resume && !msg.title) {
      const hit = (store.chatHistory()[persona] || [])
        .find((e) => e.sessionId === msg.resume);
      if (hit && hit.title) title = hit.title;
    }
    // Kickoff comes from the preset (extension-registered). A RESUMED session
    // already carries its persona in-history — kickoff is for FRESH preset
    // seats only. An unknown/retired preset name still opens a plain seat.
    const preset = presets.get(persona);
    host.create(
      (preset && !msg.resume) ? (preset.kickoff || null) : null,
      title,
      { persona: persona || 'Seat', cwd: msgCwd || seatCwd(persona), launch, resume: msg.resume });
  };
  bus.on('seatCreate', createFromMessage);

  // Instant handoff (Delegate → on a chat): open the TARGET persona's seat now,
  // seeded with the source chat's recent output as a plain-text brief. No board
  // task, no apex-handoff packet gate — the fragile "source must emit JSON"
  // dependency is exactly what stalled. The source chat stays open for
  // reference; the target takes focus (a fresh seat becomes the active chat).
  bus.on('seatHandoff', (msg) => {
    if (!host || !msg || !msg.id) return;
    const src = host.list().find((s) => s.id === msg.id);
    if (!src || src.pty || src.local) { bus.post('toast', { text: 'only a persona/Claude chat can hand off' }); return; }
    const target = (typeof msg.target === 'string' && msg.target.trim()) || '';
    if (!presets.get(target)) { bus.post('toast', { text: 'unknown persona: ' + (target || '(none)') }); return; }
    const cwd = (src.cwd && fs.existsSync(src.cwd)) ? src.cwd : seatCwd(src.persona);
    let recentText = '';
    try {
      if (src.sessionId && !String(src.sessionId).startsWith('codex:')) {
        const { backfill } = require('./engine/transcripts');
        const { messages } = backfill(src.sessionId, path.join(os.homedir(), '.claude', 'projects'));
        recentText = (messages || []).filter((m) => m.type === 'text').slice(-3)
          .map((m) => m.text).join('\n\n');
      }
    } catch { /* no transcript — the brief says so and the target asks the user */ }
    const require_handoff = require('./engine/handoff');
    // Handing BACK to a persona you're already talking to should CONTINUE that
    // chat (its full context), not open a fresh amnesiac seat (the operator,
    // 2026-07-17: "shouldn't it have gone back to the original architect").
    // Reuse a live manual chat of the target in this cwd; exclude the source
    // itself and chain workers (⛓ title) so a manual handoff can't hijack an
    // auto-chain step. Most-recent match wins.
    const reuse = host.list()
      .filter((s) => s.id !== src.id && s.persona === target && !s.pty && !s.local &&
        !String(s.title || '').includes('⛓') &&
        (!s.cwd || path.resolve(s.cwd) === path.resolve(cwd)))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    if (reuse) {
      const brief = require_handoff.composeHandoffBrief({
        sourcePersona: src.persona || 'a persona', cwd, recentText, seated: true });
      seatCommand({ type: 'seatSend', id: reuse.id, text: brief });
      bus.post('seatEvt', { id: reuse.id, m: { type: 'user', text: brief } });
      bus.post('seatReveal', { id: reuse.id });
      bus.post('toast', { text: 'Resumed your ' + target + ' chat — handed the ' +
        (src.persona || 'chat') + ' work into it (full context kept).' });
      return;
    }
    const kickoff = require_handoff.composeHandoffBrief({
      sourcePersona: src.persona || 'a persona', targetKickoff: (presets.get(target) || {}).kickoff,
      cwd, recentText,
    });
    try {
      createTaskSeat({ persona: target, title: target + ' ← ' + (src.persona || 'chat'), cwd, kickoff });
      bus.post('toast', { text: 'Handed off to ' + target + ' — picking up from ' +
        (src.persona || 'the chat') + '. The original chat stays open for reference.' });
    } catch (e) {
      bus.post('toast', { text: 'Handoff failed: ' + e.message });
    }
  });

  bus.on('seatHistory', () =>
    bus.post('seatHistory', { history: store.chatHistory() }));
  // A reloaded window asks what survived; the roster was previously push-only.
  bus.on('seatList', () => bus.post('seatList', { seats: host.list() }));

  // Effort has no live control subtype we can verify — a change is a SEAMLESS
  // RESTART: same session resumed with the new flag, history restored by the
  // gate-proven backfill. Labeled as a restart in the UI, never disguised.
  // ALSO the only way into bypassPermissions (J44): the CLI accepts that mode at
  // launch only, so the dial hands it here rather than lying about a live switch.
  bus.on('seatRelaunch', (msg) => {
    const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
    const PERMS = new Set(['manual', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions']);
    const entry = host.list().find((s) => s.id === msg.id);
    if (!entry || entry.local || entry.pty || !entry.sessionId) {
      bus.post('toast', { text: 'no session to restart yet — give the seat a moment' });
      return;
    }
    if (msg.effort && !EFFORTS.has(msg.effort)) return;
    if (msg.permissions && !PERMS.has(msg.permissions)) return;
    if (!msg.effort && !msg.permissions) return;
    const { sessionId, persona, title, mode, model, codexModel, effort, cwd } = entry;
    artifacts.seatClosed(msg.id);
    host.handle({ type: 'seatClose', id: msg.id });
    bus.post('seatGone', { id: msg.id });
    setTimeout(() => {                       // past the kill backstop: transcript flushed
      // Base on launchFor so persona-level launch config (the toolset wall)
      // survives a restart — this path bypasses createFromMessage's merge, and
      // a bare relaunch was silently dropping `tools`/`disallowedTools`,
      // unlocking a read-only persona via the effort dial. Live dials still win.
      const launch = Object.assign(launchFor(persona || 'Seat'),
                                   { permissionMode: msg.permissions || mode });
      if (model) launch.model = model;
      if (codexModel) launch.codexModel = codexModel;   // tier survives a codex relaunch
      const eff = msg.effort || effort;      // a permissions restart must not drop effort
      if (eff) launch.effort = eff;
      // a relaunch must stay in the seat's OWN repo, not the persona default —
      // an effort/bypass restart mid-task silently jumped repos otherwise
      host.create(null, title, { persona, cwd: cwd || seatCwd(persona), resume: sessionId, launch });
    }, 2500);
  });

  // ---- per-persona launch config (the AI-bar defaults panel) ----
  // 'default' is NOT a value (the operator's ruling): dials hold concrete settings
  // only; the panel shows RESOLVED values (current → default → _default).
  const readCfg = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };
  const writeCfg = (cfg) => {
    store.writeJsonAtomic(CONFIG_FILE, cfg);
    wireLog('config write: ' + JSON.stringify(cfg));   // debug-ready: not-saving reports become diagnosable
  };
  const KEYS = ['model', 'effort', 'permissions'];
  const resolve = (cfg, persona, layer) => {   // layer: 'current' or 'default'
    const p = cfg[persona] || {}, base = cfg._default || {};
    const out = {};
    for (const k of KEYS) {
      out[k] = (layer === 'current' && p.current && p.current[k]) ||
               (p.default && p.default[k]) || base[k] || '';
    }
    // pre-J80 configs hold bare 'codex' — surface it as the tier it actually
    // launches (sol IS the plan default) so the panel's dial lands on a real option
    if (out.model === 'codex') out.model = 'codex-sol';
    return out;
  };
  const postCfg = (cfg) => {
    const view = {};
    for (const persona of [...presets.keys(), 'Seat'])
      view[persona] = { current: resolve(cfg, persona, 'current'),
                        default: resolve(cfg, persona, 'default') };
    bus.post('seatConfig', { config: view });
  };
  const postPresets = () => bus.post('seatPresets', {
    presets: [...presets.values()].map((p) => ({
      name: p.name, letter: p.letter || p.name[0].toUpperCase(),
      title: p.title || ('New chat - ' + p.name),
    })),
  });
  announcePresets = () => { postPresets(); postCfg(readCfg()); };
  bus.on('seatPresets', postPresets);
  bus.on('seatConfigGet', () => postCfg(readCfg()));
  bus.on('seatConfigSet', (msg) => {
    const OK = { model: new Set(['fable', 'opus', 'sonnet', 'haiku', 'qwen', 'agy',
                                 'codex', 'codex-sol', 'codex-terra', 'codex-luna']),
                 effort: new Set(['low', 'medium', 'high', 'xhigh', 'max']),
                 permissions: new Set(['manual', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions']) };
    if (!msg.persona || !OK[msg.key] || !OK[msg.key].has(msg.value)) return;
    const cfg = readCfg();
    const p = cfg[msg.persona] || (cfg[msg.persona] = {});
    (p.current || (p.current = {}))[msg.key] = msg.value;
    writeCfg(cfg);
    postCfg(cfg);
  });
  bus.on('seatConfigDefault', (msg) => {      // resolved current becomes the default
    const cfg = readCfg();
    if (!cfg[msg.persona]) cfg[msg.persona] = {};
    cfg[msg.persona].default = resolve(cfg, msg.persona, 'current');
    writeCfg(cfg);
    postCfg(cfg);
  });
  bus.on('seatConfigReset', (msg) => {        // current ← resolved default
    const cfg = readCfg();
    if (!cfg[msg.persona]) cfg[msg.persona] = {};
    cfg[msg.persona].current = resolve(cfg, msg.persona, 'default');
    writeCfg(cfg);
    postCfg(cfg);
  });

  // ---- workspaces (project picker + tab identity) ----
  bus.on('workspacesGet', () => postWorkspaces());
  bus.on('workspaceBrowse', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const picked = await dialog.showOpenDialog(win || undefined, {
        title: 'Choose a project folder',
        properties: ['openDirectory'],
      });
      if (picked.canceled || !picked.filePaths[0]) return;
      const p = picked.filePaths[0];
      if (!fs.existsSync(p)) {
        bus.post('toast', { text: 'That folder does not exist.' });
        return;
      }
      bus.post('workspaceBrowsed', { path: p, suggestedName: path.basename(p) || p });
    } catch (e) {
      bus.post('toast', { text: 'Could not open folder picker: ' + e.message });
    }
  });
  bus.on('workspaceAdd', (msg) => {
    if (!msg || typeof msg.path !== 'string' || !path.isAbsolute(msg.path)
        || !fs.existsSync(msg.path)) {
      bus.post('toast', { text: 'That path is not a folder we can open.' });
      return;
    }
    const name = (typeof msg.name === 'string' && msg.name.trim())
      ? msg.name.trim() : (path.basename(msg.path) || msg.path);
    const cur = readWorkspaces();
    const filtered = cur.list.filter((w) => w.path !== msg.path);
    filtered.push({ name, path: msg.path });
    const defPath = cur.defaultPath || msg.path;
    writeWorkspaces({ list: filtered, defaultPath: defPath });
    postWorkspaces();
  });
  bus.on('workspaceRemove', (msg) => {
    if (!msg || typeof msg.path !== 'string') return;
    const cur = readWorkspaces();
    const filtered = cur.list.filter((w) => w.path !== msg.path);
    let defPath = cur.defaultPath;
    if (defPath === msg.path) defPath = filtered[0] ? filtered[0].path : null;
    writeWorkspaces({ list: filtered, defaultPath: defPath });
    postWorkspaces();
  });
  bus.on('workspaceSetDefault', (msg) => {
    if (!msg || typeof msg.path !== 'string' || !fs.existsSync(msg.path)) return;
    const cur = readWorkspaces();
    writeWorkspaces({ list: cur.list, defaultPath: msg.path });
    postWorkspaces();
  });

  // Clicked path in chat → the working view (read-only render; the external
  // open stays behind the view's own ↗). Absolute existing paths only.
  bus.on('artifactOpen', (msg) => {
    if (msg.path && path.isAbsolute(msg.path) && fs.existsSync(msg.path))
      artifacts.candidate(msg.id, msg.path);
    else bus.post('toast', { text: 'path not found: ' + (msg.path || '(empty)') });
  });

  // (VS Code hand-off REMOVED 2026-07-12, the operator's ruling — the vscode:// door
  // only resumes sessions of the workspace VS Code already has open; anywhere
  // else it spawns a FRESH session. "I didn't ask for this." Git keeps the code.)

  // Renderer booted (or RELOADED): rebuild the projection — live seats plus
  // every unanswered permission request (R23, harness-proven gate 2b).
  bus.on('ready', () => {
    host.reannounce();
    postPresets();   // rail buttons rebuild before the roster lands
    bus.post('seatList', { seats: host.list() });
    bus.post('seatHistory', { history: store.chatHistory() });
    postWorkspaces();
    presetConflicts.forEach((text) => bus.post('toast', { text }));
  });
}

function snapshotForRestart() {
  const chats = [];
  const notRestored = [];
  if (!host) return { chats, notRestored };

  for (const seat of host.list()) {
    if (!seat.local && !seat.pty && seat.sessionId) {
      const launch = { permissionMode: seat.mode || 'manual' };
      if (seat.model) launch.model = seat.model;
      if (seat.codexModel) launch.codexModel = seat.codexModel;
      if (seat.effort) launch.effort = seat.effort;
      chats.push({
        persona: seat.persona || 'Seat',
        sessionId: seat.sessionId,
        title: seat.title || seat.persona || 'Seat',
        cwd: seat.cwd || null,   // restart must not jump the chat to another repo
        launch,
      });
    } else if (seat.pty) {
      notRestored.push(seat.title || 'terminal');
    } else if (seat.local) {
      notRestored.push(seat.title || 'local model');
    } else {
      notRestored.push((seat.title || 'Claude chat') + ' (session not ready)');
    }
  }
  return { chats, notRestored };
}

function restoreChats(entries) {
  if (!host || !createFromMessage) return 0;
  const MODELS = new Set(['fable', 'opus', 'sonnet', 'haiku']);
  const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
  const PERMS = new Set(['manual', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions']);
  let restored = 0;

  for (const saved of entries) {
    if (!saved || typeof saved.sessionId !== 'string' || !saved.sessionId) continue;
    const launch = {};
    const raw = saved.launch || {};
    if (MODELS.has(raw.model)) launch.model = raw.model;
    if (['sol', 'terra', 'luna'].includes(raw.codexModel)) launch.codexModel = raw.codexModel;
    if (EFFORTS.has(raw.effort)) launch.effort = raw.effort;
    launch.permissionMode = PERMS.has(raw.permissionMode) ? raw.permissionMode : 'manual';
    createFromMessage({
      persona: typeof saved.persona === 'string' ? saved.persona : 'Seat',
      resume: saved.sessionId,
      title: typeof saved.title === 'string' ? saved.title : '',
      cwd: typeof saved.cwd === 'string' ? saved.cwd : undefined,   // validated downstream
      launch,
    });
    restored++;
  }
  return restored;
}

function dispose() { if (host) host.disposeAll(); }

// Smoke-test affordance only (main.js APEX_SMOKE_PTY): mounts a real ConPTY
// seat headless so CSP/xterm regressions surface in the console-error trap.
function debugCreatePty() {
  if (host) host.create(null, 'smoke-pty',
    { persona: 'smoke-pty', cwd: defaultCwd(),
      launch: { mode: 'pty', command: 'cmd.exe', args: ['/k', 'echo APEX-PTY-SMOKE'] } });
}

module.exports = {
  register,
  dispose,
  defaultCwd,
  debugCreatePty,
  snapshotForRestart,
  restoreChats,
  extensionApi,
  // workflow-layer seam (main/tasks.js) — internal, not part of the ctx surface
  observeSeats,
  createTaskSeat,
  startDisposable,
  presetInfo,
  presetNames,
  seatCommand,
  seatEntry,
  listSeats,
  closeSeat,
};

