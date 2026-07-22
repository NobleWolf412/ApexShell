// War Room — the idea contract + merge/rank + report (PURE: no fs, no Electron).
//
// A converge-round seat emits ONE fenced ```apex-ideas JSON block. That output is
// UNTRUSTED (model text, repo-content-influenceable), so validation is a strict
// allowlist: a fresh object is built field-by-field with hard caps, and everything
// else is dropped. Same discipline as engine/audit.js + engine/handoff.js.
'use strict';

const MAX_IDEAS = 6;
const CAP = { title: 80, pitch: 500, novelty: 300, evidence: 400, id: 40 };
const FEAS = new Set(['high', 'medium', 'low']);
const FEAS_RANK = { high: 3, medium: 2, low: 1 };
const MAX_BUILDS_ON = 3;
const MAX_FETCH = 3;

const IDEAS_FENCE = /```apex-ideas\s*\n([\s\S]*?)```/g;
const FETCH_FENCE = /```apex-fetch\s*\n([\s\S]*?)```/g;

const cap = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, CAP.id);

// Last block wins — a seat that corrects itself mid-turn is judged on its final word.
function lastFence(re, text) {
  const s = String(text || '');
  re.lastIndex = 0;
  let m = null, last = null;
  while ((m = re.exec(s)) !== null) last = m;
  if (!last) return { raw: null, error: 'none' };
  try { return { raw: JSON.parse(last[1]), error: null }; }
  catch { return { raw: null, error: 'malformed' }; }
}

const extractIdeas = (text) => lastFence(IDEAS_FENCE, text);

/** Strict allowlist over untrusted converge output → a clean idea array (≤6). */
function validateIdeas(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.ideas)) return [];
  const out = [];
  for (const it of raw.ideas) {
    if (out.length >= MAX_IDEAS) break;
    if (!it || typeof it !== 'object') continue;
    const title = cap(it.title, CAP.title);
    if (!title) continue;                          // an idea with no title is not actionable
    const id = slug(it.id) || slug(title) || ('idea-' + (out.length + 1));
    let builds = [];
    if (Array.isArray(it.builds_on)) {
      for (const b of it.builds_on) {
        if (builds.length >= MAX_BUILDS_ON) break;
        const bs = slug(b);
        if (bs) builds.push(bs);
      }
    }
    out.push({
      id, title,
      pitch: cap(it.pitch, CAP.pitch),
      novelty: cap(it.novelty, CAP.novelty),
      feasibility: FEAS.has(it.feasibility) ? it.feasibility : 'medium',
      evidence: cap(it.evidence, CAP.evidence),
      exists: it.exists === true,
      builds_on: builds,
    });
  }
  return out;
}

/** The Auditor's file request — relative paths only, obvious traversal rejected here
 *  (pack.js does the real realpath/within-repo guard before reading). */
function extractFetch(text) {
  const { raw } = lastFence(FETCH_FENCE, text);
  if (!raw || !Array.isArray(raw.files)) return null;
  const files = [];
  for (const f of raw.files) {
    if (files.length >= MAX_FETCH) break;
    if (typeof f !== 'string') continue;
    const t = f.trim();
    if (!t || t.includes('..') || t.startsWith('/') || t.startsWith('~') || /^[a-zA-Z]:/.test(t)) continue;
    files.push(t);
  }
  return files.length ? { files } : null;
}

const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
const wordsOf = (t) => new Set(normTitle(t).split(' ').filter(Boolean));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}
const worseFeas = (x, y) => (FEAS_RANK[x] <= FEAS_RANK[y] ? x : y);

/** Fold every persona's ideas into deduped cards, unioning who championed each. */
function mergeIdeas(ideasByPersona) {
  const cards = [];
  for (const persona of Object.keys(ideasByPersona || {})) {
    for (const idea of ideasByPersona[persona] || []) {
      const w = wordsOf(idea.title);
      const hit = cards.find((c) =>
        c.id === idea.id || normTitle(c.title) === normTitle(idea.title) || jaccard(wordsOf(c.title), w) > 0.6);
      if (hit) {
        if (!hit.champions.includes(persona)) hit.champions.push(persona);
        if ((idea.pitch || '').length > (hit.pitch || '').length) hit.pitch = idea.pitch;
        if ((idea.novelty || '').length > (hit.novelty || '').length) hit.novelty = idea.novelty;
        if ((idea.evidence || '').length > (hit.evidence || '').length) hit.evidence = idea.evidence;
        hit.exists = hit.exists || idea.exists;
        hit.feasibility = worseFeas(hit.feasibility, idea.feasibility);
        for (const b of idea.builds_on) if (!hit.builds_on.includes(b) && hit.builds_on.length < 6) hit.builds_on.push(b);
      } else {
        cards.push(Object.assign({}, idea, {
          champions: [persona], status: 'proposed', arrival: cards.length,
          builds_on: idea.builds_on.slice(),
        }));
      }
    }
  }
  return cards;
}

/** Rank: most-championed first → feasibility → novel-over-existing → arrival order. */
function rankIdeas(cards) {
  return (cards || []).slice().sort((a, b) =>
    (b.champions.length - a.champions.length) ||
    (FEAS_RANK[b.feasibility] - FEAS_RANK[a.feasibility]) ||
    ((a.exists ? 1 : 0) - (b.exists ? 1 : 0)) ||
    (a.arrival - b.arrival));
}

const PERSONA_LABEL = {
  brainstormer: 'Brainstormer', architect: 'Architect', auditor: 'Auditor',
  advocate: 'User Advocate', contrarian: 'Contrarian',
};
const label = (k) => PERSONA_LABEL[k] || k;

/** The operator's takeaway file: ranked ideas + who argued what. */
function renderReport({ topic, date, models, estTokens, budget, rounds, stopReason, cards, statements }) {
  const ranked = rankIdeas(cards || []);
  const L = [];
  L.push('# War Room — ' + (topic || 'session'));
  L.push('');
  L.push('- **Date:** ' + (date || ''));
  L.push('- **Rounds:** ' + (rounds || '') + '   **Stopped:** ' + (stopReason || 'complete'));
  L.push('- **Spend:** ~' + Math.round((estTokens || 0) / 1000) + 'k est tokens of ' +
    Math.round((budget || 0) / 1000) + 'k budget');
  if (models) L.push('- **Seats:** ' + Object.keys(models).map((k) => label(k) + ' (' + models[k] + ')').join(', '));
  L.push('');
  L.push('## Ideas (' + ranked.length + ', ranked)');
  L.push('');
  if (!ranked.length) L.push('_No ideas survived this session._');
  ranked.forEach((c, i) => {
    const badges = [c.feasibility + ' feasibility'];
    if (c.exists) badges.push('ALREADY EXISTS');
    if (c.status && c.status !== 'proposed') badges.push(c.status.toUpperCase());
    L.push('### ' + (i + 1) + '. ' + c.title);
    L.push('*' + badges.join(' · ') + '* — argued by: ' + c.champions.map(label).join(', '));
    L.push('');
    if (c.pitch) L.push(c.pitch);
    if (c.novelty) L.push('- **Why it\'s non-obvious:** ' + c.novelty);
    if (c.evidence) L.push('- **Grounding:** ' + c.evidence);
    if (c.builds_on && c.builds_on.length) L.push('- **Builds on:** ' + c.builds_on.join(', '));
    L.push('');
  });
  if (statements && statements.length) {
    L.push('## How the room argued');
    L.push('');
    let round = 0;
    for (const s of statements) {
      if (s.round !== round) { round = s.round; L.push('**Round ' + round + ' — ' + (s.phase || '') + '**'); L.push(''); }
      L.push('- **' + label(s.persona) + ':** ' + String(s.text || '').slice(0, 300).replace(/\n+/g, ' '));
    }
    L.push('');
  }
  L.push('_Full transcript lives in the app\'s War Room state, not this repo._');
  L.push('');
  return L.join('\n');
}

module.exports = {
  extractIdeas, validateIdeas, extractFetch, mergeIdeas, rankIdeas, renderReport,
  MAX_IDEAS, CAP, MAX_FETCH,
};
