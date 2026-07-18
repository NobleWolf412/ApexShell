# STUDIO v2, Wave A — build prompts

> **Wave A is fully shipped** (A1-A6, 2026-07-18 — CHANGELOG § Unreleased).
> Do not build from the sections below; they stay as the wave-protocol
> record and the template Waves B-F will extend in place. One note at the
> top rather than six per-slice edits, so the fenced prompts remain the
> byte-exact record of what each seat was handed.

## One-line invocation (paste this, nothing else)

Every fresh seat gets the SAME line — it finds its own slice:

```
Read design/studio-v2-prompts.md in full. Find the highest "A<N> —" commit
in git log; your job is slice A<N+1>'s prompt from that file, executed
EXACTLY as written including every gate. If the working tree already holds
uncommitted work for a slice, inventory it against the spec and FINISH that
slice instead. ONE slice only: commit it (only its own files — never git
add -A; unrelated files may sit in the tree), print the evidence, and STOP.
Do not begin the next slice under any circumstances.
```

Model per slice: sonnet, medium effort. A4 touches main/artifacts.js — it
earns a review step on the board route if run that way.

## How the slices work

One slice per fresh seat, in order, repo root. Never two slices in one
context. Read design/studio-v2.md (§ Wave A — the slice cut) and
design/app-builder-v1.md before touching anything — v2 builds ON v1's
shipped machinery and its disciplines (untrusted-output parsing, preflight/
TTL, provenance/hash drift, atomic writes) are binding precedent. Gates
are non-negotiable: `npm test` passes WHOLE, `APEX_SMOKE=1` exits 0 for any
renderer-visible slice, CHANGELOG.md in every change-set, floorplan.md when
structure moves. Say whether Reload or Update & restart applies. If the
spec and the code disagree anywhere, stop and ask — do not improvise.

---

## Slice A1 — the Look card + schema v2

```
Read design/studio-v2.md (§ Wave A slice cut, A1; § Wave F for why Look
feeds tokens) and the v1 shapes it extends (extensions/studio/lib/
interview.js, contract.js, render.js, blueprint.js). Implement SLICE A1
ONLY: a seventh interview area `look` (palette leanings, type feel,
density, tone words, reference notes — portable WORDS only, no paths or
binaries) as a full citizen: interview card (question, depth note, example,
suggested choices, heuristic Help-me-decide nudges), blueprint schema bumps
to 2 with `look` in BLUEPRINT_AREAS, the canonical template gains a
"Design Language" section sourced from it, and validation treats a missing
look area as an incomplete-area WARNING (never a block). Schema-1 packages
must IMPORT cleanly (the import audit maps what exists and reports look as
a gap) and validate with a clear version message. The AI suggest pass and
co-designer patch allowlist gain the new card automatically IF their card
lists derive from the interview module — verify they do, and if either
hard-codes six keys, fix it to derive. Done: npm test whole (extend the
lib/interview/import drills for the new area + schema-2 cases: v1 package
imports with look gap, schema-2 round-trip, look card heuristics),
APEX_SMOKE=1 both plain and dock=studio exit 0, CHANGELOG.md. Extension
code only — no main/, no engine. Update & restart applies — say so.
```

## Slice A2 — the tokens compiler

```
Read design/studio-v2.md (§ Wave A slice cut, A2; § Wave F, the scaffold
contract). Implement SLICE A2 ONLY: extensions/studio/lib/design.js — a
DETERMINISTIC compiler (no AI, no randomness: same Look answers in, same
bytes out) from the blueprint's look area to design/tokens.json: color
roles (bg/surface/text/dim/accent/good/warning at minimum) resolved from
palette leanings, a type scale from type feel, spacing/radius/shadow/motion
scales from density and tone. Unparseable or absent look input degrades to
the documented house defaults with a validation WARNING, never a block and
never an invented value presented as chosen. Create Project (lib/creator.js
seam) writes design/tokens.json into the package; validateProjectPackage
learns the file (malformed tokens.json = error; absent = warning for
schema-2, silent for schema-1). PROJECT.md's Design Language section
renders a human-readable summary of what compiled. Done: npm test whole
(new drill: compile determinism byte-for-byte across two runs, defaults
path, malformed-look degradation, package round-trip with tokens.json,
schema-1 absence tolerated), CHANGELOG.md. Extension code only. Update &
restart applies — say so.
```

## Slice A3 — the mockup pass

```
Read design/studio-v2.md (§ Wave A slice cut, A3) and the two disciplines
it copies: the suggest pass (extensions/studio/lib/suggest.js +
projectsCardSuggest* verbs in main.js — preflight/approval/TTL/backstop)
and provenance/drift (lib/blueprint.js). Implement SLICE A3 ONLY:
lib/mockup.js — (a) screen derivation: a deterministic pass over the
blueprint proposing the screen list (platform-adaptive: web/desktop =
screens, CLI = terminal storyboard frames, API/service = an endpoint-map
page; user can rename/remove/add before generating); (b) the prompt
builder: blueprint digest + Look area + tokens summary + ONE screen's
purpose; (c) the untrusted-reply contract: exactly one complete HTML
document, self-contained (reject ANY external URL — http(s)://, //, or
protocol-relative in src/href/url()/import — the drill must prove each),
size-capped, fail-closed to an error + no file on any violation. Output
lands under the DRAFT's own storage (ctx.stateDir draft area, not the
projects workspace — no package exists yet) as mockups/<screen>.html plus
a provenance record carrying the generating canonical hash; a later
blueprint change makes isMockupStale(draft, screen) true — a STALE badge,
never silent regeneration. Bus verbs mirror the suggest pass exactly:
prepare (usage snapshot + TTL) → run (approved:true, one disposable turn on
the model picker via launch:{model,effort}, omitted when unset) → result;
backstop timer; one pass in flight. NO preview UI yet (A4) — a minimal
list of generated/stale screens on the Canonical step is enough to
exercise it. Done: npm test whole (contract drill: valid reply, every
external-URL vector rejected, oversized reply, non-HTML reply, missing
fence, provenance staleness flip; bus drill: preflight/TTL/approval gate/
single-flight/backstop with a stubbed startDisposable — zero LLM spend),
APEX_SMOKE=1 both variants exit 0, CHANGELOG.md. Extension code only.
Update & restart applies — say so.
```

## Slice A4 — the PREVIEW step

```
Read design/studio-v2.md (§ Wave A slice cut, A4). Study how main/
artifacts.js gates the apex:// served-file allowlist and how the Viewer
consumes it BEFORE designing the registration. Implement SLICE A4 ONLY:
the SEE step in the PROJECTS stepper between Canonical and Create. The
studio's main half registers each draft's mockups directory with the
served-file gate (THE wave's one core touch: a narrow additive
registration seam in main/artifacts.js if none exists — smallest possible,
justified in your report; absolutely no weakening of the existing gate for
non-studio paths). The renderer renders the selected screen in an <iframe>
with sandbox="allow-scripts" (NO allow-same-origin — document why that
combination), src = the served mockup. Screen switcher chips, device-width
presets (mobile/tablet/desktop frame widths), the STALE badge from A3 with
a REGENERATE action riding A3's machinery, and APPROVE MOCKUPS — which
records the approval (screens + canonical hash) on the draft and is
surfaced by validation as a warning when absent for schema-2 drafts.
Create/liftoff behavior is untouched this slice beyond copying approved
mockups into the package at Create (mockups/ folder, per the package
layout in design/studio-v2.md § Wave F/A). Done: npm test whole (drills:
allowlist registration scoped to exactly the draft mockups dir — a
traversal/other-path request refuses; approval recording; package copy),
APEX_SMOKE=1 both variants exit 0 plus a smoke pass with the SEE step
reachable, CHANGELOG.md + floorplan.md (the artifacts.js touch). Update &
restart applies — say so.
```

## Slice A5 — annotate → regenerate

```
Read design/studio-v2.md (§ Wave A slice cut, A5) and main/engine/
handoff.js for the untrusted-boundary discipline the bridge must match.
Implement SLICE A5 ONLY: element annotation inside the sandboxed mockup.
At serve time (the A4 seam) the studio injects a small picker script into
the mockup HTML: hover highlight, click selects an element and posts ONE
message shape over postMessage; the renderer validates messages against a
strict allowlist (known type string, capped selector/text lengths, numeric
bbox, everything else dropped silently — a hostile mockup page can post
garbage; the drill proves it cannot crash or spoof the studio). Selected
elements gain note chips (the user's words, capped); notes batch per
screen; REGENERATE WITH NOTES runs one A3 turn whose prompt carries the
notes pinned to their elements' selector/text context. Approval state
from A4 correctly invalidates when a screen regenerates (fresh approval
required). Esc cancels picking; the picker never runs outside the SEE
step. Done: npm test whole (bridge drill: valid pick, oversized/wrong-type/
unknown-field/flood messages all safely dropped, notes cap, regen prompt
carries notes, approval invalidation; zero LLM spend via stubbed
disposable), APEX_SMOKE=1 both variants exit 0, CHANGELOG.md. Extension
code only (the injection rides A4's serve seam). Reload vs Update &
restart — say which.
```

## Slice A6 — the Wave A sweep

No bespoke prompt: use the ready-to-paste sweep prompt in
design/sweep-v1.md with scope = the Wave A commit range (A1..A5). The wave
is not done until this runs. The spec (design/studio-v2.md) does NOT flip
to implemented — only Wave A's section gains an "(shipped)" mark; the file
stays `proposed` until the last wave lands.

---

## If a slice goes sideways

Same as v1: don't argue with a drifting seat — close it, tighten the
prompt with what it got wrong, fresh seat. Bounce limit of 2.
