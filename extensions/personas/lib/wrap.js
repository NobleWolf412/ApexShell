// Persona Builder — the seat close-out (wrap) prompt, shared between the
// extension's main half (registered via ctx.seats.setWrapPrompt for the real
// app) and test/live-cast (which loads the stack without the extension loader
// and must register the SAME text, or it silently drills the generic engine
// wrap instead of the tiered-memory ritual — exactly what happened on
// 2026-07-18: three live runs, all wrapping on the default prompt).
'use strict';

const WRAP_PROMPT = [
  '[seat-wrapup] This seat closes after this turn — do the close-out now:',
  '1. Tie up loose ends from this session: finish or safely park in-flight',
  '   work; commit anything that should not be lost.',
  '2. IF you are a seated persona (you loaded a foundation.md and an identity',
  '   with project memory): complete your MEMORY WRAP per that foundation NOW.',
  '   Most important — REWRITE your project’s state.md so it reflects where',
  '   the work stands right now (active goal, recent decisions, the single',
  '   next step); it is rewritten, never appended. Record any durable note',
  '   with its MEMORY.md pointer. If you have no persona memory, skip this step.',
  '   Then run the RECIPE SWEEP: ask yourself whether this session proved out',
  '   any procedure a future seat would repeat (a working command sequence, a',
  '   debug path that landed, a build/test recipe). If yes, save it to',
  '   `memory/projects/<project>/recipes/<name>.md` with the A→Z shape and add',
  '   its MEMORY.md pointer — Apex will surface it in the SKILLS pane for the',
  '   operator to promote into a skill every seat can auto-invoke. If nothing',
  '   this session rises to that bar, say so in one line and move on.',
  '3. Leave a short handoff as your FINAL message: the state, the decisions',
  '   made, and the next steps a future session needs to pick this up cold.',
  'If there is genuinely nothing to tie up or record, say so in one line —',
  'but that escape NEVER covers step 2’s state.md rewrite: a seated persona',
  'whose state.md does not reflect reality RIGHT NOW (template/placeholder',
  'text counts as not reflecting reality) rewrites it before signing off,',
  'however small the session was. Anything you would say out loud about',
  'where things stand (uncommitted changes, who is next) belongs IN it.',
].join('\n');

module.exports = { WRAP_PROMPT };
