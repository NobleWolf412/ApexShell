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
  'drag images into the chat.';

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
  for (const ext of ['.exe', '.cmd', '.bat']) {
    for (const dir of dirs) {
      const candidate = path.join(dir, 'claude' + ext);
      try {
        if (fs.statSync(candidate).isFile())
          return { command: candidate, shell: ext !== '.exe' };
      } catch { /* keep searching PATH */ }
    }
  }
  return { command: 'claude', shell: true };
}

function buildArgs({ resume, model, effort, permissionMode, noSessionPersistence, tools,
                     shell }) {
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
  // Native launches preserve an actual empty argv item. Legacy .cmd/.bat
  // installs still need a shell, where a literal pair of quotes survives the
  // join as the documented empty value instead of disappearing.
  if (tools === '') args.push('--tools', shell ? '""' : '');
  else if (tools !== undefined) args.push('--tools', tools);
  if (resume) args.push('--resume', resume);
  if (model) args.push('--model', model);
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
  const args = buildArgs({
    resume, model, effort, permissionMode, noSessionPersistence, tools, shell: launch.shell,
  });
  const shown = args.map((arg) => arg === '' ? '""' : arg).join(' ');
  log(`spawn: ${launch.command} ${shown}  (cwd=${cwd})`);

  const child = spawn(launch.command, args, {
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
     *  `setModel(e){ this.request({subtype:"set_model", model:e}) }`). */
    setModel(model) {
      write({
        type: 'control_request',
        request_id: `apex-setmodel-${Date.now()}`,
        request: { subtype: 'set_model', model },
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

module.exports = { startSeat, buildArgs, resolveClaudeLaunch, SEAT_ENV_BRIEF, SEAT_WRAPUP_PROMPT };
