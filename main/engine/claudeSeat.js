// Apex seat engine — the Claude stream-json lane (ported from extension/seat.js).
// Spawns the local `claude` CLI with the same contract the official panel uses
// (verified from its shipped bundle + live wire probes, 2026-07-10/11):
//   claude -p --input-format stream-json --output-format stream-json
//          --verbose --include-partial-messages --permission-prompt-tool stdio
// stdout = JSON lines (system/init, assistant, stream_event, result,
// control_request for permissions). stdin = user messages + control_responses.
// Plain Node, zero Electron imports — must run under the headless harness.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Apex's internal mode vocabulary keeps `manual` as the canonical "ask me every
// time" name — the renderer dial, seats.js, seatHost, and the codex policy map
// all speak it. The `claude` CLI names that same mode `default`, and as of the
// 2.1.x line it HARD-REJECTS `manual` as a --permission-mode value ("argument
// 'manual' is invalid", exit 1 on spawn — the "session closed" seat). Translate
// ONLY here, at the CLI boundary; the rest of Apex keeps saying `manual`.
const CLI_PERMISSION_MODE = { manual: 'default' };
const toCliMode = (m) => CLI_PERMISSION_MODE[m] || m;

// Every seat is told how its room works (J20) — without this, seats improvise
// OS-level opens (`code -r`, the browser) when asked to "show" something.
const SEAT_ENV_BRIEF =
  'ENVIRONMENT: You are an embedded chat seat inside "Apex", the user\'s own ' +
  'standalone dashboard app (its own window — not a terminal, not VS Code). ' +
  'Beside your chat sits a WORKING VIEW panel that automatically renders any ' +
  'image (png/jpg/svg/gif/webp) or HTML file the moment you Read or Write it — ' +
  'from any local path, temp files included — and live-refreshes on every ' +
  'further edit. That is THE way to show the user anything visual: save it to ' +
  'a local file if needed, then Read it. Never open files or URLs with ' +
  'external programs (no `code`, no Start-Process, no browser) unless the ' +
  'user explicitly asks for an external window. The user can also paste or ' +
  'drag images into the chat. The dashboard also has a TODO board: to put a ' +
  'plan/checklist on it (or refresh yours), end a message with a fenced code ' +
  'block tagged apex-todo containing JSON {"title": "...", "plan": ["step", ' +
  '...], "done": [completed 0-based indexes]} — never a todo file. Re-emit ' +
  'the full block with updated "done" as work progresses.';

// The End-Session close-out ask wraps the seat before it dies. This is the
// generic default; a host extension may pass its own wrapPrompt to
// createSeatHost for its own persistence contract.
const SEAT_WRAPUP_PROMPT =
  '[seat-wrapup] The user pressed End Session — this seat closes after this ' +
  'turn. Do the close-out now: (1) Tie up loose ends from this session — ' +
  'finish or safely park in-flight work; commit anything that should not be ' +
  'lost. (2) Leave a short handoff as your final message: the state, the ' +
  'decisions made, and the next steps a future session would need to pick ' +
  'this up cold. If there is genuinely nothing to tie up or record, say so ' +
  'in one line.';

/**
 * Start an owned Claude seat.
 * @param {object} opts
 *   cwd        — working directory for the seat (project instructions load there).
 *   log        — (line) => void   raw wire + lifecycle logging (debug-ready duty).
 *   onEvent    — (evt)  => void   every parsed stdout JSON event.
 *   onExit     — (code) => void   process ended.
 *   resume     — session id to continue (transcript backfill is the host's job).
 *   model / effort / permissionMode — per-persona launch config (J21).
 */
function resolveClaudeLaunch() {
  if (process.platform !== 'win32') return { command: 'claude', shell: false };
  const dirs = String(process.env.PATH || '').split(path.delimiter)
    .map((entry) => entry.replace(/^"|"$/g, '')).filter(Boolean);
  const findOnPath = (name) => {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      try { if (fs.statSync(candidate).isFile()) return candidate; }
      catch { /* keep searching PATH */ }
    }
    return null;
  };
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const exe = findOnPath('claude.exe');
  if (exe) return { command: exe, shell: false };
  for (const ext of ['.cmd', '.bat']) {
    const shim = findOnPath('claude' + ext);
    if (!shim) continue;
    // npm shim install. Prefer spawning what the shim wraps DIRECTLY —
    // shell:true joins argv unquoted, so cmd.exe re-splits multi-word args
    // (the --append-system-prompt brief). Two known package layouts (this
    // machine ships the bundled-exe one — shim body verified 2026-07-16):
    const pkg = path.join(path.dirname(shim),
      'node_modules', '@anthropic-ai', 'claude-code');
    const bundledExe = path.join(pkg, 'bin', 'claude.exe');
    if (isFile(bundledExe)) return { command: bundledExe, shell: false };
    const cli = path.join(pkg, 'cli.js');
    const node = findOnPath('node.exe');
    if (node && isFile(cli)) return { command: node, argsPrefix: [cli], shell: false };
    return { command: shim, shell: true };
  }
  return { command: 'claude', shell: true };
}

// cmd.exe path only: Node's shell:true joins argv with spaces and never quotes
// items. Quote per CommandLineToArgvW rules — the CLI is a Node program parsing
// standard argv, so backslash-doubling before an embedded quote is correct.
// Residual hazard (documented, accepted): %VAR% expands inside cmd quotes; no
// seat arg carries a literal % today.
function quoteForCmd(arg) {
  const s = String(arg);
  if (s === '') return '""';
  if (!/[\s"^&|<>()]/.test(s)) return s;
  // double backslash-runs before an embedded quote, escape the quote; then
  // double a trailing run so it can't swallow the closing quote we add.
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

// Aliases the CLI does NOT resolve on some paths — the wire gets the full ID,
// the app keeps the short name. set_model never knew 'fable' (wire-verified
// 2026-07-16); by 2026-07-17 LAUNCH `--model fable` fails the same way
// (headless-verified: alias errors "may not exist", full ID answers fine).
// One map, used by both the launch args and the live dial. Extend it when a
// new model's alias misbehaves; older aliases (opus/sonnet/haiku) resolve.
const WIRE_MODEL = { fable: 'claude-fable-5' };

function buildArgs({ resume, model, effort, permissionMode, noSessionPersistence, tools,
                     disallowedTools }) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool', 'stdio',
    '--append-system-prompt', SEAT_ENV_BRIEF,
  ];
  if (noSessionPersistence) args.push('--no-session-persistence');
  // buildArgs stays pure argv — an empty --tools value is a real empty item
  // here. The shell:true fallback path quotes EVERY arg at spawn (quoteForCmd),
  // which turns the empty item into the literal "" the join needs.
  if (tools !== undefined) args.push('--tools', tools);
  // Hard deny-rules (e.g. an advisor persona's wall against serena's
  // symbol-EDIT tools — --tools only governs the BUILT-IN set; MCP tools ride
  // along regardless, wire-verified 2026-07-17).
  if (disallowedTools) args.push('--disallowed-tools', disallowedTools);
  if (resume) args.push('--resume', resume);
  if (model) args.push('--model', WIRE_MODEL[model] || model);
  if (effort) args.push('--effort', effort);
  // ALWAYS explicit (J21/J28) — and the fallback is `manual`, never a
  // don't-ask mode. The shipped-`auto` default was R20's whole story.
  // `manual` is Apex-internal; the CLI wants `default` (toCliMode).
  args.push('--permission-mode', toCliMode(permissionMode || 'manual'));
  return args;
}

function startSeat({ cwd, log, onEvent, onExit, resume, model, effort, permissionMode,
                     noSessionPersistence, tools }) {
  const launch = resolveClaudeLaunch();
  const args = [
    ...(launch.argsPrefix || []),   // node.exe shim bypass: [cli.js] rides in front
    ...buildArgs({ resume, model, effort, permissionMode, noSessionPersistence, tools }),
  ];
  const spawnArgs = launch.shell ? args.map(quoteForCmd) : args;
  const shown = args.map((arg) => arg === '' ? '""' : arg).join(' ');
  log(`spawn: ${launch.command} ${shown}  (cwd=${cwd})`);

  const child = spawn(launch.command, spawnArgs, {
    cwd,
    shell: launch.shell,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      log(`« ${line.length > 2000 ? line.slice(0, 2000) + '…[truncated]' : line}`);
      try { onEvent(JSON.parse(line)); }
      catch { log(`   (unparseable line ignored)`); }
    }
  });
  child.stderr.on('data', (c) => log(`stderr: ${c.toString('utf8').trim()}`));
  child.on('exit', (code) => { log(`exit: ${code}`); onExit(code); });
  child.on('error', (err) => { log(`spawn error: ${err.message}`); onExit(-1); });

  const write = (obj) => {
    const line = JSON.stringify(obj);
    log(`» ${line.length > 2000 ? line.slice(0, 2000) + '…[truncated]' : line}`);
    child.stdin.write(line + '\n');
  };

  return {
    /** Send a user turn — a plain string, or an API content-block array
     *  (text + base64 images from paste/drop). */
    send(content) {
      write({ type: 'user', message: { role: 'user', content } });
    },

    /** Answer a can_use_tool control_request. allow=false ⇒ deny with message.
     *  `updates` (optional) carries PermissionUpdate objects the CLI then applies
     *  to its rule set — this is how "always allow" actually persists (J46).
     *  Bundle-verified shape: {type:'addRules', rules:[{toolName, ruleContent}],
     *  behavior:'allow'|'deny'|'ask',
     *  destination:'userSettings'|'projectSettings'|'localSettings'|'session'}. */
    respondPermission(requestId, allow, input, updates) {
      const ok = { behavior: 'allow', updatedInput: input };
      if (allow && Array.isArray(updates) && updates.length) ok.updatedPermissions = updates;
      write({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: allow ? ok : { behavior: 'deny', message: 'Denied from the Apex panel.' },
        },
      });
    },

    /** Change THIS seat's permission mode while it runs (R26).
     *  The launch flag is only a starting value — the official panel changes
     *  mode live via this same control subtype (verified in its 2.1.207 bundle:
     *  `setPermissionMode(m){ this.request({subtype:"set_permission_mode", mode:m}) }`).
     *  Modes (Apex-internal): 'manual' | 'auto' | 'acceptEdits' |
     *  'bypassPermissions'. `manual` is mapped to the CLI's `default` at the
     *  wire, same as the launch flag — the control channel rejects `manual` too. */
    setPermissionMode(mode) {
      write({
        type: 'control_request',
        request_id: `apex-mode-${Date.now()}`,
        request: { subtype: 'set_permission_mode', mode: toCliMode(mode) },
      });
    },

    /** Change THIS seat's model live (bundle-verified 2.1.207:
     *  `setModel(e){ this.request({subtype:"set_model", model:e}) }`).
     *  Alias resolution is broken for some models on this path (and now at
     *  launch too) — WIRE_MODEL above is the single shared map. */
    setModel(model) {
      write({
        type: 'control_request',
        request_id: `apex-setmodel-${Date.now()}`,
        request: { subtype: 'set_model', model: WIRE_MODEL[model] || model },
      });
    },

    /** Best-effort interrupt of the current turn. */
    interrupt() {
      write({
        type: 'control_request',
        request_id: `apex-int-${Date.now()}`,
        request: { subtype: 'interrupt' },
      });
    },

    /** End the seat. Closing stdin lets -p mode exit clean; kill is the backstop.
     *  The backstop must take the TREE: shell:true makes `child` the cmd shim,
     *  and child.kill() reaped only the shim — the real claude process under it
     *  survived, kept streaming through the inherited pipe (the ✕-during-load
     *  ghost's engine, 2026-07-14) and kept burning the in-flight turn. */
    dispose() {
      try { child.stdin.end(); } catch { /* already gone */ }
      setTimeout(() => {
        if (child.exitCode !== null || child.signalCode) return;   // already exited clean
        if (process.platform === 'win32' && child.pid) {
          try {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'],
                  { windowsHide: true, stdio: 'ignore' }).unref();
          } catch { /* already gone */ }
        } else {
          try { child.kill(); } catch { /* already gone */ }
        }
      }, 1500);
    },
  };
}

module.exports = { startSeat, buildArgs, resolveClaudeLaunch, quoteForCmd,
                   SEAT_ENV_BRIEF, SEAT_WRAPUP_PROMPT };
