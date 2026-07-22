// War Room — the round scheduler + budget governor (PURE: no fs, no Electron,
// no seats). A directive-returning state machine: main.js asks nextStep() for the
// next thing to do, drives the disposable seat, and reports the reply back. This
// split is what lets the whole orchestration be proven headlessly.
'use strict';

const prompts = require('./prompts');
const ideas = require('./ideas');

// Speaking order per phase. Contrarian sits out DIVERGE (nothing to attack yet)
// and LEADS the CLASH (its whole job is detonating the forming consensus).
const PHASE_ORDER = {
  diverge: ['brainstormer', 'architect', 'auditor', 'advocate'],
  clash: ['contrarian', 'brainstormer', 'architect', 'auditor', 'advocate'],
  converge: ['brainstormer', 'architect', 'auditor', 'advocate', 'contrarian'],
};
const phasesFor = (rounds) => (Number(rounds) <= 2 ? ['diverge', 'converge'] : ['diverge', 'clash', 'converge']);

const FETCH_BATCHES = 2;                 // apex-fetch batches the Auditor gets per session
const est = (s) => Math.ceil(String(s || '').length / 4);
const promptCost = (s) => est(s) + 250;  // ~250-token reply allowance (audit.js formula)

function createSession({ topic, config }) {
  const cfg = Object.assign({ rounds: 3, budget: 55000, models: {}, pack: { forRole: () => '' } }, config || {});
  const phases = phasesFor(cfg.rounds);

  const state = {
    topic: String(topic || ''),
    phaseIdx: 0,
    pos: 0,
    statements: [],          // {seq, phase, round, persona, text}
    failures: [],            // {round, persona} — seats that timed out / died
    seen: {},                // persona -> index into statements already relayed to it
    interjections: [],       // operator queue (drained into the next prompt)
    estTokens: 0,
    fetchBudget: FETCH_BATCHES,
    pendingFetch: null,      // {files:[...]} the Auditor asked for, awaiting main
    fetchResults: null,      // resolved file contents to inline into the Auditor's next prompt
    spoken: {},              // persona -> true once it has taken its first turn
    repairUsed: {},          // persona -> true (one quiet re-ask in converge)
    current: null,           // {persona, phase, round} awaiting a reply
    ideasByPersona: {},      // converge outputs
    status: 'running',
    stopReason: null,
    wrapRequested: false,
    stopRequested: false,
    cards: [],
  };

  const phaseName = () => phases[state.phaseIdx];
  const totalRounds = phases.length;

  function finalize(reason) {
    state.status = 'done';
    state.stopReason = reason;
    state.cards = ideas.rankIdeas(ideas.mergeIdeas(state.ideasByPersona));
    return { type: 'done', reason, cards: state.cards };
  }

  // Fresh statements this persona has not been shown yet, minus its own words.
  function othersFor(persona) {
    return state.statements.slice(state.seen[persona] || 0)
      .filter((s) => s.persona !== persona)
      .map((s) => ({ persona: s.persona, text: s.text }));
  }

  function nextStep() {
    if (state.status === 'done') return { type: 'done', reason: state.stopReason, cards: state.cards };
    if (state.stopRequested) return finalize('stopped');

    // Operator asked to wrap: jump straight to the converge phase.
    if (state.wrapRequested && phaseName() !== 'converge') {
      state.phaseIdx = phases.indexOf('converge');
      state.pos = 0;
      state.wrapRequested = false;
    }

    // Walk past any exhausted phases (advance phase; finish if none left).
    while (state.pos >= PHASE_ORDER[phaseName()].length) {
      state.phaseIdx += 1;
      state.pos = 0;
      if (state.phaseIdx >= phases.length) return finalize('complete');
    }

    const phase = phaseName();
    const persona = PHASE_ORDER[phase][state.pos];
    const roundNum = state.phaseIdx + 1;

    const usingFetch = persona === 'auditor' && state.fetchResults ? state.fetchResults : null;
    const drained = state.interjections.slice(0, prompts.MAX_INTERJECT);
    const roundPrompt = prompts.buildRoundPrompt(persona, {
      phase, roundNum, totalRounds, topic: state.topic,
      others: othersFor(persona), interjections: drained, fetchResults: usingFetch,
    });
    // A persona's FIRST turn carries its identity + role-appropriate context pack
    // folded in front of the round prompt — no wasted priming turn, and the cost
    // is charged here so the budget governor sees it.
    const prompt = state.spoken[persona]
      ? roundPrompt
      : prompts.buildKickoff(persona, { topic: state.topic, pack: cfg.pack.forRole(persona) }) + '\n\n' + roundPrompt;
    const cost = promptCost(prompt);

    // Budget governor. Before converge, an over-budget send collapses the room
    // straight to converge (we still want structured ideas out). In converge, if
    // the budget is already spent we stop with whatever ideas exist.
    if (phase !== 'converge') {
      if (state.estTokens + cost > cfg.budget) {
        state.phaseIdx = phases.indexOf('converge');
        state.pos = 0;
        return { type: 'converge-now', reason: 'budget' };
      }
    } else if (state.estTokens >= cfg.budget) {
      return finalize('budget');
    }

    // Commit the send.
    state.estTokens += cost;
    state.spoken[persona] = true;
    state.seen[persona] = state.statements.length;
    if (drained.length) state.interjections = state.interjections.slice(drained.length);
    if (usingFetch) state.fetchResults = null;
    state.current = { persona, phase, round: roundNum };
    state.pos += 1;

    return { type: 'send', persona, phase, round: roundNum, model: cfg.models[persona] || prompts.PERSONA_BY_KEY[persona].model, prompt, estCost: cost };
  }

  // A seat finished its turn. Returns {needsRepair} so main can decide on one re-ask.
  function recordReply(text) {
    if (!state.current) return { needsRepair: false };
    const { persona, phase, round } = state.current;
    state.estTokens += est(text);                 // charge the real reply length
    const stored = String(text || '').slice(0, prompts.SAY_CAP);
    state.statements.push({ seq: state.statements.length, phase, round, persona, text: stored });

    let needsRepair = false;
    if (phase === 'converge') {
      const parsed = ideas.validateIdeas(ideas.extractIdeas(text).raw);
      state.ideasByPersona[persona] = parsed;
      needsRepair = parsed.length === 0 && !state.repairUsed[persona];
    } else if (persona === 'auditor' && state.fetchBudget > 0 && !state.pendingFetch) {
      const fr = ideas.extractFetch(text);
      if (fr && fr.files.length) state.pendingFetch = { files: fr.files };
    }
    state.current = null;
    return { needsRepair, persona, phase };
  }

  // A seat timed out or died — note it, skip it, keep the room alive.
  function recordFailure() {
    if (!state.current) return;
    state.failures.push({ round: state.current.round, persona: state.current.persona });
    state.current = null;
  }

  // One quiet converge re-ask for a persona that produced no parseable ideas.
  function repair(persona) {
    if (state.repairUsed[persona]) return null;
    state.repairUsed[persona] = true;
    const prompt = 'Your last message had no valid ```apex-ideas block. Emit ONLY that fenced ' +
      'block now — your ranked ideas as JSON, nothing else.';
    state.estTokens += promptCost(prompt);
    state.current = { persona, phase: 'converge', round: totalRounds };
    return prompt;
  }

  // main pulls the Auditor's file request, reads the files, and hands them back.
  const pendingFetch = () => state.pendingFetch;
  function provideFetch(results) {
    state.fetchResults = Array.isArray(results) ? results : [];
    state.pendingFetch = null;
    state.fetchBudget -= 1;
  }

  function interject(text) {
    const t = String(text || '').trim();
    if (!t) return;
    if (state.interjections.length < 20) state.interjections.push(t);
  }
  const wrapUp = () => { state.wrapRequested = true; };
  const stop = () => { state.stopRequested = true; };

  function snapshot() {
    return {
      topic: state.topic,
      status: state.status,
      phase: phaseName(),
      round: state.phaseIdx + 1,
      totalRounds,
      estTokens: state.estTokens,
      budget: cfg.budget,
      speaking: state.current ? state.current.persona : null,
      statements: state.statements.map((s) => ({ round: s.round, phase: s.phase, persona: s.persona, text: s.text })),
      failures: state.failures.slice(),
      stopReason: state.stopReason,
      cards: state.cards,
    };
  }

  return {
    nextStep, recordReply, recordFailure, repair,
    pendingFetch, provideFetch, interject, wrapUp, stop, snapshot,
    get status() { return state.status; },
    get estTokens() { return state.estTokens; },
    get budget() { return cfg.budget; },
    get cards() { return state.cards; },
    _state: state,   // drill introspection only
  };
}

module.exports = { createSession, phasesFor, PHASE_ORDER, FETCH_BATCHES };
