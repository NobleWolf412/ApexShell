// Apex seat engine — the PTY lane (R25). A GENUINE interactive terminal:
// node-pty/ConPTY spawns the CLI exactly as a human console would, so the
// session is subscription-lane by construction (invocation mode decides the
// billing lane — the pricing-fork finding). Two tenants day one:
//   claude  — the escape hatch if the programmatic lane ever un-pauses (R7)
//   agy     — Gemini's ONLY viable shape (issue #76: non-TTY = silent hang)
// Same seam surface as the other lanes where it makes sense; PTY-specific
// verbs (write/resize) ride alongside. Plain Node, no Electron imports.

let pty = null;
let ptyErr = null;
try { pty = require('node-pty'); }
catch (e) { ptyErr = e.message; }

const fs = require('fs');
const path = require('path');

/**
 * @param {object} opts
 *   command / args — the CLI to seat (e.g. 'claude', ['--model','haiku']).
 *   cwd            — working directory for the terminal tenant.
 *   cols / rows    — initial size (the view refits immediately after mount).
 *   log            — (line) => void
 *   onEvent        — (evt) => void   {type:'ptyData', data} chunks.
 *   onExit         — (code) => void
 */
function startPtySeat({ command, args, cwd, cols, rows, log, onEvent, onExit }) {
  if (!pty) {
    log(`pty unavailable: ${ptyErr}`);
    setTimeout(() => {
      onEvent({ type: 'ptyData', data: `\r\n  node-pty failed to load: ${ptyErr}\r\n` });
      onExit(-1);
    }, 0);
    return { write() {}, resize() {}, send() {}, respondPermission() {}, interrupt() {}, dispose() {} };
  }

  // ELECTRON_RUN_AS_NODE bleeds from VS-Code-hosted shells (platform-watch,
  // 2026-07-12) — never let a seated CLI inherit it.
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;

  // ConPTY's startProcess wants a real executable — `claude`/`agy` style .cmd
  // shims fail with "File not found" (the shell:true equivalent for a PTY is
  // hosting the command under cmd.exe).
  let file = command, fileArgs = args || [];
  if (process.platform === 'win32' && !/\.exe$/i.test(command)) {
    file = 'cmd.exe';
    fileArgs = ['/c', command, ...(args || [])];
  }
  log(`pty spawn: ${file} ${fileArgs.join(' ')}  (cwd=${cwd}, ${cols || 120}x${rows || 30})`);
  // node-pty throws SYNCHRONOUSLY on ConPTY / bad-cwd failure — unlike the
  // async lanes (child.on('error')). Unwrapped, that unwinds into
  // seatHost.create(), which has no catch. Fail like the pty-unavailable path:
  // an async dead seat, never a thrown create. (Structural audit C1, 2026-07-17.)
  let p;
  try {
    p = pty.spawn(file, fileArgs, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 30,
      cwd,
      env,
      useConpty: true,
    });
  } catch (e) {
    log(`pty spawn failed: ${e.message}`);
    setTimeout(() => {
      onEvent({ type: 'ptyData', data: `\r\n  terminal failed to start: ${e.message}\r\n` });
      onExit(-1);
    }, 0);
    return { write() {}, resize() {}, send() {}, respondPermission() {}, interrupt() {}, dispose() {} };
  }

  // Tee the terminal byte stream to state/transcripts/ so downstream tools can
  // archive PTY sessions (agy et al. — whose native stores are unparseable)
  // into the wiki. Raw bytes with ANSI; intake strips at ingest. Capture must
  // never break the terminal — every write is try-swallowed.
  const sessId = 'pty-' + Date.now().toString(36);
  const tDir = path.resolve(__dirname, '..', '..', 'state', 'transcripts');
  const tenant = path.basename(String(command)).replace(/\.(cmd|exe|bat)$/i, '');
  let captureOk = false;
  try {
    fs.mkdirSync(tDir, { recursive: true });
    fs.writeFileSync(path.join(tDir, sessId + '.meta.json'), JSON.stringify({
      kind: 'pty', id: sessId, tenant,
      command: [command, ...(args || [])].join(' '),
      started: new Date().toISOString(),
    }, null, 2));
    captureOk = true;
  } catch (e) { log('pty capture disabled: ' + e.message); }
  const capture = (data) => {
    if (!captureOk) return;
    try { fs.appendFileSync(path.join(tDir, sessId + '.pty.log'), data); }
    catch { captureOk = false; }
  };

  p.onData((data) => { capture(data); onEvent({ type: 'ptyData', data }); });
  p.onExit(({ exitCode }) => { log(`pty exit: ${exitCode}`); onExit(exitCode); });

  return {
    /** Raw keystrokes from the terminal view. */
    write(data) { p.write(data); },
    resize(cols2, rows2) {
      try { p.resize(Math.max(2, cols2), Math.max(2, rows2)); } catch { /* racing exit */ }
    },
    /** Seam parity: a plain-text send lands as typed input + Enter. */
    send(content) {
      const text = typeof content === 'string' ? content
        : ((Array.isArray(content) && (content.find((b) => b.type === 'text') || {}).text) || '');
      if (text) p.write(text + '\r');
    },
    respondPermission() { /* no permission protocol — the human IS the gate here */ },
    interrupt() { p.write('\x03'); },
    dispose() { try { p.kill(); } catch { /* already gone */ } },
  };
}

module.exports = { startPtySeat, ptyAvailable: () => !!pty };
