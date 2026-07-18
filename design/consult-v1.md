# Consult v1 — Build Specification

Status: proposed.

## Outcome

Every live chat gains a **Consult →** button beside Hand off →. One click:
pick a persona (or a bare model), ask a question, and a hidden disposable
seat — seeded with that persona's identity and a bounded digest of the
current chat — streams its take into a side card. Its useful output lands in
YOUR composer when YOU click it in. Close the card, the seat dies, nothing
else changed.

This fills the missing middle rung between "this seat handles it" and
"launch a whole persona session":

- **In-seat subagents** — the Claude CLI's own Task-tool fan-out, already
  inside every Claude-lane seat. Not this feature.
- **Consult (this spec)** — a second brain on the current work. Seconds to
  invoke, dies when dismissed, never touches the seat's context or the
  board.
- **Chains / Hand off →** — independent eyes and multi-step routes. Untouched
  by this spec; a consult that turns into real work ends with the existing
  Hand off → button, which is already one click.

## Non-goals for v1

- Writing into the consulted chat's context or transcript. Output reaches
  the seat ONLY through the user's composer — the user is the merge point,
  always. (The advisor's framing must not silently bleed into a seat that
  may later face independent review.)
- Structured patch blocks (accept/reject chips). The App Builder's
  co-designer owns that pattern inside STUDIO; consult v1 is streamed prose
  plus send-to-composer. Revisit only if real use demands it.
- Memory WRITES. The consultant never writes memory and never runs the wrap
  ritual — it is an opinion, not a session, so state.md stays owned by real
  work seats. (Tool-less, it could not write anyway; the non-goal is the
  principle.) Memory READS use the cheap tier only — see § What the
  consultant knows.
- Multiple simultaneous consults per seat, consult-on-consult, or consulting
  a chain step's seat mid-step (the chain has its own audit gate).
- Tools for the consultant. Disposables launch tool-less and the persona
  tester already proves the empty-tool-list invariant; consult inherits it.

## Mechanics — assembled from existing parts

| Need | Existing part |
|---|---|
| Hidden seat, streamed, killable | `ctx.seats.startDisposable` / `main/seats.js startDisposable` (controller.send/close, delta/text/result/dead) |
| Bounded chat digest, both sides | the live auditor's rolling transcript window (`main/audit.js`) — same windowing, reused not re-invented |
| Persona identity text | canonical + foundation loading, as the persona tester's kickoff builder does |
| Output → composer | `ApexChat.fillComposer` (the audit pane's send-to-chat) |
| Timeout backstop | the relationship pass's 120s backstop pattern |
| Model choice | the disposable `launch: {model, effort}` override (App Builder slice 5). If consult ships first, v1 runs on the default lane model and the picker lights up when the seam lands — note it in the card header either way. |

New code is therefore: one main-side module (`main/consult.js` — request
handling, digest assembly, kickoff composition, lifecycle), one renderer
card, and the wiring. No engine change beyond what App Builder slice 5
already specifies.

## What the consultant knows — the tiered-memory read

A seated persona reads its own files because it has tools; the consultant is
TOOL-LESS, so everything it knows is inlined into the kickoff by
`main/consult.js`. That composition follows the tiered-memory discipline
exactly (`creator.js seatKickoff` is the reference):

1. `foundation.md` + the persona's canonical — always (persona consults).
2. The cheap tier, when consulting a persona about project work: resolve the
   project slug from the CHAT's cwd (same lowercase-hyphenated rule as
   seatKickoff), then inline `memory/projects/<project>/state.md` and
   `memory/projects/<project>/MEMORY.md`. Both are small by design; cap
   defensively and note truncation in the card if a file is oversized.
   Missing files = fresh project, inline nothing, say nothing.
3. NEVER note files. Tool-less means note paging is impossible — the inlined
   index serves as awareness, so the consultant can point the operator at a
   note by name ("my notes have an entry on this — open <note> yourself").
4. Scratchpad: not inlined in v1. It is session working space, not knowledge.

**Fresh eyes toggle** in the picker: omit tier 2 when the user wants the
persona's judgment without its priors (the poke-holes/review consult).
Default is WITH memory — a second set of eyes is most valuable when it
remembers where the project stands. Bare-model consults have no tiers at
all: digest + question only.

## The flow

1. **Consult →** in the tab row of any live, non-chain seat. Opens a small
   picker: persona list (from live presets) + "just a model", model/effort
   dial (when the override seam exists), and a question box pre-focused.
   The click IS the approval — no second confirmation; the current usage
   snapshot renders in the picker so the spend is visible before send.
2. Main assembles the kickoff per § What the consultant knows: consult
   contract preamble + identity tiers (foundation/canonical/state tier,
   honoring the fresh-eyes toggle) + the digest (last N turns, both sides,
   same bounds as the auditor's window) + the user's question. The preamble
   states plainly: you are advising, you have no tools, you are not this
   seat, your memory here is read-only and partial, your reply goes to the
   operator — not the seat.
3. The reply streams into a **consult card** anchored in the chat column
   (auditor-card styling family). Header: persona name, model, elapsed,
   a kill ✕.
4. Follow-ups: the card has its own small input riding the SAME controller
   (`controller.send`), each follow-up prefixed with a fresh digest delta.
   Bounded: max 5 turns per consult, then the card says so and offers a
   fresh consult or Hand off →.
5. **Send to composer** on the reply (whole reply, or a selection if the
   selection API is cheap — implementer's call, whole-reply is enough for
   v1). Fills, never sends — the user reads before firing.
6. Card closed or seat closed → controller closed. A consult never survives
   its chat. One consult per seat at a time; a second Consult → click warns.

## Button row semantics — Consult → beside Hand off →

The two buttons look like siblings and mean opposite things; the row itself
must teach the split.

- **Tooltips** (title attributes, house style):
  - Consult → : "Quick second opinion — a persona reads this chat and
    answers YOU. Nothing is handed over; this seat keeps the work."
  - Hand off → : "Transfer the work — this chat wraps and the persona you
    pick takes over from its handoff packet."
- **Soft hierarchy, no hard gate.** Hand off → stays clickable always — the
  packet request already forces a plan/summary out of the chat at transfer
  time, so a planless chat cannot hand off planless work. When the chat HAS
  an active board todo (an apex-todo task bound to this chat), Hand off →
  gains the accent/dot treatment: the UI points at the natural next step
  without forbidding the ad-hoc one. (A hard grey-out gate was considered
  and rejected: it double-locks a door the packet demand already checks,
  and kills the deliberate chat-became-real-work flow.)
- Both button behaviors and tooltips land in slice 1; the accent state reads
  the existing chat→task binding the workflow layer already tracks.

## Guardrails

- The consultant's output is untrusted text, rendered as text — linkified
  like chat, never parsed for verbs, never executed, never auto-inserted.
- The digest is one-directional: chat → consultant. Nothing the consultant
  says enters the seat transcript, the observers' tap, the board, or memory.
  The workflow layer and auditor never see a consult happened.
- A watched seat (live auditor on) can still be consulted — the two hidden
  seats are independent and neither sees the other.
- Dead/timeout/error → the card says so plainly and offers retry; the chat
  is untouched by every failure mode.
- Cost posture: consult is user-initiated, single-seat, bounded-turn — the
  same economics as the relationship pass, cheaper than a chain step.

## Implementation sequence

1. **Core consult** — `main/consult.js` (request → digest → kickoff →
   lifecycle → bus events), the consult card + picker (no model dial),
   send-to-composer, kill/timeout/turn-bound. Hermetic drill: digest bounds,
   kickoff composition (persona vs bare), turn cap, close-on-seat-death,
   the one-per-seat rule, hostile reply rendered inert. `npm test` whole,
   `APEX_SMOKE=1` exit 0, floorplan.md (new module + card) + CHANGELOG.md.
2. **Polish** — model/effort dial once the disposable override exists,
   usage snapshot in the picker, selection-level send-to-composer if cheap,
   Consult → surfaced in the ? help overlay. Same gates.

Ship slice 1 alone; it is useful without slice 2.

## Required verification

- Persona consult and bare-model consult, streamed to card.
- Digest bounded exactly (turns and bytes) with a long transcript.
- Follow-up rides the same controller; turn 6 refused with the notice.
- Send to composer fills and does not send.
- Kill, timeout, seat-death, and disposable-error each leave the chat
  transcript byte-identical.
- Second consult on the same seat warns; consult on a chain-step seat
  refused with the explanation.
- Consultant reply containing markup/fenced blocks renders as inert text.
- Memory composition: state.md + MEMORY.md inlined when present for the
  chat's project; fresh-eyes omits them; missing files inline nothing; an
  oversized state.md truncates with notice; note files NEVER inlined; the
  wrong project's tier never leaks in (cwd→slug resolution drilled).
- Nothing is ever written to the persona's home by a consult.
