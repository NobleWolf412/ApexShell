// Wiki Pipeline — main process. Wires the mechanical store to a token-spending
// compile step, and speaks the bus to the dock pane.
//
// Cost posture (design/wiki-pipeline-cost.md): intake/queue are pure code (free);
// the ONLY model spend is compile, one bounded entry at a time, and a queue with
// nothing in it spawns nothing. The compile seat is tool-less (text in/out) — the
// model reasons, this file writes the files.
'use strict';

const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const { buildPrompt, parseOutput } = require('./lib/compile');

const COMPILE_TIMEOUT_MS = 6 * 60 * 1000;

function register(ctx) {
  const root = path.join(ctx.stateDir, 'store');
  const store = Store(root);
  store.ensure();
  const cfgFile = path.join(ctx.stateDir, 'config.json');
  const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { return {}; } };
  const saveCfg = (c) => { try { fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); } catch { /* best effort */ } };

  let active = null;      // { controller, timer, stem } — the in-flight compile
  let stopAll = false;

  const nowIso = () => new Date().toISOString();
  const postStatus = () => ctx.bus.post('wikiStatus',
    Object.assign(store.status(), { compiling: !!active, voice: loadCfg().voice || '' }));

  // Compile ONE entry. Resolves with {stem, pages, skipped} or rejects.
  function compileOne(entry) {
    return new Promise((resolve, reject) => {
      if (!ctx.seats || typeof ctx.seats.startDisposable !== 'function')
        return reject(new Error('Seat engine unavailable — cannot compile.'));
      let text = '';
      try { text = store.readRaw(entry.stem); } catch (e) { return reject(e); }

      const kickoff = buildPrompt({
        store, entryStem: entry.stem, entryText: text, personaVoice: loadCfg().voice || '',
      });
      let finalText = '', deltaText = '', done = false;
      const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); try { ctrl.close(); } catch { /* */ } active = null; fn(); };

      ctx.bus.post('wikiCompileStatus', { phase: 'running', stem: entry.stem, title: entry.title });

      const onEvent = (event) => {
        if (event.type === 'text') finalText += (finalText ? '\n\n' : '') + (event.text || '');
        else if (event.type === 'delta') deltaText += event.text || '';
        else if (event.type === 'result') {
          if (!event.ok) return finish(() => reject(new Error('Compile turn failed.')));
          const answer = (finalText || deltaText).trim();
          const parsed = parseOutput(answer);
          if (parsed.skip) {
            store.markCompiled(entry.stem, [], nowIso());   // record it so it leaves the queue
            return finish(() => resolve({ stem: entry.stem, pages: [], skipped: true }));
          }
          if (!parsed.files.length)
            return finish(() => reject(new Error('Compile produced no wiki file blocks.')));
          const written = [];
          for (const f of parsed.files) {
            try { written.push(store.writePage(f.path, f.content)); }
            catch (e) { ctx.log && ctx.log('wiki write failed: ' + e.message); }
          }
          if (!written.length) return finish(() => reject(new Error('No pages could be written.')));
          store.markCompiled(entry.stem, written, nowIso());
          finish(() => resolve({ stem: entry.stem, pages: written, skipped: false }));
        } else if (event.type === 'dead') {
          finish(() => reject(new Error('Compile seat exited before finishing.')));
        }
      };

      const ctrl = ctx.seats.startDisposable({ kickoff, onEvent });
      const timer = setTimeout(() => finish(() => reject(new Error('Compile timed out.'))), COMPILE_TIMEOUT_MS);
      active = { controller: ctrl, timer, stem: entry.stem };
    });
  }

  async function runQueue(all) {
    if (active) { ctx.bus.post('toast', { text: 'A compile is already running.' }); return; }
    stopAll = false;
    let q = store.queue();
    if (!q.length) { ctx.bus.post('toast', { text: 'Nothing to compile — queue is empty (no tokens spent).' }); postStatus(); return; }
    do {
      const entry = q[0];
      try {
        const r = await compileOne(entry);
        ctx.bus.post('wikiCompileStatus', {
          phase: 'done', stem: r.stem, pages: r.pages, skipped: r.skipped,
        });
      } catch (err) {
        ctx.bus.post('wikiCompileStatus', { phase: 'error', stem: entry.stem, error: err.message });
        ctx.bus.post('toast', { text: 'Compile failed: ' + err.message });
        break;   // leave the entry in the queue; don't thrash
      }
      postStatus();
      if (!all || stopAll) break;
      q = store.queue();
    } while (q.length);
    ctx.bus.post('wikiCompileStatus', { phase: 'idle' });
    postStatus();
  }

  // ---- bus verbs ----
  ctx.bus.on('wikiStatus', () => postStatus());
  ctx.bus.on('wikiIngest', (m) => {
    const title = (m && m.title || '').trim() || 'entry';
    const text = (m && m.text) || '';
    if (!text.trim()) { ctx.bus.post('toast', { text: 'Nothing to add — the entry is empty.' }); return; }
    const stem = store.ingest(title, text);
    ctx.bus.post('toast', { text: 'Added entry: ' + stem });
    postStatus();
  });
  ctx.bus.on('wikiCompileNext', () => runQueue(false));
  ctx.bus.on('wikiCompileAll', () => runQueue(true));
  ctx.bus.on('wikiStop', () => {
    stopAll = true;
    if (active) { try { active.controller.close(); } catch { /* */ } active = null; }
    ctx.bus.post('wikiCompileStatus', { phase: 'idle' });
    postStatus();
  });
  ctx.bus.on('wikiReadPage', (m) => {
    try { ctx.bus.post('wikiPage', { name: m.name, content: store.readPage(m.name) }); }
    catch (e) { ctx.bus.post('toast', { text: 'Cannot open page: ' + e.message }); }
  });
  ctx.bus.on('wikiSearch', (m) => {
    ctx.bus.post('wikiSearchResult', { term: m && m.term, results: store.searchPages(m && m.term) });
  });
  ctx.bus.on('wikiSetVoice', (m) => {
    const c = loadCfg(); c.voice = (m && m.persona || '').trim(); saveCfg(c);
    ctx.bus.post('toast', { text: c.voice ? ('Compile voice: ' + c.voice) : 'Compile voice cleared.' });
    postStatus();
  });
}

module.exports = { register, _internals: { COMPILE_TIMEOUT_MS } };
