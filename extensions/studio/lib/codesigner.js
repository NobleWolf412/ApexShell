// App Builder — the co-designer (§ AI integration, Level 2). A persistent side
// panel riding ONE long-lived disposable controller across many user turns
// (main.js owns the controller/lifecycle; this module is pure: the digest
// composer and the untrusted apex-studio patch-block contract).
//
// Two independent disciplines live here, both pattern-matched from existing
// code rather than invented fresh:
//
//   1. The digest (buildDigest/buildKickoff/buildTurn): every turn is prefixed
//      with a compact, STRUCTURED summary of the current draft's card states —
//      never the running transcript. The co-designer "argues from the current
//      draft," so each send() rebuilds the digest from whatever the draft looks
//      like *right now* (a card the user just edited shows up immediately, and
//      a stale transcript never accumulates hidden context).
//
//   2. The apex-studio patch-block parser (extractPatchBlock/validatePatches/
//      parsePatchReply): the SAME strict-allowlist discipline as
//      main/engine/handoff.js's apex-handoff packet — untrusted assistant
//      output, known fields only, bounded array, capped strings, drop-not-throw
//      on anything else. It is a sibling module (not a shared import) because
//      handoff.js is core-engine and this is extension-owned (§ mirror note in
//      the slice brief) and the two contracts shape completely different data.
'use strict';

const { KEYS, CARDS } = require('./interview');
const { THIN_AREA_CHARS } = require('./contract');

const CARD_KEYS = new Set(KEYS);
// Every interview card carries exactly ONE free-text answer in the v1 draft
// schema (extensions/studio/lib/drafts.js: draft.answers[key] is a plain
// string — there is no per-card sub-field today). So the allowlisted "field"
// for every known card is this one name; a patch that names anything else is
// dropped as an unknown field, and a patch that omits `field` defaults to it.
const FIELD = 'answer';

// Caps chosen to match the sibling contracts already in this extension:
// handoff.js's TEXT_CAP is 4000 for a whole packet's free text; a single patch
// proposal is a much narrower thing (one card's replacement/addition text), so
// it gets suggest.js's kind of tight cap instead. `why` is a one-line
// justification, capped tighter still.
const PROPOSAL_CAP = 800;
const WHY_CAP = 300;
const MAX_PATCHES = 4;

// Last block wins (a reply that corrects itself mid-turn is judged on its
// final word) — identical rule to handoff.js's FENCE_RE.
const FENCE_RE = /```apex-studio\s*\n([\s\S]*?)```/g;

/** Pull the LAST apex-studio block out of a turn's assistant text. Returns
 *  { raw, error } — raw is parsed but NOT yet validated. Never throws. */
function extractPatchBlock(text) {
  const s = String(text || '');
  FENCE_RE.lastIndex = 0;
  let match = null;
  for (let m; (m = FENCE_RE.exec(s)) !== null;) match = m;
  if (!match) return { raw: null, error: 'no-patch-block' };
  try { return { raw: JSON.parse(match[1]), error: null }; }
  catch { return { raw: null, error: 'malformed-patch-block' }; }
}

// Strict allowlist over untrusted content. Deliberately mirrors handoff.js's
// bounded-array philosophy for MAX_PATCHES: a 5th-and-beyond patch is TRIMMED
// (dropped individually, with a note), not treated as grounds to discard the
// whole block — the same choice handoff.js makes for its own MAX_ARTIFACTS
// (cap the list, don't fail the packet) and suggest.js makes for
// MAX_SUGGESTIONS. A too-eager reply that proposes 6 good patches still gives
// the user 4 real chips instead of none.
function validatePatches(raw) {
  const notes = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.patches))
    return { patches: [], notes };
  const patches = [];
  for (const entry of raw.patches) {
    if (patches.length >= MAX_PATCHES) { notes.push('patch list capped at ' + MAX_PATCHES); break; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      notes.push('dropped a non-object patch entry');
      continue;
    }
    if (typeof entry.card !== 'string' || !CARD_KEYS.has(entry.card)) {
      notes.push('dropped patch for unknown card: ' + JSON.stringify(entry.card));
      continue;
    }
    if (entry.field !== undefined && entry.field !== FIELD) {
      notes.push('dropped patch for unknown field: ' + JSON.stringify(entry.field));
      continue;
    }
    const proposal = typeof entry.proposal === 'string' ? entry.proposal.trim().slice(0, PROPOSAL_CAP) : '';
    if (!proposal) { notes.push('dropped patch with an empty/invalid proposal'); continue; }
    const why = typeof entry.why === 'string' ? entry.why.trim().slice(0, WHY_CAP) : '';
    // Every other key on `entry` (and on `raw`) is simply never read — dropped
    // by omission, exactly like handoff.js's packet fields and suggest.js's
    // suggestion strings.
    patches.push({ card: entry.card, field: FIELD, proposal, why });
  }
  return { patches, notes };
}

/** extractPatchBlock + validatePatches in one call. Never throws: a missing
 *  block, non-JSON, or empty reply parses to an empty patch list. */
function parsePatchReply(text) {
  const { raw, error } = extractPatchBlock(text);
  if (error) return { patches: [], notes: [], error };
  const { patches, notes } = validatePatches(raw);
  return { patches, notes, error: null };
}

// ---- the blueprint digest --------------------------------------------------
// Structured card-state summary — key, title, and a coarse status derived from
// answer length. Deliberately NOT the free-text answers themselves (beyond a
// short first line, to ground "what this project is" without inflating every
// turn with the full interview) and NEVER the conversation transcript: the
// co-designer re-reads the CURRENT draft each turn instead of accumulating a
// growing, possibly-stale history.
function cardStatus(answer) {
  const text = String(answer || '').trim();
  if (!text) return { state: 'EMPTY', chars: 0 };
  if (text.length < THIN_AREA_CHARS) return { state: 'THIN', chars: text.length };
  return { state: 'ANSWERED', chars: text.length };
}

function buildDigest(draft, cards) {
  const list = Array.isArray(cards) && cards.length ? cards : CARDS;
  const answers = (draft && draft.answers) || {};
  const lines = ['BLUEPRINT DIGEST (the current draft\'s card states — structured, not a transcript):'];
  const name = String((draft && draft.name) || '').trim() || '(untitled)';
  const pitch = String((draft && draft.pitch) || '').trim();
  lines.push('Project: ' + name + (pitch ? ' — "' + pitch + '"' : ' (no pitch yet)'));
  list.forEach((card, i) => {
    const status = cardStatus(answers[card.key]);
    const detail = status.state === 'EMPTY' ? 'EMPTY' : status.state + ', ' + status.chars + ' chars';
    lines.push((i + 1) + '. ' + card.title + ' [' + detail + ']');
  });
  return lines.join('\n');
}

/** The completion contract appended to the kickoff — how a reply may propose
 *  a patch. Mirrors handoff.js's contractText() in shape and in stating the
 *  rules plainly so a well-behaved model self-polices the bounds. */
function contractText() {
  return [
    'When you want to propose a concrete change to ONE interview card\'s answer,',
    'end that reply with exactly one fenced block (omit it entirely when you have',
    'no patch to propose right now):',
    '```apex-studio',
    // Derived from the interview module's KEYS, never hand-listed: a new card
    // (e.g. schema 2's `look`) joins the patch allowlist and this prompt
    // automatically (slice A1 — the one hard-coded six-key list this file had).
    '{ "patches": [ { "card": "<' + KEYS.join('|') + '>",',
    '                 "proposal": "<replacement/addition text, under ' + PROPOSAL_CAP + ' chars>",',
    '                 "why": "<one short reason, under ' + WHY_CAP + ' chars>" } ] }',
    '```',
    'Rules: at most ' + MAX_PATCHES + ' patches per block. You never write the blueprint',
    'yourself — every patch you propose renders as an accept/reject chip on its card, and',
    'only the user\'s explicit accept changes that card\'s answer.',
  ].join('\n');
}

/** The first turn a freshly-opened panel sends. */
function buildKickoff(draft, cards) {
  return [
    'You are the co-designer for an App Builder project blueprint interview.',
    'Argue from the CURRENT draft below. Each of your turns in this session will be',
    're-prefixed with the draft\'s latest state, not a running transcript, so always',
    'react to what is actually in the draft right now.',
    '',
    buildDigest(draft, cards),
    '',
    contractText(),
    '',
    'Open with a short, concrete reaction to the draft as it stands and ask one sharp',
    'question that moves it forward. Wait for the user\'s reply before proposing more.',
  ].join('\n');
}

/** Every later turn: fresh digest + the user's own words. */
function buildTurn(userText, draft, cards) {
  return [
    buildDigest(draft, cards),
    '',
    'User: ' + String(userText || '').trim(),
  ].join('\n');
}

module.exports = {
  CARD_KEYS,
  FIELD,
  PROPOSAL_CAP,
  WHY_CAP,
  MAX_PATCHES,
  extractPatchBlock,
  validatePatches,
  parsePatchReply,
  buildDigest,
  buildKickoff,
  buildTurn,
  contractText,
};
