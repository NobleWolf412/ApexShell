// War Room — main process. Orchestrates five hidden disposable seats through a
// round-based deliberation and converges them on a ranked idea list.
//
// Cost posture: the moderator (this file + lib/session.js) sits between every
// utterance in plain code. Disposable seats are tool-less (text in / text out) —
// the personas think, this file relays bounded digests and reads any files they
// ask for. A hard token ceiling auto-stops the room; nothing here runs without an
// operator pressing Start.
'use strict';

const fs = require('fs');
const path = require('path');
const prompts = require('./lib/prompts');
const ideas = require('./lib/ideas');
const pack = require('./lib/pack');
const { createSession } = require('./lib/session');

const TURN_BACKSTOP_MS = 120000;   // a hung/quota-stalled persona is skipped, room survives
const DEFAULT_MODELS = Object.fromEntries(prompts.PERSONAS.map((p) => [p.key, p.model]));

let teardown = () => {};           // set by register so the module-level dispose can reach the live room

function register(ctx) {
  const cfgFile = path.join(ctx.stateDir, 'config.json');
  const sessDir = path.join(ctx.stateDir, 'sessions');
  try { fs.mkdirSync(sessDir, { recursive: true }); } catch { /* best effort */ }

  const loadCfg = () => {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { /* defaults */ }
    return {
      repo: typeof c.repo === 'string' ? c.repo : '',
      budget: Number.isFinite(c.budget) ? c.budget : 55000,
      rounds: c.rounds === 2 ? 2 : 3,
      models: Object.assign({}, DEFAULT_MODELS, c.models || {}),
    };
  };
  const saveCfg = (c) => { try { fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); } catch { /* */ } };

  // The one live room (one session at a time). `seats` = persona -> controller box.
  let room = null;

  const nowIso = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);

  function postStatus() {
    const cfg = loadCfg();
    const base = {
      running: !!(room && room.session.status === 'running'),
      repo: cfg.repo, repoName: cfg.repo ? path.basename(cfg.repo) : '',
      models: cfg.models, budget: cfg.budget, rounds: cfg.rounds,
    };
    if (room) {
      const snap = room.session.snapshot();
      Object.assign(base, {
        topic: room.topic, phase: snap.phase, round: snap.round, totalRounds: snap.totalRounds,
        estTokens: snap.estTokens, sessionBudget: room.session.budget, speaking: snap.speaking,
        statements: snap.statements, stopReason: snap.stopReason,
        cards: room.cards || [], reportPath: room.reportPath || '',
      });
    }
    ctx.bus.post('warroomStatus', base);
  }

  function persist() {
    if (!room) return;
    const snap = room.session.snapshot();
    const rec = {
      id: room.id, topic: room.topic, started: room.started, status: snap.status,
      stopReason: snap.stopReason, estTokens: snap.estTokens, budget: room.session.budget,
      rounds: room.rounds, models: room.models, repo: room.repo, reportPath: room.reportPath || '',
      transcript: snap.statements, cards: room.cards || [],
    };
    try { fs.writeFileSync(path.join(sessDir, room.id + '.json'), JSON.stringify(rec, null, 2)); }
    catch { /* best effort */ }
  }

  // ---- one persona turn ----------------------------------------------------
  function spawnSeat(persona, model) {
    const box = { ctrl: null, buf: '', delta: '', timer: null, pending: false };
    const onEvent = (ev) => {
      if (!ev) return;
      if (ev.type === 'delta') { box.delta += ev.text || ''; ctx.bus.post('warroomDelta', { persona, text: ev.text || '' }); }
      else if (ev.type === 'text') { box.buf += (box.buf ? '\n\n' : '') + (ev.text || ''); }
      else if (ev.type === 'result') finishTurn(persona, box, ev.ok !== false);
      else if (ev.type === 'dead') finishTurn(persona, box, false);
    };
    box.ctrl = ctx.seats.startDisposable({ model, onEvent });
    return box;
  }

  function deliver(persona, promptText, model) {
    if (!room) return;
    let box = room.seats[persona];
    if (!box) { box = spawnSeat(persona, model || room.models[persona]); room.seats[persona] = box; }
    box.buf = ''; box.delta = ''; box.pending = true;
    box.timer = setTimeout(() => {
      ctx.bus.post('warroomDelta', { persona, text: '\n(timed out — skipped)\n' });
      finishTurn(persona, box, false);
    }, TURN_BACKSTOP_MS);
    ctx.bus.post('warroomSpeaking', { persona });
    box.ctrl.send(promptText);
  }

  function finishTurn(persona, box, ok) {
    if (!box.pending) return;               // stray/late event
    box.pending = false;
    if (box.timer) { clearTimeout(box.timer); box.timer = null; }
    if (!room) return;

    if (ok) {
      const reply = (box.buf || box.delta).trim();
      const info = room.session.recordReply(reply);
      ctx.bus.post('warroomStatement', { persona, text: reply.slice(0, prompts.SAY_CAP) });

      // The Auditor asked for files — read them (guarded) and hand them back so
      // its NEXT turn is grounded in real bytes.
      const pf = room.session.pendingFetch();
      if (pf) {
        const results = pack.readFetch(room.repo, pf.files);
        room.session.provideFetch(results);
        ctx.bus.post('warroomDelta', { persona: 'auditor', text: '\n[fetched: ' + pf.files.join(', ') + ']\n' });
      }
      // Converge reply with no parseable ideas → one quiet re-ask, same seat.
      if (info.needsRepair) {
        const rp = room.session.repair(info.persona);
        if (rp) { persist(); postStatus(); deliver(info.persona, rp); return; }
      }
    } else {
      room.session.recordFailure();
    }
    persist();
    postStatus();
    advance();
  }

  function advance() {
    if (!room || room.session.status === 'done') return;
    const step = room.session.nextStep();
    if (step.type === 'done') { finishSession(); return; }
    if (step.type === 'converge-now') {
      ctx.bus.post('toast', { text: 'War room hit its token budget — converging now.' });
      advance();
      return;
    }
    deliver(step.persona, step.prompt, step.model);
  }

  function reportTarget() {
    if (room.reportPath) return room.reportPath;           // re-export overwrites our own file
    const dir = path.join(room.repo, 'war-room');
    let file = path.join(dir, 'ideas-' + room.date + '.md');
    let n = 2;
    while (fs.existsSync(file)) { file = path.join(dir, 'ideas-' + room.date + '-' + n + '.md'); n += 1; }
    return file;
  }

  function writeReport() {
    if (!room || !room.repo) return null;
    const snap = room.session.snapshot();
    const md = ideas.renderReport({
      topic: room.topic, date: room.date, models: room.models,
      estTokens: snap.estTokens, budget: room.session.budget, rounds: room.rounds,
      stopReason: snap.stopReason, cards: room.cards, statements: snap.statements,
    });
    try {
      const file = reportTarget();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, md);
      room.reportPath = file;
      return file;
    } catch (e) { ctx.bus.post('toast', { text: 'Could not write report: ' + e.message }); return null; }
  }

  function finishSession() {
    room.cards = room.session.cards.slice();
    for (const box of Object.values(room.seats)) { try { box.ctrl.close(); } catch { /* */ } if (box.timer) clearTimeout(box.timer); }
    const file = writeReport();
    persist();
    postStatus();
    const snap = room.session.snapshot();
    ctx.bus.post('warroomDone', {
      reason: snap.stopReason, count: room.cards.length,
      estTokens: snap.estTokens, reportPath: file || '',
    });
    ctx.bus.post('toast', {
      text: 'War room done — ' + room.cards.length + ' ideas, ~' +
        Math.round(snap.estTokens / 1000) + 'k tokens' + (file ? ' → ' + path.relative(room.repo, file) : '') + '.',
    });
  }

  // ---- bus verbs -----------------------------------------------------------
  ctx.bus.on('warroomStatus', () => postStatus());

  ctx.bus.on('warroomPickRepo', async () => {
    if (!ctx.pickDirectory) { ctx.bus.post('toast', { text: 'No folder picker available.' }); return; }
    const dir = await ctx.pickDirectory({ title: 'Choose the repo the War Room reasons about' });
    if (!dir) return;
    const cfg = loadCfg(); cfg.repo = dir; saveCfg(cfg);
    ctx.bus.post('toast', { text: 'War Room repo: ' + path.basename(dir) });
    postStatus();
  });

  ctx.bus.on('warroomConfig', (m) => {
    const cfg = loadCfg();
    if (m && m.models && typeof m.models === 'object') {
      for (const k of Object.keys(DEFAULT_MODELS)) {
        if (['haiku', 'sonnet', 'opus', 'fable'].includes(m.models[k])) cfg.models[k] = m.models[k];
      }
    }
    if (m && Number.isFinite(m.budget)) cfg.budget = Math.max(10000, Math.min(150000, Math.round(m.budget)));
    if (m && (m.rounds === 2 || m.rounds === 3)) cfg.rounds = m.rounds;
    saveCfg(cfg);
    postStatus();
  });

  ctx.bus.on('warroomStart', (m) => {
    if (room && room.session.status === 'running') { ctx.bus.post('toast', { text: 'A war room is already running.' }); return; }
    if (!ctx.seats || typeof ctx.seats.startDisposable !== 'function') { ctx.bus.post('toast', { text: 'Seat engine unavailable.' }); return; }
    const topic = (m && m.topic || '').trim();
    if (!topic) { ctx.bus.post('toast', { text: 'Give the war room a topic or problem to chew on.' }); return; }
    const cfg = loadCfg();
    if (!cfg.repo || !fs.existsSync(cfg.repo)) { ctx.bus.post('toast', { text: 'Pick the repo the room reasons about first.' }); return; }

    const contextFiles = String((m && m.contextFiles) || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    let builtPack;
    try { builtPack = pack.buildPack(cfg.repo, contextFiles); }
    catch (e) { ctx.bus.post('toast', { text: 'Could not read the repo: ' + e.message }); return; }

    const session = createSession({ topic, config: { rounds: cfg.rounds, budget: cfg.budget, models: cfg.models, pack: builtPack } });
    room = {
      id: 'wr-' + Date.now(), topic, started: nowIso(), date: today(),
      repo: cfg.repo, rounds: cfg.rounds, models: cfg.models,
      session, seats: {}, cards: [], reportPath: '',
    };
    ctx.bus.post('warroomStarted', { topic, id: room.id });
    persist();
    postStatus();
    advance();
  });

  ctx.bus.on('warroomSay', (m) => {
    const text = (m && m.text || '').trim();
    if (!room || !text) return;
    room.session.interject(text);
    ctx.bus.post('warroomStatement', { persona: 'operator', text });
    ctx.bus.post('toast', { text: 'Sent to the room — it lands on the next turn.' });
  });

  ctx.bus.on('warroomWrapup', () => { if (room && room.session.status === 'running') { room.session.wrapUp(); ctx.bus.post('toast', { text: 'Wrapping up — the room converges now.' }); } });
  ctx.bus.on('warroomStop', () => {
    if (!room) return;
    room.session.stop();
    if (room.session.status === 'running') advance();   // drives to finalize + report
    else finishSession();
  });

  ctx.bus.on('warroomIdeaStatus', (m) => {
    if (!room || !m || !m.id) return;
    const card = (room.cards || []).find((c) => c.id === m.id);
    if (!card) return;
    card.status = m.status === 'approved' ? 'approved' : m.status === 'dismissed' ? 'dismissed' : 'proposed';
    persist();
    postStatus();
  });

  ctx.bus.on('warroomExport', () => {
    if (!room) { ctx.bus.post('toast', { text: 'No session to export yet.' }); return; }
    const file = writeReport();
    if (file) { ctx.bus.post('toast', { text: 'Report written → ' + path.relative(room.repo, file) }); postStatus(); }
  });

  // Let the module-level dispose() close any live seats on teardown.
  teardown = () => {
    if (!room) return;
    for (const box of Object.values(room.seats)) { try { box.ctrl.close(); } catch { /* */ } if (box.timer) clearTimeout(box.timer); }
  };
}

// Best-effort teardown if the app tears the extension down mid-session. Disposables
// self-clean their scratch dirs on exit; a hard quit lets the OS reap them anyway.
function dispose() { try { teardown(); } catch { /* */ } }

module.exports = { register, dispose, _internals: { TURN_BACKSTOP_MS, DEFAULT_MODELS } };
