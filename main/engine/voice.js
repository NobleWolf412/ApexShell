// Per-persona VOICE (the "personality" dial in the AI-bar defaults panel).
// A small, opinionated preface bolted onto the seat's FIRST turn — so the
// same coder persona can sound dry with one operator and chatty with another
// without touching its canonical identity file. Pure, so the engine harness
// can pin the wrapping shape without Electron in the loop.
//
// Scope, on purpose:
//  - Voice never survives a resume (resumed seats already had their first turn
//    seasoned; re-injecting would loop the greeting).
//  - Voice never overrides a message-carried kickoff (a composing caller like
//    the STUDIO BUILD step or a task-chain handoff owns its first turn whole).
//  - Voice truncates hard at PERSONALITY_CAP — a config value can't blow up
//    the kickoff a running seat receives.
'use strict';

const PERSONALITY_CAP = 2000;

// Preset voices, kept small and playful. Custom = whatever the operator typed;
// the picker just fills the textarea, and the SAVED text is what ships.
const PRESETS = {
  dry:      "Dry, understated, and terse. Short sentences. State facts without warmth or padding — no exclamation marks, no cheerleading.",
  warm:     "Warm and friendly. Acknowledge what I'm asking before diving in. It's OK to be encouraging, but stay useful — no empty flattery.",
  concise:  "Answer in as few words as possible. Skip preamble, skip summaries, skip 'let me know if…'. Direct answers only.",
  chatty:   "Conversational and a little chatty — talk to me like a colleague at a whiteboard. Explain your thinking briefly out loud.",
  mentor:   "Teach as you go. When you make a choice, name the tradeoff in one line. Assume I want to learn, not just be handed answers.",
  salty:    "Blunt, no-nonsense, mildly grumpy. Cut through fluff. Push back when I'm wrong — respectfully but honestly.",
  pirate:   "Answer in playful pirate voice — 'arr', 'ye', 'matey', the works. Keep the technical content correct; only the wrapping is piratical.",
  hype:     "Enthusiastic and upbeat. Celebrate small wins, keep momentum going. Never sacrifice accuracy for cheerleading.",
  professor:"Precise and academic. Use full names, cite the specific mechanism or line. Prefer clarity over brevity.",
  custom:   "",
};

function presetNames() { return Object.keys(PRESETS); }
function presetText(name) {
  return Object.prototype.hasOwnProperty.call(PRESETS, name) ? PRESETS[name] : '';
}

// Normalize whatever the config file / bus message hands us into a safe string
// (or null when there's effectively nothing to say). Anything non-string is a
// caller bug, so it collapses to null rather than throwing on the launch path.
function normalize(personality) {
  if (personality == null) return null;
  if (typeof personality !== 'string') return null;
  const trimmed = personality.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, PERSONALITY_CAP);
}

// Build the voice preface line the model will see. Kept as ONE contract — a
// leading `[voice]` tag the seat's rendered output won't accidentally trip
// (renderer/chatView.js's md() never treats bracketed literals as verbs).
function voiceLine(personality) {
  const t = normalize(personality);
  return t ? '[voice] Speak in this style throughout the whole session: ' + t : null;
}

// The seam createFromMessage calls: fold voice into the fresh kickoff string.
// - kickoff null + no voice   → null (no first turn at all — blank seat)
// - kickoff null + voice      → the voice line stands alone as the first turn
// - kickoff set  + no voice   → unchanged (byte-identical to the pre-voice path)
// - kickoff set  + voice      → voice line, blank line, then the original kickoff
function wrapKickoff(kickoff, personality) {
  const voice = voiceLine(personality);
  if (!voice) return kickoff == null ? null : kickoff;
  if (kickoff == null || !String(kickoff).trim()) return voice;
  return voice + '\n\n' + kickoff;
}

module.exports = { wrapKickoff, voiceLine, normalize, presetText, presetNames,
                   PERSONALITY_CAP, _PRESETS: PRESETS };
