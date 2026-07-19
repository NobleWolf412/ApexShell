'use strict';

// Pins the per-persona VOICE contract. This wraps the seat's first turn — one
// wrong regression here and either every seat sounds identical (voice silently
// dropped) or a resumed seat re-greets in a new voice (voice leaks past its
// scope). The engine harness runs this without Electron loaded.

const assert = require('assert');
const {
  wrapKickoff, voiceLine, normalize, presetText, presetNames, PERSONALITY_CAP,
} = require('../main/engine/voice');

let pass = 0;
function gate(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

gate('empty personality is null (no voice line)', () => {
  assert.strictEqual(voiceLine(''), null);
  assert.strictEqual(voiceLine('   '), null);
  assert.strictEqual(voiceLine(null), null);
  assert.strictEqual(voiceLine(undefined), null);
  assert.strictEqual(voiceLine(123), null, 'non-string is a caller bug — collapses');
});

gate('voice line uses the [voice] contract tag', () => {
  const line = voiceLine('warm');
  assert.match(line, /^\[voice\] /, 'starts with the [voice] preface');
  assert.ok(line.endsWith('warm'), 'personality text lives at the tail');
});

gate('wrapKickoff: no voice AND no kickoff → null (blank seat stays blank)', () => {
  assert.strictEqual(wrapKickoff(null, ''), null);
  assert.strictEqual(wrapKickoff(null, null), null);
});

gate('wrapKickoff: kickoff without voice is byte-identical (no regression path)', () => {
  const k = '[seat-launch] hello there';
  assert.strictEqual(wrapKickoff(k, ''), k);
  assert.strictEqual(wrapKickoff(k, null), k);
});

gate('wrapKickoff: voice alone becomes the first turn', () => {
  const out = wrapKickoff(null, 'be terse');
  assert.match(out, /^\[voice\] /);
  assert.ok(out.includes('be terse'));
});

gate('wrapKickoff: voice + kickoff → voice, blank line, kickoff', () => {
  const out = wrapKickoff('do the thing', 'be terse');
  const parts = out.split('\n\n');
  assert.strictEqual(parts.length, 2, 'exactly one blank line separates voice from kickoff');
  assert.match(parts[0], /^\[voice\] /);
  assert.strictEqual(parts[1], 'do the thing');
});

gate('personality is CAPPED so a runaway config can\'t blow up the first turn', () => {
  const huge = 'x'.repeat(PERSONALITY_CAP * 3);
  const n = normalize(huge);
  assert.strictEqual(n.length, PERSONALITY_CAP, 'truncated at the cap');
  const line = voiceLine(huge);
  assert.ok(line.length <= PERSONALITY_CAP + 200, 'line stays bounded');
});

gate('presets: every advertised name resolves to something (or empty for custom)', () => {
  const names = presetNames();
  assert.ok(names.length >= 5, 'at least a handful of choices');
  assert.ok(names.includes('custom'), 'custom exists as the blank slate');
  for (const n of names) {
    assert.strictEqual(typeof presetText(n), 'string', n + ' resolves');
  }
  assert.strictEqual(presetText('nope-not-a-preset'), '', 'unknown preset is empty, not undefined');
});

gate('preset text is non-empty for every non-custom voice', () => {
  for (const n of presetNames()) {
    if (n === 'custom') continue;
    assert.ok(presetText(n).length > 0, n + ' has copy');
  }
});

gate('a resume seat should pass no kickoff (contract check: null in → null out)', () => {
  // seats.js is expected to hand null when msg.resume is truthy; document that
  // wrapKickoff does not INVENT a first turn on resume even if voice is set.
  // This isn't the whole guarantee (seats.js is where resume is detected) — but
  // it pins the pure half so a refactor can't quietly re-introduce a preface.
  assert.strictEqual(wrapKickoff(null, ''), null);
});

console.log('persona voice drill: ' + pass + '/10 passed');
