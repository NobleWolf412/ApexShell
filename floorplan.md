# FLOORPLAN — where everything lives and plugs in

The map an AI manager reads before moving furniture. Keep it current: any
change to the shell's structure or contribution points updates this file in
the same change-set — a stale map is worse than none.

## Doc map — which file answers what

- **User-facing**: `README.md` (what it is) · `INSTALL.md` (fresh-machine
  runbook, incl. the `seatconfig.json` schema).
- **Lane guides** (`connect/`): one per seat lane — `claude.md`, `codex.md`,
  `local.md` (Ollama), `agy.md`. Wire-verified operational detail + traps.
- **Architecture** (this file): where everything lives and plugs in.
- **Design history** (`design/`): one spec per wave (persona-builder-v1,
  live-auditor-v1, app-builder-v1, consult-v1, studio-v2 + its live
  prompts file studio-v2-prompts), the standing sweep protocol
  (sweep-v1), and `design/reviews/` (archival persona-builder slice reviews).
- **CHANGELOG.md**: version-stamped feature rollups.

## The three laws

1. **Parts, not a monolith.** The seat engine (`main/engine/`) is plain
   Node — zero Electron imports, provable headless (`test/engine-harness.js`).
   The renderer is a projection; engine state is the truth (permission
   queues, dials, roster). If a UI and the engine disagree, the engine wins.
2. **One door.** The sandboxed renderer talks to main ONLY through
   `preload.js` (window-caption ipc + the typed message bus). No node
   integration, strict CSP: `script-src 'self'` (no `unsafe-eval`) is the
   load-bearing guarantee. `style-src` carries `'unsafe-inline'` as a SCOPED
   exception — xterm injects its cursor/selection rules as a runtime style
   element (index.html:8 documents it); scripts stay fully locked (audit L1).
3. **Vendor-shaped things are extensions.** The shell core must run with an
   empty `extensions/` folder and no assumptions about trees, personas, or
   services on the machine.

## Rooms

```
ApexShell/
├── main/                  Electron main process
│   ├── main.js            window lifecycle + module registration ONLY (the
│   │                      main window + the detached studio window, Wave S)
│   ├── bus.js             typed message bus (renderer⇄main), register('type', fn);
│   │                      multi-window: post() broadcasts to every registered
│   │                      live window — except a 'ready' dispatch, whose
│   │                      re-posts target the readying window alone; postTo()
│   │                      targets ONE window (per-window winState); handlers
│   │                      get ctx.sender (undefined on injected smoke posts)
│   ├── studioWindow.js    detached-studio toggle truth (open-or-focus) +
│   │                      open/closed notify, the main-closed close() cascade,
│   │                      and the bounds/reopen-preference persistence
│   │                      (state/studio-window.json); Electron-free so the
│   │                      multiwindow drill proves it
│   ├── appFrame.js        the app frame (STUDIO v2 Wave B+C core touch):
│   │                      one main-owned WebContentsView per host window for
│   │                      the studio's living preview — localhost-only URL
│   │                      wall, bounds sanitation, per-window show/hide/
│   │                      navigate/destroy registry, appFrame* bus verbs
│   │                      (per-window postTo replies), the B3 instrument
│   │                      stream (console-error/failed-load events shaped,
│   │                      capped, rate-bounded 20/s with an honest drop
│   │                      summary, budget reset on navigate → appFrameEvent
│   │                      per-window), and the C2 inspect seam — inspect()
│   │                      injects a picker overlay into the hosted page via
│   │                      the adapter's runScript; picks ride BACK on the
│   │                      same console wire as '[apex-pick]'+JSON lines,
│   │                      filtered by prefix BEFORE the error-level chip
│   │                      gate (both gates live here, drilled — the factory
│   │                      forwards every console line with its level),
│   │                      validated by shapePickPayload (the A5 twin: caps,
│   │                      rebuilt fields, fail-closed) → appFramePick
│   │                      per-window; the flag drops on every page
│   │                      replacement. Electron-free with an injectable view
│   │                      factory (main.js supplies the sandboxed view, nav
│   │                      confinement, the thin listeners + runScript) so
│   │                      test/appframe-drill.js proves it headless
│   ├── seats.js           seat lifecycle, presets, launch config, restore
│   ├── terminal.js        built-in dock shell lifecycle + bounded replay
│   ├── tasks.js           the WORKFLOW LAYER: task board store + persona
│   │                      delegation chains (routes, handoff gates, bounce)
│   ├── audit.js           the LIVE AUDITOR: opt-in per-seat shadow review —
│   │                      watches a seat, runs a haiku disposable per turn
│   ├── consult.js         CONSULT v1: request → digest → kickoff → lifecycle
│   │                      for a hidden, tool-less disposable that gives the
│   │                      operator a second opinion on the current chat
│   ├── skills.js          Claude Code skills surface: scan/create SKILL.md
│   │                      (personal + per-repo), promote persona recipes
│   ├── engine/            THE ENGINE (Electron-free, harness-gated)
│   │   ├── seatHost.js    seat roster/truth; create/close/wrap/permissions
│   │   ├── claudeSeat.js  Claude stream-json lane (spawns `claude -p`)
│   │   ├── codexSeat.js   Codex app-server lane (JSON-RPC; owned chat, R33)
│   │   ├── localSeat.js   Ollama lane (chat + gated file tools)
│   │   ├── ptySeat.js     ConPTY lane (any terminal CLI, xterm-rendered)
│   │   ├── handoff.js     apex-handoff packet contract (parse + strict
│   │   │                  allowlist validation of untrusted seat output)
│   │   ├── audit.js       apex-audit finding contract (parse + validate the
│   │   │                  shadow auditor's untrusted output)
│   │   ├── consult.js     Consult contract: digest window, project-slug rule,
│   │   │                  tiered-memory read, kickoff composition (persona vs
│   │   │                  bare model, fresh-eyes), turn cap — pure, no fs-side
│   │   │                  effects beyond reading the persona's own memory files
│   │   └── transcripts.js transcript backfill parser (resume support)
│   ├── monitors/          tracker data plane
│   │   ├── index.js       config load + source lifecycle (panes.json →
│   │   │                  panes.sample.json → empty)
│   │   ├── sourceDemo.js  fake wandering data (the zero-setup source)
│   │   ├── sourceHttp.js  poll a JSON endpoint (the copy-me template)
│   │   ├── sourceSystem.js base-install: local CPU/mem/disk (os/fs, no perms)
│   │   ├── sourceWeather.js base-install: Open-Meteo, keyless
│   │   ├── sourceMcp.js   MCP tracker: active-in-project vs available servers,
│   │   │                  health via `claude mcp list` (follows seatFocus cwd)
│   │   └── panes.json     THE USER'S panes (panes.sample.json documents it)
│   ├── extensions.js      extension loader (see § Extensions)
│   ├── extensionServices.js  the services an extension's main half receives (ctx)
│   ├── externalUrl.js    SECURITY: the URL blocklist/guard for "open link"
│   │                      (shell.openExternal only after this vets it)
│   ├── liveUpdate.js      source watcher → code-changed badge → seat-safe restart
│   ├── usage.js           provider usage probes + the per-day local ledger
│   ├── theme.js / background.js — appearance state (UI-written configs)
│   └── store.js / artifacts.js — history index + working-view candidates
│                          (artifacts also gates the apex:// served-file allowlist:
│                          the C2 exact-file set, plus registerServedDir/
│                          revokeServedDir — a token-keyed dir whose direct-child
│                          .html files may serve, realpath-checked; the studio's
│                          SEE step registers a draft's mockups dir through
│                          ctx.serve. STUDIO v2 Wave A's one core touch)
├── renderer/              the window (plain JS, no framework)
│   ├── index.html         static skeleton: title bar, menu, core dock panes,
│   │                      AI rail (+ button only), tracker blind, script list
│   ├── shell.js           blinds/tabs geometry, dock registration, menu,
│   │                      zoom, close gates, keyboard shortcuts + ? overlay,
│   │                      clickable tracker chips (jump to a pane); studio
│   │                      boot mode ('#apexWindow=studio'): docked chrome
│   │                      hides, STUDIO pinned open full-bleed, no state
│   │                      read/persist (localStorage is cross-window)
│   ├── chatView.js        the chat center: seats UI, rail menu, defaults panel,
│   │                      the Consult → picker + in-chat consult card
│   ├── taskBoard.js       the TODO dock pane (workflow-layer projection)
│   ├── auditPane.js       the AUDIT dock pane (live-auditor projection)
│   ├── skillPane.js       the SKILLS dock pane (author/list Claude skills)
│   ├── prompt.js          ApexPrompt — the window.prompt() stand-in (Electron
│   │                      renderers have none); singleton modal
│   ├── termView.js        xterm mount for PTY seats
│   ├── terminalDock.js    built-in TERMINAL dock projection
│   ├── monitors.js        tracker grid renderer (widget kinds)
│   ├── viewer.js          the VIEWER dock tab (artifact rendering; pin to hold
│   │                      the view + a history strip of recent artifacts)
│   ├── usage.js           usage bars (rail units + quarter rows)
│   ├── bus.js             renderer half of the typed bus + ApexToast
│   ├── linkify.js         SECURITY: markdown→HTML escaping + safe URL linkify
│   │                      (LINK_RE excludes "'<> — the XSS contract; test it)
│   ├── imageStaging.js    paste/drop image staging for the composer
│   ├── theme.js / background.js — appearance panels (renderer half)
│   ├── extensions.js      renderer-side extension injector
│   └── styles/            base/shell/chat/monitors/theme CSS (tokened)
├── extensions/            DROP-IN FOLDER — one subfolder per extension
├── state/                 gitignored local state (logs, history, ledger)
├── test/engine-harness.js the headless gate — run after ANY engine change
├── preload.js             the one door
├── seatconfig.json        per-persona launch dials (current/default layers),
│                          `_workspace` + `_workspaces`, and per-persona
│                          `tools`/`disallowedTools` (the read-only wall);
│                          full schema in INSTALL.md (UI-written)
├── theme.json/themes.json/background.json   appearance (UI-written)
└── assets/apex.ico        window icon (in-app; nothing reaches outside)
```

## Extensions — the contribution points

An extension = `extensions/<name>/extension.json`:

```json
{ "name": "...", "main": "main.js", "renderer": "renderer.js",
  "styles": ["style.css"], "priority": -10 }
```

All fields but `name` optional. Main half loads eagerly at window creation,
try-wrapped (a broken extension toasts; the shell lives). Renderer half is
injected after shell boot (script/link tags — CSP 'self' covers them).

`priority` (optional, default 0, lower loads first) orders BOTH the main-half
`register()` calls and the renderer-injection order. It exists for the case
where one extension exposes a renderer global that others register into: the
**studio** shell (`ApexStudio`, `priority: -10`) must run before the personas
renderer that calls `ApexStudio.registerBuilder`. The renderer injector runs
the injected scripts with `async=false` so that emitted order is honored at
execution time (renderer/extensions.js), not left to whichever file loads
first. When no extension sets `priority`, order is alphabetical as before.

`main.js` exports `register(ctx)` (+ optional `dispose()`). ctx carries:

- `ctx.bus` — the main-side bus: `on(type, fn)` / `post(type, msg)`.
- `ctx.extDir` — the extension's own folder.
- `ctx.stateDir` — an ignored, per-install state folder at
  `state/extensions/<extension-folder>`; keep machine/runtime configuration
  here, never in a portable package.
- `ctx.pickDirectory({title, defaultPath})` — opens the shell's native folder
  picker after an explicit user action and resolves to an absolute path or
  `null` when cancelled.
- `ctx.serve` — the apex:// served-file gate's registration seam (STUDIO v2
  slice A4): `registerDir(token, absoluteDir)` admits that directory's
  direct-child `.html` files through the protocol (path-normalized,
  realpath-checked — see main/artifacts.js); `revokeDir(token)` closes it.
  Register the narrowest dir you own (the studio registers one draft's
  mockups dir per token), never a broad tree.
- `ctx.seats` — seat preset API:
  - `registerPreset({name, letter, title, kickoff, cwd})` — a named rail
    button; `kickoff` is the first prompt a fresh seat receives (omit for
    none); `cwd` overrides the workspace for that seat.
  - `setDefaultCwd(dir)` — where blank seats/terminals spawn.
  - `setWrapPrompt(text)` — replaces the generic End-Session close-out.
  - `presetNames()` / `registerWorkspace({name, path})` — added for the App
    Builder's Lift-off (slice 8): a read-only live-preset list (the
    Delegate-to-Architect gate) and a `_workspaces` registration that WARNS
    on a name/path collision instead of clobbering (unlike the picker's own
    `workspaceAdd` bus verb, which last-writer-wins). Plain synchronous
    `ctx.seats` methods, not bus verbs — `bus.post()`/`bus.on()` are
    main→renderer/renderer→main only, so a synchronous return value can never
    reach another main-side module through the bus; this is why
    `checkPresetNames`/`replacePresetGroup` already lived here too.

What each half can contribute:

| Contribution | How |
|---|---|
| Dock tab (left) | renderer half builds a `.sidePane.dockPane` element and calls `ApexShell.registerDockPane(el, {order})` — order slots the tab (VIEWER/TERMINAL sit at 10/15) |
| Studio sub-view | a builder renderer calls `ApexStudio.registerBuilder({id, label, mount(el), order})` — mount gets a view container; STUDIO frames it as a sub-tab (PERSONAS=10, PROJECTS=20). Provided by `extensions/studio/`; personas is the first tenant |
| Seat presets / rail buttons | main half via `ctx.seats.registerPreset` — the shell renders the buttons and defaults-panel entries from the data |
| Monitor source | today: add a module + require-map row in `main/monitors/index.js` (a small core edit); panes then reference its type |
| Background watcher / bus verbs | main half: `ctx.bus.on(...)` + its own timers; clean them in `dispose()` |
| Styles | `styles` in the manifest — injected before the renderer script |

Live-reload: edits to an extension's `renderer.js`/`.css` need only Reload;
anything else in the folder needs Update & restart (the watcher knows).

## Seats — how a lane works

- **Claude lane** (`claudeSeat.js`): spawns the local `claude` CLI with the
  stream-json contract; permissions arrive as `can_use_tool` control
  requests and render as cards; mode/model switch live, effort switches via
  seamless restart (`--resume`). Details + traps: `connect/claude.md`.
- **Codex lane** (`codexSeat.js`): spawns `codex app-server` (JSON-RPC) —
  owned chat with the same cards (including provider-offered remembered
  approvals), resume (`codex:`-prefixed session ids), and wrap. Verified by
  its own headless drill (`test/codex-drill.js`).
  Details + the Windows containment truth: `connect/codex.md`.
- **Local lane** (`localSeat.js`): Ollama chat with tool rounds; writes gate
  through the same permission card. `connect/local.md`.
- **PTY lane** (`ptySeat.js`): a real ConPTY + xterm — for TTY-only CLIs
  (agy) and anyone who wants the raw terminal. No resume across restarts
  (a ConPTY child can't be resumed — the app says so honestly).
- **Dock terminal** (`terminal.js` + `terminalDock.js`): the same PTY driver
  behind a built-in left tab. It starts on first pull, survives collapse and
  renderer Reload (256 KiB bounded replay), and ends on full app restart.

Launch dial resolution: seat `current` → seat `default` → `_default` →
hard `manual`. `_workspace` sets the bare default cwd; preset `cwd` and
`setDefaultCwd` override.

**Disposable launch override** (App Builder slice 5): `createDisposable`
(`seatHost.js`) and the `ctx.seats.startDisposable` extension seam accept an
optional `launch: { model, effort }` — `model` validates against the
Claude-lane tiers ONLY (`fable | opus | sonnet | haiku`; a disposable always
spawns via `claudeSeat`, so anything else is a caller bug, rejected with a
clean thrown `Error` before any scratch dir or child process exists). The
existing flat `model`/`effort` params (`main/audit.js`'s haiku pass) still
work untouched — `launch`, when present, simply wins over them — and omitting
`launch` entirely (the shape `personaTestPrepare`/`personaRelSuggestLlm` use)
is byte-identical to before this slice. `main/seats.js`'s `startDisposable` is
a pure passthrough; the engine is the single validation gate, so
`test/engine-harness.js` (which drives `createDisposable` directly, no
Electron in the loop) is what proves the three cases: a valid tier steering a
real spawn, a non-Claude lane rejected before anything spawns, and the
omitted-launch shape spawning exactly as it always has.

**Per-persona toolset wall** (`launchFor` in `seats.js`): a persona's
seatconfig entry may carry top-level `tools` (the CLI's built-in allowlist,
e.g. `Read,Glob,Grep,WebSearch,WebFetch,Write,Bash,TodoWrite`) and
`disallowedTools` (hard deny-rules — the only thing that reaches MCP tools;
`--tools` governs built-ins only). This is how the read-only advisor personas
(Architect, Auditor) launch WITHOUT Edit/Task and with serena's symbol-edit
tools denied. The keys are top-level (outside the current/default layers)
because the set-default/reset dial actions replace whole layers; they survive
every launch path including `seatRelaunch` (so an effort restart can't unlock
the wall).

## The workflow layer — tasks, routes, delegation

`main/tasks.js` (core module, registered after extensions so routes can
validate against live presets) + `renderer/taskBoard.js` (the TODO dock
pane) + `main/engine/handoff.js` (pure packet contract).

- A **task** = title + repo cwd + a **route** of persona presets
  (`Architect → Auditor → Coder`). State: `state/tasks.json`; saved route
  templates: `state/routes.json`. Tasks group per repo on the board.
- Each **step** runs in its own seat, launched with a composed kickoff:
  `[seat-launch]` + the persona's own kickoff + an `<apex-task>` block
  carrying the repo cwd, the PERSONA HOME (absolute — task cwd overrides
  the preset cwd, so relative memory paths would otherwise orphan), the
  previous step's packet, and the completion contract. `taskCreate` accepts
  one more optional field, `brief` — a verbatim text block (capped 20 KB)
  that rides STEP 0's kickoff only, never later steps. It exists for the App
  Builder's Lift-off "Delegate to the Architect" (`extensions/studio/`,
  slice 8): the canonical PROJECT.md text needs to reach the first seat
  verbatim, not as a rumor of it, and no other channel into `composeTaskBody`
  existed. Omitted, a task behaves exactly as before this addition.
- A step signals completion by ending its final message with one fenced
  ```apex-handoff``` JSON block: `status done | needs-decision | bounce`,
  plus summary/findings/decision/artifacts. The content is UNTRUSTED —
  `handoff.js` validates against a strict allowlist; a packet can never
  name a target, route, cwd, or permission (targets come only from the
  task's stored route).
- **Manual tasks**: the packet lands on the card; Delegate → advances.
  **Auto tasks** (`auto` flag): done → wrap+close the seat, launch the next
  step unasked; bounce → resume the PREVIOUS step's session with the
  findings (max 2 bounces; review steps are always fresh seats —
  independence preserved); needs-decision → pause for the user.
- **Hand off → (`seatHandoff` in seats.js)** is the LIVE delegate-from-chat
  path today: the source chat's recent output becomes a plain-text brief that
  opens the target persona (reusing a live chat of that persona if one exists —
  the handoff-back case), NO board task and NO packet gate. `taskDelegateFromChat`
  below is the older packet-gated variant (now `_test`-mostly); don't confuse
  them (audit L6).
- **taskDelegateFromChat** (legacy/packet-gated): any live rail chat can hand
  its work onward without a pre-planned task — the tab row's Delegate → button
  picks a target persona, the chat becomes step 1 of a fresh auto task, is
  asked for its handoff packet, and the normal machinery advances (wrap+close
  the chat, open the target with the packet).
- **Gates** (chain stops, tab dot pulses, toast): malformed/missing packet,
  step error/seat death, decision needed, bounce limit, chain complete.
  The seat stays open on packet gates — answer in its chat and the observer
  keeps parsing every later result.
- **apex-todo** — any chat's road onto the board. A seat may end a message
  with a fenced ```apex-todo``` JSON block (`{title?, plan[], done[]}`,
  advertised in `SEAT_ENV_BRIEF`): a free rail chat spawns a lightweight board
  task in its repo (updated in place on later blocks); a chain step merges the
  block into its own task's PLAN checklist (the handoff packet's plan/planDone
  still rules at hand-off). This is why a persona shows progress on the board
  instead of writing a todo file into the viewer.
- Memory stays SILOED per persona; handoffs carry packets, never shared
  context. seats.js exposes a narrow internal seam for this module
  (`observeSeats`, `createTaskSeat`, `startDisposable`, `presetInfo/Names`,
  `seatCommand`, `seatEntry`, `closeSeat`) — deliberately NOT part of the
  extension ctx. `observeSeats` also sees a synthetic `seatUserSend` (a normal
  seatSend the view never echoes) so observers get both sides of a chat.

## The live auditor — opt-in shadow review

`main/audit.js` (watch manager) + `renderer/auditPane.js` (AUDIT dock pane) +
`main/engine/audit.js` (pure apex-audit contract).

- Off by default; a per-seat toggle in the AUDIT pane. While a seat is watched,
  each completed turn feeds a rolling transcript window (both sides) to a hidden
  **haiku disposable** seat that returns an `apex-audit` block — at most 3
  findings, validated by the same untrusted-output discipline as handoff.js.
- Cost-bounded: cheap model, ~4s debounce, small window, opt-in only. The
  auditor sees the transcript ONLY, never the watched persona's memory —
  independence, same principle as the delegation audit step.
- Findings render as severity cards (risk/warn/info) with "send to chat"
  (drops into the seat's composer via `ApexChat.fillComposer`) and dismiss; a
  👁 chip marks a watched tab.

## Consult v1 — a second opinion on the current chat

`main/consult.js` (lifecycle) + `main/engine/consult.js` (pure digest/kickoff/
turn-cap contract) + `renderer/chatView.js` (the Consult → picker + card).
Full spec: `design/consult-v1.md`.

- **Consult →** sits beside **Hand off →** in every live, non-chain seat's tab
  row and means the OPPOSITE thing: a hidden, tool-less disposable seat reads a
  bounded digest of the chat (the live auditor's own window — same 6-turn/8KB
  bounds, `main/engine/consult.js`) and answers the OPERATOR in a card, never
  the chat. Nothing the consultant says reaches the seat's transcript, the
  workflow layer, or memory — the user is the only merge point (send-to-
  composer fills, never sends).
- **Picker → kickoff**: pick a persona (or "just a model") + an optional
  model/effort dial (the disposable launch override, App Builder slice 5 —
  steers THIS consult's seat only, omitted = the default lane model, byte-
  identical to slice 1) + a fresh-eyes toggle + a question, with the current
  Claude usage snapshot (session/weekly %, from the same ambient `usageData`
  push the rail bars use) rendered so spend is visible before send. A persona
  consult inlines tier 1 (`foundation.md` + its own canonical, full text, the
  same identity a seated persona reads) always, and tier 2 (its OWN
  `memory/projects/<slug>/state.md` + `MEMORY.md`, project slug resolved from
  the CHAT's cwd) unless fresh-eyes is on. Missing tier-2 files inline nothing
  and say nothing (fresh project); an oversized file truncates with a notice;
  note files are NEVER inlined (tool-less — paging one in is impossible). A
  bare-model consult carries no identity tier at all, just the digest and the
  question.
- **Turns**: kickoff + up to 4 follow-ups (5 replies total) riding the SAME
  disposable controller (`controller.send`, not a fresh spawn); each follow-up
  prefixes a fresh digest delta. The 6th is refused with a notice pointing at
  a fresh consult or Hand off →. A 120s per-turn backstop (the relationship
  pass's pattern) and any dead/timeout/error close the consult and report
  plainly — the chat itself is untouched by every failure mode. One consult
  per seat; a second `consultStart` warns instead of clobbering. A consult
  never survives its chat (seat-gone closes it silently).
- **Button-row semantics**: both buttons stay clickable always (no hard
  gate) — Hand off → gains an accent/dot when the active chat has a live
  board-task binding (`main/tasks.js`'s `chatTasks`, surfaced to the renderer
  as `boundSeatIds` on every `taskList` post) — the natural next step is
  suggested, never forced.
- **Send to composer**: fills the operator's composer with the whole reply, or
  just the current text selection when one is anchored inside the reply
  (cheap selection-level send, slice 2) — never sends either way.
- Guardrails: the consultant's reply is untrusted text, rendered exactly like
  chat prose (escaped + linkified, `chatView.js`'s `md()`) — never parsed for
  verbs, never auto-inserted. Main never inspects reply content either; it is
  forwarded verbatim over the bus.
- Consult → is also listed in the `?` gestures/shortcuts overlay, beside
  Hand off →, spelling out the opposite-of-handoff distinction.

## Verification duties (inherited by anyone who edits)

- ANY main/renderer logic change → `npm test` — the full hermetic drill suite
  (zero LLM spend) must pass whole. It runs three targets (audit M7): `test:core`
  (launch-args, multiwindow, appframe, taskboard, audit, consult, skills,
  linkify — the Law-3-pure subset
  that needs NO `extensions/`, so it proves the core in isolation), `test:studio`
  (the STUDIO shell + `registerBuilder` seam), and `test:persona` (the personas
  EXTENSION's own drills). Keep new core drills in `test:core`; extension drills
  belong to their extension's target.
- Engine or lane change → `npm run test:live` — the gates that spend real
  sessions (engine-harness on the Claude lane, codex-drill, pty-drill).
- Full-stack proofs on demand: park the electron launcher stub
  (`node_modules/electron/dist/resources/app` — it hijacks every electron
  invocation to main.js), then `npx electron test/live-chain` (a REAL 2-step
  haiku delegation chain) or `npx electron test/live-audit` (a real haiku
  auditor on a watched seat + a risky transcript).
- Window change → `APEX_SMOKE=1` smoke (exit 0 = no renderer errors).
  Affordances: `APEX_SMOKE_DOCK=<tab>` opens a pane, `APEX_SMOKE_SHOT=x.png`
  screenshots, `APEX_SMOKE_PTY=1` mounts a ConPTY seat, `APEX_SMOKE_CFG=1`
  asserts a config write.
- Renderer edits apply on Reload; main/preload/extension-main edits need
  Update & restart. Say which when shipping.
- New npm dependencies are a deliberate, argued step — the two that exist
  are load-bearing choices, not a floor to build on.

