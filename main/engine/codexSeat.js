// Apex seat engine — the Codex app-server lane (R33: "codex needs the same
// treatment as claude"). Spawns `codex app-server` and speaks its JSON-RPC
// protocol (newline-delimited), built against the generated protocol schema
// AND a live wire capture (2026-07-14, v0.144.3) — never guessed:
//   client:  initialize → initialized → thread/start|thread/resume →
//            turn/start {threadId, input:[{type:'text',text}], effort}
//   server:  item/agentMessage/delta (streamed text), item/started|completed
//            (agentMessage / reasoning / commandExecution / fileChange),
//            thread/tokenUsage/updated, turn/started|completed,
//            item/commandExecution/requestApproval + item/fileChange/
//            requestApproval + item/permissions/requestApproval (JSON-RPC
//            SERVER→CLIENT REQUESTS — the approval round-trip; decisions:
//            accept | acceptForSession | decline | cancel).
// Windows containment truth (wire-proven): the sandbox clamps to readOnly no
// matter what is requested — the response is the truth, never the request —
// and an ACCEPTED APPROVAL is what executes a command. Our permission cards
// are therefore the real boundary, exactly like the Claude lane.
// Plain Node, zero Electron imports — must run under the headless drill.
'use strict';

const { spawn } = require('child_process');

// Session ids for this lane are namespaced so history/restore can route a
// resume back here (a codex thread id means nothing to `claude --resume`).
const PREFIX = 'codex:';

// dial → protocol mapping. The sandbox request is best-effort (Windows clamps
// it to readOnly on the wire); approvalPolicy is what changes behavior.
function policyFor(permissionMode) {
  if (permissionMode === 'bypassPermissions')
    return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  if (permissionMode === 'acceptEdits')
    return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };   // manual + anything else
}

// Efforts are model-advertised. Wire truth (model/list, 2026-07-14): all three
// visible models advertise low/medium/high/xhigh/max (sol+terra also 'ultra',
// which the dial doesn't carry) — the old clamp-to-high is retired.
const EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };

// The selectable tiers (the operator, 2026-07-14: "all the tiers just like claude").
// Wire truth from a live model/list probe on this plan — sol is the frontier
// default, terra balanced, luna fast. turn/start accepts `model` PER TURN, so
// a switch is live (applies from the next turn, no restart).
const MODEL_IDS = { sol: 'gpt-5.6-sol', terra: 'gpt-5.6-terra', luna: 'gpt-5.6-luna' };

/**
 * Start an owned Codex seat. Same contract as startSeat/startLocalSeat:
 * @param {object} opts
 *   cwd / log / onEvent / onExit — as the other lanes.
 *   resume       — PREFIXED session id ("codex:<threadId>") to continue.
 *   effort / permissionMode — launch dials.
 *   model        — tier alias ('sol'|'terra'|'luna'); empty = plan default.
 * Returns { send, interrupt, respondPermission, replay, setModel, dispose }.
 */
function startCodexSeat({ cwd, log, onEvent, onExit, resume, effort, permissionMode, model }) {
  const child = spawn('codex app-server', {
    shell: true,            // codex is a .cmd shim on Windows (same as claude)
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  log(`spawn: codex app-server (cwd=${cwd}${resume ? ', resume=' + resume : ''})`);

  let nextId = 0;
  const replies = new Map();        // rpc id -> { onReply, onError, method }
  let threadId = null;
  let currentTurnId = null;
  let disposed = false;
  let curModel = MODEL_IDS[model] || null;   // null = ride the plan default
  const sendQueue = [];             // user turns arriving before the thread exists

  const rpc = (method, params, onReply, onError) => {
    if (disposed) return;
    const id = ++nextId;
    if (onReply || onError) replies.set(id, { onReply, onError, method });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  };
  const notify = (method, params) => {
    if (!disposed) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };
  const answer = (id, result) => {
    if (!disposed) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  };

  // ---- outbound: user turns ----
  const startTurn = (text) => {
    const params = { threadId, input: [{ type: 'text', text }] };
    const eff = EFFORT[effort];
    if (eff) params.effort = eff;
    if (curModel) params.model = curModel;   // per-turn model (schema-verified)
    rpc('turn/start', params);
  };
  const send = (textOrContent) => {
    // image blocks (paste/drop) are a Claude-lane shape — take the text parts,
    // say so honestly for the rest (schema has an image-url input; wire it
    // when a real need lands rather than guessing its semantics now)
    let text = textOrContent;
    if (Array.isArray(textOrContent)) {
      text = textOrContent.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (textOrContent.some((b) => b.type === 'image')) {
        text = '(the user attached an image the codex lane cannot carry yet)\n' + text;
        log('image blocks dropped — codex lane is text-only for now');
      }
    }
    if (!threadId) { sendQueue.push(text); return; }
    startTurn(text);
  };

  // ---- inbound: wire → view vocabulary ----
  const ITEM_TOOL_LABEL = {
    commandExecution: 'command (codex)',
    fileChange: 'file change (codex)',
    mcpToolCall: 'MCP tool (codex)',
    webSearch: 'web search (codex)',
  };

  function onNotification(m) {
    const p = m.params || {};
    switch (m.method) {
      case 'item/agentMessage/delta':
        onEvent({ type: 'delta', text: p.delta || '' });
        break;
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        onEvent({ type: 'thinkingTick' });
        break;
      case 'item/started': {
        const it = p.item || {};
        if (it.type === 'agentMessage') onEvent({ type: 'block', kind: 'text' });
        else if (it.type === 'reasoning') onEvent({ type: 'block', kind: 'thinking' });
        else if (ITEM_TOOL_LABEL[it.type])
          onEvent({ type: 'tool', name: ITEM_TOOL_LABEL[it.type],
                    detail: it.command || it.query ||
                            (it.changes && Object.keys(it.changes).join(', ')) || '' });
        break;
      }
      case 'item/completed': {
        const it = p.item || {};
        // final text replaces the streamed block — same shape the Claude lane
        // posts ('text' after its deltas); commentary and final_answer are both
        // visible assistant prose
        if (it.type === 'agentMessage' && it.text) onEvent({ type: 'text', text: it.text });
        // file changes land in the working view like Write/Edit tool calls
        if (it.type === 'fileChange' && it.changes)
          for (const path of Object.keys(it.changes))
            onEvent({ type: 'artifactCandidate', path });
        break;
      }
      case 'thread/tokenUsage/updated': {
        // `last` = the latest request the model consumed — that IS the live
        // context footprint (wire: last.inputTokens includes its cached part).
        // The wire also carries the ceiling (modelContextWindow) — the meter
        // gets both, same shape the Claude lane feeds it.
        const tu = p.tokenUsage || {};
        const u = tu.last;
        if (u && u.inputTokens)
          onEvent({ type: 'context', used: u.inputTokens + (u.outputTokens || 0),
                    window: tu.modelContextWindow || 0 });
        break;
      }
      case 'turn/started':
        currentTurnId = (p.turn && p.turn.id) || p.turnId || null;
        break;
      case 'turn/completed': {
        const status = p.turn && p.turn.status;
        onEvent({ type: 'result', ok: status === 'completed' });
        currentTurnId = null;
        break;
      }
      case 'thread/compacted':
        onEvent({ type: 'compacted', trigger: 'codex', pre: 0 });
        break;
      case 'error':
        onEvent({ type: 'text', text: '⚠ codex error: ' + JSON.stringify(p).slice(0, 500) });
        onEvent({ type: 'result', ok: false });
        break;
      default: break;   // status chips, rate limits, mcp noise — logged in wire log only
    }
  }

  // server→client APPROVAL requests: JSON-RPC id must ride back with the
  // decision. requestId is namespaced so seatPerm answers route here.
  function onServerRequest(m) {
    const p = m.params || {};
    const requestId = 'codex-rpc-' + m.id;
    let tool = 'codex approval';
    let detail = '';
    if (m.method === 'item/commandExecution/requestApproval') {
      tool = 'Run command (codex)';
      detail = p.command || '';
    } else if (m.method === 'item/fileChange/requestApproval') {
      tool = 'Apply file changes (codex)';
      detail = p.grantRoot ? 'under ' + p.grantRoot : 'proposed patch';
    } else if (m.method === 'item/permissions/requestApproval') {
      tool = 'Grant permissions (codex)';
      detail = JSON.stringify(p).slice(0, 200);
    } else {
      // unknown server request — refuse rather than hang the turn (fail closed)
      log('unhandled server request ' + m.method + ' — declining');
      answer(m.id, { decision: 'decline' });
      return;
    }
    // The provider tells us exactly which remembered decisions are valid for
    // this request. Keep the raw decisions engine-side; the renderer receives
    // only opaque choice ids and therefore cannot invent a broader grant.
    const decisions = Array.isArray(p.availableDecisions) ? p.availableDecisions : [];
    const remembered = new Map();
    const rememberChoices = [];
    for (const d of decisions) {
      if (d === 'acceptForSession' && !remembered.has('session')) {
        remembered.set('session', d);
        rememberChoices.push({
          id: 'session', label: 'Allow for session',
          title: 'Allow this request and matching repeats for this Codex session.',
        });
      } else if (d && typeof d === 'object' && d.acceptWithExecpolicyAmendment &&
                 !remembered.has('execpolicy')) {
        remembered.set('execpolicy', d);
        rememberChoices.push({
          id: 'execpolicy', label: 'Always allow',
          title: 'Apply Codex\'s proposed command rule so future matching commands do not ask again.',
        });
      }
    }
    pendingApprovals.set(requestId, { rpcId: m.id, remembered });
    onEvent({
      type: 'permission', requestId, tool,
      description: p.reason || '',
      detail, input: { command: p.command, cwd: p.cwd },
      suggestions: [],
      rememberChoices,
    });
  }
  const pendingApprovals = new Map();   // our requestId -> { rpcId, remembered }

  const respondPermission = (requestId, allow, _input, _updates, choice) => {
    const pending = pendingApprovals.get(requestId);
    if (!pending) { log('permission answer for unknown ' + requestId); return; }
    pendingApprovals.delete(requestId);
    const decision = allow
      ? (pending.remembered.get(choice) || 'accept')
      : 'decline';
    answer(pending.rpcId, { decision });
    log(`approval ${requestId} → ${JSON.stringify(decision)}`);
  };

  // ---- backfill/replay: thread/read → past turns as view events ----
  const postThreadItems = (items) => {
    let posted = 0;
    for (const it of items || []) {
      if (!it) continue;
      if (it.type === 'userMessage') {
        const text = (it.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        // resumed env-brief turns stay out of the visible history (wire ≠ bubble)
        if (text && !text.startsWith('<apex-environment-reminder>'))
          { onEvent({ type: 'user', text }); posted++; }
      } else if (it.type === 'agentMessage' && it.text) {
        onEvent({ type: 'text', text: it.text }); posted++;
      }
    }
    if (posted) onEvent({ type: 'result', ok: true });
    return posted;
  };
  const replay = () => {
    if (!threadId) return;
    // items ride per-turn and only when asked for (wire-found: a bare read
    // returns the thread shell with itemsView "notLoaded")
    rpc('thread/read', { threadId, includeTurns: true }, (result) => {
      const t = (result && result.thread) || {};
      const items = (t.turns || []).flatMap((turn) => turn.items || []);
      const n = postThreadItems(items.length ? items : t.items || []);
      log(`thread/read replay: ${n} items posted`);
    }, (error) => {
      // A new thread can be announced before its rollout gets the first
      // metadata line. Reading that empty history is a no-op, not a refusal.
      if (/(rollout[\s\S]*is empty|not materialized yet)/i.test(String(error && error.message))) {
        log('thread/read replay skipped — rollout not populated yet');
        return true;
      }
      return false;
    });
  };

  // ---- wire pump ----
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      log('< ' + (line.length > 2000 ? line.slice(0, 2000) + '…[cut]' : line));
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && m.method) onServerRequest(m);          // server request
      else if (m.id !== undefined) {                                    // response
        const h = replies.get(m.id);
        replies.delete(m.id);
        if (m.error) {
          if (h && h.onError && h.onError(m.error)) continue;
          log('rpc error: ' + JSON.stringify(m.error).slice(0, 300));
          onEvent({ type: 'text', text: '⚠ codex error: ' + (m.error.message || 'rpc error') });
          onEvent({ type: 'result', ok: false });
        } else if (h && h.onReply) h.onReply(m.result);
      } else if (m.method) onNotification(m);                           // notification
    }
  });
  child.stderr.on('data', (c) => log('E ' + c.toString('utf8').trim().slice(0, 500)));
  child.on('exit', (code) => { if (!disposed) onExit(code); });
  // Same duty as the Claude lane: an unhandled 'error' event (spawn failure,
  // EACCES) throws in the main process and takes the whole app down.
  child.on('error', (err) => { log('spawn error: ' + err.message); if (!disposed) onExit(-1); });

  // ---- handshake ----
  const { approvalPolicy, sandbox } = policyFor(permissionMode);
  rpc('initialize', { clientInfo: { name: 'apex', title: 'Apex', version: '0.1.0' } }, () => {
    notify('initialized', {});
    const onThread = (result) => {
      const t = (result && result.thread) || {};
      threadId = t.id;
      // the RESPONSE is the truth (Windows clamps the sandbox) — log it
      log(`thread ${threadId} model=${result.model} sandbox=${JSON.stringify(result.sandbox)} approvalPolicy=${JSON.stringify(result.approvalPolicy)}`);
      onEvent({ type: 'init', sessionId: PREFIX + threadId, model: result.model || 'codex' });
      if (resume) replay();                       // history back into the view
      while (sendQueue.length) startTurn(sendQueue.shift());
    };
    if (resume) {
      rpc('thread/resume', { threadId: String(resume).replace(PREFIX, ''),
                             cwd, approvalPolicy, sandbox }, onThread);
    } else {
      const params = { cwd, approvalPolicy, sandbox };
      if (curModel) params.model = curModel;   // ThreadStartParams carries model
      rpc('thread/start', params, onThread);
    }
  });

  // Live tier switch: `model` on turn/start is a CLIENT-owned param applied to
  // the next turn — there is no CLI refusal path to wait on (unlike Claude's
  // set_model control round-trip), so confirming immediately IS the truth.
  // If the server ever reroutes, ModelRerouted arrives in the wire log.
  const setModel = (alias) => {
    if (!MODEL_IDS[alias]) return;
    curModel = MODEL_IDS[alias];
    log(`model → ${curModel} (next turn)`);
    onEvent({ type: 'controlResult', kind: 'model', ok: true });
  };

  const interrupt = () => {
    if (threadId && currentTurnId) rpc('turn/interrupt', { threadId, turnId: currentTurnId });
    else if (threadId) rpc('turn/interrupt', { threadId });
  };

  const dispose = () => {
    disposed = true;
    try { child.stdin.end(); } catch { /* gone */ }
    // shell:true makes `child` the cmd shim — kill() alone left the real codex
    // process running underneath (same shape as the Claude lane's ✕ ghost,
    // 2026-07-14). Take the tree.
    if (process.platform === 'win32' && child.pid &&
        child.exitCode === null && !child.signalCode) {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'],
              { windowsHide: true, stdio: 'ignore' }).unref();
      } catch { /* gone */ }
    } else {
      try { child.kill(); } catch { /* gone */ }
    }
  };

  return { send, interrupt, respondPermission, replay, setModel, dispose };
}

module.exports = { startCodexSeat, CODEX_SESSION_PREFIX: PREFIX };
