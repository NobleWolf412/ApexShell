# STUDIO v2 — the one-stop app studio

Status: proposed. Builds on `design/app-builder-v1.md` (implemented). This
spec is the gap audit between what v1 ships and the operator's stated
outcome — *"the 1-stop shop for app building… it can show you what you're
going to build… load your project and edit the UI: click on something, type
what you want changed, boom changed… know exactly what you're getting, front
and back end"* — and the design that closes those gaps without breaking the
three laws.

## The audit — what v1 is, and the five gaps

v1 is a **blueprint factory with an AI co-author**. It takes a vague idea to
a delegable PROJECT.md through a guided interview, keeps the human the
author (chips and patches propose; only the user writes), and hands the
finished blueprint to the workflow layer's personas. That part is genuinely
strong and stays untouched: the interview, the canonical/hash discipline,
the portable package, Lift-off.

What it cannot do today:

1. **The blueprint is words, not sight.** Nothing shows what the app will
   look or feel like before the build starts. The nearest thing in the repo
   is the thing that built *this* feature — a hand-made clickable HTML
   mockup. That loop (spec → mockup → build) worked; it just isn't a product
   feature yet.
2. **No living preview.** Once a project exists as real code, STUDIO has no
   surface that runs it and shows it. The Viewer renders artifacts; nothing
   hosts the actual app.
3. **No click-to-edit.** There is no path from "I see the thing I dislike"
   to "a seat changed exactly that." Today the user alt-tabs to a chat and
   describes UI in prose — the precise pain the operator named.
4. **No front/back X-ray.** "Know exactly what you're getting" needs the
   architecture made visible — planned (from the blueprint) and actual (from
   the code) — plus the drift between them. graphify + serena exist as MCP
   tooling; nothing projects them into STUDIO.
5. **The loop doesn't close.** Lift-off fires a chain and STUDIO's job ends.
   Build progress lives on the TODO board; the studio never shows the app
   growing, so the "one stop" is really "first stop."

Why nothing else out there looks like this if we close them: cloud
scaffolders (v0/Bolt/Lovable-class) generate-and-host but own your stack and
your loop; editors with AI (Cursor-class) edit code but have no blueprint
authority, no persona chain with independent review, no portable
provider-free package. Apex already has the rare parts — local seats on your
own quota, the workflow layer with bounce-limited review, blueprints that
outlive any provider. v2 adds the missing sensory organs: eyes (preview),
hands (boom-change), and X-ray (architecture).

## Design principles (inherited, non-negotiable)

- **The three laws hold.** Engine stays Electron-free; the renderer keeps
  one door and strict CSP; everything vendor-shaped stays in extensions.
- **The user authors; the AI proposes.** Boom-change edits code the way
  co-designer patches edit the blueprint: visible, attributable, revertable.
- **The package stays portable.** Mockups, design tokens, and architecture
  snapshots enter the project folder; dev-server commands, ports, and
  machine paths stay in `state/extensions/studio/` — same split as v1.
- **Every AI pass is opt-in, prefaced, and priced** (the v1 preflight/TTL
  pattern), on the STUDIO model picker's choice.
- **Waves of slices, fresh seat per slice, foreman-verified, sweep at the
  end.** The v1 build protocol is the build protocol.

## Wave A — see it before you build it (mockups)

The blueprint gains a visual stage between Canonical and Create.

- **The Look card.** A seventh interview area (`look`): palette, type scale,
  density, tone words, reference notes. Portable data only — it rides
  `blueprint.json` and renders as a PROJECT.md section (schema bump to 2,
  v1 packages import cleanly with the area reported as a gap — the import
  machinery already speaks "missing area").
- **Mockup pass.** One disposable turn per screen: blueprint digest + Look
  card in, ONE self-contained HTML file out (inline CSS/JS, zero external
  fetches), written to `<project>/mockups/<screen>.html` with provenance
  (generating hash of the canonical it was derived from — drift rules apply:
  a blueprint edit marks mockups stale, never silently regenerates).
- **Preview surface.** A new PREVIEW step in the PROJECTS stepper renders
  the mockup in a sandboxed `<iframe>` fed through the existing `apex://`
  served-file allowlist (artifacts.js already gates exactly this class of
  thing) — `sandbox` with scripts but no same-origin, no node, no bus.
  Screen switcher, device widths (mobile/tablet/desktop), light/dark.
- **Annotate → regenerate.** Click an element in the mockup, leave a note
  (a chip pinned to the element), batch notes, one regen turn per screen.
  This is boom-change v0 — trained on throwaway HTML where mistakes are
  free, before it ever touches real code.

Verification: hermetic drills for the mockup contract (self-containment
check: no external URLs; provenance/hash; stale detection), served-path
allowlist tests, smoke with the PREVIEW step open.

## Wave B — the living preview (your real app, inside STUDIO)

- **Dev-server runner.** Per-project launch config (command, cwd, port,
  ready-regex) stored machine-side in `state/extensions/studio/servers.json`
  — never in the package. Start/stop/restart + log tail in a PREVIEW-side
  drawer; the process rides the existing PTY/child machinery in main, not a
  new subsystem.
- **The app frame.** An Electron `WebContentsView` owned by MAIN (Law 2: the
  renderer never gains node or webview powers; main positions the view over
  the studio's preview rectangle, bounds-synced on layout — the same
  geometry discipline the dock blinds already do). It hosts
  `http://localhost:<port>` — the user's own app, fully isolated from the
  Apex renderer.
- **Instrument bar.** Console errors and failed network calls surface as
  chips over the frame (read via the WebContentsView's debugger from main —
  the live-auditor pattern applied to a web page). Device-width presets,
  reload, open-external.

Verification: a drill against a fixture static server (hermetic: spawn a
tiny node http server, assert frame targeting/teardown via main-side state);
smoke gains an `APEX_SMOKE_PREVIEW=1` affordance.

## Wave C — boom changed (click-to-edit on real code)

The headline act, built on A+B:

- **Inspector overlay.** Main injects a picker script into the *preview's*
  WebContents (never Apex's renderer): hover highlight, click captures
  `{selector, tag, classes, text, bbox, screenshot crop}` and freezes the
  pick. Esc cancels. The overlay speaks only to main over the debugger wire.
- **Source resolver — tiered and honest.** (a) dev-mode hints when the
  stack offers them (React/Vite source annotations); (b) serena symbol
  search + grep over the project for classes/text/component names;
  (c) low-confidence fallback: hand the seat the element context and let it
  locate. Every resolution reports its tier and confidence to the user —
  never a silent guess.
- **The Surgeon.** A disposable seat in the project cwd with a tight
  contract: element context + the user's typed intent in, the MINIMAL edit
  out, diff reported in an `apex-surgeon` fenced block (same allowlist
  discipline as handoff/audit/apex-studio: known fields, capped sizes,
  fail-closed parsing). Tools walled to the project folder; permission mode
  per the user's dial; the live auditor can watch it like any seat.
- **Boom ledger.** Every change lands as a card: the pick's screenshot crop,
  the intent, the diff, REVERT. Revert is real (each change is a git commit
  in the project repo when one exists, a file backup when not). HMR shows
  the result; no HMR → auto-reload the frame.
- **Scope guard.** The surgeon refuses picks that resolve outside the
  project workspace; multi-file changes above a threshold demote to a
  proposal card ("this is bigger than a boom — delegate it?") that hands off
  to the workflow layer instead. Boom-change is for surgical strikes; chains
  remain the artillery.

Verification: resolver drills (fixture project with known selectors → known
files, all three tiers), surgeon-contract drills (hostile/oversized/
malformed replies fail closed), ledger drills (change→revert round-trip),
and a live gate with a real seat on a fixture app.

## Wave D — the X-ray (front and back end, visible)

- **Planned view.** An ARCHITECTURE step renders the blueprint's components/
  data/integrations as a generated diagram (one disposable turn → mermaid
  source stored in the package with provenance; rendered locally in the
  studio — no external renderer).
- **Actual view.** For a project with code: graphify's module graph and
  serena's symbol inventory projected into the same step — routes, API
  endpoints, models/schema (per-stack extractors, starting with the stacks
  the operator actually uses), dependency hot-spots (god-node detection is
  already a graphify verb).
- **Drift, again.** Planned vs actual diffed the way canonical hash drift
  works: "the app grew a component the blueprint never named" is a review
  prompt with one-click blueprint amendment (through the normal
  patch-accept authority — the diagram never edits the blueprint itself).

## Wave E — closing the loop (the actual one-stop shop)

- **Build tracker.** The Lift-off screen becomes a living BUILD step:
  milestones from the blueprint's delivery area, each wired to its chain
  task (the board already broadcasts `taskList`; the studio filters by
  project cwd). Milestone done → preview refresh prompt → next milestone's
  delegate button pre-armed with the updated PROJECT.md.
- **The full circle.** Interview → Look → Mockup approved → Create →
  scaffold chain (Architect → Coder → Auditor, unchanged) → living preview
  → boom-change refinement (with drift feeding amendments back into the
  blueprint) → next milestone → … → the Sweep. Every stage in one pane, on
  one model picker, under one authority model.

## Wave F — the product contract (design-grade output, editable anywhere)

The operator's deepest requirement is about the OUTPUT, not the studio:
*"the actual product the builder outputs needs to be unbelievably amazing…
launch it in a studio type app even if it lives separately from its Apex
home… choosing options for certain buttons, types, effects, cards, panels —
all modifiable."* The wrong answer is a universal editor that understands
arbitrary code (that's a research problem). The right answer is a
**contract**: every app the builder scaffolds is BORN editable.

- **The scaffold contract.** A blueprint compiles to an app built on three
  machine-readable spines, all living in the project repo:
  1. `design/tokens.json` — colors, type scale, spacing, radii, shadows,
     motion. The Look card (Wave A) compiles INTO this file; nothing in the
     app hard-codes a color or font.
  2. A typed **component library** — buttons, cards, panels, inputs, each
     with named variants and effect options, consuming tokens only.
  3. A **UI manifest** — which screens exist, which components each uses,
     with what variants/props. Regenerable from source; drift-checked.
  Coder personas receive the contract in their kickoff (Lift-off already
  carries PROJECT.md; it grows the contract addendum), so quality and
  consistency are properties of construction, not of prompting luck.
- **Design mode — the app's own studio.** The scaffold includes a dev-only
  overlay (vendored into the template, ~zero-dep, tree-shaken from
  production builds): run the app anywhere — no Apex required — flip on
  design mode, click any component, and get VISUAL pickers: variant, size,
  effect, radius, palette role, spacing. Changes hot-apply and persist to
  `tokens.json`/the manifest as ordinary file writes → an ordinary git
  diff. This is "boom changed" made *deterministic*: token and variant
  edits need no LLM, no seat, no quota — they're just data.
- **Apex-connected mode.** When the same app runs inside STUDIO's preview
  (Wave B) — or Apex detects its dev server — the overlay gains the AI
  half: the co-designer argues about the design system as a whole, and the
  Surgeon (Wave C) handles what pickers can't (new components, layout
  surgery, behavior). One mental model: **pickers for taste, seats for
  structure.** Standalone gives you the first; coming home to Apex adds
  the second.
- **Behind the scenes, honestly.** Design mode's second tab shows what the
  operator asked to *understand*: the live component tree with each node's
  manifest entry, which tokens it consumes, and (Apex-connected) a
  one-click "explain this screen" seat pass. The X-ray (Wave D) covers the
  repo level; this covers the pixel level.
- **What ships.** Production builds carry none of it — design mode is a dev
  dependency, stripped at build. The contract files ship with the repo
  (they ARE the design system's source of truth).

## Build order

Waves land in order (A→E, F alongside C-E); each wave is 3-5 slices, one
fresh seat per slice, gates per slice (`npm test` whole, smoke, `test:live`
where the engine or a WebContentsView seam moves), sweep as the tail slice
of each wave — the v1 protocol verbatim. Wave A is pure extension code and
ships value alone (mockups make every blueprint tangible even if B-E never
land). Wave B is the one careful core touch (main-owned WebContentsView +
bounds sync — argued, minimal, drilled). C rides B. D is parallel-safe with
C. E is mostly projection over existing machinery. F's contract definition
(tokens/components/manifest shapes + the scaffold template) can start as
early as A — it is what makes the mockup pass and the coder kickoff speak
the same design language — while its overlay lands after C proves the
picker/DOM plumbing.

New npm dependencies expected: **zero**. Electron ships WebContentsView;
mermaid rendering can be vendored as a single static asset only if argued
at its slice — otherwise the diagram renders through the same served-file
sandbox as mockups.

## Non-goals for v2

- Replacing the workflow layer's chains with in-studio builds (the studio
  *drives* delegation; personas still build).
- Cloud anything: hosting, deploy targets, provider-bound scaffolds. The
  package stays portable and local-first.
- A component marketplace or template library (v3 territory, if ever — the
  Wave F scaffold template is ONE opinionated house style, not a catalog).
- WYSIWYG structural editing of the mockup HTML (annotate-and-regenerate
  only; hand-editing the mockup breaks provenance for no payoff).
- A universal editor for arbitrary existing codebases: design mode is a
  property of apps built ON the contract. Imported/foreign projects get
  boom-change (Wave C) and the X-ray (Wave D), which work anywhere; the
  pickers require the spines.
