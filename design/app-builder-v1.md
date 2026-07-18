# App Builder v1 (STUDIO) — Build Specification

Status: implemented (slices 1-9 all shipped: STUDIO shell, contract library,
workspace/drafts/interview, canonical review + drift, the disposable launch
override, per-card AI suggest, the co-designer panel, Create + Lift-off,
import + validator polish — see CHANGELOG.md and floorplan.md § Seats /
§ The workflow layer for the engine and core-module touches). One known gap
against this spec: `projectsRemove` (§ Write safety, archive-not-delete) is
implemented and drilled (`test/studio-liftoff-drill.js`) but has no PROJECTS
UI affordance yet — a follow-up, not a divergence in behavior. The build
prompts (`design/app-builder-v1-prompts.md`) and the UX mockup
(`design/mockups/studio-mockup.html`) are removed now that the implementation
they guided has shipped — see git history (slice 10, the Sweep).

Superseding note (STUDIO v2 Wave A, 2026-07-18): this spec's "six areas" /
"schema 1" language describes v1 as it shipped. The builder now speaks
blueprint schema 2 — a seventh `look` area, `design/tokens.json`, and the
SEE mockup step — per `design/studio-v2.md` § Wave A; schema-1 packages
import cleanly there.

## Outcome

Apex Shell gains a **STUDIO** — one dock tab hosting both builders as
sub-views: **PERSONAS** (the existing Persona Builder, re-homed unchanged) and
**PROJECTS** (new). The App Builder takes a person from a vague idea to a
**delegable project blueprint**: a guided interview shapes the idea, AI assists
at every step on a model the user chooses, and Create hands the finished
package straight to the Architect through the existing workflow layer.

The builder creates *blueprints*. Seated personas do the building. The
workflow layer coordinates them. These remain cleanly separated — the App
Builder never writes code, never scaffolds a repo, never runs a chain itself.

## Non-goals for v1

- Scaffold code, `git init`, or generate starter files (a seated coder persona
  does that better, from the blueprint).
- Bind a project to a provider, model, or machine path in the portable package.
- Automate multi-step routing beyond seeding one task with a suggested route.
- Replace the TODO board, Hand off →, or delegation machinery — the builder
  *feeds* them.
- Offer codex/local lanes on the disposable model picker (Claude-lane tiers
  only in v1; the seam is lane-ready, the UI is not).
- Redesign the Persona Builder. It moves house; its behavior is untouched.

## The STUDIO shell

A new `extensions/studio/` extension owns the dock pane (order 20 — the slot
PERSONAS holds today). The pane header carries two sub-tabs: PERSONAS |
PROJECTS. The TERMINAL tab is untouched — base-shell features stay.

The studio renderer exposes one small seam:

```js
ApexStudio.registerBuilder({ id, label, mount(el), order })
```

The Persona Builder's renderer half switches its last line from
`ApexShell.registerDockPane(pane, { order: 20 })` to
`ApexStudio.registerBuilder({ id: 'personas', label: 'PERSONAS', mount, order: 10 })`
— a pure re-homing; its DOM, styles, and bus traffic do not change. The App
Builder registers as `{ id: 'projects', label: 'PROJECTS', order: 20 }`.

Quarter pull works for quick edits; **drag-to-full is the portal mode** — the
existing dock geometry already covers the stage, so no new shell contribution
point is needed. Load order note: studio's renderer script must inject before
both builders' (extension injection is manifest-ordered; the studio extension
sorts first or exposes a ready promise — implementer's choice, drilled either
way).

## Portable project package

The App Builder writes into a **projects workspace** the user picks once
(directory picker, stored in `state/extensions/studio/workspace.json`, same
discipline as the persona workspace — absolute path, schema-versioned,
atomic write). Each project is one folder:

```text
<projects-workspace>/
└── <project-id>/
    ├── PROJECT.md            authoritative blueprint — readable, editable,
    │                         usable without the builder
    ├── blueprint.json        approved interview snapshot + provenance + hash
    ├── project-context.md    short digest other tools read (the persona
    │                         builder's relationship pass already consumes
    │                         this name)
    └── notes/                optional: co-designer artifacts the user kept
```

Authority mirrors the Persona Builder exactly: `PROJECT.md` is canonical;
`blueprint.json` never overrides it and records a hash of the canonical it
produced; external edits surface as a review prompt on reopen, never a silent
regeneration. No provider, model, credential, or machine path enters the
package.

## PROJECT.md — canonical template

```markdown
---
schema_version: 1
name: project-id
display_name: Display Name
description: One-sentence pitch of what this project is.
---

# Display Name

## Vision and Users
<!-- The idea, who it serves, the pain it kills, the success signal. -->

## Scope and MVP Cut
<!-- What v1 does, what it deliberately does not, explicit non-goals. -->

## Platform and Stack
<!-- Targets (web/desktop/mobile/CLI), constraints, stack preferences,
     existing repos or systems it must live with. -->

## Architecture Sketch
<!-- Key components, data owned, integrations, the risky seams. -->

## Milestones and Delivery
<!-- Ordered milestones, what lift-off means, verification demands. -->

## Risks and Open Questions
<!-- Known unknowns, decisions parked for the Architect. -->
```

Six semantic areas, headings renameable, coverage validated from the
blueprint mapping — same rule as personas.

## Guided interview

Six cards, one at a time; Back, Save draft, Skip for now, Help me decide;
crash-safe automatic draft persistence in `ctx.stateDir` (the drafts library
pattern is lifted from `extensions/personas/lib/drafts.js` — extract shared
pieces into `extensions/studio/lib/` only where the code is genuinely
identical; no speculative frameworks).

1. **The idea** — elevator pitch, the itch it scratches, why now.
2. **Users and jobs** — who uses it, the jobs-to-be-done, what success looks
   like from the outside.
3. **Scope** — the MVP cut and the explicit non-goals. This card pushes back:
   thin answers here are the number-one blueprint killer.
4. **Platform and stack** — targets, constraints, preferences, prior art the
   project must coexist with.
5. **Architecture and data** — components, data owned, integrations, the
   parts the user already knows are hard.
6. **Delivery** — milestones, verification expectations, what "lifted off"
   means, risks to hand the Architect.

Each card: plain question, expected depth, suggested choices, a complete
example, free text, **Help me decide**.

## AI integration — two levels, one picker

### The model picker (the one core change)

`createDisposable` (engine) and `ctx.seats.startDisposable` (the extension
seam) accept an optional launch override:

```js
startDisposable({ kickoff, onEvent, launch: { model, effort } })
```

`model` validates against the Claude-lane tiers of the existing dial set
(`fable | opus | sonnet | haiku`); anything else is rejected at the seam —
`codex`/`qwen`/`agy` never reach a disposable in v1. Default when omitted:
today's behavior, unchanged — the persona builder and live auditor keep
working without edits. Engine change ⇒ `test/engine-harness.js` gains the
override case; `npm run test:live` gates it.

The STUDIO header carries the picker (persisted per-builder in
`state/extensions/studio/`): one choice drives both AI levels. Guidance in
the UI, not enforced: haiku for suggest chips, sonnet+ for the co-designer.

### Level 1 — suggest passes (per card)

Mirrors the persona builder's proven pattern: heuristics answer instantly and
free; an opt-in **AI pass** button runs one disposable turn (usage preflight +
explicit approval, exactly like `personaTestPrepare`/`personaRelSuggestLlm`),
prompt built from the draft so far plus `project-context.md` files of
*existing* projects in the workspace (overlap detection — "this sounds like
your X project's territory"). Replies parse under the untrusted-output
discipline (strict allowlist, bounded counts) and render as suggestion chips
the user accepts into the card or ignores.

### Level 2 — the co-designer

A persistent side panel inside the PROJECTS view: a real streamed chat riding
one long-lived disposable controller (`controller.send()` per user turn,
delta/text events render live — the plumbing the persona tester already
exercises). Its kickoff carries the co-designer contract; each user turn is
prefixed with a compact **blueprint digest** (structured card states, not the
whole transcript) so it always argues from the current draft.

The co-designer may end a reply with one fenced ```apex-studio``` JSON block:

```json
{ "patches": [ { "card": "scope", "field": "nonGoals",
                 "proposal": "...", "why": "..." } ] }
```

Parsed by a contract module under the same rules as `handoff.js`/`audit.js`:
strict allowlist (known cards/fields only), bounded (max 4 patches), string
lengths capped, everything else dropped. Patches render as **accept / reject
chips on the target card** — the AI never writes the blueprint; the user does.
A closed panel = a closed seat; reopening starts fresh from the digest (no
hidden context accumulates, and a stuck seat can always be killed like the
relationship pass's backstop timer).

## Blueprint shape

```json
{
  "schema_version": 1,
  "canonical_hash": "",
  "idea": {},
  "users": {},
  "scope": {},
  "platform": {},
  "architecture": {},
  "delivery": {}
}
```

Sub-answers preserved per card (targeted revision stays possible). No secret,
credential, provider binding, or machine path is stored.

## Builder state machine

1. **Workspace Setup** — choose the projects workspace (picker; reuse of the
   persona workspace's parent is fine but never required).
2. **Start** — working name + one-sentence pitch; new or imported project.
3. **Interview** — six cards; suggest passes and the co-designer available
   throughout.
4. **Blueprint Review** — structured answers; missing/contradictory decisions
   highlighted before prose generation.
5. **Canonical Draft** — render approved answers into PROJECT.md; targeted
   section regeneration; manual edit; hash drift detection.
6. **Validate** — deterministic checks + advisory review (below).
7. **Create Project** — explicit action writes the package atomically
   (same-directory temp + rename, no overwrite, traversal rejected).
8. **Lift-off** — the payoff screen, offered immediately after create:
   - **Register workspace** — adds `{ name, path }` to `_workspaces` in
     `seatconfig.json` so every seat picker knows the project (skipped with a
     warning if the name collides).
   - **Delegate to the Architect** — posts the workflow layer's own
     `taskCreate` + `taskStart` verbs: a board task in the project folder,
     route defaulting to a template that starts with a read-only advisor
     (Architect) and is user-editable before launch; the step kickoff carries
     PROJECT.md so the chain starts from the blueprint, not a rumor of it.
     Suggested routes the user accepts save as templates via `taskRouteSave`.
   - **Open a chat here** — one seat in the project cwd, no chain.
   Route names validate against live presets (the tasks module already
   enforces this); with no Architect-shaped persona present the delegate
   button explains itself instead of failing — and points at the PERSONAS
   sub-tab sitting one click away. That adjacency is the point of STUDIO.

Until Create Project, everything is a draft. The AI proposes; the user
authors and approves.

## Validation

### Deterministic errors

- Project ID empty, unsafe, or mismatched with its folder/canonical filename.
- Required frontmatter missing or malformed; JSON malformed; schema version
  unsupported.
- A path escapes the configured projects workspace.
- The package would overwrite an existing project.

### Warnings

- An interview area is incomplete.
- Canonical hash differs from the approved blueprint.
- Scope card names no non-goals (the fluff-logic tripwire).
- Delivery names no verification expectation.
- The delegate route references a preset that does not exist.

### Suggestions

- Vision or MVP cut too thin to guide an Architect.
- Overlap with an existing project's `project-context.md`.
- Architecture names a component no milestone ever touches.

Errors block. Warnings require review. Suggestions advise. Heuristics never
rewrite the blueprint on their own.

## Import

An existing project folder (or bare PROJECT.md) enters audit mode, mirroring
persona import: change nothing, validate structure, map existing sections to
the six areas with user review, build the initial blueprint from the approved
mapping, report gaps, offer targeted revision.

## Write safety

- All writes beneath the configured projects workspace; IDs normalized;
  traversal rejected.
- Same-directory temp folder + atomic rename; existing projects never
  overwritten.
- Draft deletion and project removal are separate explicit actions; removal
  archives (`projects/.archive/`) rather than deletes, like personas.
- No external message, publication, connector call, or credential access is
  required to build a project.

## Implementation sequence

1. **Studio shell** — `extensions/studio/` pane + `registerBuilder` seam;
   Persona Builder re-homed; smoke + persona drills prove zero behavior
   change. Ships alone.
2. **Contract library** — blueprint schema, safe IDs, paths, hashing,
   deterministic validation, fixtures, tests. No UI.
3. **Workspace + draft store + interview** — crash-safe drafts, six cards,
   heuristic Help-me-decide.
4. **Canonical renderer** — preview, targeted regeneration, manual edit, hash
   drift.
5. **Disposable launch override** — the engine seam + harness case + the
   STUDIO model picker.
6. **Suggest passes** — usage preflight, approval, allowlist parsing, chips.
7. **Co-designer** — panel chat, digest composer, `apex-studio` patch
   contract + its own parser drill.
8. **Create + Lift-off** — atomic package, `_workspaces` registration,
   delegate-to-Architect via `taskCreate`/`taskStart`/`taskRouteSave`.
9. **Import + validator polish** — audit mode, plain-language reports.

Each slice lands with its own tests and printed evidence; `npm test` passes
whole at every slice; slice 5 additionally gates on `npm run test:live`.

## Required verification

- Minimal valid project; full-detail project.
- Invalid ID / path traversal / overwrite collision.
- Malformed frontmatter, JSON, unsupported schema version.
- Canonical hash drift with no overwrite.
- Crash/restart draft recovery.
- Launch override: valid tier honored, non-Claude lane rejected, omitted =
  legacy behavior byte-identical.
- `apex-studio` patch block: valid patches chip correctly; unknown card,
  oversized proposal, and 5+ patches are dropped without error.
- Delegate flow: task created in the project cwd with the chosen route;
  unknown preset warns instead of creating; route template saves.
- `_workspaces` registration: added once, collision warned, seatconfig
  otherwise untouched.
- Persona Builder under STUDIO: full existing persona drill suite passes
  unmodified.
