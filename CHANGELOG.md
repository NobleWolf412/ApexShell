# Apex Shell Changelog

## Unreleased

- **STUDIO v2, Wave A slice A1 — the Look card + blueprint schema 2**
  (`extensions/studio/lib/*`, `extensions/studio/renderer.js`,
  `extensions/studio/main.js`): the interview gains a seventh area, `look`
  (palette leanings, type feel, density, tone words, references BY NAME —
  portable words only, never a path or binary), as a full citizen: its own
  card with depth note, example, chips, and Help-me-decide nudges (thin
  answer / no palette words / no tone words); the canonical template gains a
  "Design Language" section (`app-builder:look` marker) sourced from it; and
  the blueprint schema bumps to **2**. Compatibility is deliberate: a
  schema-1 package is "older schema — import to upgrade", not unsupported —
  native validation blocks with that plain-language message while import
  mode audits it cleanly and reports `look` as a gap (a missing look area is
  ALWAYS an incomplete-area warning, never a block; unknown versions like 99
  stay outright errors). Pre-A1 drafts on disk read back with the new card
  simply unanswered (an older-schema preview bundle is dropped and
  regenerated deterministically — answers untouched). The AI suggest pass
  and co-designer patch allowlist pick the card up automatically because
  they derive from the interview module; the one hard-coded six-key list
  (the co-designer contract prompt's `card` enum) now derives too. Drills
  extended across `test/studio-{lib,drafts,review,import,codesigner}-drill.js`
  (schema-1 native vs import severity, look-gap import, schema-2 round-trip,
  look heuristics, draft migration) with a new `test/studio-fixtures/valid-v1`
  schema-1 fixture; the `valid` fixture is now schema 2 and
  `unsupported-schema` declares 99 (2 stopped being unsupported).

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
  spend), chained into `test:core`.
- **Consult v1, slice 2** (polish): the picker gains a model/effort dial (the
  disposable launch override, App Builder slice 5 — steers that one consult's
  seat only; omitted stays the default lane model) and a Claude usage
  snapshot (session/weekly %) so spend is visible before send. "Send to
  composer" now sends just the selected text when part of the reply is
  selected, otherwise the whole reply. Consult → is listed in the `?`
  gestures/shortcuts overlay beside Hand off →. `test/consult-drill.js`
  gained launch-override passthrough coverage (22/22).

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
- **App Builder per-card AI suggest pass** (`extensions/studio/`): each
  interview card now offers an opt-in AI pass alongside its free heuristic
  chips — one disposable turn, never run without explicit approval. Mirrors
  `extensions/personas/main.js`'s `personaTestPrepare`/`personaRelSuggestLlm`
  pattern exactly: `projectsCardSuggestPrepare` reports a usage snapshot
  (`ctx.usage.claudeSnapshot()`) and stamps a 5-minute TTL (same order as
  personas' `TEST_PREPARE_TTL_MS`) on the prepared-but-unapproved state;
  `projectsCardSuggestRun` refuses to fire without `approved: true`, re-checks
  the TTL and the draft's revision, and allows only one pass at a time. The
  disposable call (`ctx.seats.startDisposable`) carries `launch: { model,
  effort }` sourced from the STUDIO header picker
  (`modelPicker.readModelPick`) — omitted entirely when no pick is saved yet,
  byte-identical to the legacy path per slice 5's contract. A 120-second
  backstop timer (matching `personaRelSuggestLlm`'s) force-finishes the pass
  with an error if the seat never answers, and `done()` always posts a result.
  New `lib/suggest.js`: the prompt builder (the card's question + the current
  answer + every existing project's `project-context.md` digest, read via
  `contract.readSiblingContexts` — reused, not reinvented, for overlap
  detection) and the untrusted-reply parser, which allows only a bounded,
  capped list of suggestion strings (`MAX_SUGGESTIONS`/`TEXT_CAP` matching
  `relationships.js`'s own caps) — oversize is trimmed rather than rejected,
  unknown fields and wrong-typed entries are dropped silently, and a missing
  JSON block, non-JSON payload, or empty reply fails closed to an empty list
  plus a clear error, never a thrown exception. Parsed suggestions render as
  chips on the card; clicking one proposes text into the free-text answer —
  the AI never writes the draft directly, the user still saves/next for it to
  count. New `test/studio-suggest-drill.js` (parser: valid / oversized /
  hostile / non-JSON-empty-missing-block; prompt builder as a pure function;
  and the full prepare→approve→run bus wiring driven through a stubbed
  `ctx.seats.startDisposable`, covering the approval gate, TTL expiry,
  revision staleness, single-flight, a dead seat, the backstop, and the launch
  passthrough) chained into `test:studio`; zero LLM spend. Renderer edits
  apply on Reload; the `main.js`/`contract.js` changes need Update & restart.
  (App Builder v1, slice 6 of 9.)
- **App Builder co-designer** (`extensions/studio/`): the PROJECTS builder gains
  a persistent side-panel chat riding **ONE long-lived disposable controller**
  per open panel session — not a fresh one per turn. `codesignerOpen` starts it
  (its kickoff turn fires the same way `createDisposable`'s own kickoff-on-
  construct already does); every later `codesignerSend` reuses that SAME
  controller's `.send()`, streamed live back to the panel via `codesignerDelta`
  (running text) and finalized on `codesignerMessage`. **Closed panel = closed
  seat**: `codesignerClose` (explicit, or an implicit re-open) always tears the
  controller down, and reopening starts a **fresh** controller from a fresh
  digest — no session resumption, no leftover state. Each turn — including the
  kickoff — is prefixed with a compact **blueprint digest** (new
  `lib/codesigner.js`'s `buildDigest`: structured per-card status —
  answered/thin/empty plus char count, never the free-text answers themselves
  and never the running conversation) so the co-designer always argues from the
  draft as it stands *right now*, including a card the user just edited or a
  patch just accepted. A reply may end with one fenced ` ```apex-studio ` JSON
  block proposing up to `MAX_PATCHES` (4) card patches; the parser
  (`extractPatchBlock`/`validatePatches`/`parsePatchReply`) mirrors
  `main/engine/handoff.js`'s untrusted-packet discipline exactly — strict
  allowlist (only the six interview card keys; the v1 draft schema has exactly
  one free-text field per card, so `field` allowlists to `"answer"` alone),
  bounded array (a 5th+ patch is **trimmed**, not grounds to drop the whole
  block — the same choice `handoff.js` makes for its own `MAX_ARTIFACTS` and
  `suggest.js` makes for `MAX_SUGGESTIONS`), capped strings (`PROPOSAL_CAP` 800 /
  `WHY_CAP` 300, trimmed not rejected), and drop-not-throw on anything else
  (wrong types, nested junk, unknown fields, non-JSON, missing block, empty
  reply — all fail closed to an empty patch list). Patches render as
  **accept/reject chips ON their target card** (`renderCoPatchBlock`/
  `wireCoPatchesForCard` in `renderer.js`) — the AI never writes the blueprint;
  only an explicit **ACCEPT** click (`codesignerPatchAccept`) appends the
  proposal into that card's answer through the normal revision-gated
  `drafts.updateDraft`, posted back via a dedicated `projectsDraftPatched`
  event that refreshes the draft **without** the step-navigation side effect
  `projectsDraftStatus` carries (accepting a patch on a card you're not looking
  at must not yank you there). Uses slice 5's launch override exactly like
  slice 6: `launch: { model, effort }` from `modelPicker.readModelPick`, omitted
  entirely when unset. New `test/studio-codesigner-drill.js` — the patch-block
  contract (valid/unknown-card/5+-trim/oversize-cap/nested-junk/non-JSON-empty-
  missing-block, all as discrete named checks), the digest composer (proves it
  is structured card-state, not a transcript or the raw answer text), and the
  controller lifecycle (open starts exactly one `startDisposable` call, three
  sends reuse that one controller, close closes it and rejects a further send,
  reopen starts a distinct controller and closes the old one, accept/reject
  wiring) — driven through a stubbed `ctx.seats.startDisposable`, zero LLM
  spend, chained into `test:studio`. Renderer edits apply on Reload; the
  `main.js` change needs Update & restart. (App Builder v1, slice 7 of 9.)
- **Create Project + Lift-off** (`extensions/studio/`): the explicit action that
  finally writes a portable package to disk, and the payoff screen after it.
  `lib/creator.js` (`createProjectPackage`) writes PROJECT.md, blueprint.json,
  and project-context.md atomically — same-directory temp-folder-plus-rename,
  lock-file-guarded, reusing slice 2's `contract.js` (`isSafeProjectId`,
  `validateProjectPackage({mode:'create'})`) for id safety, traversal rejection,
  and would-overwrite detection *before* any lock/stage exists, so a collision or
  a bad id leaves zero stray files; `archiveProject` moves a project under
  `.archive/` instead of deleting it — a separate explicit action from draft
  deletion. Lift-off offers three independent actions: **(a) Register
  workspace** — a new `ctx.seats.registerWorkspace({name, path})` (main/seats.js;
  a plain synchronous method beside the existing `checkPresetNames`/
  `replacePresetGroup`, not a bus verb — the bus's `post()`/`on()` are
  main→renderer/renderer→main only, so a synchronous result can never reach a
  calling main-side extension any other way) adds `{name, path}` to
  `_workspaces`, collision (same name OR path) warns and never clobbers the
  existing entry, every other `seatconfig.json` key is untouched. **(b) Delegate
  to the Architect** — dispatches the workflow layer's own `taskCreate` (+
  `taskRouteSave` when the user accepts the route as a template) via
  `ctx.bus.inject` (the same in-process dispatch `main/main.js`'s own smoke code
  and `test/live-chain` use — `post()` cannot hand a return value back to a
  main-side caller, `inject()` is "the same code path a renderer post takes past
  ipc"); the route defaults to the first live Architect-shaped preset alone
  (`lib/liftoff.js`), is user-editable, and is checked against
  `ctx.seats.presetNames()` (new read-only method beside `registerWorkspace`)
  before ever calling `taskCreate` — an unknown preset warns instead of
  creating a task, and no Architect-shaped preset at all explains itself and
  points at the PERSONAS sub-tab instead of failing opaquely. `main/tasks.js`
  gained one small additive field for this: `taskCreate`'s optional `brief`
  rides step 0's kickoff only (`composeTaskBody`) as the verbatim PROJECT.md
  text, never a summary — absent for every existing caller, byte-identical
  behavior when omitted. **(c) Open a chat here** — one bare `seatCreate` seat
  in the project's folder, no route, no task. New `test/studio-liftoff-drill.js`
  (atomic write + rollback-on-collision + traversal-rejection + validator
  round-trip, archive-not-delete, the three Lift-off actions' decision logic
  against a stubbed `ctx.seats`/fake bus, and `main/tasks.js`'s `brief` field
  against the real module) chained into `test:studio`, zero LLM spend, no real
  seat/task ever launches. Renderer edits apply on Reload; the `main.js`/
  `main/seats.js`/`main/tasks.js` changes need Update & restart. (App Builder
  v1, slice 8 of 9.)
- **App Builder import/audit mode** (`extensions/studio/lib/importer.js`): an
  existing project folder (or a folder holding a bare PROJECT.md) can now enter
  the builder in audit mode, mirroring the Persona Builder's importer
  discipline function-for-function: read-only inspection (never writes to the
  source), a heading→area mapping the user reviews before anything is built,
  and the blueprint built from the APPROVED mapping only — an unmapped or
  missing section is a reported gap, never invented content. Three new bus
  verbs: `projectsImportChoose` (pick a folder, audit it, seed a mapping from
  heading heuristics), `projectsImportSetMapping` (retarget ONE section's area
  — or clear it — without re-picking or re-reading the source: the targeted-
  revision primitive, usable both during the first review and again later to
  fix one gap), and `projectsImportBuild` (turn the currently-approved mapping
  into a draft's answers, then run the SAME `blueprint.buildBundle` every other
  draft uses, so gap reporting is never a second implementation of "never
  invent" — the first build creates a new draft, every later call from the
  same audit updates that one draft instead of creating a second). The STUDIO
  Start screen gained an "IMPORT EXISTING PROJECT…" entry point with a mapping
  review screen (one dropdown per detected section, gaps listed in plain
  language) that lands in Blueprint Review the moment a draft is built.
  **Validator polish**: swept `contract.js`'s error/warning/suggestion messages
  for terse or code-shaped text (`schema_version` literals, "Runtime-only
  fields are not portable blueprint data", "Blueprint area is missing or
  invalid", the fluff tripwires, the orphan/overlap suggestions) and rewrote
  them in plain language — rule codes and logic are untouched, and the two
  message-text drill assertions elsewhere in the suite (`/escapes/` in
  `resolveInside`, `/kebab-case/` in `render.js`/`blueprint.js`'s own
  `isSafeProjectId` guards) were left alone and still pass unmodified. New
  `test/studio-import-drill.js` (clean import, missing areas, five hostile-path
  shapes, targeted revision, and a read-only proof that asserts the source
  folder's bytes/mtime/directory listing are unchanged after a full
  choose→remap→build flow) chained into `test:studio`; zero LLM spend, no real
  seat/disposable call. Renderer edits (the import screen) apply on Reload;
  the `main.js`/`contract.js` changes need Update & restart. (App Builder v1,
  slice 9 of 9 — final content slice.)

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
