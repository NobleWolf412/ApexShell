# Apex Shell Changelog

## Unreleased

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
