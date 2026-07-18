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

---

# Wave B + parallel track — build prompts (added post-Wave-S)

Wave B lands serially in the main tree (B1 → B2 → B3 → B4 sweep; B2/B3
prompts get appended here when B1's realities are known). F1 and D1 are
new-files-only lib slices, explicitly parallel-safe: they run in isolated
worktrees alongside B1 and merge after it lands.

## Slice B1 — the dev-server runner (main tree)

```
Read design/studio-v2.md (§ Wave B — the living preview). Implement SLICE
B1 ONLY: the dev-server runner, extension-only. lib/servers.js: per-project
launch config {command, args, cwd, port, readyRegex?} persisted machine-side
in state/extensions/studio/servers.json (atomic write, schema-versioned,
NEVER in the portable package — the A2/workspace.json discipline); a
lifecycle state machine (stopped→starting→ready→stopped/failed) driven by
an injectable spawner seam (child_process in production, a stub in drills);
ready detection via readyRegex on stdout/stderr with a port-listen fallback
timeout; a bounded log ring (last 400 lines); stop = tree-kill on Windows
(taskkill /T — study main/engine/claudeSeat.js's Windows kill for the
idiom, do NOT touch that file); every server dies on extension dispose and
app quit (no orphans — drill the dispose path). Bus verbs (suggest-pass
naming discipline): projectsServerConfigGet/Save, projectsServerStart/
Stop, posts projectsServerState {projectId, phase, port, logTail} and
projectsServerLog deltas. UI: a minimal RUN drawer on the Lift-off/BUILD
step (config form, start/stop, log tail) — the full BUILD step is Wave E.
Guards: cwd must be inside a registered workspace project or the projects
workspace (containment, drilled); commands run with the project cwd, plain
env, no shell string interpolation of user fields into a shell line (spawn
with args array — drill that a hostile command string cannot smuggle a
second command). Done: npm test whole (new drill: config round-trip,
lifecycle transitions with stubbed spawner, ready-regex + fallback, log
ring cap, dispose kills all, containment refusals, args-array
no-injection), APEX_SMOKE=1 both variants exit 0, CHANGELOG.md. Extension
code only — no main/, no engine. Update & restart applies — say so.
```

## Slice F1 — the product-contract spines (parallel worktree)

```
Read design/studio-v2.md (§ Wave F — the product contract). Implement
SLICE F1 ONLY: the contract SCHEMAS as pure lib code + docs — no UI, no
bus verbs, no main.js/liftoff wiring (F2 does that). New
extensions/studio/lib/spines.js: (1) the component-library manifest schema
(components.json v1: named components, each with variants[], effects[],
token-role bindings — validate shape, cap counts/lengths, fail-closed);
(2) the UI-manifest schema (manifest.json v1: screens[], each naming
components + variants used — same discipline); (3) validators
(validateComponents/validateManifest returning {valid, errors, warnings}
in the contract.js voice — plain language, never throws); (4) a
renderContractAddendum(tokens, components?, manifest?) producing the
markdown addendum text a coder kickoff will carry (F2 wires it) — pure
function, deterministic, states what exists and what the scaffold must
create. New design/contract-spines.md documenting both schemas with
examples (the file scaffold templates and coder personas will read). Done:
npm test whole (new drill test/studio-spines-drill.js: valid/hostile/
oversized shapes for both schemas, addendum determinism + content, never
throws), CHANGELOG.md. NEW FILES ONLY plus the package.json test:studio
chain line and CHANGELOG — zero edits to existing lib/renderer/main files.
```

## Slice D1 — the architecture-diagram contract (parallel worktree)

```
Read design/studio-v2.md (§ Wave D — the X-ray, planned view). Implement
SLICE D1 ONLY: the mermaid-source contract as pure lib code — no UI, no
bus verbs, no AI wiring (D2 does the disposable pass + the step). New
extensions/studio/lib/xray.js: (1) buildDiagramPrompt(blueprint) — the
prompt for a future one-turn diagram pass (blueprint architecture/platform
digest in, mermaid flowchart out), deterministic; (2) the untrusted-reply
contract: extract exactly one fenced mermaid block, validate against a
STRICT allowlist subset (flowchart/graph directives, node/edge lines,
subgraph/end, class/style lines — reject click/callback/href/%%{init}
and ANY line not matching the allowlist grammar; size-capped; fail-closed
to {source:null, error}); (3) provenance shape {canonicalHash,
generatedAt} matching A3's sidecar idiom; (4) a deterministic FALLBACK
diagram builder (no AI): parse the architecture area's prose for component
nouns (the A2 keyword-table style) and emit a valid mermaid flowchart of
them — always available, marked source:'derived'. Done: npm test whole
(new drill test/studio-xray-drill.js: valid mermaid accepted, every
forbidden directive rejected, non-mermaid/oversized/multi-block fail
closed, fallback determinism + validity vs own allowlist, prompt shape),
CHANGELOG.md. NEW FILES ONLY plus the package.json test:studio chain line
and CHANGELOG — zero edits to existing lib/renderer/main files.
```

## Slice B2 — the app frame (main tree, CORE — the careful one)

```
Read design/studio-v2.md (§ Wave B — the living preview) and B1's shipped
reality (extensions/studio/lib/servers.js + the projectsServerState verbs;
git log 04da31f). Implement SLICE B2 ONLY: the app frame — the user's real
app hosted INSIDE the studio via a main-owned Electron WebContentsView.
Core touch (argued, minimal, line-reviewed): a new main/appFrame.js owning
create/position/navigate/destroy of ONE WebContentsView per host window,
attached to whichever BrowserWindow the requesting renderer belongs to
(BrowserWindow.fromWebContents(ctx.sender's owner) — the S2 idiom; the
docked shell AND the detached studio window both work). The view loads
ONLY http://localhost:<port> or http://127.0.0.1:<port> URLs (validate at
the seam — any other origin refuses; the port comes from the project's
B1 server state); sandboxed webPreferences (no preload, no node,
sandbox:true, contextIsolation:true); setWindowOpenHandler deny;
will-navigate confined to the same localhost origin. Renderer side: a
PREVIEW surface on the Lift-off/RUN area (Wave E renames it) showing the
frame when the B1 server is ready — the renderer posts appFrameShow
{projectId, bounds} / appFrameHide / appFrameNavigate, with bounds synced
on layout changes (a ResizeObserver on the placeholder div posting
throttled bounds — study how the studio pane's geometry works; the view
overlays the placeholder rectangle exactly). The frame hides when the
step/pane/tab hides (drill the visibility contract at the module seam).
Bus verbs follow S2's postTo discipline for per-window replies. Factor
EVERYTHING drillable (URL validation, bounds math, visibility state
machine, per-window registry) into main/appFrame.js pure functions or a
registry object with an injectable view factory — drill it hermetically
like multiwindow-drill stubs electron; the Electron shell stays thin.
Done: npm test whole (new test/appframe-drill.js: URL allowlist
(localhost/127.0.0.1 only, port required, hostile origins/paths refuse),
registry add/position/hide/destroy per window, destroyed-window cleanup,
bounds sanitation (finite, non-negative, capped)); APEX_SMOKE=1 both
variants exit 0 (no frame in smoke — nothing starts a server); CHANGELOG
+ floorplan (the new core file). Update & restart applies — say so.
```

## Slice C1 — surgeon + resolver contracts (parallel worktree, libs only)

```
Read design/studio-v2.md (§ Wave C — boom changed). Implement SLICE C1
ONLY: the two Wave C contracts as pure lib code — no UI, no bus verbs, no
seat wiring (C2+ does that). NEW extensions/studio/lib/resolver.js: the
tiered source resolver — given an element context {selector, classes[],
text, tag} and a project root, return ranked candidates {file, line?,
tier, confidence} via (a) framework dev hints if present (data-source
attrs in the html — parse only), (b) class-name/text search over project
files (fs walk with caps: skip node_modules/.git/dist/build, max 2000
files, max 512KB/file, extensions allowlist .html/.css/.js/.jsx/.ts/.tsx/
.vue/.svelte), (c) a low-confidence whole-context fallback descriptor for
the seat. Deterministic ordering, every result carries its tier honestly.
NEW extensions/studio/lib/surgeon.js: the apex-surgeon reply contract —
kickoff/prompt builder (element context + resolver candidates + the user's
intent + the ONE-minimal-edit law + the report shape), and the fenced
apex-surgeon JSON block parser under handoff.js discipline: {summary,
edits:[{file, kind:'modified'|'created', hunks?:string}], followup?} —
known fields only, max 6 edits, paths must be relative and traversal-free
(never absolute, never ..), string caps, fail-closed to {result:null,
error}; a bigger-than-a-boom detector (edits>threshold or any
followup:'delegate' → demote flag). Done: npm test whole (new
test/studio-surgeon-drill.js covering both libs: resolver tier a/b/c over
a fixture mini-project (create test/studio-fixtures/resolver-app/),
determinism, caps; surgeon parse valid/hostile/oversized/traversal/
absolute-path/7-edits, demote detector), CHANGELOG.md. NEW FILES ONLY plus
the package.json test:studio line and CHANGELOG — zero edits to existing
lib/renderer/main files.
```

## Slice F3 — the design-mode overlay template (parallel worktree, new files)

```
Read design/studio-v2.md (§ Wave F — the product contract, design mode).
Implement SLICE F3 ONLY: the dev-only design-mode overlay that scaffolded
apps ship, as a TEMPLATE ASSET — no Apex UI, no bus verbs, no scaffold
writer (that is the coder persona's job, guided by the addendum; F2 wires
the addendum). NEW extensions/studio/templates/design-mode.js: a single
self-contained vanilla-JS file (zero deps, no imports, no external URLs —
the A3 self-containment law applies to the template itself) that a
scaffolded app includes in DEV builds only. It: reads design/tokens.json +
design/components.json + design/manifest.json via fetch of SAME-ORIGIN
relative paths (fail-soft: missing file = that panel disabled with an
honest note); renders a floating toggleable panel (bottom-right, its own
shadow-root so app CSS cannot break it and it cannot break the app);
element picking (the A5 overlay pattern: fixed overlay box, hover
highlight, click select, Esc cancel); for a picked element whose class
matches a component name, shows variant/effect radio pickers + token-role
info from the spines; a "copy change" action that writes the chosen
variant change to the clipboard as a precise instruction (v1 of
persistence — actual file writes need a dev server endpoint, out of
scope, documented in the file header); and a component-tree tab (walk the
DOM for [data-component] marks per contract-spines.md, else class-name
match). NEW design/design-mode.md documenting: what the template does,
how a scaffold includes it dev-only (script tag the coder adds behind an
env/dev flag per stack), its honest v1 limits (read-only + clipboard),
and the Apex-connected future (C/F2+). Add a drill
(test/studio-designmode-drill.js) that statically validates the template:
parses as JS (node --check via child spawn or new Function in a try),
self-contained (the A3 external-URL vectors re-used — write the checks,
do not import mockup.js), size cap, and contains required marker strings
(shadow-root attach, Esc handler, fail-soft fetch guards). Done: npm test
whole, CHANGELOG.md. NEW FILES ONLY plus the package.json test:studio
line and CHANGELOG — zero edits to existing lib/renderer/main files.
```

## Slice B3 — the instrument bar (main tree, extends the B2 core minimally)

```
Read design/studio-v2.md (§ Wave B) and B2's shipped reality
(main/appFrame.js + the PREVIEW card in extensions/studio/renderer.js).
Implement SLICE B3 ONLY: instruments over the app frame. main/appFrame.js
extends MINIMALLY (core — every line argued): when a view is created,
attach console-message and did-fail-load/network-failure listeners on the
view's webContents (use the modern console-message event field shapes;
level>=error only) and forward capped, structured events over
bus.postTo(win, 'appFrameEvent', {kind:'console'|'net', text<=300,
url?<=200}) — rate-bound main-side (max 20/s, drop beyond, one honest
'…dropped N' summary event per second when dropping). NO debugger API in
this slice (C2 owns that); listeners only. Renderer: an instrument strip
on the PREVIEW card — error chips (count badges for console errors and
failed loads, click to expand a capped list, clear button), device-width
presets (mobile 390 / tablet 768 / desktop full — sizing the placeholder
div, which the existing bounds sync already follows), and the RELOAD
button moves into the strip. Chips reset on navigate/reload. Done: npm
test whole (extend test/appframe-drill.js: event forwarding shape, caps,
rate bound + drop summary, reset-on-navigate at the registry seam),
APEX_SMOKE=1 both variants exit 0, CHANGELOG.md + floorplan touch-up if
the appFrame.js entry needs it. Update & restart applies — say so.
```

## Slice F2 — the contract addendum rides the kickoff (parallel worktree)

```
Read design/studio-v2.md (§ Wave F) and design/contract-spines.md.
Implement SLICE F2 ONLY: wire lib/spines.js renderContractAddendum into
the Lift-off flows in extensions/studio/main.js + lib/liftoff.js ONLY (do
NOT touch renderer.js — the B3 seat owns it this cycle; the existing UI
needs no change: the addendum rides the brief invisibly). At delegate
time: read the created package's design/tokens.json (design.js validate),
components.json + manifest.json if present (spines.js validators, fail-
soft — a malformed spine is reported in the addendum as
present-but-unusable, never a crash); render the addendum; append it to
the taskCreate brief AFTER the PROJECT.md text with a clear separator.
Same for the Open-a-chat kickoff. The brief cap in main/tasks.js is 20000
chars — if PROJECT.md + addendum exceeds it, the addendum is truncated
LAST (PROJECT.md wins) with an honest '[addendum truncated]' marker;
drill that. Done: npm test whole (extend test/studio-liftoff-drill.js:
addendum rides the brief verbatim after PROJECT.md, absent spines stated
honestly, malformed spine = present-but-unusable line, truncation order +
marker), CHANGELOG.md. Only extensions/studio/main.js, lib/liftoff.js,
the liftoff drill, package.json if needed, CHANGELOG — nothing else.
```

## Slice D2 — the ARCHITECTURE step (main tree)

```
Read design/studio-v2.md (§ Wave D — the X-ray) and D1's shipped contract
(extensions/studio/lib/xray.js + test/studio-xray-drill.js). Implement
SLICE D2 ONLY: the ARCHITECTURE step in the PROJECTS stepper (between SEE
and Create — argue placement if the flow reads better elsewhere). The step
shows the project's diagram: the D1 FALLBACK (deriveFallbackDiagram, free,
always available, badged 'derived from your architecture card') renders
immediately; an opt-in AI pass (the A3 prepare/approve/TTL/backstop
machinery verbatim, one disposable turn on the model picker via
launch:{model,effort}, prompt = D1's buildDiagramPrompt) upgrades it,
badged 'AI-drawn' with provenance + the stale rule (canonical moves →
STALE badge + regenerate, never silent). RENDERING (the argued decision):
NO external mermaid library, NO new deps — render the validated mermaid
source yourself: parse the D1-allowlisted subset (you may extend xray.js
with a parseValidated() returning {nodes, edges, subgraphs} — the grammar
is already line-anchored, parsing it is mechanical) and lay it out as
plain HTML/CSS boxes and SVG arrows in a simple layered layout (tiers by
edge direction — the fallback's own tier structure makes this natural;
imperfect layout for exotic AI output is acceptable and honest, note it
in the UI as 'diagram view — layout is approximate'). Store the diagram
source + provenance on the DRAFT (drafts.js validated field, the
mockupApproval pattern); Create copies architecture.mmd + provenance into
the package (atomic stage, the A4 mockups pattern). Done: npm test whole
(extend studio-xray-drill.js: parseValidated on valid/fallback sources,
layout-input shape; extend drafts/liftoff drills for the field + package
copy), APEX_SMOKE=1 both variants exit 0, CHANGELOG.md. Extension code
only — no main/, no engine. Update & restart applies — say so.
```

## Slice C2 — boom-change (main tree, CORE — the last careful one)

```
Read design/studio-v2.md (§ Wave C — boom changed) and the shipped halves
you are wiring: lib/resolver.js + lib/surgeon.js (C1), main/appFrame.js
(B2/B3), the A5 pick-bridge validator discipline (lib/mockup.js
validatePickMessage), and the A3/A6 disposable machinery. Implement SLICE
C2 ONLY — the full boom loop on the app frame:

(1) INSPECT MODE (core touch, argued line-by-line): main/appFrame.js gains
inspect(win, on) — when on, the frame's webContents gets a picker injected
via webContents.executeJavaScript (the A5 overlay pattern: fixed
pointer-events-none highlight box, hover, click captures {selector,
classes[], text<=160, tag, html<=2000 outerHTML slice for data-source
hints}, Esc cancels; the script posts via console.log with a magic prefix
'[apex-pick]'+JSON — the B3 console-message listener already flows to
main, no debugger API needed after all: filter the magic prefix BEFORE
the B3 error-level gate, strip it from normal chip flow, validate the
payload with a shapePickPayload() twin of the A5 validator: caps, known
fields rebuilt, fail-closed). Injection is idempotent (double-inject
guard), removed on inspect-off/navigate. The renderer gets INSPECT as a
strip toggle; picks post appFramePick per-window (postTo).

(2) THE BOOM FLOW (extension): a pick opens a BOOM card over the PREVIEW
area: the element context, an intent input, and GO. GO runs: resolver
(project root = the created project dir) → candidates listed with
tier/confidence honestly → one Surgeon disposable (A3 prepare/approve
machinery COLLAPSED to a single approve-on-GO — the card IS the approval;
usage snapshot shown on the card before GO; TTL n/a; single-flight;
5-min backstop; launch from the picker) in the PROJECT cwd with the C1
kickoff (surgeon.buildKickoff). The reply parses via surgeon.parseReply
(fail-closed). Edits apply ONLY if: every path passes the C1 wall AND
resolves inside the project dir (re-check at apply time — belt and
braces); kind 'modified' requires the file exists, 'created' requires it
does not. Apply = write the hunks as full-file content? NO — hunks are
freeform text in C1's contract; v1 apply discipline: the Surgeon's
kickoff (extend surgeon.js contractText minimally if needed) demands
edits carry the COMPLETE new file content in hunks (capped 16KB — small
files only in v1; bigger = followup:'delegate'), and apply writes
atomically (temp+rename) after a git-aware backup.

(3) THE LEDGER: before applying, snapshot: if the project dir is a git
repo (a .git exists), record dirty-file paths and apply, then `git add
<files> && git commit -m 'boom: <intent slice>'` via execFile (args
array, no shell) in the project cwd — the commit hash is the revert
token; if NOT a repo, copy each touched file to
state/extensions/studio/boomledger/<projectId>/<ts>/<relpath> first.
Ledger entries {ts, intent<=200, files[], mode:'git'|'backup', token,
demoted?} persist in state/extensions/studio/boomledger/<projectId>.json
(atomic, capped 100 entries, oldest dropped). REVERT: git mode = `git
revert --no-edit <hash>` (execFile; refuse if the working tree is dirty,
honest error); backup mode = restore the copies (atomic). The ledger
card lists entries with REVERT buttons on the BOOM panel.

(4) DEMOTE: surgeon.detectDemote fires → no apply, the card shows 'bigger
than a boom' with a DELEGATE button that pre-fills the existing Lift-off
delegate flow with the intent as extra brief context (reuse the F2
composition — one function call, no new machinery).

DRILLS (hermetic, stub the disposable + execFile seams): shapePickPayload
twins the A5 vectors; magic-prefix routing (a page console.log WITHOUT
the prefix still chips normally, WITH it never chips + parses; hostile
prefix payloads fail closed); apply-time path re-wall (traversal/absolute/
outside-project refuse even if parseReply somehow passed them); exists/
not-exists kind rules; atomic write + backup-first ordering; ledger
append/cap/persist; git vs backup mode selection; revert dirty-tree
refusal; demote → no writes + delegate prefill shape. Extend
test/appframe-drill.js (inspect/pick seam) + a new
test/studio-boom-drill.js. npm test WHOLE; APEX_SMOKE both variants exit
0; CHANGELOG + floorplan (appFrame inspect seam). Update & restart — say
so. Core diffs pasted INLINE in the report.
```
