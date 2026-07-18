// App Builder — the apex-surgeon reply contract (STUDIO v2, Wave C slice C1).
// Pure lib code, no Electron, no writes, no bus, no seat wiring (C2+ seats the
// surgeon and lands the ledger). Two jobs, both pattern-matched from siblings
// rather than invented fresh:
//
//   1. The kickoff builder (buildKickoff/contractText): element context + the
//      resolver's ranked candidates + the user's typed intent + the
//      ONE-minimal-edit law + the report shape, in one deterministic prompt.
//      The candidates render with their tiers and confidences verbatim —
//      honesty survives the trip into the prompt (§ Wave C: never a silent
//      guess).
//
//   2. The fenced ```apex-surgeon JSON parser (extractReport/validateReport/
//      parseReply) under handoff.js discipline: untrusted assistant output,
//      last block wins, known fields only (the result is REBUILT field by
//      field, never a spread — unknown keys are dropped by construction).
//      Where this contract is STRICTER than handoff/codesigner, on purpose:
//      an edit list describes REAL file changes the surgeon claims it made,
//      so nothing is ever trimmed or truncated into acceptance — a 7th edit,
//      an absolute or traversing path, an unknown kind, or any oversized
//      string fails the WHOLE reply closed to { result: null, error } (the
//      mockup.js pick-message rule: drop whole, never repair). A report the
//      contract cannot vouch for is a report nobody acts on.
//
// The demote detector (detectDemote) is the § Wave C scope guard's pure half:
// a VALID report claiming more than DEMOTE_EDIT_THRESHOLD edits, or asking
// followup "delegate", flags "bigger than a boom" — C2+ turns the flag into
// the proposal card that hands off to the workflow layer.
'use strict';

const path = require('path');
const { describeElement, cleanContext } = require('./resolver');

// ---- caps and shapes --------------------------------------------------------
// The edit-list bound (§ slice brief, verbatim): six is already a big boom.
const MAX_EDITS = 6;
// The scope guard's line (§ Wave C: "multi-file changes above a threshold
// demote to a proposal card"): above THREE claimed edits, a valid report is
// still parsed and shown — but flagged for demotion instead of auto-landing.
const DEMOTE_EDIT_THRESHOLD = 3;
const DELEGATE_FOLLOWUP = 'delegate';
// String caps. Summary sits between codesigner's PROPOSAL_CAP and handoff's
// TEXT_CAP (it narrates one surgical strike); hunks carry a unified-diff
// excerpt, so they get a working-file-sized allowance; followup is one line.
const SUMMARY_CAP = 2000;
const HUNKS_CAP = 16 * 1024;
const FOLLOWUP_CAP = 500;
const MAX_EDIT_PATH = 260;
const EDIT_KINDS = ['modified', 'created'];
// Kickoff inputs, bounded like every prompt input in this extension.
const MAX_INTENT_CHARS = 1000;
const MAX_KICKOFF_CANDIDATES = 12;

// Last block wins (a seat that corrects itself mid-turn is judged on its
// final word) — identical rule to handoff.js's FENCE_RE.
const FENCE_RE = /```apex-surgeon\s*\n([\s\S]*?)```/g;

/** Pull the LAST apex-surgeon block out of a turn's assistant text. Returns
 *  { raw, error } — raw is parsed but NOT yet validated. Never throws. */
function extractReport(text) {
  const s = String(text || '');
  FENCE_RE.lastIndex = 0;
  let match = null;
  for (let m; (m = FENCE_RE.exec(s)) !== null;) match = m;
  if (!match) return { raw: null, error: 'no-report' };
  try { return { raw: JSON.parse(match[1]), error: null }; }
  catch { return { raw: null, error: 'malformed-report' }; }
}

// The edit-path wall. An edit path is a surgeon's CLAIM about what it touched;
// the ledger and revert machinery resolve it against the project root, so a
// path that could resolve anywhere else is hostile by definition. Rejected by
// name: absolute of either flavor (isAbsolute under BOTH path flavors — the
// app runs on Windows but the contract must not care), any colon (drive
// letters, NTFS alternate streams), any .. segment, a leading ~, control
// characters. classifyEditPath returns the specific error so a drill (and a
// log line) can prove each vector individually; null means the path passed.
function classifyEditPath(file) {
  if (typeof file !== 'string') return 'malformed-edit';
  const p = file.trim();
  if (!p || p.length > MAX_EDIT_PATH) return 'malformed-edit';
  if (/[\u0000-\u001f]/.test(p)) return 'malformed-edit';
  if (path.win32.isAbsolute(p) || path.posix.isAbsolute(p) ||
      p.includes(':') || p.startsWith('~')) return 'absolute-edit-path';
  if (p.split(/[\\/]+/).some((segment) => segment === '..')) return 'traversal-edit-path';
  return null;
}

/**
 * Strict allowlist over an untrusted parsed report. Returns
 * { result, error } — exactly one set. result: { summary, edits: [{ file,
 * kind, hunks? }], followup? }, rebuilt field by field; every other key in
 * the raw input is never read. Every violation fails the WHOLE report closed
 * (see the header for why this contract never trims).
 */
function validateReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { result: null, error: 'malformed-report' };

  if (typeof raw.summary !== 'string' || !raw.summary.trim())
    return { result: null, error: 'missing-summary' };
  const summary = raw.summary.trim();
  if (summary.length > SUMMARY_CAP)
    return { result: null, error: 'oversized-summary' };

  if (!Array.isArray(raw.edits))
    return { result: null, error: 'missing-edits' };
  if (raw.edits.length > MAX_EDITS)
    return { result: null, error: 'too-many-edits' };
  const edits = [];
  for (const entry of raw.edits) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return { result: null, error: 'malformed-edit' };
    const pathError = classifyEditPath(entry.file);
    if (pathError) return { result: null, error: pathError };
    if (typeof entry.kind !== 'string' || !EDIT_KINDS.includes(entry.kind))
      return { result: null, error: 'unknown-edit-kind' };
    const edit = { file: entry.file.trim(), kind: entry.kind };
    if (entry.hunks !== undefined) {
      if (typeof entry.hunks !== 'string')
        return { result: null, error: 'malformed-edit' };
      if (entry.hunks.length > HUNKS_CAP)
        return { result: null, error: 'oversized-hunks' };
      edit.hunks = entry.hunks;
    }
    edits.push(edit);
  }

  const result = { summary, edits };
  if (raw.followup !== undefined) {
    if (typeof raw.followup !== 'string' || !raw.followup.trim())
      return { result: null, error: 'malformed-followup' };
    if (raw.followup.trim().length > FOLLOWUP_CAP)
      return { result: null, error: 'oversized-followup' };
    result.followup = raw.followup.trim();
  }
  return { result, error: null };
}

/** extractReport + validateReport in one call. Never throws; fails closed to
 *  { result: null, error } on every violation. */
function parseReply(text) {
  const { raw, error } = extractReport(text);
  if (error) return { result: null, error };
  return validateReport(raw);
}

/**
 * The bigger-than-a-boom detector, over a VALIDATED result only. Returns
 * { demote, reasons } — reasons name each trigger in plain language so the
 * proposal card can quote them. A null/invalid result is nobody's boom:
 * { demote: false } (the parse already failed it closed; there is nothing
 * to demote).
 */
function detectDemote(result, threshold) {
  const limit = Number.isInteger(threshold) && threshold > 0 ? threshold : DEMOTE_EDIT_THRESHOLD;
  const reasons = [];
  if (!result || typeof result !== 'object') return { demote: false, reasons };
  if (Array.isArray(result.edits) && result.edits.length > limit)
    reasons.push('claims ' + result.edits.length + ' edits — above the ' + limit + '-edit boom threshold');
  if (result.followup === DELEGATE_FOLLOWUP)
    reasons.push('the surgeon itself asked to delegate');
  return { demote: reasons.length > 0, reasons };
}

// ---- the kickoff builder ----------------------------------------------------
/** The completion contract appended to the kickoff. Mirrors handoff.js's
 *  contractText() in stating the rules plainly so a well-behaved model
 *  self-polices the bounds — and states that violations discard the report
 *  whole, because here they do.
 *  C2's one extension (the v1 apply discipline): `hunks` is the COMPLETE new
 *  content of the file, not a diff excerpt — the boom applier writes exactly
 *  those bytes, so a diff would land as a diff. Stated here, in the prompt,
 *  while the PARSER stays exactly C1's (hunks optional, capped): the apply
 *  layer refuses an edit without hunks, it never repairs one. */
function contractText() {
  return [
    'When your edit is COMPLETE, end your FINAL message with exactly one fenced block:',
    '```apex-surgeon',
    '{ "summary": "<what you changed and why, under ' + SUMMARY_CAP + ' chars>",',
    '  "edits": [ { "file": "<project-RELATIVE path — never absolute, never ..>",',
    '               "kind": "modified" | "created",',
    '               "hunks": "<the COMPLETE new content of this file — the applier writes these exact bytes>" } ],',
    '  "followup": "<optional one-liner; exactly "' + DELEGATE_FOLLOWUP + '" when the job is bigger than one minimal edit>" }',
    '```',
    'Rules: at most ' + MAX_EDITS + ' edits, and a report claiming more than ' + DEMOTE_EDIT_THRESHOLD +
      ' (or asking to delegate) becomes a',
    'proposal card for the user instead of landing directly. Every edit you want applied MUST',
    'carry the file\'s complete new content in "hunks" (under ' + Math.floor(HUNKS_CAP / 1024) +
      ' KB — a file too big for that is',
    'not a boom: report followup "' + DELEGATE_FOLLOWUP + '" instead). A report that breaks the contract —',
    'an absolute or .. path, an unknown kind, an oversized field — is discarded WHOLE, so stay',
    'inside it. Do not emit the block until you are finished.',
  ].join('\n');
}

/** Render one resolver candidate as a kickoff line — tier and confidence ride
 *  along verbatim, and the tier-c descriptor is spelled out as the honest
 *  "locate it yourself" instruction it is. */
function candidateLine(candidate, index) {
  const label = index + '. [' + candidate.tier + ', ' + candidate.confidence + ' confidence] ';
  if (candidate.tier === 'context' || !candidate.file)
    return label + 'no file resolved — locate the element yourself: ' +
      (candidate.descriptor || 'see the element context above');
  return label + candidate.file + (candidate.line ? ':' + candidate.line : '');
}

/**
 * The surgeon's kickoff: everything a disposable seat in the project cwd
 * needs for ONE surgical strike. Deterministic over its inputs; every
 * free-text input is bounded before it rides.
 * @param {object} args { displayName?, intent, context, candidates }
 *   context is the picker capture (cleaned here via resolver.cleanContext);
 *   candidates is resolveElement's ranked list.
 */
function buildKickoff({ displayName, intent, context, candidates } = {}) {
  const ctx = cleanContext(context);
  const list = (Array.isArray(candidates) ? candidates : []).slice(0, MAX_KICKOFF_CANDIDATES);
  const lines = [
    'You are the Apex SURGEON — a disposable seat performing ONE surgical strike on',
    'the project "' + String(displayName || '(untitled)').trim() + '" (your working directory is the project root).',
    'The user clicked a real element in the running app and typed what they want changed.',
    '',
    'THE ELEMENT (captured from the live page):',
    '- element: ' + describeElement(ctx),
    '- tag: ' + (ctx.tag || '(unknown)'),
    '- classes: ' + (ctx.classes.length ? ctx.classes.join(' ') : '(none)'),
    '- visible text: ' + (ctx.text ? '"' + ctx.text + '"' : '(none)'),
    '- selector: ' + (ctx.selector || '(none)'),
    '',
    'WHERE IT PROBABLY LIVES (the source resolver\'s ranked candidates — each carries',
    'its tier and confidence honestly; VERIFY before you cut):',
  ];
  if (list.length) list.forEach((c, i) => lines.push(candidateLine(c, i + 1)));
  else lines.push('(the resolver returned nothing — locate the element from the context above)');
  lines.push(
    '',
    'THE USER\'S INTENT (their own words — this is the whole job):',
    String(intent || '').trim().slice(0, MAX_INTENT_CHARS) || '(no intent captured — ask the user before touching anything)',
    '',
    'THE ONE-MINIMAL-EDIT LAW: make the SMALLEST change that satisfies the intent and',
    'nothing else. Touch as few files as possible — ideally one. No refactors, no',
    'drive-by cleanups, no dependency changes, nothing outside the project root. If',
    'honest work needs more than ' + DEMOTE_EDIT_THRESHOLD + ' files or real restructuring, STOP and report',
    'followup "' + DELEGATE_FOLLOWUP + '" instead — that is a good outcome, not a failure.',
    '',
    contractText()
  );
  return lines.join('\n');
}

// The constants export wholesale as the module's public contract (the
// suggest.js precedent): the drill pins the caps and error names, C2+ wires
// the seat, and nothing re-invents a number.
module.exports = {
  MAX_EDITS,
  DEMOTE_EDIT_THRESHOLD,
  DELEGATE_FOLLOWUP,
  SUMMARY_CAP,
  HUNKS_CAP,
  FOLLOWUP_CAP,
  MAX_EDIT_PATH,
  EDIT_KINDS,
  MAX_INTENT_CHARS,
  extractReport,
  classifyEditPath,
  validateReport,
  parseReply,
  detectDemote,
  contractText,
  buildKickoff,
};
