// Apex — the mobile lane (main side, 2026-07-18). The slim phone face's
// entire network door: one HTTP server (static page + transcript replay) and
// one WebSocket bridge into the typed bus, bound ONLY to this machine's
// Tailscale address. No Tailscale interface up = no server = no surface.
//
// Trust model: tailnet membership IS the lock. The server never binds
// 0.0.0.0 / LAN / loopback; a defense-in-depth check also rejects any peer
// whose address is outside Tailscale's CGNAT range (100.64.0.0/10).
// Inbound messages pass a strict whitelist and are rebuilt field-by-field —
// a phone frame can never smuggle a PTY spawn, a browser grant, or an
// arbitrary launch config into seatCreate (the consent choke point stays
// with the desktop app).
'use strict';

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const bus = require('./bus');
const store = require('./store');
const { backfill } = require('./engine/transcripts');

// APEX_MOBILE_PORT: smoke/test instances bind elsewhere so they never fight
// the live app for the face's port (the 07-18 EADDRINUSE dialog)
const PORT = Number(process.env.APEX_MOBILE_PORT) || 8890;
const STATIC_ROOT = path.resolve(__dirname, '..', 'mobile');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
               '.json': 'application/json; charset=utf-8' };

let log = () => {};
let server = null;
let loopServer = null;   // 127.0.0.1 twin — the tailscale-serve HTTPS proxy's door
let retryTimer = null;
const clients = new Set();   // live WS sockets

// ---- Tailscale address discovery ----
// CGNAT range 100.64.0.0/10 → first octet 100, second 64..127. Tailscale is
// the only tenant of that range on this box (it exists so it never collides
// with home LANs). IP is stable per node, but the interface may come up after
// the app does — hence the retry loop in register().
function tailscaleIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const a of ifaces || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [o1, o2] = a.address.split('.').map(Number);
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return a.address;
    }
  }
  return null;
}
const inTailnet = (addr) => {
  // ws remote addresses arrive as '::ffff:100.x.y.z' on a dual-stack socket
  const ip = String(addr || '').replace(/^::ffff:/, '');
  // loopback = this machine — covers the `tailscale serve` HTTPS proxy, whose
  // upstream traffic is already tailnet-authenticated before it reaches us
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) return true;
  const [o1, o2] = ip.split('.').map(Number);
  return o1 === 100 && o2 >= 64 && o2 <= 127;
};

// ---- inbound whitelist: type -> sanitizer (null = drop the frame) ----
// Rebuild every message from typed fields; never forward a phone frame as-is.
const str = (v) => (typeof v === 'string' ? v : '');
// phone camera/gallery attachments: same wire shape the desktop stages
// (J19 blocks) — capped, image/* only, base64-shaped payloads
function cleanImages(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 6).filter((i) =>
    i && /^image\/[a-z0-9+.-]+$/.test(str(i.mediaType)) &&
    typeof i.data === 'string' && i.data.length > 0 && i.data.length < 15_000_000 &&
    /^[A-Za-z0-9+/=]+$/.test(i.data)
  ).map((i) => ({ mediaType: i.mediaType, data: i.data }));
}
const MODES = new Set(['manual', 'auto', 'acceptEdits', 'dontAsk']);
const MODELS = new Set(['fable', 'opus', 'sonnet', 'haiku']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const INBOUND = {
  seatList: () => ({ type: 'seatList' }),
  seatHistory: () => ({ type: 'seatHistory' }),
  seatPresets: () => ({ type: 'seatPresets' }),
  // Upstream's per-seat checklist module (main/todo.js) doesn't exist in this
  // fork — the board (main/tasks.js) is our checklist story. Swallow the
  // phone's request quietly instead of warn-spamming the bus with an
  // unhandled verb; the phone's drawer simply stays empty.
  todoGet: () => null,
  usageRefresh: () => ({ type: 'usageRefresh' }),   // usageData rides the sink back
  // the liveUpdate lane: snapshot chats -> relaunch -> restore. Phone-safe by
  // design (chats survive), and the phone reconnects on its own backoff.
  updateRestart: () => ({ type: 'updateRestart' }),
  seatStop: (m) => (str(m.id) ? { type: 'seatStop', id: m.id } : null),
  // tab lifecycle from the phone — wrap runs the seat's close-out turn,
  // close is the desktop X (engine handles both; same verbs, same semantics)
  seatWrap: (m) => (str(m.id) ? { type: 'seatWrap', id: m.id } : null),
  seatClose: (m) => (str(m.id) ? { type: 'seatClose', id: m.id } : null),
  seatSend: (m) => {
    if (!str(m.id)) return null;
    const images = cleanImages(m.images);
    if (!str(m.text) && !images.length) return null;
    const out = { type: 'seatSend', id: m.id, text: str(m.text) };
    if (images.length) out.images = images;
    return out;
  },
  // live dials (the phone AI bar) — value sets mirror the desktop's
  seatMode: (m) => (str(m.id) && MODES.has(m.mode)
    ? { type: 'seatMode', id: m.id, mode: m.mode } : null),
  seatModel: (m) => (str(m.id) && MODELS.has(m.model)
    ? { type: 'seatModel', id: m.id, model: m.model } : null),
  // restart-backed dials: effort / bypass / the browser toggle. One field per
  // frame, rebuilt explicitly — chrome only ever a literal boolean.
  seatRelaunch: (m) => {
    if (!str(m.id)) return null;
    const out = { type: 'seatRelaunch', id: m.id };
    if (EFFORTS.has(m.effort)) out.effort = m.effort;
    else if (m.permissions === 'bypassPermissions') out.permissions = 'bypassPermissions';
    else if (typeof m.chrome === 'boolean') out.chrome = m.chrome;
    else return null;
    return out;
  },
  // permission answers pass through with their known fields; `input` and
  // `updates` are engine-validated downstream exactly as the desktop's are
  seatPerm: (m) => (str(m.id) && str(m.requestId)
    ? { type: 'seatPerm', id: m.id, requestId: m.requestId, allow: m.allow === true,
        input: m.input, updates: m.updates, choice: m.choice } : null),
  // Persona seats AND the blank seat (persona: '') — the desktop + button.
  // A blank seat's lane comes from the operator's own saved defaults
  // (seatconfig), which the phone cannot touch: the frame still carries NO
  // launch config, so this is exactly the desktop + press, no escalation.
  // An unknown persona name falls through presets and opens a plain seat,
  // same as the desktop rail. Terminals stay desktop-only (their verb is
  // never whitelisted).
  seatCreate: (m) => (typeof m.persona === 'string'
    ? { type: 'seatCreate', persona: m.persona, title: str(m.title) || undefined } : null),
  // The fork's board (main/tasks.js): 'taskList' is both the bare request
  // verb and the broadcast that answers it (and re-fires on every publish),
  // so the phone's board drawer stays live for free once it asks.
  taskList: () => ({ type: 'taskList' }),
};

// ---- outbound filter: everything the window gets, minus the floods the
// phone never renders (terminal bytes) ----
const OUTBOUND_SKIP = new Set(['ptyData', 'termData']);

function wsBroadcast(msg) {
  if (!clients.size) return;
  const frame = JSON.stringify(msg);
  for (const ws of clients) { try { ws.send(frame); } catch { /* dead socket — close event reaps it */ } }
}

function handleFrame(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  const clean = INBOUND[m && m.type] ? INBOUND[m.type](m) : undefined;
  if (clean === undefined) { log('mobile: dropped inbound type ' + (m && m.type)); return; }
  if (clean === null) return;   // known type, malformed frame
  if (clean.type === 'seatSend') {
    // the engine never echoes user turns (the view draws its own bubble) —
    // phones render from the bus.on('seatSend') echo below; the DESKTOP needs
    // this window-only copy so a phone-sent turn appears there live too
    const evt = { type: 'user', text: clean.text };
    if (clean.images) evt.images = clean.images;   // photo thumbs carry forward
    bus.post('seatEvt', { id: clean.id, m: evt }, { windowOnly: true });
  }
  bus.inject(clean);
}

// ---- html artifacts for the phone viewer ----
// The desktop iframe loads html via apex:// (an Electron protocol phones can't
// resolve), so the lane serves those files over HTTP — but ONLY paths the
// artifacts module has actually announced on the bus. The allowlist is the
// announcement stream itself; nothing else on disk is reachable.
const announcedHtml = new Set();
let lastUsage = null;   // latest usageData off the sink — replayed to each fresh connection
let lastCode = null;    // latest codeChanged — the phone's glowing-logo update cue
const lastArtifacts = new Map();   // seat id -> latest artifact msg — phones reload often,
                                   // and a fresh page has never heard the broadcast
function noteArtifact(msg) {
  if (msg.type === 'artifact' && msg.path) {
    if (msg.kind === 'html') announcedHtml.add(msg.path);
    if (msg.id) lastArtifacts.set(msg.id, msg);
  }
  if (msg.type === 'seatGone' && msg.id) lastArtifacts.delete(msg.id);
  if (msg.type === 'usageData') lastUsage = msg;
  if (msg.type === 'codeChanged') lastCode = msg;
}

// phone file uploads land here; the message carries the path and the seat
// Reads it like any local file — the universal lane (images stay API blocks)
const UPLOAD_DIR = path.resolve(__dirname, '..', 'state', 'mobile-uploads');
function handleUpload(req, res) {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 60_000_000) { res.writeHead(413); res.end(); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const name = String(body.name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
      const data = Buffer.from(String(body.data || ''), 'base64');
      if (!data.length) { res.writeHead(400); res.end(); return; }
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const file = path.join(UPLOAD_DIR, Date.now() + '-' + name);
      fs.writeFileSync(file, data);
      log('mobile: upload ' + name + ' (' + Math.round(data.length / 1024) + ' KB) -> ' + file);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: file }));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/upload') { handleUpload(req, res); return; }
  // transcript replay: pure read via the engine's own parser. Claude-lane
  // session ids only (codex threads replay live-only on the phone in v1).
  const replay = url.pathname.match(/^\/api\/replay\/([A-Za-z0-9-]+)$/);
  if (replay) {
    const { messages } = backfill(replay[1], path.join(os.homedir(), '.claude', 'projects'));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ messages }));
    return;
  }
  if (url.pathname === '/api/artifact') {
    const p = url.searchParams.get('p') || '';
    if (!announcedHtml.has(p)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(STATIC_ROOT, rel);
  // traversal guard: resolved path must stay inside mobile/
  if (!file.startsWith(STATIC_ROOT + path.sep) && file !== path.resolve(STATIC_ROOT, 'index.html')) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
                         'Cache-Control': 'no-cache' });   // iteration-friendly: phones re-validate every load
    res.end(data);
  });
}

function makeFace(bindIp) {
  // one face, any binding: identical handlers + walls on every listener
  const { WebSocketServer } = require('ws');
  const srv = http.createServer((req, res) => {
    if (!inTailnet(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return; }
    serveStatic(req, res);
  });
  const wss = new WebSocketServer({ server: srv });
  wss.on('connection', (ws, req) => {
    if (!inTailnet(req.socket.remoteAddress)) { ws.close(); return; }
    clients.add(ws);
    log('mobile: client connected (' + req.socket.remoteAddress + '), ' + clients.size + ' live');
    // a fresh phone shouldn't wait for the next broadcast to know the meters
    // or that an update is pending
    if (lastUsage) { try { ws.send(JSON.stringify(lastUsage)); } catch { /* reaped on close */ } }
    if (lastCode) { try { ws.send(JSON.stringify(lastCode)); } catch { /* reaped on close */ } }
    for (const a of lastArtifacts.values()) { try { ws.send(JSON.stringify(a)); } catch { /* reaped */ } }
    ws.on('message', (raw) => handleFrame(raw));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });
  return { srv, wss };
}

function listen(ip) {
  const face = makeFace(ip);
  server = face.srv;
  const onServerError = (e) => {
    // EADDRINUSE (another instance holds the port) / EADDRNOTAVAIL (Tailscale
    // dropped between discovery and bind) — quiet retry, NEVER a crash dialog
    if (!server) return;   // both emitters can fire for one failure — once is enough
    log('mobile: server error ' + e.code + ' — retrying in 30s');
    try { server.close(); } catch { /* already down */ }
    server = null;
    retryTimer = setTimeout(tryStart, 30000);
  };
  // ws@8 forwards the http server's 'error' onto the wss emitter — with no
  // listener there, EADDRINUSE became an UNCAUGHT exception (the 07-18 crash
  // dialog on the operator's desktop; repro'd + fix verified in isolation). The wss
  // handler must exist even though onServerError sees the same event.
  server.on('error', onServerError);
  face.wss.on('error', onServerError);
  server.listen(PORT, ip, () =>
    log('mobile: face up at http://' + ip + ':' + PORT + ' (tailnet only)'));
  // the loopback twin: same face, bound 127.0.0.1 — the door the
  // tailscale-serve HTTPS proxy walks through (it can't reach the TS-IP bind).
  // Best-effort: its failure never takes the tailnet listener down.
  if (!loopServer) {
    const twin = makeFace('127.0.0.1');
    loopServer = twin.srv;
    const onLoopError = (e) => {
      log('mobile: loopback twin error ' + e.code + ' — https lane down until restart');
      try { if (loopServer) loopServer.close(); } catch { /* already down */ }
      loopServer = null;
    };
    loopServer.on('error', onLoopError);
    twin.wss.on('error', onLoopError);
    loopServer.listen(PORT, '127.0.0.1', () =>
      log('mobile: loopback twin up at http://127.0.0.1:' + PORT + ' (for tailscale serve)'));
  }
}

function tryStart() {
  retryTimer = null;
  const ip = tailscaleIp();
  if (!ip) {
    log('mobile: no Tailscale interface — face stays down, retrying in 30s');
    retryTimer = setTimeout(tryStart, 30000);
    return;
  }
  listen(ip);
}

function register() {
  log = store.openLog('mobile');
  // everything main posts to the window flows to connected phones too,
  // minus the terminal-byte floods
  bus.sink((msg) => { noteArtifact(msg); if (!OUTBOUND_SKIP.has(msg.type)) wsBroadcast(msg); });
  // user-turn echo: fires for EVERY origin (desktop IPC and phone inject both
  // route through the bus) — phones draw user bubbles only from this, so a
  // desktop-sent turn appears on the phone and a phone-sent turn confirms back.
  // Attachments ride the echo too (that's how the sender's own thumbs render).
  bus.on('seatSend', (m) => {
    const evt = { type: 'user', text: m.text };
    if (Array.isArray(m.images) && m.images.length)
      evt.images = m.images.map((i) => ({ mediaType: i.mediaType, data: i.data }));
    wsBroadcast({ type: 'seatEvt', id: m.id, m: evt });
  });
  tryStart();
}

function dispose() {
  if (retryTimer) clearTimeout(retryTimer);
  for (const ws of clients) { try { ws.close(); } catch { /* shutting down */ } }
  clients.clear();
  if (server) { try { server.close(); } catch { /* shutting down */ } server = null; }
  if (loopServer) { try { loopServer.close(); } catch { /* shutting down */ } loopServer = null; }
}

module.exports = { register, dispose, tailscaleIp, PORT };
