// App Builder — the guided interview copy (§ Guided interview). Six cards, one
// per blueprint area; the keys line up with contract.BLUEPRINT_AREAS so a draft
// answer maps straight onto the canonical without a translation table. Pure data
// plus one heuristic (helpForCard) — no Electron, no AI, no runtime state. Shipped
// to the renderer over the bus the same way personas/lib/interview.js is, so the
// UI never hard-codes card prose.
'use strict';

const { THIN_AREA_CHARS } = require('./contract');

const CARDS = [
  {
    key: 'idea',
    title: 'The idea',
    question: 'What is this thing, and why now?',
    depth: 'One tight paragraph: the elevator pitch, the itch it scratches, and what changed to make it worth building today. Anchor it on the win the user actually feels, not on the technology.',
    example: 'Example: "SniperSight — a trading-intelligence layer that scores liquidity-sweep entries by confluence, so I stop eyeballing four charts at 5am. Now, because the data plane I already run finally makes the signals cheap to compute."',
    suggestions: ['State the pain first', 'Name the user in the pitch', 'Why now — what changed?'],
    heuristics: [
      'Lead with the pain, not the feature — what hurts today?',
      'Put the measurable win in the sentence (time saved, risk cut).',
      'Answer "why now": name the thing that just became possible.',
    ],
    help: 'Picture pitching this to someone in one breath before any code exists. If they can\'t repeat the pain and the win back to you, the pitch is still too abstract.',
  },
  {
    key: 'users',
    title: 'Users and jobs',
    question: 'Who uses it, and what job do they hire it for?',
    depth: 'Real users and the jobs-to-be-done, with the outside-visible success signal. Start with yourself as user zero if that is the truth; split distinct moments of use into distinct jobs.',
    example: 'Example: "Me, pre-market: I want a ranked list of A+ setups by 6:30 so I can plan risk before the open. Success = I act on the list instead of re-deriving it. Failure = I still open four charts anyway."',
    suggestions: ['Start with yourself as user zero', 'One job per user, verb-first', 'Define the success signal'],
    heuristics: [
      'Name a concrete user, not a persona-shaped abstraction.',
      'Phrase each job verb-first: "plan risk", "triage tickets".',
      'State the success signal AND the failure signal.',
    ],
    help: 'Finish this out loud: "____ uses it to ____, and I\'ll know it works when ____." If any blank stays generic, the Architect will guess — and guess wrong.',
  },
  {
    key: 'scope',
    title: 'Scope and non-goals',
    question: 'What does v1 do — and what does it deliberately not do?',
    depth: 'The MVP cut plus the explicit non-goals. This is the number-one blueprint killer: a scope with no non-goals sprawls. Name at least a couple of things v1 will NOT do, and cut anything without a user job behind it.',
    example: 'Example: "v1 scores entries and alerts on one channel. Non-goals: no auto-execution, no backtester UI, no mobile app. MVP is one full path — ingest to alert — end to end."',
    suggestions: ['List 3 non-goals minimum', 'Cut anything without a user job', 'MVP = one full path, end to end'],
    heuristics: [
      'Write the non-goals first — they are what keeps v1 shippable.',
      'One full path end-to-end beats three half-built features.',
      'If a feature has no user job from the last card, cut it here.',
    ],
    help: 'For each thing you want in v1, ask "does a user job need it to ship?" If not, it is a non-goal — say so out loud so the Architect does not build it anyway.',
  },
  {
    key: 'platform',
    title: 'Platform and stack',
    question: 'Where does it run, and with what?',
    depth: 'Targets (web / desktop / mobile / CLI), hard constraints, stack preferences, and the existing repos or systems it must coexist with. Name the constraint before the preference.',
    example: 'Example: "Windows desktop first (Electron or Tauri), a Node data plane, and it must live alongside the ApexShell workspace layout. Latency budget for a signal: under 250ms."',
    suggestions: ['Name the constraint before the preference', 'List repos it must respect', 'State hard limits (latency, offline)'],
    heuristics: [
      'Separate hard constraints from soft preferences.',
      'Name the systems it has to live next to, not just what you like.',
      'If latency/offline/scale matters, put a number on it here.',
    ],
    help: 'Ask what would make a stack choice wrong: an existing repo it must fit, a latency budget, a deployment target. Those constraints belong here, not buried in delivery.',
  },
  {
    key: 'architecture',
    title: 'Architecture and data',
    question: 'What are the moving parts, and what data does each own?',
    depth: 'Key components, the data each one owns, the integrations, and the seams you already know are risky. One owner per piece of data; mark the risky contract explicitly so the Architect starts there.',
    example: 'Example: "Feed ingester → structure detector → confluence scorer → alert bus. The scorer owns setup state; nothing else writes it. The detector↔scorer contract is the risky seam — treat it as a validated packet from day one."',
    suggestions: ['One owner per piece of data', 'Mark the risky seam explicitly', 'Name the replay/backfill story'],
    heuristics: [
      'Give every piece of data exactly one owner.',
      'Point at the seam you already suspect is hard.',
      'Say how it recovers/replays — bolting that on later is the trap.',
    ],
    help: 'Sketch the boxes and arrows in your head. The arrow you are least sure about is the one to describe most — that is where the Architect earns their keep.',
  },
  {
    key: 'delivery',
    title: 'Delivery',
    question: 'What are the milestones, and what proves lift-off?',
    depth: 'Ordered milestones, verification expectations, what "lifted off" actually means, and the risks you are handing the Architect. Define lift-off as an observed behavior, not a date; end every milestone in a check.',
    example: 'Example: "M1: ingest + detect on replay data, drill-gated. M2: live scoring. Lift-off = one week of live alerts I actually act on. Risk parked for the Architect: which broker API, and its rate limits."',
    suggestions: ['Every milestone ends in a drill', 'Define lift-off as a behavior', 'Park the open questions for the Architect'],
    heuristics: [
      'Order the milestones; each one ends in something you can verify.',
      'Lift-off is a behavior you can watch, never a calendar date.',
      'List the risks you are knowingly handing off — evidence, not vibes.',
    ],
    help: 'Ask "how will I know this is done, not just built?" The answer is your verification. Then name the one decision you are deliberately leaving for the Architect.',
  },
];

const KEYS = CARDS.map((card) => card.key);

// Help me decide — a pure, offline heuristic (§ scope: no AI in this slice). It
// returns the card's stable thought-starters plus live nudges computed from the
// answer so far. Deterministic and total: unknown keys throw (a programming
// error), everything else returns a { hints, nudges } shape. The renderer mirrors
// the nudge rules client-side; this copy is the tested source of truth.
function helpForCard(key, text) {
  const card = CARDS.find((c) => c.key === key);
  if (!card) throw new Error('Unknown interview card: ' + key);
  const answer = String(text || '').trim();
  const hints = card.heuristics.slice();
  const nudges = [];
  if (!answer) {
    nudges.push('Nothing here yet — the example above is a complete answer you can adapt.');
    return { hints, nudges };
  }
  if (answer.length < THIN_AREA_CHARS)
    nudges.push('This reads thin for an Architect to act on — add a concrete detail or two.');
  if (key === 'users' && !/\b(user|who|team|people|customer|client|operator|me|myself|i)\b/i.test(answer))
    nudges.push('Name the actual user in the answer — a job needs someone who hires it.');
  if (key === 'scope' && !/(non.?goals?|won'?t|will not|\bnot\b|exclude|out of scope)/i.test(answer))
    nudges.push('Scope names no non-goal. Say at least one thing v1 deliberately will not do.');
  if (key === 'delivery' && !/(test|drill|verif|gate|proof|evidence|demo|accept|milestone)/i.test(answer))
    nudges.push('Delivery names no way to prove lift-off. Say what evidence counts as done.');
  return { hints, nudges };
}

module.exports = { CARDS, KEYS, helpForCard };
