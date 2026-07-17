// Apex — monitors data plane (main side). Owns: config load, source
// lifecycle, the ready/action contract. Sources are swappable modules
// behind one seam: start(pane, ctx) -> stop(), action(pane, id, ctx).
// Adding a source type touches this table and nothing else.
'use strict';

const fs = require('fs');
const path = require('path');
const bus = require('./../bus');

const SOURCES = {
  'demo':      require('./sourceDemo'),
  'http-json': require('./sourceHttp'),  // generic JSON endpoint client
  'system':    require('./sourceSystem'),// base-install: local machine stats, zero permissions
  'weather':   require('./sourceWeather'),// base-install: Open-Meteo, keyless
  'mcp':       require('./sourceMcp')    // MCP servers: active-in-project + available inventory, health via `claude mcp list`
};

function loadConfig() {
  for (const name of ['panes.json', 'panes.sample.json']) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
      catch (e) { console.warn(`monitors: ${name} unparseable — ${e.message}`); }
    }
  }
  return { panes: [] };
}

let stops = [];

function register() {
  const cfg = loadConfig();

  bus.on('ready', () => {
    bus.post('config', { panes: cfg.panes });
    stops.forEach((s) => { try { s(); } catch {} });   // re-ready after reload
    stops = [];
    for (const pane of cfg.panes) {
      const src = SOURCES[(pane.source && pane.source.type) || 'demo'];
      if (!src) continue;
      const ctx = makeCtx(pane);
      const stop = src.start(pane, ctx);
      if (stop) stops.push(stop);
    }
  });

  bus.on('action', (m) => {
    const pane = cfg.panes.find((p) => p.id === m.paneId);
    if (!pane) return;
    const src = SOURCES[(pane.source && pane.source.type) || 'demo'];
    if (src && src.action) src.action(pane, m.actionId, makeCtx(pane));
  });
}

function makeCtx(pane) {
  return {
    emit: (data) => bus.post('data', { paneId: pane.id, data }),
    log:  (line) => bus.post('actionLog', { paneId: pane.id, line: String(line) }),
    busy: (b)    => bus.post('actionState', { paneId: pane.id, busy: !!b })
  };
}

function dispose() { stops.forEach((s) => { try { s(); } catch {} }); stops = []; }

module.exports = { register, dispose };
