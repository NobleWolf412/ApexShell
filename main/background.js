// Apex — stage background state (main side). The renderer gets an apex:// URL
// to paint, but native file picking and persistence remain in the main process.
'use strict';

const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const bus = require('./bus');
const store = require('./store');

const FILE = path.join(__dirname, '..', 'background.json');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']);

function validImage(file) {
  if (typeof file !== 'string' || !IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    return false;
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function normalize(raw) {
  const dim = Number(raw && raw.dim);
  return {
    path: raw && validImage(raw.path) ? raw.path : '',
    fit: raw && raw.fit === 'contain' ? 'contain' : 'cover',
    dim: Number.isFinite(dim) ? Math.min(.85, Math.max(0, dim)) : .42
  };
}

function load() {
  try { return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch { return normalize(null); }
}

function save(state) {
  const clean = normalize(state);
  store.writeJsonAtomic(FILE, clean);
  return clean;
}

function post(state) {
  bus.post('background', { background: state || load() });
}

function register() {
  bus.on('backgroundGet', () => post());

  bus.on('backgroundPick', async () => {
    let picked;
    try {
      picked = await dialog.showOpenDialog({
        title: 'Choose stage background',
        properties: ['openFile'],
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']
        }]
      });
    } catch (e) {
      bus.post('toast', { text: 'Could not open image picker: ' + e.message });
      return;
    }

    if (picked.canceled || !picked.filePaths[0]) return;
    if (!validImage(picked.filePaths[0])) {
      bus.post('toast', { text: 'That file is not a readable image' });
      return;
    }

    const next = load();
    next.path = picked.filePaths[0];
    post(save(next));
  });

  bus.on('backgroundSet', (m) => {
    const next = load();
    if (m.fit === 'cover' || m.fit === 'contain') next.fit = m.fit;
    if (Number.isFinite(Number(m.dim)))
      next.dim = Math.min(.85, Math.max(0, Number(m.dim)));
    post(save(next));
  });

  bus.on('backgroundClear', () => {
    const next = load();
    next.path = '';
    post(save(next));
  });
}

module.exports = { register };
