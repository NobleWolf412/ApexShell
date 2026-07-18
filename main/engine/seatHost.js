// Apex seat engine — the seat host (ported from extension/seats.js, vendor-neutral).
// Owns the seat processes and speaks a projection stream to whatever view is
// attached (Electron renderer via ipc, or the headless harness):
//   host → view: {type:'seatNew', id, title} · {type:'seatEvt', id, m:<view vocab>}
//                · {type:'seatTitle', id, title}
//   view → host: handle({type:'seatSend'|'seatPerm'|'seatStop'|'seatClose'|'seatMode', id, …})
// View vocab: init / user / block / delta / text / thinkingTick / tool /
// permission / artifactCandidate / result / dead.
//
// Engine seam rules (standalone-app-plan §3): ZERO Electron imports — plain
// Node, headless-drivable. The VS Code hand-off and the working-view watcher
// live OUTSIDE the engine (app-level concerns); artifactCandidate events are
// forwarded raw for the host app to act on.
//
// R23, dissolved by architecture: the HOST owns every pending permission
// request in a per-seat FIFO (J24: queue, never a scalar). The view is a
// projection — reannounce() replays live seats AND their pending requests,
// so a view reload can never orphan a turn.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startSeat, SEAT_ENV_BRIEF, SEAT_WRAPUP_PROMPT } = require('./claudeSeat');
const { startCodexSeat } = require('./codexSeat');
const { startLocalSeat } = require('./localSeat');
const { startPtySeat } = require('./ptySeat');
const { backfill } = require('./transcripts');

let nextId = 1;
let nextDisposableId = 1;

// Context windows learned from live results (modelUsage.contextWindow), keyed
// by full model name. Transcripts carry per-message usage but NOT the window —
// this map lets a resumed chat's meter show a ceiling immediately. Wire-truth
// only, never guessed; persisted (opts.windowsFile) because an app restart
// otherwise forgets every ceiling and resumed meters sit blank until the
// first completed turn (the operator, 2026-07-13).
const MODEL_WINDOWS = new Map();
let windowsFile = null;
function learnWindow(name, w) {
  if (!w || MODEL_WINDOWS.get(name) === w) return;
  MODEL_WINDOWS.set(name, w);
  if (windowsFile) {
    try { fs.writeFileSync(windowsFile, JSON.stringify(Object.fromEntries(MODEL_WINDOWS))); }
    catch { /* meter degrades to learn-per-run; never break the wire for it */ }
  }
}

// Working-view rendering kinds (J17/J18). The engine only classifies which
// tool calls are artifact candidates; rendering is the app's business.
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const isHtml = (e) => e === 'html' || e === 'htm';

/**
 * @param {object} opts
 *   apexRoot     — fallback cwd for spawned seats when a create passes none
 *                  (the host app usually resolves cwd per-create).
 *   wrapPrompt   — string or () => string: the End-Session close-out text.
 *                  Falls back to the generic SEAT_WRAPUP_PROMPT.
 *   emit         — (msg) => void  the projection stream to the attached view.
 *   log          — (line) => void wire + lifecycle log (debug-ready duty).
 *   onChange     — () => void     roster changed (create/close/title).
 *   record       — (persona, sessionId, title) => void  history index hook
 *                  (storage adapter injected by the host app — J16).
 *   projectsRoot — transcript store override (default ~/.claude/projects).
 */
function createSeatHost({ apexRoot, emit, log, onChange, record, projectsRoot,
                          windowsFile: wf, wrapPrompt, transcriptsDir }) {
  const wrapText = () =>
    (typeof wrapPrompt === 'function' ? wrapPrompt() : wrapPrompt) || SEAT_WRAPUP_PROMPT;
  const seats = new Map();   // id -> entry
  const disposables = new Set();
  const transcriptsRoot = projectsRoot || path.join(os.homedir(), '.claude', 'projects');
  // Host-injected transcript dir for the local/pty lanes — the engine no longer
  // computes an app-relative path itself (audit M4). Harness default = a temp
  // dir, so a headless/relocated run never writes beside the engine file.
  const localTranscripts = transcriptsDir || path.join(os.tmpdir(), 'apex-transcripts');
  if (wf) {
    windowsFile = wf;
    try {
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(wf, 'utf8'))))
        if (typeof v === 'number' && v > 0) MODEL_WINDOWS.set(k, v);
    } catch { /* first run — the file appears on the first learned window */ }
  }
  const changed = () => { if (onChange) onChange(); };
  const post = (m) => emit(m);

  function create(kickoff, title, opts = {}) {
    const id = 's' + (nextId++);
    const entry = {
      seat: null, title: title || 'Seat', persona: opts.persona || 'Seat',
      // A resumed seat KEEPS its session id (wire-verified: --resume <id> →
      // init reports the same id) — seed it at create instead of waiting for
      // init, because a resumed CLI is MUTE until its first input (J8): a
      // boot-restored seat would otherwise sit blank until the user types
      // (the 2026-07-14 restore saga — replay had nothing to key on).
      sessionId: opts.resume || null, autoTitled: !!opts.resume, local: false,
      // which repo/folder this seat works out of — rides every announcement so
      // the view can badge and group chats by repo (multi-repo work)
      cwd: opts.cwd || apexRoot,
      permQueue: [],           // pending can_use_tool requests — host-owned (R23)
      // the seat's CURRENT dials — host-owned truth (R26 pattern); launch
      // flags are only starting values
      mode: (opts.launch && opts.launch.permissionMode) || 'manual',
      model: (opts.launch && opts.launch.model) || '',
      // codex tier alias (sol/terra/luna) — separate from `model`, which stays
      // 'codex' as the LANE marker (relaunch/restore route on it)
      codexModel: (opts.launch && opts.launch.codexModel) || '',
      effort: (opts.launch && opts.launch.effort) || '',
      // A requested-but-unconfirmed dial change. It becomes truth only when the
      // CLI says so (J44) — the host never promotes its own hope to fact.
      modeWanted: null, modelWanted: null,
      // `--resume` DROPS --append-system-prompt (proven headless 2026-07-12;
      // found when a resumed seat misidentified itself) — the env brief rides
      // the first user turn instead, invisibly (wire ≠ bubble; the '<' prefix
      // keeps it out of future backfills too). Codex seats have no
      // append-system-prompt equivalent wired, so the brief rides their first
      // user turn always.
      needsEnvBrief: !!opts.resume || !!(opts.launch && opts.launch.model === 'codex'),
      // set by seatClose BEFORE dispose — a closing seat's stream doesn't stop
      // instantly (stdin-end grace, kill backstop, in-flight pipe data), and
      // every straggler event resurrected the removed chat as a blank "Seat"
      // ghost tab (the operator's ✕-during-load, 2026-07-14). Closed = view-silent.
      closed: false,
      ts: Date.now(),
    };
    const postM = (m) => {
      if (entry.closed) {
        // the tail of a closed seat: drop everything view-bound, but keep the
        // history record — the session is real on disk and stays resumable
        // even when its chat was ✕'d at birth
        if (m.type === 'init' && !entry.local) {
          entry.sessionId = m.sessionId;
          if (record) record(entry.persona, m.sessionId, entry.title, entry.cwd);
        }
        return;
      }
      // Dial verdicts never reach the chat feed — they settle host truth and
      // re-echo it, so what the header shows is what the CLI actually did (J44).
      if (m.type === 'controlResult') {
        if (m.kind === 'mode') {
          if (m.ok && entry.modeWanted) entry.mode = entry.modeWanted;
          entry.modeWanted = null;
          post({ type: 'seatMode', id, mode: entry.mode, error: m.ok ? '' : m.error });
        } else if (entry.codexLane) {
          // codex tier settles into codexModel — entry.model stays 'codex'
          if (m.ok && entry.modelWanted) entry.codexModel = entry.modelWanted;
          entry.modelWanted = null;
          post({ type: 'seatModel', id, model: entry.codexModel, error: m.ok ? '' : m.error });
        } else {
          if (m.ok && entry.modelWanted) entry.model = entry.modelWanted;
          entry.modelWanted = null;
          post({ type: 'seatModel', id, model: entry.model, error: m.ok ? '' : m.error });
        }
        return;
      }
      if (m.type === 'init') {
        entry.sessionId = m.sessionId;
        // codex init reports the thread's ACTUAL model (e.g. gpt-5.6-sol) —
        // settle the tier alias from it so the dial shows wire truth
        if (entry.codexLane) {
          const tier = ['sol', 'terra', 'luna'].find((t) => (m.model || '').includes(t));
          if (tier) entry.codexModel = tier;
        }
        if (entry.local) m.local = true;
        // local seats don't support --resume; keep them out of history
        if (record && !entry.local) record(entry.persona, m.sessionId, entry.title, entry.cwd);
      }
      if (m.type === 'permission') entry.permQueue.push(m);
      // Lane events not special-cased above (e.g. localSeat's `localUsage`) are
      // forwarded raw ON PURPOSE — app-side consumers own them (main/seats.js
      // relays localUsage into the usage ledger; the renderer shows no context
      // meter for local seats, chatView.js). Not drift — don't "route" them here.
      post({ type: 'seatEvt', id, m });
    };
    if (opts.launch && opts.launch.mode === 'pty') {
      // The raw lane (R25): a real ConPTY terminal. No history record (no
      // session id), no permission protocol — the human drives directly.
      entry.pty = true;
      entry.local = true;   // keeps it out of resume history
      entry.seat = startPtySeat({
        command: opts.launch.command || 'claude',
        args: opts.launch.args || [],
        cwd: opts.cwd || apexRoot,
        transcriptsDir: localTranscripts,
        cols: opts.launch.cols, rows: opts.launch.rows,
        log: (l) => log(`[${id}] ${l}`),
        onEvent: postM,
        onExit: (code) => { entry.dead = true; if (!entry.closed) post({ type: 'seatEvt', id, m: { type: 'dead', code } }); changed(); },
      });
    } else if (opts.launch && opts.launch.model === 'codex') {
      // The Codex app-server lane (R33) — an OWNED clean-view seat, full
      // Claude parity: streamed deltas, permission cards, resume, wrap.
      // Not `local`: it has a durable session (thread) and belongs in history.
      entry.codexLane = true;
      entry.seat = startCodexSeat({
        cwd: opts.cwd || apexRoot,
        resume: opts.resume,
        effort: entry.effort,
        model: entry.codexModel,
        permissionMode: entry.mode,
        log: (l) => log(`[${id}] ${l}`),
        onEvent: postM,
        onExit: (code) => { entry.dead = true; if (!entry.closed) post({ type: 'seatEvt', id, m: { type: 'dead', code } }); changed(); },
      });
    } else if (opts.launch && opts.launch.model === 'qwen') {
      // The local lane (J22): Ollama-backed, chat-only, view-vocab direct.
      entry.local = true;
      entry.title = entry.title === 'Seat' ? 'Local coder (Ollama)' : entry.title;
      entry.seat = startLocalSeat({
        cwd: opts.cwd || apexRoot,
        transcriptsDir: localTranscripts,
        log: (l) => log(`[${id}] ${l}`),
        onEvent: postM,
        onExit: (code) => { entry.dead = true; if (!entry.closed) post({ type: 'seatEvt', id, m: { type: 'dead', code } }); changed(); },
      });
    } else {
      entry.seat = startSeat({
        cwd: opts.cwd || apexRoot,
        resume: opts.resume,
        ...(opts.launch || {}),
        log: (l) => log(`[${id}] ${l}`),
        onEvent: (evt) => routeEvt(evt, postM, log),
        onExit: (code) => { entry.dead = true; if (!entry.closed) post({ type: 'seatEvt', id, m: { type: 'dead', code } }); changed(); },
      });
    }
    seats.set(id, entry);
    // sessionId rides along so a restore-created seat's header can say WHICH
    // session it is instead of "starting…" (a resumed CLI is mute until first
    // input, J8 — no init ever comes to fill the header)
    post({ type: 'seatNew', id, title: entry.title, persona: entry.persona,
           pty: !!entry.pty, local: entry.local, mode: entry.mode,
           model: entry.model, codexModel: entry.codexModel,
           effort: entry.effort, sessionId: entry.sessionId, cwd: entry.cwd });
    // `--resume` continues the session but replays NOTHING over the wire —
    // without a backfill the resumed chat opens blank (J26). The codex lane
    // does its OWN backfill (thread/read) — the Claude transcript store
    // knows nothing about codex threads.
    if (opts.resume && !entry.local && !entry.codexLane) {
      const { file, messages, context } = backfill(opts.resume, transcriptsRoot);
      if (!file) log(`[${id}] backfill: no transcript found for ${opts.resume}`);
      for (const m of messages) post({ type: 'seatEvt', id, m });
      if (messages.length) {
        // the replay's last 'user' event leaves the head pulsing — settle it
        post({ type: 'seatEvt', id, m: { type: 'result', ok: true } });
        log(`[${id}] backfill: restored ${messages.length} messages for ${opts.resume}`);
      }
      // seed the context meter from the transcript — a resumed session
      // reopens with all its prior context (the transcript IS the context)
      if (context) post({ type: 'seatEvt', id, m: { type: 'context', used: context.used,
        window: MODEL_WINDOWS.get(context.model) || 0 } });
    }
    if (kickoff) {
      entry.seat.send(kickoff);
      post({ type: 'seatEvt', id, m: { type: 'user', text: kickoff } });
    }
    changed();
    return id;
  }

  // Hidden, tool-disabled Claude session for bounded extension workflows such
  // as Persona Builder behavior tests. It never joins the roster or history,
  // and Claude is launched with session persistence disabled.
  function createDisposable({ kickoff, model, effort, onEvent }) {
    if (typeof onEvent !== 'function') throw new Error('Disposable seat requires an event sink.');
    const label = 'disposable-' + nextDisposableId++;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-disposable-'));
    let closed = false;
    let controller = null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
    };
    const deliver = (message) => { if (!closed) onEvent(message); };
    let seat;
    try {
      seat = startSeat({
        cwd: scratch,
        model,
        effort,
        permissionMode: 'manual',
        noSessionPersistence: true,
        tools: '',
        log: (line) => log(`[${label}] ${line}`),
        onEvent: (event) => routeEvt(event, deliver, log),
        onExit: (code) => {
          disposables.delete(controller);
          cleanup();
          deliver({ type: 'dead', code });
        },
      });
    } catch (err) {
      cleanup();
      throw err;
    }
    controller = {
      send(text) { if (!closed) seat.send(String(text || '')); },
      stop() { if (!closed) seat.interrupt(); },
      close() {
        if (closed) return;
        closed = true;
        disposables.delete(controller);
        seat.dispose();
      },
    };
    disposables.add(controller);
    if (kickoff) controller.send(kickoff);
    return controller;
  }

  /** Active chats for the rail dropdowns (and app-level verbs like hand-off). */
  function list() {
    return [...seats.entries()].map(([id, e]) =>
      ({ id, title: e.title, persona: e.persona, local: e.local, pty: !!e.pty,
         sessionId: e.sessionId, mode: e.mode, model: e.model,
         codexModel: e.codexModel, effort: e.effort, ts: e.ts, cwd: e.cwd }));
  }

  /** Pending permission requests for a seat (the host-owned queue, R23). */
  function pendingPermissions(id) {
    const e = seats.get(id);
    return e ? [...e.permQueue] : [];
  }

  /** View → host plumbing. True if the message was seat business.
   *  Exact types only — a startsWith('seat') claim once swallowed the
   *  seatConfig* messages and silently ate the operator's settings (J23). */
  const SEAT_MSGS = new Set(['seatSend', 'seatPerm', 'seatStop', 'seatClose', 'seatMode',
                             'seatModel', 'seatPtyInput', 'seatPtyResize', 'seatReplay',
                             'seatWrap']);
  function handle(msg) {
    if (!msg || !SEAT_MSGS.has(msg.type)) return false;
    const entry = seats.get(msg.id);
    if (!entry) return true;   // late message for a dead seat — swallow
    // A seat whose process has exited stays in the roster (visible as dead so
    // the user can Retry/close) but its child is GONE — routing a write to it
    // hits a destroyed stdin (EPIPE) and can crash main (external audit H3).
    // Only seatClose (removes it) may still act on a dead seat.
    if (entry.dead && msg.type !== 'seatClose') return true;
    switch (msg.type) {
      case 'seatSend': {
        // Images ride the message as base64 content blocks (J19: paste/drop).
        // The view renders its own user bubble at send time — no echo here.
        if (msg.files && msg.files.length) {
          const paths = msg.files.map((f) => '- ' + f.path).join('\n');
          msg = Object.assign({}, msg, { text: (msg.text || '') +
            '\n\n<apex-session-attachments>\nThe user attached local copies of these files:\n' +
            paths + '\n</apex-session-attachments>' });
        }
        if (entry.needsEnvBrief && !entry.local && !entry.pty) {
          entry.needsEnvBrief = false;
          msg = Object.assign({}, msg, {
            text: '<apex-environment-reminder>\n' + SEAT_ENV_BRIEF +
                  '\n</apex-environment-reminder>\n\n' + (msg.text || ''),
          });
        }
        if (msg.images && msg.images.length) {
          const content = msg.images.map((i) =>
            ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } }));
          content.push({ type: 'text', text: msg.text || '(see attached)' });
          entry.seat.send(content);
        } else {
          entry.seat.send(msg.text);
        }
        // First real message names the chat: "Agent" → "Agent — fix the printer".
        // (Kickoffs never route through seatSend — create() sends them
        // directly — so no [seat-launch] sniff is needed here. transcripts.js
        // still filters the marker on backfill, where kickoffs DO appear.)
        if (!entry.autoTitled) {
          // an image-only first turn has no msg.text (the images branch never
          // sets it) — `.replace` on undefined threw inside this ipc handler
          // (external audit M8, 2026-07-18). Coerce, and title the visual turn.
          const t = msg.text || (msg.images && msg.images.length ? '(image)' : '');
          const snip = t.replace(/\s+/g, ' ').trim().slice(0, 30);
          entry.title = entry.persona + ' — ' + snip + (t.length > 30 ? '…' : '');
          entry.autoTitled = true;
          post({ type: 'seatTitle', id: msg.id, title: entry.title });
          if (entry.sessionId && record && !entry.local)
            record(entry.persona, entry.sessionId, entry.title, entry.cwd);
          changed();
        }
        break;
      }
      // Re-hand a LIVE seat's history to a fresh view. A window reload destroys
      // the renderer but not the seat (it lives here), so the view came back
      // empty and the operator had to close the chat and reopen it from history. Same
      // transcript backfill a resume uses — the seat itself is untouched.
      case 'seatReplay': {
        if (entry.local || entry.pty || !entry.sessionId) break;
        // codex seats replay from their own thread (thread/read), then the
        // pending-permission re-post below still applies
        if (entry.codexLane) {
          if (entry.seat.replay) entry.seat.replay();
          for (const pq of entry.permQueue) post({ type: 'seatEvt', id: msg.id, m: pq });
          break;
        }
        const { file, messages, context } = backfill(entry.sessionId, transcriptsRoot);
        if (!file) { log(`[${msg.id}] replay: no transcript for ${entry.sessionId}`); break; }
        for (const m of messages) post({ type: 'seatEvt', id: msg.id, m });
        if (messages.length) {
          post({ type: 'seatEvt', id: msg.id, m: { type: 'result', ok: true } });
          log(`[${msg.id}] replay: restored ${messages.length} messages after reload`);
        }
        if (context) post({ type: 'seatEvt', id: msg.id, m: { type: 'context', used: context.used,
          window: MODEL_WINDOWS.get(context.model) || 0 } });
        // a permission the seat is still waiting on must come back too, or the
        // reloaded view shows no card and the seat looks hung (R23 queue is
        // host-owned precisely so this survives).
        for (const pq of entry.permQueue) post({ type: 'seatEvt', id: msg.id, m: pq });
        break;
      }
      // End-Session wrap-up (2026-07-14): send the close-out contract as a real
      // user turn — loose ends, memory/scratchpad writes, then the SESSION
      // REFLECTION — so the seat lands its state before the operator closes it.
      // Routed through seatSend so the env-brief-on-resume logic still applies;
      // the user event is posted here because seatSend never echoes (the view
      // normally draws its own bubble at send time).
      case 'seatWrap': {
        if (entry.local || entry.pty) break;
        entry.autoTitled = true;   // the wrap text must never become the title
        const wrap = wrapText();
        handle({ type: 'seatSend', id: msg.id, text: wrap });
        post({ type: 'seatEvt', id: msg.id, m: { type: 'user', text: wrap } });
        break;
      }
      case 'seatPerm': {
        // Answer + drop from the host queue; surface the next one if queued.
        // msg.updates = Claude's own saved-rule suggestion (J46). Codex keeps
        // its provider decisions engine-side and receives only an opaque choice.
        entry.permQueue = entry.permQueue.filter((p) => p.requestId !== msg.requestId);
        entry.seat.respondPermission(msg.requestId, msg.allow, msg.input, msg.updates, msg.choice);
        break;
      }
      case 'seatModel': {
        // Live model switch. Allowlisted names — this wire reaches the CLI.
        // codex: tier aliases, applied per-turn (schema-verified 2026-07-14);
        // claude: set_model control subtype (bundle-verified).
        const MODELS = entry.codexLane
          ? new Set(['sol', 'terra', 'luna'])
          : new Set(['fable', 'opus', 'sonnet', 'haiku']);
        if (!entry.local && !entry.pty && MODELS.has(msg.model) && entry.seat.setModel) {
          entry.modelWanted = msg.model;      // provisional until the seat answers
          entry.seat.setModel(msg.model);     // echo fires from controlResult (J44)
        }
        break;
      }
      case 'seatStop': entry.seat.interrupt(); break;
      case 'seatPtyInput':  if (entry.pty) entry.seat.write(msg.data); break;
      case 'seatPtyResize': if (entry.pty) entry.seat.resize(msg.cols, msg.rows); break;
      case 'seatMode': {
        // R26 — live permission-mode change on a running seat. Mode names are
        // an allowlist: this wire reaches the CLI's own control channel.
        const MODES = new Set(['manual', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions']);
        if (entry.local || entry.pty || !MODES.has(msg.mode)) break;
        // Two cases need a RESTART instead of a live switch, both routed to the
        // path the effort dial uses (same session resumed, nothing lost, J44):
        //   (a) bypassPermissions is LAUNCH-ONLY — the CLI refuses it mid-session
        //       unless started with --dangerously-skip-permissions (never).
        //   (b) codex has NO live mode wire (no setPermissionMode) but DOES
        //       support every policy at launch (policyFor) — so a codex mode
        //       change relaunches rather than silently dropping the dial
        //       (structural audit C2, 2026-07-17).
        const noLiveModeWire = !entry.seat.setPermissionMode;
        const bypassNeedsLaunch = msg.mode === 'bypassPermissions' && entry.mode !== 'bypassPermissions';
        if (noLiveModeWire || bypassNeedsLaunch) {
          if (entry.mode !== msg.mode)   // a no-op change needs no restart
            post({ type: 'seatModeRelaunchNeeded', id: msg.id, mode: msg.mode, current: entry.mode });
          break;
        }
        entry.modeWanted = msg.mode;          // provisional until the CLI answers
        entry.seat.setPermissionMode(msg.mode);
        break;
      }
      case 'seatClose':
        entry.closed = true;   // silence the tail BEFORE the kill (ghost fix)
        entry.seat.dispose(); seats.delete(msg.id); changed(); break;
    }
    return true;
  }

  /** After a view (re)load: rebuild the projection — live seats first, then
   *  every UNANSWERED permission request (R23: a reload can't orphan a turn). */
  function reannounce() {
    for (const [id, e] of seats) {
      post({ type: 'seatNew', id, title: e.title, persona: e.persona,
             pty: !!e.pty, local: e.local, mode: e.mode, model: e.model,
             codexModel: e.codexModel, effort: e.effort,
             sessionId: e.sessionId, cwd: e.cwd });
      for (const p of e.permQueue) post({ type: 'seatEvt', id, m: p });
    }
  }

  function disposeAll() {
    for (const controller of [...disposables]) controller.close();
    seats.forEach((e) => e.seat.dispose());
    seats.clear();
  }

  return { create, createDisposable, handle, reannounce, disposeAll, list, pendingPermissions };
}

// Raw stream-json events → the view vocabulary (unchanged from seats.js).
function routeEvt(evt, post, log) {
  switch (evt.type) {
    case 'system':
      if (evt.subtype === 'init') post({
        type: 'init', sessionId: evt.session_id, model: evt.model,
        tools: Array.isArray(evt.tools) ? evt.tools : null,
      });
      // The CLI compacted the conversation (auto near the window, or manual
      // /compact): older detail was just summarized away. Binary-verified event
      // shape: compact_boundary + compact_metadata {trigger, pre_tokens}.
      else if (evt.subtype === 'compact_boundary') {
        const cm = evt.compact_metadata || {};
        post({ type: 'compacted', trigger: cm.trigger || '', pre: cm.pre_tokens || 0 });
      }
      break;
    case 'stream_event': {
      const e = evt.event || {};
      if (e.type === 'content_block_start' && e.content_block) {
        if (e.content_block.type === 'text') post({ type: 'block', kind: 'text' });
        if (e.content_block.type === 'thinking') post({ type: 'block', kind: 'thinking' });
      } else if (e.type === 'content_block_delta' && e.delta) {
        if (e.delta.type === 'text_delta') post({ type: 'delta', text: e.delta.text });
        if (e.delta.type === 'thinking_delta') post({ type: 'thinkingTick' });
      }
      break;
    }
    case 'assistant': {
      // Live context meter (2026-07-14): every assistant message reports the
      // prompt it just consumed — fresh + cache-read + cache-created tokens ARE
      // the current context footprint (wire-verified against this app's own
      // seat logs). The window limit arrives later, on the result event.
      const u = evt.message && evt.message.usage;
      if (u) {
        const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) +
                     (u.cache_creation_input_tokens || 0);
        if (used) post({ type: 'context', used });
      }
      for (const block of (evt.message && evt.message.content) || []) {
        if (block.type === 'text') post({ type: 'text', text: block.text });
        else if (block.type === 'tool_use') {
          post({ type: 'tool', name: block.name, detail: summarizeInput(block.name, block.input) });
          const p = block.input && block.input.file_path;
          if (p) {
            const ext = (p.split('.').pop() || '').toLowerCase();
            // Writes always open the working view; READS open it for visual
            // files only (J18 — text reads stay silent or every code-read
            // would spam the view).
            if (['Write', 'Edit', 'NotebookEdit'].includes(block.name))
              post({ type: 'artifactCandidate', path: p });
            else if (block.name === 'Read' && (IMG_EXT.has(ext) || isHtml(ext)))
              post({ type: 'artifactCandidate', path: p });
          }
        }
      }
      break;
    }
    case 'control_request': {
      const r = evt.request || {};
      if (r.subtype === 'can_use_tool') {
        post({
          type: 'permission', requestId: evt.request_id,
          tool: r.display_name || r.tool_name,
          description: r.description || '',
          detail: summarizeInput(r.tool_name, r.input),
          input: r.input,
          // The CLI hands us a ready-made rule for this exact call — the payload
          // behind the official panel's "don't ask again" (J46). Ignoring it is
          // why `auto` never quieted down here: an Apex seat could never LEARN
          // a rule, so every new command asked forever.
          suggestions: r.permission_suggestions || [],
        });
      } else log(`(unhandled control_request subtype: ${r.subtype})`);
      break;
    }
    case 'control_response': {
      // NOT a nothing-to-see ack (J44, the operator: "permission settings don't work").
      // The CLI REFUSES some changes — bypassPermissions is launch-only:
      //   "Cannot set permission mode to bypassPermissions because the session
      //    was not launched with --dangerously-skip-permissions"
      // Swallowing that refusal is exactly what made the dial lie: the header
      // read `bypass` while the seat stayed in `manual` and kept asking.
      const rsp = evt.response || {};
      const rid = rsp.request_id || '';
      const kind = rid.startsWith('apex-mode-') ? 'mode'
                 : rid.startsWith('apex-setmodel-') ? 'model' : '';
      if (!kind) break;                       // can_use_tool acks: nothing to do
      if (rsp.subtype === 'error') {
        log(`control REJECTED (${rid}): ${rsp.error}`);
        post({ type: 'controlResult', kind, ok: false,
               error: String(rsp.error || 'refused by the CLI') });
      } else {
        post({ type: 'controlResult', kind, ok: true });
      }
      break;
    }
    case 'result': {
      // The result contributes ONLY the window ceiling. Its `usage` is the
      // turn's tokens SUMMED across iterations — every tool round re-reads the
      // full context, so a long turn reads as millions (the operator caught "5.7M/1M"
      // live; the iterations[] entry vs the top-level sum proves it). The true
      // live footprint is the per-assistant-message usage, posted above.
      // Pick the window of the model actually holding the conversation (the
      // one with the largest prompt load; helper models like the haiku
      // summarizer show up with tiny loads and a 200k window).
      let window = 0, load = -1;
      for (const [name, mu] of Object.entries(evt.modelUsage || {})) {
        learnWindow(name, mu.contextWindow);
        const l = (mu.inputTokens || 0) + (mu.cacheReadInputTokens || 0) +
                  (mu.cacheCreationInputTokens || 0);
        if (l > load) { load = l; window = mu.contextWindow || 0; }
      }
      if (window) post({ type: 'context', window });
      post({ type: 'result', ok: !evt.is_error });
      break;
    }
    case 'rate_limit_event':
      break;
    default:
      log(`(unrouted event type: ${evt.type})`);
  }
}

function summarizeInput(tool, input) {
  if (!input) return '';
  if (input.file_path) return input.file_path;
  if (input.command) return String(input.command).slice(0, 200);
  if (input.pattern) return String(input.pattern).slice(0, 200);
  const s = JSON.stringify(input);
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

module.exports = { createSeatHost };

