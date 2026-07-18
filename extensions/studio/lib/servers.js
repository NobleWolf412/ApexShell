// STUDIO (App Builder) — Wave B slice B1: the dev-server runner. Three jobs,
// all extension-side, all hermetically drillable:
//
//   1. Per-project launch config {command, args, cwd, port, readyRegex}
//      persisted machine-side in state/extensions/studio/servers.json — the
//      workspace.json/A2 discipline verbatim: schema-versioned, same-dir temp
//      + exclusive-flag write, atomic rename, and NEVER in the portable
//      package (a launch line is this machine's business, not the project's).
//   2. A lifecycle state machine (stopped → starting → ready → stopped/failed)
//      per project, driven through an injectable spawner seam: production uses
//      child_process (a plain node builtin — extension main halves use those
//      the same way personas use fs), drills inject a stub and never launch a
//      real process. Ready detection is readyRegex over stdout/stderr lines,
//      with a port-listen probe and a hard fallback timeout behind it; a
//      bounded ring keeps the last LOG_RING_MAX lines.
//   3. Guards. The cwd a server runs in must sit inside an allowed root
//      (the projects workspace or a registered workspace — main.js supplies
//      the list); commands spawn with an args ARRAY and shell:false, so a
//      hostile "command" string can never smuggle a second command through
//      shell interpolation — there is no shell line to interpolate into.
//
// Stop is a TREE kill: on Windows `taskkill /pid <pid> /T /F` (the
// main/engine/claudeSeat.js dispose idiom — child.kill() alone reaps only the
// npm shim and orphans the real server under it); on POSIX the child is
// spawned detached (a process-group leader) so kill(-pid) takes the group.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const contract = require('./contract');

const SERVERS_FILE = 'servers.json';
const LOG_RING_MAX = 400;      // the spec'd bound: last 400 lines, oldest drop
const LOG_TAIL = 25;           // lines a projectsServerState post carries
const MAX_COMMAND = 200;
const MAX_ARGS = 32;
const MAX_ARG = 200;
const MAX_REGEX = 200;
const MAX_LINE = 500;          // one line's cap — a minified bundle dump must not eat the ring
const READY_TIMEOUT_MS = 60 * 1000;   // fallback: assume up rather than kill a slow server
const PORT_POLL_MS = 1000;

// ---- config persistence ----------------------------------------------------

function serversPath(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir))
    throw new Error('App Builder state directory must be absolute.');
  return path.join(stateDir, SERVERS_FILE);
}

// Fail-closed shape validation for ONE launch config. Throws plain-language
// errors (they surface verbatim in the RUN drawer).
function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Launch config must be an object.');
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) throw new Error('Launch config needs a command (the executable alone — arguments go in args).');
  if (command.length > MAX_COMMAND)
    throw new Error('Command is longer than ' + MAX_COMMAND + ' characters.');
  const rawArgs = raw.args === undefined || raw.args === null ? [] : raw.args;
  if (!Array.isArray(rawArgs))
    throw new Error('Launch args must be an array of strings — never one shell line.');
  if (rawArgs.length > MAX_ARGS)
    throw new Error('Launch config allows at most ' + MAX_ARGS + ' arguments.');
  const args = rawArgs.map((a) => {
    if (typeof a !== 'string') throw new Error('Every launch argument must be a string.');
    if (a.length > MAX_ARG) throw new Error('An argument is longer than ' + MAX_ARG + ' characters.');
    return a;
  });
  const cwd = raw.cwd === undefined || raw.cwd === null || raw.cwd === '' ? null : raw.cwd;
  if (cwd !== null && (typeof cwd !== 'string' || !path.isAbsolute(cwd)))
    throw new Error('The launch cwd must be an absolute path (or empty for the project folder).');
  const port = raw.port === undefined || raw.port === null || raw.port === '' ? null : raw.port;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('Port must be a whole number between 1 and 65535.');
  const readyRegex = raw.readyRegex === undefined || raw.readyRegex === null || raw.readyRegex === ''
    ? null : raw.readyRegex;
  if (readyRegex !== null) {
    if (typeof readyRegex !== 'string' || readyRegex.length > MAX_REGEX)
      throw new Error('The ready pattern must be a string of at most ' + MAX_REGEX + ' characters.');
    try { new RegExp(readyRegex); }   // a bad pattern fails HERE, not mid-stream
    catch (err) { throw new Error('The ready pattern is not a valid regular expression: ' + err.message); }
  }
  return { command, args, cwd, port, readyRegex };
}

// The whole file, fail-soft: a corrupt/wrong-schema file reads as empty with
// the story attached — machine-local convenience config, never worth a crash.
function readServerConfigs(stateDir) {
  const file = serversPath(stateDir);
  if (!fs.existsSync(file)) return { servers: {}, error: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schema !== 1) throw new Error('schema must be 1');
    if (!parsed.servers || typeof parsed.servers !== 'object' || Array.isArray(parsed.servers))
      throw new Error('servers must be an object');
    const servers = {};
    for (const [projectId, config] of Object.entries(parsed.servers)) {
      if (!contract.isSafeProjectId(projectId)) continue;
      try { servers[projectId] = normalizeConfig(config); } catch { /* skip the bad row, keep the rest */ }
    }
    return { servers, error: null };
  } catch (err) {
    return { servers: {}, error: 'Saved server configs are invalid: ' + err.message };
  }
}

function readServerConfig(stateDir, projectId) {
  if (!contract.isSafeProjectId(projectId)) return null;
  return readServerConfigs(stateDir).servers[projectId] || null;
}

function writeServerConfig(stateDir, projectId, config) {
  if (!contract.isSafeProjectId(projectId)) throw new Error('That is not a valid project id.');
  const clean = normalizeConfig(config);
  const servers = readServerConfigs(stateDir).servers;   // a corrupt file starts over — nothing salvageable
  servers[projectId] = clean;

  fs.mkdirSync(stateDir, { recursive: true });
  const destination = serversPath(stateDir);
  const temporary = path.join(stateDir, `.${SERVERS_FILE}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify({ schema: 1, servers }, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    });
    fs.renameSync(temporary, destination);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
  return clean;
}

// ---- containment -----------------------------------------------------------

// The cwd guard: a dev server may only run inside one of the allowed roots
// (main.js supplies the projects workspace + the registered workspaces).
// contract.isInside is the same path.relative containment the package writer
// trusts — prefix confusion (C:\ws-evil vs C:\ws) and ..-traversal both fail.
function isCwdContained(cwd, allowedRoots) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false;
  return (Array.isArray(allowedRoots) ? allowedRoots : []).some((root) =>
    typeof root === 'string' && path.isAbsolute(root) && contract.isInside(root, cwd));
}

function assertCwdContained(cwd, allowedRoots) {
  if (!isCwdContained(cwd, allowedRoots))
    throw new Error('The dev server cwd must be inside the projects workspace or a registered workspace.');
}

// ---- production seams (injectable — drills stub both) ----------------------

const defaultSpawner = {
  spawn(command, args, opts) {
    return require('child_process').spawn(command, args, opts);
  },
  // The claudeSeat.js dispose idiom (that file stays untouched): Windows reaps
  // the whole tree via taskkill /T /F — child.kill() alone kills only the npm
  // shim and the real server under it survives as an orphan. POSIX: the child
  // was spawned detached (a process-group leader), so kill(-pid) takes the
  // group; plain child.kill is the last resort.
  kill(child) {
    if (!child || child.exitCode !== null || child.signalCode) return;   // already exited clean
    if (process.platform === 'win32' && child.pid) {
      try {
        require('child_process').spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' }).unref();
      } catch { /* already gone */ }
    } else if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    }
  },
};

// One TCP connect attempt against localhost:<port> — the fallback "is anything
// listening yet" signal for servers whose banner matches no regex.
function defaultPortProbe(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (up) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* closing anyway */ }
      resolve(up);
    };
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(800, () => done(false));
  });
}

// ---- the lifecycle manager -------------------------------------------------

// createServerManager({ spawner?, onState?, onLog?, portProbe?,
//                       readyTimeoutMs?, portPollMs? })
//   → { start({projectId, config, fallbackCwd, allowedRoots}), stop(projectId),
//       stopAll(), state(projectId), running() }
//
// Every phase change calls onState with the projectsServerState payload shape
// {projectId, phase, port, logTail, error}; every batch of new log lines calls
// onLog with {projectId, lines}. All timers are unref'd so a forgotten server
// can never hold the process (or a drill) open.
function createServerManager(options = {}) {
  const spawner = options.spawner || defaultSpawner;
  const onState = typeof options.onState === 'function' ? options.onState : () => {};
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
  const portProbe = options.portProbe || defaultPortProbe;
  const readyTimeoutMs = options.readyTimeoutMs || READY_TIMEOUT_MS;
  const portPollMs = options.portPollMs || PORT_POLL_MS;

  const entries = new Map();   // projectId -> { child, phase, port, ring, ... }

  const stateOf = (projectId) => {
    const e = entries.get(projectId);
    return {
      projectId,
      phase: e ? e.phase : 'stopped',
      port: e ? e.port : null,
      logTail: e ? e.ring.slice(-LOG_TAIL) : [],
      logSize: e ? e.ring.length : 0,   // ring occupancy — proves the cap holds
      error: null,
    };
  };
  const emit = (projectId) => onState(stateOf(projectId));

  const clearTimers = (e) => {
    if (e.pollTimer) { clearInterval(e.pollTimer); e.pollTimer = null; }
    if (e.readyTimer) { clearTimeout(e.readyTimer); e.readyTimer = null; }
  };

  // Ring push + delta post, batched per call. The ring drops from the FRONT —
  // the tail is always the most recent LOG_RING_MAX lines.
  const addLines = (e, lines) => {
    if (!lines.length) return;
    const capped = lines.map((line) => line.length > MAX_LINE ? line.slice(0, MAX_LINE) + '…' : line);
    e.ring.push(...capped);
    if (e.ring.length > LOG_RING_MAX) e.ring.splice(0, e.ring.length - LOG_RING_MAX);
    onLog({ projectId: e.projectId, lines: capped });
  };

  const markReady = (e, note) => {
    if (e.phase !== 'starting') return;   // ready is only reachable from starting
    clearTimers(e);
    if (note) addLines(e, [note]);
    e.phase = 'ready';
    emit(e.projectId);
  };

  // One buffered line-splitter per stream; regex ready-detection rides it.
  const wireStream = (e, stream, regex) => {
    if (!stream || typeof stream.on !== 'function') return;
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const lines = [];
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        lines.push(buf.slice(0, nl).replace(/\r$/, ''));
        buf = buf.slice(nl + 1);
      }
      if (!lines.length) return;
      addLines(e, lines);
      if (regex && e.phase === 'starting' && lines.some((line) => regex.test(line)))
        markReady(e);
    });
  };

  function start({ projectId, config, fallbackCwd, allowedRoots }) {
    if (!contract.isSafeProjectId(projectId)) throw new Error('That is not a valid project id.');
    const existing = entries.get(projectId);
    if (existing && (existing.phase === 'starting' || existing.phase === 'ready'))
      throw new Error('The dev server is already running — stop it first.');
    const clean = normalizeConfig(config);
    const cwd = clean.cwd || fallbackCwd;
    assertCwdContained(cwd, allowedRoots);
    const regex = clean.readyRegex ? new RegExp(clean.readyRegex) : null;

    // args ARRAY + shell:false is the whole no-injection guarantee: whatever a
    // hostile config puts in `command` stays ONE executable token — nothing
    // here ever joins command and args into a line a shell could re-split.
    const child = spawner.spawn(clean.command, clean.args.slice(), {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      // POSIX: process-group leader so the default kill's kill(-pid) reaps the
      // tree; Windows reaps via taskkill /T instead (defaultSpawner.kill).
      detached: process.platform !== 'win32',
    });

    const e = {
      projectId, child, phase: 'starting', port: clean.port, ring: [],
      userStopped: false, pollTimer: null, readyTimer: null,
    };
    entries.set(projectId, e);

    wireStream(e, child.stdout, regex);
    wireStream(e, child.stderr, regex);

    if (typeof child.on === 'function') {
      child.on('error', (err) => {        // spawn failure (ENOENT etc), pre-exit
        if (e.phase === 'stopped' || e.phase === 'failed') return;
        clearTimers(e);
        addLines(e, ['[apex] launch failed: ' + err.message]);
        e.phase = 'failed';
        emit(e.projectId);
      });
      child.on('exit', (code, signal) => {
        clearTimers(e);
        if (e.phase === 'stopped' || e.phase === 'failed') return;   // stop()/error already told the story
        addLines(e, ['[apex] process exited' +
          (code !== null && code !== undefined ? ' (code ' + code + ')' : signal ? ' (' + signal + ')' : '')]);
        e.phase = code === 0 ? 'stopped' : 'failed';
        emit(e.projectId);
      });
    }

    // Fallback ready detection: a port-listen probe while starting, and a hard
    // timeout that ASSUMES up rather than killing a slow server — an honest
    // note lands in the log either way the regex never fired.
    if (clean.port) {
      e.pollTimer = setInterval(() => {
        portProbe(clean.port).then((up) => { if (up) markReady(e); }).catch(() => { /* keep polling */ });
      }, portPollMs);
      if (typeof e.pollTimer.unref === 'function') e.pollTimer.unref();
    }
    e.readyTimer = setTimeout(
      () => markReady(e, '[apex] ready detection timed out — assuming the server is up'),
      readyTimeoutMs);
    if (typeof e.readyTimer.unref === 'function') e.readyTimer.unref();

    emit(projectId);
    return stateOf(projectId);
  }

  function stop(projectId) {
    const e = entries.get(projectId);
    if (!e || (e.phase !== 'starting' && e.phase !== 'ready'))
      throw new Error('The dev server is not running.');
    e.userStopped = true;
    clearTimers(e);
    try { spawner.kill(e.child); } catch { /* already gone */ }
    addLines(e, ['[apex] stopped']);
    e.phase = 'stopped';
    emit(projectId);
    return stateOf(projectId);
  }

  // The dispose path: every live server dies (extension dispose, app quit).
  function stopAll() {
    let killed = 0;
    for (const projectId of [...entries.keys()]) {
      const e = entries.get(projectId);
      if (e.phase === 'starting' || e.phase === 'ready') {
        try { stop(projectId); killed++; } catch { /* dying anyway */ }
      }
    }
    return killed;
  }

  const running = () => [...entries.values()]
    .filter((e) => e.phase === 'starting' || e.phase === 'ready')
    .map((e) => e.projectId);

  return { start, stop, stopAll, state: stateOf, running };
}

module.exports = {
  SERVERS_FILE,
  LOG_RING_MAX,
  LOG_TAIL,
  READY_TIMEOUT_MS,
  PORT_POLL_MS,
  serversPath,
  normalizeConfig,
  readServerConfigs,
  readServerConfig,
  writeServerConfig,
  isCwdContained,
  assertCwdContained,
  defaultSpawner,
  defaultPortProbe,
  createServerManager,
};
