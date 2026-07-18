// App Builder — the per-card AI suggest pass (§ AI integration, Level 1). A
// heuristic set of chips already ships free with every card (interview.js's
// static `suggestions`); this module is the OPT-IN richer pass: one disposable
// turn, prompted from the card's own question plus the draft answer so far
// plus every EXISTING project's project-context.md digest (overlap detection
// — "this sounds like your X project's territory"). main.js owns the seat and
// the usage-preflight/approval/TTL state machine; this module only builds the
// prompt and validates the untrusted reply.
//
// Pattern-matched from extensions/personas/lib/relationships.js's
// buildPrompt/parseLlmReply — the allowlist discipline (bounded count, capped
// string length, unknown fields dropped, never throws) is the same shape by
// design. It is a sibling, not a shared import: the persona reply carries
// suggestions/routes shaped for a collaboration contract; a studio card reply
// carries nothing but a flat list of short strings the user can paste into
// free text — different enough that sharing would mean forcing one shape onto
// two problems.
'use strict';

// Same caps as personas/lib/relationships.js (TEXT_CAP, MAX_SUGGESTIONS): a
// suggestion is capped, not rejected, when oversize — mirroring that module's
// philosophy that a too-long/too-many reply is still useful, just trimmed.
const TEXT_CAP = 240;
const MAX_SUGGESTIONS = 12;
// How much of an existing project's digest rides in the prompt per project —
// keeps a workspace with many projects from ballooning the kickoff.
const CONTEXT_EXCERPT_CHARS = 300;
const MAX_ANSWER_CHARS = 4000;

/** Prompt for one card's suggest pass. `card` is an interview.js CARDS entry
 *  (title/question); `answer` is the draft's current text for that card;
 *  `contexts` is [{ id, text }] from sibling projects' project-context.md
 *  (contract.readSiblingContexts' shape — reused, not reinvented). */
function buildPrompt(card, answer, contexts) {
  const list = Array.isArray(contexts) ? contexts : [];
  const lines = [
    'You are helping refine ONE card of a project-blueprint interview.',
    '',
    'Card: ' + ((card && card.title) || '(untitled)'),
    'Question: ' + ((card && card.question) || ''),
    '',
    'The answer written so far:',
    (String(answer || '').trim() || '(nothing written yet)').slice(0, MAX_ANSWER_CHARS),
    '',
    'Existing projects already in this workspace (for overlap detection):',
    list.length
      ? list.map((c) => '- ' + c.id + ': ' + String(c.text || '').slice(0, CONTEXT_EXCERPT_CHARS)).join('\n')
      : '(none yet)',
    '',
    'Suggest short, concrete additions or fixes to THIS answer only. If the idea',
    'clearly overlaps an existing project above, make one suggestion say so',
    'plainly (name the project). Reply with ONLY one fenced block:',
    '```json',
    '{ "suggestions": ["<short suggestion the user could paste straight into',
    '  the answer, under 240 chars>", "..."] }',
    '```',
    'Rules: suggestions only, nothing else; at most 8 of them; each one stands',
    'alone as a sentence or two, not a fragment.',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** Strict allowlist over an untrusted LLM reply. Returns { suggestions,
 *  error }. Never throws: a missing block, non-JSON, or empty reply fails
 *  closed to an empty suggestion list plus a clear error string. */
function parseLlmReply(text) {
  const match = String(text || '').match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (!match) return { suggestions: [], error: 'no JSON block in the reply' };
  let raw;
  try { raw = JSON.parse(match[1]); }
  catch { return { suggestions: [], error: 'reply JSON did not parse' }; }
  return { suggestions: validateSuggestions(raw), error: null };
}

// The ONLY thing a reply may carry is a bounded list of bounded strings — no
// other field of `raw` is ever read, so extra/unexpected keys are dropped by
// omission; wrong-typed or nested-object entries are skipped rather than
// crashing the parse.
function validateSuggestions(raw) {
  const suggestions = [];
  if (raw && Array.isArray(raw.suggestions)) {
    for (const s of raw.suggestions) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      if (typeof s !== 'string') continue;
      const cleaned = s.trim().slice(0, TEXT_CAP);
      if (cleaned) suggestions.push(cleaned);
    }
  }
  return suggestions;
}

module.exports = {
  TEXT_CAP,
  MAX_SUGGESTIONS,
  CONTEXT_EXCERPT_CHARS,
  MAX_ANSWER_CHARS,
  buildPrompt,
  parseLlmReply,
  validateSuggestions,
};
