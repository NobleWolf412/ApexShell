// Apex — generic http-json monitor source. The shell owns no remote-service
// logic on this path: it polls state, renders fields, and posts named actions.
// If this window dies, the service it observes never notices.
//
// Adaptive poll: refreshSecs when idle, 2s while the pane is busy so live
// rate updates (speed tests) reach the gauges. Log lines carry a monotonic
// seq from the service; only unseen lines are forwarded.
'use strict';

const http = require('http');

function getJson(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve({ ok: true, json: JSON.parse(body) }); }
        catch { resolve({ ok: false }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false }));
  });
}

function postJson(url, obj, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(obj);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
    req.write(body);
    req.end();
  });
}

const mem = new Map();   // paneId -> { lastSeq, busy, timer, stopped }

// This source forwards a REMOTE endpoint's JSON into the widget bind layer.
// Coerce each bound field to the type its widget kind expects, so a malformed
// or hostile endpoint can't hand a gauge a string or a list a scalar (the
// renderer guards too, but the source owns the trust boundary). Unbound fields
// pass through untouched — the renderer only reads bound ones. (Audit F4.)
const LED_STATES = new Set(['good', 'warning', 'critical', 'idle']);
function coerceByKind(pane, data) {
  const kinds = {};
  for (const w of (pane.widgets || [])) if (w.bind) kinds[w.bind] = w.kind;
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    switch (kinds[k]) {
      case 'gauge': out[k] = Number.isFinite(+v) ? +v : 0; break;
      case 'led':   out[k] = LED_STATES.has(v) ? v : 'idle'; break;
      case 'list':
      case 'tiles': out[k] = Array.isArray(v) ? v : []; break;
      case 'stat':  out[k] = (v == null || typeof v === 'object') ? '' : v; break;
      default:      out[k] = v;   // unbound, or log/settings — not rendered by value
    }
  }
  return out;
}

function start(pane, ctx) {
  const src = pane.source;
  const remote = src.pane || pane.id;
  const st = { lastSeq: 0, busy: false, timer: null, stopped: false };
  mem.set(pane.id, st);

  const poll = async () => {
    const r = await getJson(`${src.base}/api/state`);
    if (st.stopped) return;
    const p = r.ok && r.json.panes && r.json.panes[remote];
    if (!p) {
      ctx.emit({ tunnel: 'critical', region: 'svc offline', down: 0, up: 0,
                 pf: '?', wired: 'critical', containers: '?' });
      schedule(false);
      return;
    }
    ctx.emit(coerceByKind(pane, p.data));
    for (const entry of p.log || []) {
      if (entry.i > st.lastSeq) { st.lastSeq = entry.i; ctx.log(entry.line); }
    }
    if (p.busy !== st.busy) { st.busy = p.busy; ctx.busy(p.busy); }
    schedule(p.busy);
  };

  const schedule = (busy) => {
    if (st.stopped) return;
    clearTimeout(st.timer);
    st.timer = setTimeout(poll, busy ? 2000 : Math.max(5, pane.refreshSecs || 20) * 1000);
  };

  st.poll = poll;
  poll();
  return () => { st.stopped = true; clearTimeout(st.timer); mem.delete(pane.id); };
}

async function action(pane, actionId, ctx) {
  const src = pane.source;
  const code = await postJson(`${src.base}/api/action`,
    { paneId: src.pane || pane.id, actionId });
  if (code === 202) {
    // accepted — snap to a fast poll so busy + log lines land immediately
    ctx.busy(true);
    const st = mem.get(pane.id);
    if (st && !st.stopped) { clearTimeout(st.timer); st.timer = setTimeout(st.poll, 300); }
  } else if (code === 409) {
    ctx.log('busy — an action is already running');
  } else {
    ctx.log(`✕ Command Center unreachable (HTTP ${code || 'no answer'})`);
  }
}

module.exports = { start, action };
