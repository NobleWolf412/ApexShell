# Apex Shell Changelog

## Unreleased

- **The verify gate + auto-watch — the chain proves its own work**
  (`main/tasks.js`, `main/audit.js`, `main/seats.js`, `renderer/taskBoard.js`,
  drills). Two closures of the honor-system gap the `verified` field left
  open. (1) A task may carry a **verify command** (new form field, optional,
  task-stored — never packet-carried, same allowlist law as targets): every
  done-flow path now converges on `verifyThenAdvance`, which runs the command
  in the task cwd (injectable `runVerify` seam for the hermetic drill; real
  runner is child_process.exec, 10-min timeout) and only advances on exit 0.
  Red clears the claim and re-asks the SAME seat with the failure tail
  (2 tries, then a `verify-failed` gate); the kickoff announces the gate so
  seats plan around it. (2) **Auto-watch**: seatconfig `watch: true` at a
  persona block's top level (beside tools/disallowedTools) flips the live
  auditor onto that persona's chain-step seats at launch via a new
  `audit.watchStep` seam — with a `chainOk` flag that bypasses the
  chain-seat suppression (which exists to stop double-billing the MANUAL 👁,
  not the watch the chain itself asked for). The watch stops for free when
  the step wraps and its seat closes. Gates: taskboard drill 56 (verify
  green/red-retry/exhaustion + watch-at-launch), audit drill 19 (chainOk
  bypass + seatGone cleanup).
- **Handoff packets carry verification evidence — chains stop paying LLM
  review for what the test suite proves** (`main/engine/handoff.js`,
  `renderer/taskBoard.js`, drills). The apex-handoff contract gains an
  optional `verified` field (capped free text, same allowlist discipline):
  the mechanical gate the step actually ran and its result ("npm test →
  41/41 pass"). Contract text now orders VERIFY BEFORE DONE — a step that
  changed code runs the repo's own gate before emitting its packet and
  reports the evidence, so a review step spends its bounded budget on what
  the suite can't prove (design drift, security, missing coverage) instead
  of re-deriving green tests. Step-0 plan guidance tightened to match: each
  phase names its own checkable done-condition, so an Architect's plan is
  executable without round-tripping back per phase. `renderPacket` shows
  the evidence to the next step (labeled claimed, not proof), the board's
  history fold shows it on the card. Absent field = packet behaves exactly
  as before — additive, nothing existing re-validates.

- **Builder feedback + spend estimates — no more dead-looking buttons**
  (`extensions/personas/{main.js,renderer.js}`, `extensions/studio/{main.js,
  renderer.js,style.css}`). Persona Builder: REGENERATE SECTION now feeds
  `regenerateSection` the CURRENT interview answer (the original wiring fed
  the blueprint's own frozen response back — a guaranteed no-op unless the
  section carried manual edits), and both regenerate actions report their
  outcome in the status line — rendering is deterministic, so "regenerated,
  no change" is a real result the operator must SEE (reported live
  2026-07-18: validate flagged gaps, regenerate "did nothing"). The STUDIO
  canonical step gained the matching one-line regen confirmation
  (`pjSectionRegenNote`). Spend previews before every explicit RUN: the
  mockup pass builds its exact prompt at prepare time (same revision gate as
  run, so the bytes can't drift) and shows ≈prompt tokens + a typical output
  range beside the usage snapshot; the persona behavior test shows its
  kickoff+cases estimate the same way (chars/4 — the honest heuristic, no
  counting endpoint on a CLI seat). And the mockup pass now shows LIVE
  progress — elapsed + KB received off the seat's own text stream, patched
  into the busy line in place (a full render would reload the mockup
  iframes) — a minutes-long document generation was previously
  indistinguishable from a freeze.
- **Mobile face — the phone as a second face over Tailscale** (ported from
  upstream c99e2bb; walkthrough: `design/mobile-face-bones.md`). Seats keep
  running on the desktop; a phone renders and drives them. Three additive
  pieces: `main/bus.js` gains `sink()` + a `windowOnly` post opt (adapted to
  our Wave-S multi-window fan-out — sinks ride the broadcast fan only, ready
  re-posts stay window-targeted); `main/mobile.js` (the lane: tailnet-only
  HTTP for the page + `backfill()` transcript replay + artifact serving off
  the announcement allowlist, WS bridge whose inbound frames pass a strict
  rebuilt-field-by-field whitelist — no PTY spawns, no launch configs, no
  browser grants from a phone; loopback twin for a tailscale-serve HTTPS
  proxy); `mobile/` (3-file vanilla client + installable manifest). Fork
  deltas: `todoGet` swallowed quietly (no per-seat checklist module here —
  the board is our checklist story). New dep: `ws`. Gates: syntax 3/3, full
  hermetic suite green, smoke exit 0 with live probes — tailnet page 200,
  loopback twin 200, manifest 200, traversal + artifact-leak guards held.
  Widened past the upstream v1 for this fork: the new-seat drawer offers a
  BLANK seat (whitelist accepts `persona: ''` — byte-identical to the desktop
  + button; the lane still carries no launch config, so the operator's saved
  defaults decide and nothing escalates), the TODO drawer renders the real
  TASK BOARD (`taskList` request whitelisted; every board publish re-fires
  the broadcast, so the drawer live-updates once opened) instead of
  upstream's per-seat checklist this fork never had, and the dead 🌐 Browser
  toggle hides itself (the browser-switch is doc-only here). Verified
  against the live page in a phone viewport: blank-seat chip, board drawer,
  wrap/close buttons reachable, WS round-trip for the board proven.

- **Persona memory wrap — the state.md rewrite actually lands now**
  (`main/tasks.js`, `extensions/personas/{main.js,lib/wrap.js,lib/foundation.js,
  lib/creator.js}`, `test/live-cast/main.js`). Three stacked defects had left
  every persona's `state.md` as cast-import placeholder text despite live
  chains running: (1) `WRAP_BACKSTOP_MS` was 12s — the wrap turn is the
  persona's multi-file MEMORY-WRITE turn (30–90s observed), so auto chains
  closed the seat mid-write; now 120s (the consult backstop precedent —
  `advance()` never waits on it, so chain latency is untouched). (2) The wrap
  prompt's "nothing to record" escape hatch swallowed step 2's rewrite even
  when files changed; the prompt (extracted to `lib/wrap.js` so drill and
  extension share one text) now makes the state.md rewrite non-skippable,
  placeholder text explicitly counting as stale. (3) `test/live-cast` could
  never have caught either: it reported + disposed the instant the chain
  finished (killing wraps mid-write) and never registered the personas wrap
  prompt at all (extensions don't load there), so it drilled the generic
  engine close-out — it now sets the real prompt via `extensionApi` and waits
  for every chain seat's wrap to settle before snapshotting. Also: the
  portable `DEFAULT_FOUNDATION` gains the tiered-memory + never-mix-repos
  sections the kickoff already pointed at, and `seatKickoff` spells the exact
  project-slug rule (ApexShell → apexshell) so the slug a persona writes
  always matches the one consult's reader computes. Proven live 2026-07-18:
  a real 3-step cast chain ended with all three personas rewriting/creating
  `memory/projects/apexshell/state.md` (hash-verified by the drill).

- **STUDIO v2, Wave E slice E1 — the living BUILD step + the chat-kickoff
  seam** (`extensions/studio/{main.js,renderer.js,style.css}` +
  `extensions/studio/lib/liftoff.js`; one argued core touch in
  `main/seats.js`; drills: `test/studio-liftoff-drill.js` grows to 37,
  `test/taskboard-drill.js` to 51). Lift-off renames to **BUILD** — label
  and copy only, the step id stays `liftoff` (goStep routing) — and
  reorganizes milestone-first: a MILESTONE track heads the screen, parsed
  deterministically from the canonical's delivery section
  (`lib/liftoff.js`: `extractDeliverySection` between the stable
  app-builder markers + `parseMilestones` — numbered/bulleted lines and
  'milestone'-marked sentences; slugged, deduped, capped 30×200; imperfect
  parsing is fine by spec — the delivery card is the fix). Each row's
  open/building/done status is **derived, never stored**
  (`deriveMilestoneStatus`, mirrored in the renderer the
  SECTIONS/validatePickMessage way): a `taskList` task in the project's
  folder whose slugified title carries the milestone slug on token
  boundaries — any live task = building (a re-delegated done milestone
  honestly reopens), else a done task = done; chips patch in place per
  broadcast (the caret discipline). DELEGATE THIS pre-fills the existing
  delegate flow (the C2 boomIntent pattern): the milestone rides the F2
  addendum as one more bounded MILESTONE FOCUS block, and its slug rides
  the task TITLE — the very field the derived status matches on, closing
  the loop. The core seam: `seatCreate` (`main/seats.js
  createFromMessage`) reads an optional `msg.kickoff` — string-only,
  capped 24000 (clears the 20000 compose cap), never on a resume, riding
  exactly the preset-kickoff slot (host.create's first argument; message
  wins whole over preset, the composeKickoff precedent) — and the F2 gap
  closes: "Open a chat here" now sends the SAME composed brief as delegate
  (PROJECT.md + contract addendum, one `composeKickoffBrief` call) as the
  chat's first turn. Update & restart applies (extension main + core seats
  + renderer).

- **STUDIO v2, Wave C slice C2 — boom-change (the full loop on the app
  frame)** (`main/appFrame.js` + `main/main.js` — the last core touch;
  `extensions/studio/{main.js,renderer.js}` +
  `extensions/studio/lib/{boom.js,surgeon.js}`; drills:
  `test/appframe-drill.js` grows to 28 checks (inspect/pick seam), new
  `test/studio-boom-drill.js` 15 checks). INSPECT rides the preview strip:
  `appFrame.inspect(win, on)` injects the A5-pattern picker overlay into the
  hosted page through the adapter's one new `runScript` line
  (executeJavaScript; idempotent by page guard, removable, dead with every
  navigate — the registry's flag drops at the same trigger). Picks come BACK
  on the existing console wire as `'[apex-pick]'+JSON` lines — no debugger
  API after all: the factory now forwards EVERY console line with its level,
  and BOTH gates live drilled in the registry, prefix first (a prefixed line
  never chips, valid or not; hostile payloads are dead air) then the B3
  error-level chip gate; `shapePickPayload` twins the A5 validator (caps,
  rebuilt known fields, fail-closed) and survivors leave as `appFramePick`
  per-window. A pick opens the BOOM card (extension): element context +
  intent + GO — the A3 prepare/approve machinery collapsed to approve-on-GO
  (usage on the card, no TTL, single-flight, 5-min backstop). GO runs the C1
  resolver (candidates shown with tier/confidence, honestly) → one Surgeon
  disposable → `surgeon.parseReply` fail-closed → `detectDemote`. v1 apply
  discipline (`lib/boom.js`): hunks must be the COMPLETE new file content
  (`contractText` extended to say so; the C1 parser untouched), every path
  re-runs the wall AND must resolve inside the project dir at apply time,
  modified-requires-exists / created-requires-not, parents staged before any
  byte, atomic temp+rename per file. The ledger: git project (`.git`
  exists) → dirty snapshot, apply, `git add -- <files>` + `git commit -m
  'boom: …'` via an injectable execFile seam (args array, never a shell) —
  the hash is the revert token; else backup-FIRST copies to
  `state/extensions/studio/boomledger/<projectId>/<ts>/…`; entries `{ts,
  intent≤200, files, mode, token, demoted?}` persist atomically, capped
  100. REVERT per entry: `git revert --no-edit <hash>` (dirty tree refused
  honestly, token pinned to hex) or backup restore (+ created files
  removed). Demote → no writes, a "bigger than a boom" card whose DELEGATE
  pre-fills the Lift-off flow — the intent rides the F2
  `composeKickoffBrief` addendum tail (one call, no new machinery). Stated
  divergence, argued in `lib/boom.js`'s header: the disposable primitive is
  tool-disabled/scratch-cwd by engine contract (out of scope), so the seat
  does not literally run in the project cwd — the top candidates' file
  contents ride the kickoff instead, bounded at the 16 KB small-file law.
  Update & restart applies.

- **STUDIO v2, Wave D slice D2 — the ARCHITECTURE step (the X-ray, visible)**
  (`extensions/studio/{main.js,renderer.js,style.css}` +
  `extensions/studio/lib/{xray.js,drafts.js,creator.js}`; drills:
  `test/studio-xray-drill.js` grows parseValidated/collectDiagram + the
  pass's bus machinery, `test/studio-drafts-drill.js` the validated field,
  `test/studio-liftoff-drill.js` the package copy). A new X-RAY step sits
  between SEE and Create (step id `xray` — `architecture` is an interview
  card key): the D1 fallback renders immediately, free, badged "derived from
  your architecture card"; an opt-in AI pass — the A3
  prepare/approve/TTL/single-flight/backstop machinery verbatim, one
  disposable turn on the STUDIO model pick via `launch:{model,effort}`,
  prompt = D1's `buildDiagramPrompt` — upgrades it, badged AI-DRAWN with
  provenance and the stale rule (a canonical move → STALE badge +
  regenerate, never a silent redraw). Rendering is the argued decision: NO
  mermaid library, no new deps — `lib/xray.js` grows `parseValidated()`
  (validates first, refuses whatever the validator refuses, then reads only
  the allowlist grammar into `{direction, nodes, edges, subgraphs}` with
  anchored node-token consumption so arrow-shaped label text can't split an
  edge) and the renderer lays tiers out as plain HTML boxes + SVG arrows
  (longest-path layering, bounded relaxation), honestly captioned "diagram
  view — layout is approximate". The validated source + provenance persist
  on the DRAFT (`drafts.js`'s `diagram` field, held to xray's own validator
  — no mirror needed, no require cycle) and Create stages
  `architecture.mmd` + `architecture.provenance.json` inside the same
  atomic temp dir (the A4 mockups pattern; `xray.collectDiagram` sends the
  current AI source, or the derived fallback when none/stale — provenance
  names who drew what rode). Update & restart applies.

- **STUDIO v2, Wave B slice B3 — the instrument bar** (`main/appFrame.js` +
  `main/main.js` — the B2 core extended minimally;
  `extensions/studio/{renderer.js,style.css}`; `test/appframe-drill.js` grows
  to 20 checks). Instruments over the app frame, listeners only — NO debugger
  API this slice (C2 owns that wire). The split keeps B2's law: main.js's
  createView factory contributes exactly two thin webContents listeners
  (modern `console-message` object shape, level `'error'` only, and
  `did-fail-load` with ERR_ABORTED filtered) feeding raw `{kind, text, url}`
  into the registry's new `onEvent` inlet; every policy decision — shaping
  (`shapeFrameEvent`: kinds `console`/`net` only, text ≤ 300, url ≤ 200,
  anything else dropped silently — the hosted page is untrusted input on
  this wire too), the per-frame rate gate (max 20 forwarded events per
  second, overflow counted, ONE honest `…dropped N` summary event
  (`kind:'drop'`) flushed at the next window boundary), and
  reset-on-navigate (reload, new url, or changed-url show wipes the budget
  AND any pending drop count — stale noise must not haunt the fresh page) —
  is Electron-free, drilled, with an injectable clock. Survivors leave as
  `appFrameEvent {kind, text, url?}` over per-window `bus.postTo` (the S2
  discipline: the frame's noise belongs to its hosting window alone).
  Renderer: the PREVIEW card gains the instrument strip — CONSOLE/NET count
  chips (warn-toned when non-zero; click expands a capped list where drop
  summaries ride through verbatim; CLEAR wipes), device-width presets
  (MOBILE 390 / TABLET 768 / DESKTOP full, sizing the placeholder div — the
  B2 bounds sync follows on its own), and RELOAD moved in from its lone
  row (still same-url `appFrameNavigate`, now clearing the chips as main
  resets its gate on the same navigate). Events patch chips/list in place
  (the projectsServerLog precedent — a full render per event would eat the
  RUN form's caret); the store caps at 100, the list shows the last 30.
  Update & restart applies.

- **STUDIO v2, Wave F slice F2 — the contract addendum rides the kickoff**
  (`extensions/studio/main.js` + `extensions/studio/lib/liftoff.js`;
  `test/studio-liftoff-drill.js` grown to 25 checks — no renderer change:
  the addendum rides the brief invisibly). Lift-off's "Delegate to the
  Architect" brief is now the verbatim PROJECT.md text PLUS F1's
  `renderContractAddendum` output, behind a pinned separator (`===== CONTRACT
  ADDENDUM (rides the kickoff; not part of PROJECT.md) =====`) — so a Coder
  persona's step-0 kickoff carries the three spines' ground truth (§ Wave F:
  quality as a property of construction, not prompting luck). At delegate
  time main.js reads the created package's `design/tokens.json`,
  `components.json`, and `manifest.json` FAIL-SOFT: absent = the addendum's
  honest does-not-exist-yet line, unreadable/unparseable = a junk sentinel
  the spines/design validators reject, so the file reports
  present-but-unusable by name — a broken spine costs one honest line, never
  the kickoff. Composition lives in `lib/liftoff.js`
  (`composeKickoffBrief`), pure and drillable: `BRIEF_CAP` mirrors
  `main/tasks.js`'s own 20000-char `taskCreate` brief cap (untouched), and
  when PROJECT.md + addendum exceeds it the ADDENDUM absorbs the whole
  overflow — PROJECT.md is never cut — closing with an honest
  `[addendum truncated]` marker composed to land exactly at the cap, so
  tasks.js's own silent slice never eats it. Lift-off's "Open a chat here"
  stays a bare seat for now, stated rather than faked: `seatCreate` reads no
  kickoff text off the wire (a seat's kickoff comes from its persona preset
  alone), and `main/seats.js` is outside this slice's surface — the additive
  message-carried kickoff there is the named follow-up. Drill additions pin
  the separator/marker/cap verbatim on the test side and prove: addendum
  rides the brief byte-for-byte after PROJECT.md, absent spines stated
  honestly, malformed spine = present-but-unusable, truncation order +
  marker (pure and through the REAL tasks.js cap). Update & restart applies
  (extension-main change).
- **STUDIO v2, Wave B slice B2 — the app frame** (`main/appFrame.js` NEW +
  its `main/main.js` wiring — the wave's one core touch, narrow and argued;
  `extensions/studio/{renderer.js,style.css}`; drill in
  `test/appframe-drill.js` — 14 checks, wired into `test:core`). The user's
  real app, hosted INSIDE the studio: a main-owned Electron `WebContentsView`
  per host window (Law 2 — the renderer never gains node or webview powers),
  attached to whichever shell window the posting renderer lives in
  (`BrowserWindow.fromWebContents(ctx.sender)` — the S2 idiom; the docked
  pane and the detached studio window host independently, both at once).
  `appFrame.js` is Electron-free (the studioWindow.js precedent) and owns
  every drillable decision: the URL wall (ONLY `http://localhost:<port>` /
  `http://127.0.0.1:<port>`, explicit port required, credentials/userinfo
  spoofs/IPv6/other loopback refused, WHATWG-normalized), bounds sanitation
  (numbers-only, finite, negatives clamp to 0, capped, scaled by the
  sender's webFrame zoom so CSS px land as DIPs), and the per-window
  registry (show doubles as the bounds sync — only a CHANGED url reloads;
  hide keeps view + url alive so a tab/step flip never restarts the app;
  only a window's death destroys, via its `closed` hook, with a quit-time
  `destroyAll` backstop). main.js supplies the thin shell: fully sandboxed
  webPreferences (no preload, `sandbox:true`, `contextIsolation:true`, no
  node), `setWindowOpenHandler` deny, and will-navigate/will-redirect
  confined to the frame's own localhost origin through the registry's live
  allowedUrl accessor. Bus verbs `appFrameShow {projectId, url, bounds}` /
  `appFrameHide` / `appFrameNavigate {url}` answer per-window over
  `bus.postTo` (`appFrameState`); senderless (smoke-injected) posts drop
  silently, and on a core without the module the studio's posts land as the
  bus's unhandled-type warning — fail-soft, no frame, nothing breaks.
  Renderer: a PREVIEW card on Lift-off (Wave E renames it) stakes out a
  placeholder rectangle while the B1 server is `ready`; one truth function
  recomputes geometry + visibility from the live DOM on every render,
  ResizeObserver fire (a hidden ancestor zeroes the rect — dock-tab,
  sub-tab, and step hides all land there), window resize, and scroll,
  throttled trailing-edge; RELOAD rides same-url `appFrameNavigate`. No
  frame in smoke — nothing starts a server. Update & restart applies.
- **STUDIO v2, Wave C slice C1 — the surgeon + resolver contracts**
  (`extensions/studio/lib/{resolver.js,surgeon.js}` new; drill in
  `test/studio-surgeon-drill.js` — 28 checks over the new fixture mini-project
  `test/studio-fixtures/resolver-app/`, wired into `test:studio`; new files
  only — no UI, no bus verbs, no seat wiring, zero edits to existing
  lib/renderer/main code (C2+ adds the inspector overlay, the seat, and the
  boom ledger)). `resolver.js` is the tiered source resolver (§ Wave C):
  given a picker-captured element context `{selector, classes[], text, tag,
  html?}` and a project root, it returns ranked candidates `{file, line?,
  tier, confidence}` — tier `hint` (high) parses `data-source="path[:line]"`
  attrs out of the captured html (parse ONLY; the value is untrusted page
  content, so it passes the surgeon's own relative/traversal-free path wall
  and must name a real non-link file under the root, or it is dropped, never
  repaired); tier `search` (medium) is a capped deterministic fs walk (skip
  node_modules/.git/dist/build, max 2000 files, max 512 KB/file, extension
  allowlist .html/.css/.js/.jsx/.ts/.tsx/.vue/.svelte, symlinks never
  followed) scoring whole-token class matches + visible-text hits with
  first-match line numbers, ranked score-desc/path-asc in plain byte order
  (never localeCompare — the design.js determinism law); tier `context`
  (low) is the always-present, always-last whole-context fallback descriptor
  for the seat. Every result carries its tier honestly — never a silent
  guess. `surgeon.js` is the apex-surgeon reply contract: the kickoff
  builder (element context + the resolver's ranked candidates verbatim + the
  user's intent + the ONE-minimal-edit law + the report shape) and the
  fenced ```apex-surgeon JSON parser under handoff.js discipline — last
  block wins, known fields only, result rebuilt field by field
  (`{summary, edits:[{file, kind:'modified'|'created', hunks?}], followup?}`),
  and STRICTER than its siblings on purpose: nothing is ever trimmed or
  truncated into acceptance — a 7th edit, an absolute or `..` path (either
  path flavor, any colon, control chars), an unknown kind, or any oversized
  string fails the WHOLE reply closed to `{result:null, error}`.
  `detectDemote` is the scope guard's pure half: a valid report claiming
  more than 3 edits, or asking followup `"delegate"`, flags bigger-than-a-
  boom for the proposal card C2+ renders.

- **STUDIO v2, Wave F slice F3 — the design-mode overlay template**
  (`extensions/studio/templates/design-mode.js` new, `design/design-mode.md`
  new; drill in `test/studio-designmode-drill.js`, wired into `test:studio`;
  new files only — zero edits to existing lib/renderer/main code). The
  dev-only overlay a scaffolded app ships (§ Wave F — design mode), as a
  template ASSET Apex never executes: one self-contained vanilla-JS file
  (zero deps, zero imports, zero external URLs — the A3 self-containment law
  applied to the template itself) the scaffold includes behind the stack's
  dev flag. Standalone in any browser it reads the three contract spines
  over same-origin relative fetch, fail-soft per file (a missing or
  non-schema-1 spine disables just that panel with an honest note; a
  relative-only base override refuses protocols and `//`); renders a
  bottom-right launcher + panel inside its OWN shadow root (app CSS cannot
  break it, its CSS cannot leak; one host element is its whole DOM
  footprint); element picking is the A5 overlay pattern (fixed
  pointer-events-none highlight box, hover aim, click select, Escape cancel
  on capture-phase listeners attached only while picking); a picked element
  resolves to its component ([data-component] mark first, class-name
  fallback) and gets variant/effect radio pickers plus token-ROLE bindings
  resolved against tokens.json; "copy change" writes a precise paste-ready
  instruction to the clipboard (v1 persistence, honest limits: read-only +
  clipboard, no hot-apply — real file writes need a dev-server endpoint,
  out of scope, documented in the header and design/design-mode.md); a
  component-tree tab walks the DOM for marks/class matches (200-node cap)
  with the manifest's screen list beside it. The drill validates the
  template statically: parses as JS, the A3 external-URL vectors
  re-implemented (written, not imported) with seeded positive controls, a
  64 KB size cap, and the load-bearing markers (shadow-root attach, Escape
  handler, fail-soft fetch guards, schema gates, no innerHTML). Template
  asset only — nothing to reload or restart.
- **STUDIO v2, Wave B slice B1 — the dev-server runner**
  (`extensions/studio/lib/servers.js` new, `extensions/studio/{main.js,
  renderer.js,style.css}`; drill in `test/studio-servers-drill.js`, wired into
  `test:studio`; extension code only — zero main/engine edits). Per-project
  launch config `{command, args, cwd, port, readyRegex}` persists machine-side
  in `state/extensions/studio/servers.json` (schema 1, same-dir temp +
  exclusive-flag atomic write — the workspace.json discipline; NEVER in the
  portable package). A per-project lifecycle machine (stopped → starting →
  ready → stopped/failed) runs through an injectable spawner seam
  (child_process in production, a stub in drills — zero real processes in
  `npm test`): ready = `readyRegex` matching a stdout/stderr line, else a
  port-listen probe, else a hard fallback timeout that ASSUMES up with an
  honest log note rather than killing a slow server; logs ride a bounded ring
  (last 400 lines, per-line cap). Stop is a TREE kill — `taskkill /pid /T /F`
  on Windows (the claudeSeat.js dispose idiom; that file untouched),
  `kill(-pid)` on a detached POSIX group — and `extensions/studio/main.js` now
  exports `dispose()`, called by main/extensions.js on app quit, so every
  server dies with the extension (no orphans, drilled). Guards: the launch
  cwd must sit inside the projects workspace or a registered workspace
  (seatconfig `_workspaces`, read fail-soft — ctx.seats has no reader seam),
  and commands spawn with an args ARRAY + `shell:false` — a hostile command
  string stays one inert argv token (drilled). Bus verbs:
  `projectsServerConfigGet/Save`, `projectsServerStart/Stop`; posts
  `projectsServerState {projectId, phase, port, logTail, logSize, error}` and
  `projectsServerLog {projectId, lines}` deltas. UI: a minimal RUN drawer on
  the Lift-off step (config form with whitespace-split args — no shell, no
  quoting; start/stop; phase chip; live log tail patched in place) — the full
  BUILD step is Wave E. Update & restart applies.
- **STUDIO v2, Wave D slice D1 — the X-ray diagram contract**
  (`extensions/studio/lib/xray.js` new; drill in `test/studio-xray-drill.js`
  — 17 checks; new files only, no UI, no bus verbs, no AI wiring — D2 adds
  the disposable pass and the ARCHITECTURE step). The mermaid-source contract
  as pure lib code: `buildDiagramPrompt(blueprint)` builds the deterministic
  one-turn prompt (idea/platform/architecture digest in, one flowchart out);
  `parseLlmReply` extracts exactly ONE ```mermaid fence and holds every LINE
  of it to a strict allowlist grammar (flowchart/graph directive first and
  once, node/edge lines, subgraph/end/direction, classDef/class/style —
  click/callback/href and all %% lines including %%{init} rejected by name,
  any unrecognized line fails the reply whole; 32 KB / 300-line / 300-char
  caps; fail-closed to `{source:null, error}` — the mockup.js discipline on
  diagram source). Provenance is the A3 sidecar idiom on a pure record:
  `buildProvenance` → `{schema, source:'llm'|'derived', canonicalHash,
  generatedAt, bytes}`, with `isDiagramStale` applying the mockup drift rule
  (a badge, never a silent regeneration). `deriveFallbackDiagram` is the
  no-AI, no-quota fallback: the architecture area's prose parsed through a
  design.js-style keyword table into tiered components (user → interface →
  services → stores), emitted as a valid flowchart marked source 'derived' —
  the drill holds its output to the module's OWN validator, so the fallback
  can never emit what the contract would refuse.
- **STUDIO v2, Wave F slice F1 — the product-contract spines (schemas +
  addendum)** (`extensions/studio/lib/spines.js` new,
  `design/contract-spines.md` new; drill in `test/studio-spines-drill.js` —
  new files only, zero edits to existing lib/renderer/main code): the two
  contract files a scaffolded app is born with, beside A2's tokens.json
  (§ Wave F). `design/components.json` schema 1 — the typed component
  library (name, optional purpose, variants, effects, token-ROLE bindings
  resolved against a fixed `<group>.<role>` table whose color roles come
  straight from design.js's COLOR_ROLES) — and `design/manifest.json`
  schema 1 — the UI manifest (screens, each naming the components + variants
  it uses). `validateComponents`/`validateManifest` follow the contract.js
  voice: deterministic, total (never a throw), `{valid, errors, warnings}`
  in plain language, every count/length capped and over-cap refused whole —
  never truncated into acceptance. Passing the parsed library to
  `validateManifest` turns on the drift check (unknown component /
  undeclared variant = WARNING, the canonical-drift precedent; a broken
  library performs no drift check at all). `renderContractAddendum(tokens,
  components?, manifest?)` produces the deterministic markdown a Coder
  kickoff will carry (F2 wires it into Lift-off): the three spines, the
  tokens honesty ledger (derived groups vs house defaults, said plainly),
  EXISTS / MUST-create / present-but-unusable per spine file, and the one
  law — no hard-coded colors or fonts, tokens only. Both schemas documented
  with examples in `design/contract-spines.md` (the file scaffold templates
  and coder personas read; spines.js is its executable twin). No UI, no bus
  verbs, no wiring — pure lib + docs.

- **STUDIO v2, Wave S slice S2 — the studio boot mode, per-window captions,
  the ⧉ affordance, and the reopen preference** (`renderer/shell.js`,
  `renderer/styles/shell.css`, `main/main.js`, `main/bus.js`,
  `main/studioWindow.js`, `extensions/studio/{renderer.js,style.css}`; drill
  extended in `test/multiwindow-drill.js` — 18 checks). The detached window
  now boots in STUDIO MODE: shell.js reads `#apexWindow=studio` and flips
  `body.studioMode` — the tracker blind, AI rail, and every dock pane except
  STUDIO hide (CSS), the STUDIO pane mounts open and full-bleed with no tab
  and no pull, the title reads APEX STUDIO, and shell state is neither read
  nor persisted (localStorage is shared across windows). Dock/chat shortcuts
  (Ctrl+1..9, Ctrl+T, Esc-collapse) and the closeRequested answerer are
  studio-mode-gated; the ? overlay, menu, zoom, and code badge keep working.
  Caption ipc (`win:minimize/maximize/close/fullscreen/reload`) is
  sender-aware via `BrowserWindow.fromWebContents` — the studio window's
  buttons drive the studio window (before: always the main one); `winState`
  posts per-window over the new `bus.postTo`, and the ready reply reports the
  READYING window's state via the new `ctx.sender`. Lifecycle decided: the
  studio is a companion surface — when the main window truly closes (after
  its seat-aware gate), the studio follows and the app quits. The docked
  STUDIO header gains the ⧉ pop-out button (docked shell only) posting
  `studioWindowToggle`, plus an "also open in its own window" chip driven by
  the new `studioWindowState {open}` post (S1's one-sided
  `studioWindowClosed` — which had no listener — is migrated into it whole;
  `studioWindowGet` asks for the current truth at extension load). The
  reopen preference rides beside the S1 bounds in `state/studio-window.json`
  (`open: true` on open, `false` on a user close, kept `true` when the app
  takes the window down with it) — read at launch after the main window
  exists, never in smoke (`shouldReopen` guards `APEX_SMOKE`, drilled).
  Persistence moved into Electron-free `main/studioWindow.js`
  (loadState/saveState/shouldReopen + isOpen/close), all drilled. With no
  studio window and no flag, the docked shell's behavior is unchanged.

- **STUDIO v2, Wave S slice S1 — the multi-window bus + the detached studio
  window** (`main/bus.js`, `main/main.js`, `main/studioWindow.js` new; drill
  in `test/multiwindow-drill.js`; zero renderer changes): `bus.post()` now
  broadcasts to every registered live window — a Set of webContents, added by
  `bus.addWindow(win)` (was `init(win)`; main.js is the only caller), removed
  by the webContents' own `destroyed` hook, with an `isDestroyed()` guard in
  the post loop so a dying window can never crash a broadcast. The ONE
  exception is `'ready'`: its synchronous re-posts target the readying window
  alone (every ready handler audited — all re-post state synchronously), so a
  second window's boot rebuilds ITS projection without replaying
  seatNew/permission events at windows that already hold them; an injected
  ready (the smoke path) has no sender and still broadcasts.
  `createStudioWindow()` opens a second BrowserWindow with the SAME preload,
  the SAME webPreferences (sandbox, contextIsolation, no node), the SAME
  navigation lock (audit H1, now module-scoped), loading the same
  renderer/index.html with `#apexWindow=studio` — the boot flag rides through
  unused until S2's studio layout, so the window boots as a full second shell.
  Bounds persist machine-side (`state/studio-window.json`, saved on close,
  restored on open — second-monitor placement sticks). The bus verb
  `studioWindowToggle` opens it if closed / focuses (and un-minimizes) it if
  open — the open-or-focus truth lives in Electron-free `main/studioWindow.js`
  so the drill proves it hermetically; `studioWindowClosed` broadcasts to the
  survivors when it dies. Never auto-opened: with one window the shell behaves
  exactly as before, and nothing sends the toggle verb yet (S2 adds the ⧉
  affordance).

- **STUDIO v2, Wave A slice A5 — annotate → regenerate**
  (`extensions/studio/lib/{mockup,drafts}.js`, `extensions/studio/main.js`,
  `extensions/studio/renderer.js`, `extensions/studio/style.css`; drills in
  `test/studio-mockup-drill.js` — extension code only, zero `main/` changes):
  element annotation inside the sandboxed mockup. At SERVE time the studio
  writes a DERIVED `<screen>.annotate.html` (the stored bytes + an injected
  picker script) into the same served mockups dir — the A4 gate already
  admits direct-child `.html`, so serving it needs no core change; the
  stored mockup stays pristine (it is the provenance-hashed artifact), and
  the derivative is disposable: refreshed every serve, never hashed, never
  listed (no sidecar), never packaged (approval screen ids are
  `SCREEN_ID_RE`-pinned — no dots — so `collectApprovedMockups` can never
  name it; drilled), gone with the mockups dir. In annotate mode the SEE
  iframe swaps to that file: hover highlights via one data-free
  fixed-position overlay, a click posts exactly ONE message shape
  (`{type:'apex-mockup-pick', selector, text, bbox}`), Esc posts
  `apex-mockup-pick-cancel`, nothing else ever — `targetOrigin` is `'*'`
  because a sandboxed opaque-origin document can name no origin; the
  renderer bridge compensates with an `event.source === contentWindow`
  identity check plus a strict allowlist (`lib/mockup.validatePickMessage`,
  the drilled authority the renderer mirror is held to): exact type string,
  selector ≤ 256 / text ≤ 160 (oversized DROPS, never truncates),
  all-finite numeric bbox, result rebuilt from known fields only, ≤ 10
  picks/s (`createPickLimiter`), everything else dropped in silence — a
  hostile mockup page cannot crash or spoof the studio (drilled: wrong
  type, oversized, unknown-field, flood, garbage). The bridge exists only
  while SEE is mounted AND annotate is on (every render tears it down);
  the picker never runs outside the SEE step by construction — it only
  exists in the derived file, which is only iframed there. Picks become
  note chips persisted on the draft (`drafts.js`-validated `mockupNotes`
  field: per-screen arrays of `{selector, text, note ≤ 500}`, ≤ 12/screen,
  fail-closed like `mockupApproval`) via one `projectsMockupNoteSave` verb
  under the usual revision gate. REGENERATE WITH NOTES is the NORMAL A3
  `projectsMockupRun` — when the draft carries notes for the screen they
  ride the prompt pinned to their elements ("the element matching
  <selector> ("<text>"): <note>"); no new verbs, same
  prepare/approve/TTL/backstop machinery. A successful regen consumes the
  screen's notes (cleared on success ONLY — a failed turn leaves them so
  nothing is retyped) and clears the recorded approval outright (A4's
  invalidation, verified and extended by drill). 12 new drill gates, zero
  LLM spend (stubbed disposable).

- **STUDIO v2, Wave A slice A4 — the SEE step**
  (`extensions/studio/renderer.js`, `extensions/studio/main.js`,
  `extensions/studio/lib/{drafts,mockup,creator,contract}.js`,
  `extensions/studio/style.css`; core: `main/artifacts.js` + one ctx line in
  `main/main.js`; drills in `test/studio-mockup-drill.js`, fixture
  `test/studio-fixtures/valid/mockups/`): the PROJECTS stepper gains SEE
  between Canonical and Create — A3's minimal Canonical-step mockup list is
  absorbed here whole. The step renders the selected screen in an `<iframe
  sandbox="allow-scripts">` (NO `allow-same-origin`: scripts run but the
  document gets an opaque origin — no Apex storage/cookies/DOM, no bus;
  with A3's no-external-URL contract and the apex:// response CSP the page
  is fully inert), with screen-switcher chips, device-width presets
  (mobile 390 / tablet 768 / desktop 1180), the A3 STALE badge, and
  REGENERATE riding A3's prepare→run machinery unchanged. Serving is the
  wave's ONE core touch: `main/artifacts.js` gains an additive
  `registerServedDir(token, dir)`/`revokeServedDir(token)` seam beside the
  C2 exact-file set (direct-child `.html` only — sidecars, subdirs,
  traversal, symlinks, and every unregistered path still refuse;
  realpath-checked; the no-network response CSP still applies), exposed to
  extensions as `ctx.serve` (one line in `main/main.js`); the studio
  registers exactly one draft's mockups dir per token and revokes it on
  draft delete. APPROVE MOCKUPS records `{screens, canonicalHash,
  approvedAt}` on the draft (`drafts.js`-validated `mockupApproval` field,
  the preview discipline): a canonical move makes the approval stale
  (re-approve), regenerating any screen clears it outright, and validation
  surfaces a missing/stale approval as a plain-language WARNING
  (`missing-mockups`) on schema-2 drafts and packages — silent on schema 1,
  never a block. At Create, the approved still-current screens' html +
  provenance sidecars copy into `<project>/mockups/` INSIDE creator.js's
  same atomic staging dir (before the rename — never a post-rename write);
  unapproved/stale mockups stay behind in draft state. Smoke affordances
  (extension-side, hash-ridden through the existing verbatim
  `APEX_SMOKE_DOCK`): `#builder=<id>` fronts a studio sub-view,
  `#pjstep=see` opens the SEE step draft-free. 13 new drill gates: the
  served-dir gate's scope/traversal/revoke/symlink refusals against the
  real `main/artifacts.js`, exact-dir registration + revoke-on-delete,
  approval record/staleness/regen-invalidation, malformed-approval shapes,
  and the Create copy both ways (approved rides, unapproved stays +
  warning). Update & restart.

- **STUDIO v2, Wave A slice A3 — the mockup pass**
  (`extensions/studio/lib/mockup.js` new; `extensions/studio/main.js`,
  `extensions/studio/renderer.js`, `test/studio-mockup-drill.js` new): the
  blueprint gains its first visual stage. Screen derivation is a
  DETERMINISTIC pass over the blueprint (no AI): the platform answer picks
  the kind — web/desktop/mobile words → screen mockups, cli/terminal →
  terminal storyboard frames (invocation/session, + errors/config when
  mentioned), api/service → one endpoint-map page; explicit UI words outrank
  cli which outranks api, and no match defaults to screens. Screens: `home`
  always, plus `auth`/`dashboard`/`settings` only when the blueprint's own
  words mention them — the user renames/removes/adds the list before
  generating anything. The prompt builder feeds ONE screen per disposable
  turn: blueprint digest + the Look area + the A2 tokens summary (compiled
  by `lib/design.js`, never re-implemented) + that screen's purpose. The
  untrusted-reply contract is fenced (```html, like every other untrusted
  contract in the extension) and fails CLOSED to an error + NO file on any
  violation: exactly one complete document (doctype→</html>; two fences are
  an error, not a pick), a 512 KB cap, and every static external-URL vector
  rejected individually — http(s):// and protocol-relative // in src=,
  href=, CSS url(), and @import — while data: URIs, #fragments, and
  relative refs stay legal (self-contained means inline or data:). Output
  lands under the DRAFT's own storage, never the projects workspace (no
  package exists yet): `state/extensions/studio/mockups/<draftId>/
  <screen>.html` + a provenance sidecar carrying the generating canonical
  hash, under the drafts-store discipline (symlink/non-dir refusal at both
  levels, exclusive-temp atomic rename, regex-pinned filenames); deleting a
  draft cleans its mockup dir too. Drift stays honest: a blueprint change
  flips `isMockupStale()` and the Canonical step's minimal mockup list (the
  real PREVIEW surface is A4) shows a STALE badge — nothing ever regenerates
  silently. Bus verbs mirror the suggest pass verb-for-verb —
  `projectsMockupList/Prepare/Run/Stop` with usage preflight, 5-minute
  prepare TTL, explicit `approved:true`, single-flight, launch:{model,
  effort} passthrough (omitted when the picker is unset), and a backstop
  timer (5 min — a whole document, not a chip list). New hermetic drill
  `test/studio-mockup-drill.js` (43 gates: derivation table + determinism,
  prompt shape, valid reply, eleven external-URL rejections, oversize/
  non-HTML/missing-fence/double-fence, provenance staleness flip, store
  containment + cleanup, and the full prepare/TTL/approval/single-flight/
  backstop machine on a stubbed disposable — zero LLM spend).

- **STUDIO v2, Wave A slice A2 — the tokens compiler**
  (`extensions/studio/lib/design.js` new; `lib/contract.js`, `lib/creator.js`,
  `extensions/studio/main.js`): the blueprint's `look` answer now compiles
  into `design/tokens.json` — the first Wave F contract artifact — through a
  DETERMINISTIC, AI-free keyword compiler: same look words in, same bytes out
  (a canonical fixed-key-order serializer, no Date/random/locale anywhere).
  Documented tables map palette leanings (dark/light + fourteen hue words) to
  the seven color roles (bg/surface/text/dim/accent/good/warning), type feel
  (technical/editorial/friendly) to a family + modular size scale, density
  (dense/airy) to spacing and radii, and tone (calm/bold) to shadows and
  motion. Degradation is honest: unparseable or absent look input falls back
  to the documented house style (dark, blue accent, plain type, regular
  density, even tone) with a WARNING — never a block — and a per-group
  `source` ledger plus "(house default)" summary markers so a default is
  never presented as chosen. Create stages `design/tokens.json` inside the
  SAME atomic rename as the rest of the package, and the create-time
  `project-context.md` gains a `## Design` summary line; the canonical
  PROJECT.md stays generated from approved answers only (the compiled summary
  lives in the tokens file and digest, never spliced into the canonical).
  `validateProjectPackage` learns the file: malformed tokens.json (bad JSON,
  wrong schema, missing roles) is an ERROR, absence is a plain-language
  warning on schema-2 packages and silent on schema-1 (which predates the
  contract), and tokens.json is deliberately NOT drift-checked against the
  blueprint — Wave F's design mode edits it as ordinary file writes. New
  drill `test/studio-design-drill.js` (byte-for-byte determinism, canonical
  serializer, mapping tables, defaults + degradation warnings, atomic
  package round-trip, malformed/absent severities, schema-1 silence); the
  `valid` fixture gains its compiled `design/tokens.json`.

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
