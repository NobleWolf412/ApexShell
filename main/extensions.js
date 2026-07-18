// Apex — extension loader. The shell is a bare frame; anything that assumes
// a particular tree, vendor, or household lives in app/extensions/<name>/
// and plugs in here. One extension = one folder with an extension.json:
//
//   { "name": "...",            display/logging name
//     "main": "main.js",        optional — main-process module, register(ctx)
//     "renderer": "renderer.js" optional — renderer script, injected post-boot
//     "styles": ["style.css"] } optional — stylesheets, injected before it
//
// Main side loads eagerly at window creation (same lifecycle as the built-in
// modules). Renderer side is pull-based: the renderer's extensions.js asks
// for the manifest on boot ('extList') and injects script/link tags — the
// shell is fully booted by then, so extension renderers can register dock
// panes via ApexShell.registerDockPane.
//
// A broken extension must never take the shell down: every load is
// try-wrapped, failures toast + log, the rest continue.
'use strict';

const fs = require('fs');
const path = require('path');
const bus = require('./bus');
const { stateDirFor, chooseDirectory } = require('./extensionServices');

const EXT_DIR = path.join(__dirname, '..', 'extensions');
const STATE_ROOT = path.join(__dirname, '..', 'state', 'extensions');

const loaded = [];    // { name, dir, manifest, mod }
const failed = [];    // load-failure toasts, replayed once the renderer exists
                      // (a toast posted before the window loads is lost —
                      // Codex review, R32)

function discover() {
  let names;
  try { names = fs.readdirSync(EXT_DIR, { withFileTypes: true }); }
  catch { return []; }   // no extensions/ dir = bare install, fine
  const found = [];
  for (const e of names) {
    if (!e.isDirectory()) continue;
    const dir = path.join(EXT_DIR, e.name);
    const mf = path.join(dir, 'extension.json');
    if (!fs.existsSync(mf)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
      found.push({ name: manifest.name || e.name, folder: e.name, dir, manifest });
    } catch (err) {
      console.error('[extensions] bad manifest ' + mf + ':', err.message);
    }
  }
  // Load ORDER matters when one extension exposes a global others register into
  // (studio's ApexStudio ← the personas renderer). Optional manifest `priority`
  // (lower loads first, default 0) sorts both the main-half register() calls and
  // the renderer-injection order; the renderer runs them async=false to honor it.
  found.sort((a, b) =>
    ((a.manifest.priority || 0) - (b.manifest.priority || 0)) || a.name.localeCompare(b.name));
  return found;
}

function register(services) {
  for (const ext of discover()) {
    let mod = null;
    if (ext.manifest.main) {
      try {
        const stateDir = stateDirFor(STATE_ROOT, ext.folder);
        fs.mkdirSync(stateDir, { recursive: true });
        mod = require(path.join(ext.dir, ext.manifest.main));
        if (typeof mod.register === 'function')
          mod.register({
            ...(services || {}),
            // registerPreset carries WHO registered it — presets need an owner
            // for conflict handling, and extensions can't be trusted to
            // self-identify consistently (apex-personas never did).
            ...(services && services.seats ? {
              seats: {
                ...services.seats,
                registerPreset: (p) => services.seats.registerPreset(p, ext.name),
              },
            } : {}),
            bus,
            extDir: ext.dir,
            stateDir,
            pickDirectory: (options) => {
              // Electron is resolved only when a human clicks a picker-backed
              // control; pure extension tests never need an Electron process.
              const { dialog } = require('electron');
              return chooseDirectory(dialog, options);
            },
          });
      } catch (err) {
        console.error('[extensions] ' + ext.name + ' main failed:', err.message);
        failed.push('Extension ' + ext.name + ' failed to load: ' + err.message);
        continue;   // a failed main must not ship its renderer half
      }
    }
    loaded.push({ ...ext, mod });
  }

  // Failures surface when a renderer exists to show them (every load/reload).
  bus.on('ready', () => failed.forEach((text) => bus.post('toast', { text })));

  // Renderer asks on boot (and on every reload — each fresh document asks again).
  bus.on('extList', () => {
    bus.post('extList', {
      extensions: loaded.map((ext) => ({
        name: ext.name,
        // paths relative to renderer/index.html — the renderer injects these verbatim
        renderer: ext.manifest.renderer ? '../extensions/' + ext.folder + '/' + ext.manifest.renderer : null,
        styles: (ext.manifest.styles || []).map((s) => '../extensions/' + ext.folder + '/' + s),
      })),
    });
  });
}

function dispose() {
  for (const ext of loaded) {
    try { if (ext.mod && typeof ext.mod.dispose === 'function') ext.mod.dispose(); }
    catch (e) { console.error('[extensions] ' + ext.name + ' dispose:', e.message); }
  }
}

module.exports = { register, dispose };

