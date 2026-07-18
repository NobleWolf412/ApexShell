# App Builder v1 — build prompts

How to run this: **one slice per fresh seat, in the repo root, in order.**
Never two slices in one context — a fresh seat re-reads the spec and can't
inherit the last slice's drift. The seat picks up CLAUDE.md on its own; these
prompts point it at the spec and pin the gates. Paste verbatim, edit freely.

Board alternative: NEW TASK per slice with your normal route
(e.g. Coder, or Architect → Coder → Auditor for the engine slice), repo cwd =
ApexShell, and the slice prompt as the task description. Slice 5 is the one
that genuinely earns a review step — it touches the engine.

After each slice lands: run the app, poke the feature, then start the next
seat. Slice 1 ships alone and proves the re-homing before any new code exists.

---

## Slice 1 — STUDIO shell + re-home the Persona Builder

```
Read design/app-builder-v1.md (§ The STUDIO shell) and floorplan.md before
touching anything. Implement SLICE 1 ONLY: a new extensions/studio/ extension
that owns one dock pane (order 20) titled STUDIO with sub-tabs, exposing
ApexStudio.registerBuilder({id,label,mount,order}). Re-home the Persona
Builder into it: its renderer registers as {id:'personas'} instead of calling
ApexShell.registerDockPane. ZERO behavior change to the Persona Builder — same
DOM, same styles, same bus traffic. Solve renderer load order so ApexStudio
exists before the personas renderer runs, and document the choice.
Match the existing pane CSS conventions (styles/shell.css tokens).
Done means: npm test passes whole, the full persona drill suite unmodified,
APEX_SMOKE=1 exits 0, floorplan.md + CHANGELOG.md updated in this change-set.
Say whether Reload or Update & restart applies. If the spec and the code
disagree anywhere, stop and ask — do not improvise around it.
```

## Slice 2 — contract library (no UI)

```
Read design/app-builder-v1.md (§ Portable project package, § PROJECT.md
template, § Blueprint shape, § Validation, § Write safety). Implement SLICE 2
ONLY: extensions/studio/lib/ contract modules — blueprint schema constants,
safe project IDs, path handling, canonical parsing/rendering primitives,
hashing, and the deterministic validation rules. Pattern-match
extensions/personas/lib/contract.js; extract shared code only where it is
genuinely identical, no speculative frameworks. No UI, no bus verbs.
Ship fixtures + a hermetic drill wired into npm test covering: minimal valid
project, invalid id, path traversal, overwrite collision, malformed
frontmatter/JSON, unsupported schema version, hash drift. npm test must pass
whole. Update CHANGELOG.md. Update & restart applies — say so.
```

## Slice 3 — workspace, draft store, interview

```
Read design/app-builder-v1.md (§ Portable project package, § Guided
interview, § Builder state machine steps 1–3). Implement SLICE 3 ONLY: the
projects-workspace picker (ctx.pickDirectory, config in
state/extensions/studio/workspace.json, atomic write, same discipline as the
personas extension), a crash-safe draft store in ctx.stateDir, and the
six-card interview UI inside the PROJECTS sub-tab (question, depth note,
example, suggested choices, free text, heuristic Help-me-decide, Back / Save
draft / Skip). No AI calls in this slice. Reference the interaction model in
design/mockups/studio-mockup.html — match its card flow and stepper feel, in
the shell's real CSS idiom. Done: npm test whole (add a drafts drill:
create/save/reopen/crash-recover/delete), APEX_SMOKE=1 exit 0, CHANGELOG.md.
```

## Slice 4 — canonical renderer + review + drift

```
Read design/app-builder-v1.md (§ PROJECT.md template, § state machine steps
4–6). Implement SLICE 4 ONLY: Blueprint Review (structured answers, gaps
highlighted), canonical PROJECT.md generation from approved answers only
(missing areas visibly incomplete — never invented), targeted per-section
regeneration, manual canonical edit, hash-drift detection with a review
prompt (never silent regeneration), and the validation report UI
(errors/warnings/suggestions off the slice-2 rules). Mirror the persona
builder's preview/render/validator seams where the shape is identical.
Done: npm test whole with renderer drills (drift, section regen, gap
rendering), APEX_SMOKE=1 exit 0, CHANGELOG.md.
```

## Slice 5 — disposable launch override (ENGINE — the careful one)

```
Read design/app-builder-v1.md (§ The model picker) and floorplan.md § The
three laws. Implement SLICE 5 ONLY: createDisposable (main/engine/seatHost.js)
and the ctx.seats.startDisposable seam accept an optional
launch: { model, effort }. model validates against Claude-lane tiers ONLY
(fable|opus|sonnet|haiku) — codex/qwen/agy rejected at the seam with a clear
error. Omitted launch = today's behavior byte-identical: the persona builder
and live auditor must not change. The engine stays Electron-free. Add the
STUDIO header model picker persisted in state/extensions/studio/.
Done: test/engine-harness.js gains the override cases (valid tier honored,
bad lane rejected, omitted = legacy), npm test whole, npm run test:live
passes, floorplan.md + CHANGELOG.md. Update & restart applies — say so.
```

## Slice 6 — per-card suggest passes

```
Read design/app-builder-v1.md (§ Level 1 — suggest passes). Implement SLICE 6
ONLY: the opt-in AI pass per interview card. Usage preflight + explicit
approval + TTL, copied from the personaTestPrepare / personaRelSuggestLlm
pattern (extensions/personas/main.js). One disposable turn on the picked
model, prompt built from the draft + existing projects' project-context.md
(overlap detection). Replies parse under strict allowlist discipline —
bounded suggestion count, capped string lengths, unknown fields dropped,
never an exception. Render as chips the user accepts into the card. Backstop
timeout like the relationship pass. Done: npm test whole with a parser drill
(valid, oversized, hostile, empty replies), CHANGELOG.md.
```

## Slice 7 — the co-designer

```
Read design/app-builder-v1.md (§ Level 2 — the co-designer). Implement SLICE
7 ONLY: the persistent side panel chat in the PROJECTS view riding one
long-lived disposable controller (controller.send per turn, delta/text
streamed live). Each user turn is prefixed with a compact blueprint digest —
structured card states, never the transcript. Parse the fenced apex-studio
patch block with a dedicated contract module under the same rules as
main/engine/handoff.js: known cards/fields only, max 4 patches, lengths
capped, everything else dropped. Patches render as accept/reject chips ON the
target card — the AI never writes the blueprint. Closed panel = closed seat;
reopen starts fresh from the digest. Reference the mockup's co-designer panel
for the UX. Done: npm test whole including the patch-contract drill
(hostile blocks: unknown card, 5+ patches, oversized proposal, nested junk),
APEX_SMOKE=1 exit 0, CHANGELOG.md.
```

## Slice 8 — Create + Lift-off

```
Read design/app-builder-v1.md (§ state machine steps 7–8, § Write safety).
Implement SLICE 8 ONLY: Create Project (atomic same-directory temp + rename,
no overwrite, traversal rejected, archive-not-delete for removal) and the
Lift-off screen: (a) register {name, path} into _workspaces in
seatconfig.json — collision warns, never clobbers; (b) Delegate to the
Architect via the workflow layer's OWN taskCreate/taskStart verbs — board
task in the project cwd, editable route validated against live presets, step
kickoff carrying PROJECT.md, accepted route saved via taskRouteSave; with no
matching preset the button explains itself and points at the PERSONAS
sub-tab; (c) Open a chat here (one seat, project cwd, no chain).
Done: npm test whole with lift-off drills (task created with route, unknown
preset warns, workspace registered once, seatconfig otherwise untouched),
APEX_SMOKE=1 exit 0, CHANGELOG.md + floorplan.md (the workflow-layer touch).
```

## Slice 9 — import + polish

```
Read design/app-builder-v1.md (§ Import, § Validation). Implement SLICE 9
ONLY: import an existing project folder or bare PROJECT.md in audit mode —
change nothing, validate structure, map existing sections to the six areas
with user review, build the blueprint from the approved mapping, report gaps,
offer targeted revision. Mirror the persona importer's discipline
(extensions/personas/lib/importer.js). Plus validator polish: plain-language
messages throughout. Done: npm test whole (import drills: clean import,
missing areas, hostile paths), APEX_SMOKE=1 exit 0, CHANGELOG.md, and a final
pass confirming design/app-builder-v1.md § Required verification is fully
covered — list each item with where its drill lives.
```

---

## If a slice goes sideways

Don't argue with a drifting seat — close it, tighten the prompt with what it
got wrong, fresh seat. The drafts, spec, and drills are the durable state;
the conversation never is. Bounce limit of 2, same as your chains.
