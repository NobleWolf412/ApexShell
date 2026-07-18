# Apex Shell Changelog

## Unreleased

- **Consult v1, slice 1** (`main/consult.js`, `main/engine/consult.js`,
  `renderer/chatView.js`): a **Consult →** button beside Hand off → in every
  live, non-chain seat's tab row. One click: pick a persona (or "just a
  model"), ask a question, and a hidden, tool-less disposable seat — seeded
  with a bounded digest of the current chat (the live auditor's own
  6-turn/8KB window) plus, for a persona, its own tiered memory (foundation +
  canonical always; its `memory/projects/<slug>/state.md` + `MEMORY.md`
  unless "fresh eyes" is on) — streams a second opinion into an in-chat
  consult card. Up to 5 turns ride the same controller, each follow-up
  carrying a fresh digest delta; a 120s per-turn backstop and every
  dead/timeout/error close the consult and say so plainly — the chat's own
  transcript is untouched by every failure mode, and by design (main never
  inspects the reply, the renderer renders it exactly like chat prose). "Send
  to composer" fills the operator's composer with the whole reply — never
  sends it. Hand off →'s tab-row button gains a soft accent when the chat has
  a live board-task binding (`main/tasks.js`'s `chatTasks`, now surfaced to
  the renderer as `boundSeatIds`) — a suggestion, never a gate. New
  `test/consult-drill.js` (pure contract + lifecycle state machine, zero LLM
  spend), chained into `test:core`. No model/effort dial yet — lands with the
  disposable launch override already in the engine (slice 2).

- **STUDIO shell** (`extensions/studio/`): a new dock pane (order 20 — the slot
  PERSONAS held) that hosts the builders as sub-views behind PERSONAS|PROJECTS
  sub-tabs. Exposes the `ApexStudio.registerBuilder({id, label, mount, order})`
  seam. The Persona Builder is re-homed into it unchanged (same DOM, styles, and
  bus traffic — only its registration seam moved from `ApexShell.registerDockPane`
  to `ApexStudio.registerBuilder`). PROJECTS ships as an empty placeholder for the
  App Builder (slice 2+). Extension load order gained an optional manifest
  `priority` so the studio host initializes before its dependents (renderer
  scripts now inject `async=false` to honor it). New `test:studio` drill, chained
  into `npm test`. (App Builder v1, slice 1 of 9.)
- **App Builder contract library** (`extensions/studio/lib/`): the pure,
  Electron-free contract for portable project packages. `contract.js` carries the
  blueprint schema constants (schema v1, the six areas `idea`/`users`/`scope`/
  `platform`/`architecture`/`delivery`), safe project IDs, workspace-containment
  path handling, PROJECT.md frontmatter parsing, sha256 canonical hashing, and the
  deterministic `validateProjectPackage` rules — errors block (unsafe/mismatched
  id, malformed frontmatter/JSON, unsupported schema, workspace escape,
  would-overwrite, runtime-field leak), warnings review (incomplete area, hash
  drift, no non-goals, no verification), suggestions advise (thin vision/MVP,
  project overlap, orphan component). Validation never throws — it returns a
  structured `{ valid, errors, warnings, suggestions }`. `render.js` renders the
  canonical PROJECT.md from an approved shape with renameable headings behind
  stable `app-builder:<section>` markers. No provider, model, credential, or
  machine path may enter the package. New `test/studio-lib-drill.js` (with static
  fixtures under `test/studio-fixtures/`) chained into `test:studio`; zero LLM
  spend. No UI, no bus verbs. (App Builder v1, slice 2 of 9.)
- **App Builder workspace + drafts + interview** (`extensions/studio/`): the
  PROJECTS sub-tab is now a working guided interview. A projects-workspace picker
  (`ctx.pickDirectory`) persists the choice to `state/extensions/studio/workspace.json`
  with the persona discipline — schema-versioned, absolute path, atomic
  temp-file-plus-rename write. A crash-safe draft store (`lib/drafts.js`, sibling of
  the persona store: atomic `wx`+rename so an interrupted write only ever orphans a
  `.tmp`, symlink-refusing, revision-gated, workspace-isolated) keeps the in-progress
  interview — working name, one-sentence pitch, and the six card answers — under
  `ctx.stateDir`, never in the portable package; draft deletion is its own explicit
  action. The six interview cards (`lib/interview.js`, keyed to the blueprint areas)
  carry a plain question, expected-depth note, a complete example, suggested choices,
  and a **Help-me-decide** that is a pure client-side heuristic — card thought-starters
  plus live nudges (thin answer, scope with no non-goal, delivery with no verification);
  no AI or disposable call anywhere in this slice. The renderer mounts through the same
  `ApexStudio.registerBuilder({ id: 'projects' })` seam with a stepper + card flow, Back /
  Save draft / Skip, and a resume-or-delete draft list; all bus wiring is gated so the
  headless studio-drill still exercises the shell seam untouched. New
  `test/studio-drafts-drill.js` (create / save / reopen / crash-recover / delete, the
  workspace picker, the interview bus verbs, and the heuristic) chained into
  `test:studio`; zero LLM spend. (App Builder v1, slice 3 of 9.)
- **App Builder Blueprint Review + Canonical Draft** (`extensions/studio/`): the
  PROJECTS builder now carries the interview through to a delegable canonical.
  A new **Review** step shows the six structured answers with gaps highlighted; a
  new **Canonical** step generates PROJECT.md from **approved answers only** and
  never invents content — a missing area renders as an explicit, visible
  "incomplete" placeholder in its section (`lib/blueprint.js`, pattern-matched
  from the persona render bundle: `buildBundle` / `withCanonicalEdit` /
  `regenerateSection` / `acceptCanonical`, all using the slice-2 `renderCanonical`
  / `hashCanonical` primitives rather than duplicating them). Card→section
  partition: `idea`+`users` collapse into "Vision and Users", each other card owns
  one section, and "Risks and Open Questions" (no dedicated card in v1) is authored
  by hand — a visible gap until then, never a split-and-invent of the delivery
  answer. **Hash-drift** is detected against the approved blueprint snapshot
  (persisted on the draft, `lib/drafts.js` gaining a validated `preview` field so
  drift survives reload/crash): a manual edit surfaces a **review prompt** —
  re-approve (adopt + rehash) or regenerate from answers (discard the edit) — and
  is **never** a silent regeneration. **Targeted per-section regeneration**
  re-renders one section from its approved answer, leaving the others and any manual
  edits elsewhere intact. The **validation report** projects the slice-2
  `validateProjectPackage` rules (errors block, warnings review, suggestions advise)
  by staging the preview into an ephemeral temp package and running the same
  contract — no validation logic is re-implemented, and no package is written to the
  projects workspace (that is slice 8). No AI or disposable call in this slice. New
  `test/studio-review-drill.js` (drift detection + review arms, section regen,
  gap rendering, the validation projection, draft-store snapshot persistence, and
  the preview bus verbs) chained into `test:studio`; zero LLM spend. (App Builder
  v1, slice 4 of 9.)
- **Disposable launch override — the engine slice** (`main/engine/seatHost.js`,
  `main/seats.js`): `createDisposable` and the `ctx.seats.startDisposable`
  extension seam accept an optional `launch: { model, effort }`. `model`
  validates against the Claude-lane tiers ONLY (`fable | opus | sonnet |
  haiku`) — a disposable always spawns via `claudeSeat`, so codex/qwen/agy are
  rejected with a clean thrown `Error` before any scratch dir or child process
  exists (no crash, no fallback spawn). The pre-existing flat `model`/`effort`
  params (`main/audit.js`'s haiku pass) still work unchanged — `launch`, when
  given, simply wins over them — and omitting `launch` entirely (the shape
  `personaTestPrepare`/`personaRelSuggestLlm` already use) is byte-identical to
  before this slice; `main/seats.js`'s `startDisposable` stays a pure
  passthrough, so the engine is the single validation gate. The engine stays
  Electron-free (zero new imports in `seatHost.js`). Added the **STUDIO header
  model picker** (`extensions/studio/lib/modelPicker.js`): one choice,
  persisted atomically in `state/extensions/studio/model.json`, shared across
  builders — nothing calls a disposable with it yet (slices 6/7 will). New
  `test/engine-harness.js` cases (valid tier honored — a real spawn; non-Claude
  lane rejected — pure, no live spend; omitted launch = legacy — a real spawn
  matching today's exact call shape) plus `test/studio-model-picker-drill.js`
  (hermetic, zero LLM spend) chained into `test:studio`. `npm run test:live`
  gates the engine cases. Update & restart applies. (App Builder v1, slice 5
  of 9 — the engine touch.)

## 0.2.0 — 2026-07-17

Personas returned as a first-class, tool-driven system, plus a wave of
workflow, tracker, and UX work.

- **Persona Builder + cast**: a create/edit/archive persona system
  (`extensions/personas/`) with a workspace at `apex/personas`. Shipped the
  Architect (read-only planner), Auditor (read-only review + UX/UI lens), and
  Coder (implementation + debugging) cast. Read-only is enforced technically
  via a per-persona toolset wall (`tools`/`disallowedTools` in seatconfig).
- **TODO board** (renamed from TASKS): persona-route chains, the Delegate-from-
  chat path, a seat-first packet-ask ladder before any hand-typed summary, and
  the **apex-todo** block — any chat can post/refresh a checklist on the board.
- **MCP tracker**: a CONTROL CENTER pane showing active-in-project vs available
  MCP servers with live health via `claude mcp list`; graphify + serena made
  global (cwd-resolved).
- **Live auditor**: opt-in per-seat shadow review (haiku), with an auto-stop
  ceiling and a hung-pass backstop.
- **Local lane**: switched Ollama default from Qwen to gpt-oss:20b (+ llama3.1
  fallback); UI relabelled "Local (Ollama)".
- **Viewer**: pin-to-hold + a history strip of recent artifacts; readable text.
- **UX pass**: clickable tracker chips, keyboard shortcuts + a `?` cheat-sheet,
  named workspaces (with a scratch default) + rail-menu manage controls,
  ApexPrompt (the missing `window.prompt`), and a batch of correctness fixes
  from a full audit sweep (timer leaks, propagation bugs, stale-state races).
- **Model dial**: `fable` alias sent to the wire as its full model id on both
  launch and live-switch paths (CLI alias regression workaround).

## 0.1.0 — 2026-07-15

- Created the independent Apex Shell repository from the proven standalone app.
- Shipped built-in Viewer and Terminal dock tabs.
- Kept AI seats, PTY terminals, trackers, themes, backgrounds, and drop-in extensions.
- Removed all persona, pipeline-worker, lab-specific, credential, transcript, and operator-state coupling.
- Added the agent-led install contract and Windows launcher.
- Published the public GitHub repository at `Ir8code/ApexShell` while retaining
  the private Vault remote as the build machine's canonical upstream.
- Fixed web links being misread as Windows paths at the `s:/` inside `https://`;
  HTTP(S) targets are now fully visible, clickable, keyboard-accessible, and
  opened externally only after explicit user activation.
