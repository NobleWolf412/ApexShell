// Apex seat engine — local seat: Qwen via Ollama on this box, REBUILT
// 2026-07-12 as a real coding seat (the operator: "it's supposed to have coding
// capabilities, not a chatbot"). The original J22 chat-only muzzle applied
// the Atrium unattended-authorship verdict to a SUPERVISED chat — wrong
// scope. Here the human is the deterministic gate the verdict demanded:
//   - read_file / list_dir  — auto, surfaced as tool chips
//   - write_file            — goes through the SAME permission card as a
//                             Claude seat (view vocab 'permission'; the
//                             seat blocks until the operator answers)
// Model = the resident 30B (the delegate.py workhorse — rows 2-8 of the
// offload log are its accepted code). Same interface as the other lanes.
// HONESTY: a local model knows nothing past its training and has no web —
// the system prompt makes it SAY so instead of arguing (the Biden loop).

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL = 'gpt-oss:20b';          // MoE (~3.6B active) — CPU-friendly coder
const FALLBACK_MODEL = 'llama3.1:8b'; // dense 8B fallback if the 20B isn't pulled
const ENDPOINT = 'http://localhost:11434';
const KEEP_ALIVE = '30m';
const MAX_TOOL_ROUNDS = 8;

// Reads anywhere under these roots; writes ALSO require the user's Allow.
// Scope = the seat's working directory (the host resolves it: the workspace
// folder, or whatever an extension set) + the temp dir.
const SCOPES = (cwd) => [os.tmpdir(), cwd || os.homedir()];
// Real containment, not a string prefix: `startsWith` let sibling dirs
// through (scope C:\work\app admitted C:\work\app-secrets) — Codex review,
// R32. realpath first so a junction inside the scope can't point out of it.
const inScope = (p, cwd) => {
  let abs = path.resolve(p);
  try { abs = fs.realpathSync.native(abs); } catch { /* not on disk yet (a write) — bound the literal path */ }
  return SCOPES(cwd).some((r) => {
    let root = path.resolve(r);
    try { root = fs.realpathSync.native(root); } catch { /* keep resolved */ }
    const rel = path.relative(root, abs);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
};

const SYSTEM = () =>
  'You are a local coding assistant seat inside "Apex", the user\'s dashboard ' +
  'app. TODAY IS ' + new Date().toDateString() + '. Your ' +
  'training data ends well before today — for ANYTHING current (events, ' +
  'office-holders, prices, versions) you MUST use web_search/web_fetch ' +
  'instead of answering from memory; NEVER state a stale fact as current and ' +
  'NEVER argue with the user about what year it is. When tool results ' +
  'conflict with your training memory, THE TOOL RESULTS WIN — report what ' +
  'they say plainly, without hedging that they "must refer to" something in ' +
  'your training. If results are thin, search again with different words ' +
  'or web_fetch a result page. Your tools: web_search, ' +
  'web_fetch, read_file, list_dir, write_file (writes need the user\'s ' +
  'explicit approval — a permission prompt he answers in the app). Use tools ' +
  'instead of guessing. File access covers the workspace folder and the ' +
  'temp directory. Be direct and concise; write complete, runnable code.';

const TOOLS = [
  { type: 'function', function: {
    name: 'read_file',
    description: 'Read a text file. Workspace folder or temp dir only.',
    parameters: { type: 'object', required: ['path'],
      properties: { path: { type: 'string', description: 'absolute path' } } } } },
  { type: 'function', function: {
    name: 'list_dir',
    description: 'List a directory (names; dirs get a trailing slash). Workspace folder or temp dir only.',
    parameters: { type: 'object', required: ['path'],
      properties: { path: { type: 'string', description: 'absolute path' } } } } },
  { type: 'function', function: {
    name: 'write_file',
    description: 'Write a text file (requires the user\'s approval via a permission prompt). Workspace folder or temp dir only.',
    parameters: { type: 'object', required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } } } } },
  { type: 'function', function: {
    name: 'web_search',
    description: 'Search the web. Returns the top results as title, url, and snippet.',
    parameters: { type: 'object', required: ['query'],
      properties: { query: { type: 'string' } } } } },
  { type: 'function', function: {
    name: 'web_fetch',
    description: 'Fetch a URL and return its readable text (HTML stripped, capped).',
    parameters: { type: 'object', required: ['url'],
      properties: { url: { type: 'string' } } } } },
];

// ---- web tools (keyless; every access surfaces as a tool chip in chat) ----
async function fetchUrl(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Apex-local-seat' },
    });
    return { status: res.status, text: await res.text() };
  } finally { clearTimeout(t); }
}
const stripHtml = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

async function webSearch(query) {
  const { status, text } = await fetchUrl(
    'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
  if (status !== 200) return 'ERROR: search returned HTTP ' + status;
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(text)) && out.length < 8) {
    let url = m[1];
    const uddg = /[?&]uddg=([^&]+)/.exec(url);          // DDG redirect unwrap
    if (uddg) url = decodeURIComponent(uddg[1]);
    out.push('- ' + stripHtml(m[2]) + '\n  ' + url +
             (m[3] ? '\n  ' + stripHtml(m[3]).slice(0, 200) : ''));
  }
  return out.length ? out.join('\n') : 'no results parsed (engine layout may have changed)';
}

async function webFetch(url) {
  if (!/^https?:\/\//i.test(url)) return 'ERROR: http(s) URLs only';
  const { status, text } = await fetchUrl(url);
  let t = stripHtml(text);
  if (t.length > 25000) t = t.slice(0, 25000) + '\n…[truncated at 25k chars]';
  return 'HTTP ' + status + '\n' + t;
}

// Reasoning/format residue scrub — two model families:
//   Qwen3     — <think>…</think> blocks, unopened </think> heads, /think echoes.
//   gpt-oss   — the "harmony" channel format (<|channel|>analysis…). Ollama
//               normally routes analysis into the `thinking` field, so this is
//               a belt-and-suspenders pass for markup that leaks into content.
// All patterns are no-ops on already-clean text, so a model that emits neither
// family passes through untouched.
function cleanReasoning(s) {
  return s
    // -- Qwen3 --
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^[\s\S]*?<\/think>/, '')
    .replace(/<\/?think>/g, '')
    .replace(/^\s*\/(no_)?think\b/, '')
    .replace(/\s*\/(no_)?think\s*$/, '')
    // -- gpt-oss harmony --
    // drop analysis/commentary channel segments whole (with any role header)
    .replace(/(?:<\|start\|>\w+)?<\|channel\|>(?:analysis|commentary)[\s\S]*?(?:<\|end\|>|<\|return\|>|$)/g, '')
    // unwrap the final channel header, then strip any leftover special tokens
    .replace(/(?:<\|start\|>\w+)?<\|channel\|>final<\|message\|>/g, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();
}

function startLocalSeat({ cwd, log, onEvent, onExit }) {
  const messages = [{ role: 'system', content: SYSTEM() }];
  let aborter = null;
  let disposed = false;
  let model = MODEL;
  const pendingPerms = new Map();   // requestId -> {resolve}
  const sessionId = 'local-' + Date.now().toString(36);

  // Local chats persist to state/transcripts/ so downstream consumers can
  // archive them — a local model's chat is history too (the operator's
  // 2026-07-14 ruling; the unpersisted 8B rage session is why). Meta first
  // line, then one {ts, role, text} event per message. Append-only.
  const T_DIR = path.resolve(__dirname, '..', '..', 'state', 'transcripts');
  const T_FILE = path.join(T_DIR, sessionId + '.jsonl');
  let metaWritten = false;
  function persist(role, text) {
    if (!text || !String(text).trim()) return;
    try {
      fs.mkdirSync(T_DIR, { recursive: true });
      if (!metaWritten) {
        fs.appendFileSync(T_FILE, JSON.stringify({
          kind: 'local', chat: sessionId, model,
          started: new Date().toISOString(),
        }) + '\n');
        metaWritten = true;
      }
      fs.appendFileSync(T_FILE, JSON.stringify({
        ts: new Date().toISOString(), role, text: String(text),
      }) + '\n');
    } catch { /* persistence must never break the chat */ }
  }

  log(`local seat: ${model} @ ${ENDPOINT} (tools: read/list/write-gated)`);
  setTimeout(() => onEvent({
    type: 'init', sessionId, model,
  }), 0);

  // ---- tool executors ----
  async function runTool(name, args) {
    try {
      if (name === 'read_file') {
        if (!inScope(args.path, cwd)) return 'ERROR: path outside the allowed scope';
        let t = fs.readFileSync(args.path, 'utf8');
        if (t.length > 60000) t = t.slice(0, 60000) + '\n…[truncated at 60k chars]';
        return t;
      }
      if (name === 'list_dir') {
        if (!inScope(args.path, cwd)) return 'ERROR: path outside the allowed scope';
        return fs.readdirSync(args.path, { withFileTypes: true })
          .map((d) => d.name + (d.isDirectory() ? '/' : '')).join('\n') || '(empty)';
      }
      if (name === 'write_file') {
        if (!inScope(args.path, cwd)) return 'ERROR: path outside the allowed scope';
        // the human gate: same permission flow as a Claude seat
        const requestId = 'local-perm-' + Date.now().toString(36);
        const allowed = await new Promise((resolve) => {
          pendingPerms.set(requestId, { resolve });
          onEvent({
            type: 'permission', requestId,
            tool: 'write_file (local seat)',
            description: 'The local model wants to write this file.',
            detail: args.path,
            input: args,
          });
        });
        if (!allowed) return 'DENIED: the user declined this write.';
        fs.mkdirSync(path.dirname(args.path), { recursive: true });
        fs.writeFileSync(args.path, args.content);
        onEvent({ type: 'artifactCandidate', path: args.path });   // working view
        return 'ok — wrote ' + args.content.length + ' chars';
      }
      if (name === 'web_search') return await webSearch(String(args.query || ''));
      if (name === 'web_fetch') return await webFetch(String(args.url || ''));
      return 'ERROR: unknown tool ' + name;
    } catch (e) { return 'ERROR: ' + e.message; }
  }

  // ---- one model call (streaming); returns {text, toolCalls} ----
  async function callModel() {
    aborter = new AbortController();
    const res = await fetch(ENDPOINT + '/api/chat', {
      method: 'POST', signal: aborter.signal,
      body: JSON.stringify({ model, messages, stream: true, tools: TOOLS,
                             keep_alive: KEEP_ALIVE }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // model not pulled → drop to the fallback once
      if (res.status === 404 && model !== FALLBACK_MODEL && /not found/i.test(body)) {
        log(`model ${model} not pulled — falling back to ${FALLBACK_MODEL}`);
        model = FALLBACK_MODEL;
        onEvent({ type: 'text', text: '⚠ ' + MODEL + ' isn\'t pulled in Ollama — using ' +
          FALLBACK_MODEL + '. For the real coder: `ollama pull ' + MODEL + '`' });
        return callModel();
      }
      throw new Error('Ollama HTTP ' + res.status);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let lineBuf = '', visible = '', started = false;
    const toolCalls = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        const m = j.message || {};
        if (m.tool_calls) toolCalls.push(...m.tool_calls);
        if (m.content) {
          if (!started) { onEvent({ type: 'block', kind: 'text' }); started = true; }
          visible += m.content;
          onEvent({ type: 'delta', text: m.content });
        }
        if (m.thinking) onEvent({ type: 'thinkingTick' });
        // Ollama's final chunk carries its exact token accounting — relayed as
        // an event for the host to consume app-side (usage trackers). Engine
        // stays vendor-neutral: it reports, it does not count.
        if (j.done && (j.eval_count !== undefined || j.prompt_eval_count !== undefined))
          onEvent({ type: 'localUsage',
                    promptTokens: j.prompt_eval_count || 0, evalTokens: j.eval_count || 0 });
      }
    }
    return { text: cleanReasoning(visible), toolCalls };
  }

  // ---- the turn loop: model → tools → model, until text with no calls ----
  async function run() {
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const { text, toolCalls } = await callModel();
        if (!toolCalls.length) {
          messages.push({ role: 'assistant', content: text });
          persist('assistant', text);
          onEvent({ type: 'text', text });          // authoritative replace
          onEvent({ type: 'result', ok: true });
          return;
        }
        messages.push({ role: 'assistant', content: text, tool_calls: toolCalls });
        persist('assistant', text);
        for (const tc of toolCalls) {
          const fn = (tc.function || {});
          let args = fn.arguments;
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
          onEvent({ type: 'tool', name: fn.name,
                    detail: (args && (args.path || args.query || args.url ||
                            JSON.stringify(args).slice(0, 120))) || '' });
          const out = await runTool(fn.name, args || {});
          messages.push({ role: 'tool', tool_name: fn.name, content: String(out) });
        }
      }
      persist('assistant', '⚠ stopped after ' + MAX_TOOL_ROUNDS + ' tool rounds.');
      onEvent({ type: 'text', text: '⚠ stopped after ' + MAX_TOOL_ROUNDS + ' tool rounds.' });
      onEvent({ type: 'result', ok: false });
    } catch (e) {
      if (disposed) return;
      log('local seat error: ' + e.message);
      persist('assistant', '⚠ local model error: ' + e.message);
      onEvent({ type: 'text', text: '⚠ local model error: ' + e.message +
        (/fetch/i.test(e.message) ? ' — is Ollama running?' : '') });
      onEvent({ type: 'result', ok: false });
    }
  }

  return {
    send(content) {
      const text = typeof content === 'string' ? content
        : ((content.find((b) => b.type === 'text') || {}).text || '');
      if (Array.isArray(content) && content.some((b) => b.type === 'image')) {
        onEvent({ type: 'text', text: '⚠ this local seat is text-only — images were dropped.' });
      }
      messages.push({ role: 'user', content: text });
      persist('user', text);
      run();
    },
    respondPermission(requestId, allow, _input, _updates, _choice) {   // uniform lane arity (audit D4)
      const p = pendingPerms.get(requestId);
      if (p) { pendingPerms.delete(requestId); p.resolve(!!allow); }
    },
    interrupt() { if (aborter) aborter.abort(); },
    dispose() {
      disposed = true;
      if (aborter) aborter.abort();
      // never leave a write hanging on a dead seat
      for (const [, p] of pendingPerms) p.resolve(false);
      pendingPerms.clear();
    },
  };
}

module.exports = { startLocalSeat };
