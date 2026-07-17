# Live Auditor — v1 spec

Status: IMPLEMENTED (shipped 2026-07-16). Live in `main/audit.js` +
`renderer/auditPane.js` + `main/engine/audit.js`; see floorplan.md § The live
auditor. This spec is kept as the design record.

## Purpose

An opt-in shadow auditor that watches the active chat and surfaces a live
second opinion — risky actions, drifted assumptions, unverified claims —
without the user manually invoking a review. Complements the Task Board's
structured audit *step*: that is a gate inside a delegation chain; this is
ambient, continuous feedback on any seat you point it at.

## Cost discipline (the governing constraint)

Continuous auditing roughly doubles token flow for any watched seat, so cost
control is the design, not an afterthought:

- **Off by default. Per-seat toggle.** Never global, never automatic.
- **Cheap model.** The shadow auditor runs haiku/low regardless of the watched
  seat's model.
- **Debounced + windowed.** Audits fire on the watched seat's turn completion
  (`result`), debounced ~4s, over a rolling transcript window (last ~6 turns,
  byte-capped) — not the whole history each pass.
- **One-shot mode.** An "audit now" button runs a single pass over the last N
  turns without arming continuous watch — most of the value at a fraction of
  the spend.
- **Auto-off guard.** Optional per-session token ceiling; crossing it disarms
  the watch with a toast.

## Mechanism (reuses existing plumbing)

- `seats.observeSeats(fn)` — the same tap the Task Board uses — accumulates the
  watched seat's `text` per turn.
- On `result` (debounced), the rolling window goes to a **disposable seat**
  (`createDisposable`, tools-disabled, no persistence) carrying an audit
  contract.
- The disposable auditor ends its turn with one fenced `apex-audit` JSON block
  — same untrusted-output discipline as `main/engine/handoff.js`:
  `{ "findings": [ { "severity": "info|warn|risk", "claim": "...",
  "why": "...", "suggestion": "..." } ] }`, validated against a strict
  allowlist, capped at 3 findings/pass, all text length-capped.

## Independence

The shadow auditor sees the **transcript only** — never the watched persona's
memory or identity. Same principle that makes the Task Board's audit step
worth having: independent context is the whole point of a second opinion.

## UI

- **Toggle** in the seat's dial row / menu: "Live audit (haiku)" with a
  running token-spent readout so the cost is never hidden.
- **AUDIT dock pane** (new left pane, ~order 18) — deliberately NOT the viewer
  (the viewer is the artifact surface and gets overwritten by every image a
  seat reads). Findings render as severity-coded cards scoped to the active
  seat; switching seats switches the view.
- Per-finding **"send to chat"** pastes the finding into the watched seat's
  composer (you decide whether to act) and **"dismiss."**
- A per-seat chip (like the ⛓ chain chip) marks a seat as watched.

## Build surface (fully additive — no existing flow changes)

- New: `main/engine/audit.js` (pure contract, mirrors handoff.js),
  `renderer/auditPane.js`, `renderer/styles/audit.css`, `test/audit-drill.js`.
- Modified: `main/seats.js` (audit-watch lifecycle riding the observeSeats
  tap), `renderer/index.html` (pane + toggle), `renderer/chatView.js` (dial-row
  toggle + watched chip).

## Open questions

- **Auditor identity** — fixed neutral reviewer, or point the watch at your own
  Auditor persona's identity/kickoff? Selectable is more powerful; resolve the
  independence tension by letting it borrow the Auditor's *identity* while still
  denying it the watched seat's memory.
- **Window/debounce defaults** — tune against real spend after first use.
- **Relationship to the Task Board audit step** — a watched seat that is also a
  chain step: suppress the live audit during the chain (the chain has its own
  audit) or allow both? Lean suppress, to avoid double-billing.
