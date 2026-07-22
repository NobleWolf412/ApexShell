# War Room — a multi-persona deliberation room

Five complementary AI personas argue *with each other* to invent ideas no single
agent would reach, then converge on a ranked list you review. Built to think
outside the box while staying cheap.

## The roster

| Persona | Default model | Role |
|---|---|---|
| **Brainstormer** | haiku | Pure divergence — 5-8 ideas/round, each naming the assumption it breaks (analogy / inversion / first-principles / 10×). |
| **Architect** | sonnet | Feasibility from a coding standpoint. A *generative* critic: reshapes the infeasible into a cheaper variant, never just vetoes. |
| **Auditor** | sonnet | Grounded in the real repo via the `apex-fetch` file contract. Hunts the "adjacent possible"; flags what already exists (a finding, not a veto). |
| **User Advocate** | haiku | The value axis — would you actually use this? Merges fragments into usable hybrids. |
| **Contrarian** | haiku | Devil's advocate. Leads the CLASH round, attacks the forming consensus to force second-order ideas. |

## How a session runs

`diverge → clash → converge` (2 or 3 rounds, dial). Each seat is a hidden,
tool-less disposable (text in / text out); the moderator (`main.js` +
`lib/session.js`) relays a bounded delta digest between them in plain code. The
Auditor may request ≤3 repo files per batch (2 batches/session) — read
path-guarded, never a live tool. You can interject at any time; it lands on the
next turn. A hard token ceiling (default 55k, dial 10-150k) auto-stops the room.

Output: reviewable idea cards (Approve / Dismiss) in the dock pane **and** a
`war-room/ideas-<date>.md` report written into the chosen repo.

## Design

- **Zero core edits.** Everything lives in this folder; it rides the standard
  `register(ctx)` + `ctx.seats.startDisposable` + `registerDockPane` contract.
- **Token discipline** is the whole point: cheap models by role, bounded digests
  (6 turns / 8KB tails on the relay caps), est-token metering, an auto-off ceiling,
  and 120s per-turn backstops. Numbers mirror the shell's live-auditor/consult recipes.
- **Untrusted output** (the `apex-ideas` / `apex-fetch` fenced blocks) is validated
  by a strict allowlist — fresh objects, Set-checked enums, hard caps — exactly like
  `main/engine/audit.js`.

## Proving it

- `node test/warroom-drill.js` — headless: round order, delta digests, interjection,
  budget governor, the idea contract + merge/rank, the fetch guard, and backstop
  survival. No model, no Electron.
- `APEX_SMOKE=1 APEX_SMOKE_DOCK=warroom npx electron .` — pane registers, exit 0.
