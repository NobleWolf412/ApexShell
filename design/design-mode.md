# Design mode — the dev-only overlay template

Status: implemented (STUDIO v2, Wave F slice F3 —
`extensions/studio/templates/design-mode.js`, drilled statically by
`test/studio-designmode-drill.js`). The file is a template ASSET: Apex never
executes it. The scaffold (the coder persona, guided by the F2 kickoff
addendum) copies it into a generated app and wires it into DEV builds only.
This document is the wiring guide and the honest statement of what v1 does
and does not do.

## What the template does

One self-contained vanilla-JS file — zero dependencies, zero imports, zero
external URLs (the A3 self-containment law, applied to the template itself).
Dropped into any page of a contract-built app it provides:

- **The spines, read live.** On first open it fetches the three contract
  files over same-origin RELATIVE paths — `design/tokens.json`,
  `design/components.json`, `design/manifest.json`
  (`design/contract-spines.md` is the schema authority). Fail-soft per file:
  a missing, malformed, or non-schema-1 spine disables just that panel with
  an honest note; the rest of the overlay keeps working. Never a throw,
  never a blank overlay. A "reload spines" button re-reads them — edit
  tokens.json, reload, see the new values.
- **Its own shadow root.** A floating launcher chip (bottom-right) and the
  panel it toggles live behind `attachShadow` — the app's CSS cannot restyle
  the overlay and the overlay's CSS cannot leak into the app. Its one
  structural footprint in the page is the single host element; the app's DOM
  is never otherwise mutated.
- **Element picking** — the A5 mockup-annotate pattern (the
  `PICKER_SCRIPT` in `extensions/studio/lib/mockup.js`): a fixed,
  pointer-events-none highlight box, hover to aim, click to select, Escape
  to cancel. Capture-phase listeners, attached only while picking.
- **The pickers.** A picked element resolves to its component — a
  `[data-component]` mark wins (the contract's convention, below), else a
  class token naming a library component, walking up a few hops so a click
  on a button's label still resolves the button. The panel then shows
  variant and effect radio pickers from `components.json`, plus the
  component's token-ROLE bindings with each role resolved to its live
  tokens.json value.
- **Copy change.** Choosing a different variant/effect previews a precise,
  paste-ready instruction (component, locating selector, exact from → to,
  the one law restated) and copies it to the clipboard on click — for a
  coder seat or a human to apply.
- **The component tree.** Tab two walks the DOM (`[data-component]` marks
  first, class-name match as fallback, capped at 200 nodes) into the app's
  component composition, and lists the manifest's declared screens beside
  it — the pixel-level half of "behind the scenes, honestly".

## How a scaffold includes it (dev builds only)

The scaffold copies the template into the generated app (any path works;
`dev/design-mode.js` is the suggested home) and includes it behind the
stack's dev flag — production builds must carry none of it:

- **Plain static page**: `<script src="dev/design-mode.js"></script>` at the
  end of `<body>`, present only in the dev copy of the page (or added by the
  dev server).
- **Vite**: `if (import.meta.env.DEV) import('./dev/design-mode.js');`
- **webpack / CRA-style**:
  `if (process.env.NODE_ENV !== 'production') import('./dev/design-mode.js');`
- **Express-style dev server**: serve the file (and the `design/` dir) only
  when not in production.

Two serving requirements, both trivial in dev:

1. `design/tokens.json`, `design/components.json`, and `design/manifest.json`
   must be fetchable at the page's origin under `design/`. If the dev server
   mounts them elsewhere, set `window.APEX_DESIGN_BASE` to a RELATIVE path
   (e.g. `'static/design/'`) before the script tag — the override refuses
   anything carrying a protocol or `//`, so the overlay can never fetch
   off-origin.
2. Component roots should carry `data-component="<name>"` (and ideally
   `data-variant` / `data-effect` for their current state). Without marks
   the overlay falls back to matching class tokens against library names;
   without marks AND without a usable components.json, the tree and pickers
   say so honestly and offer nothing.

The overlay guards itself against double injection (`window.__apexDesignMode`)
and wraps its own startup in a try/catch — a broken overlay logs one warning
and the app runs on untouched.

## Honest v1 limits

- **Read-only + clipboard.** "Copy change" produces an instruction; nothing
  edits `tokens.json`, the manifest, or any source file. Real persistence
  needs a dev-server write endpoint the template cannot assume exists —
  out of scope for v1, documented in the file header too.
- **No hot-apply.** Choosing a variant does not restyle the live element
  (the overlay never mutates the app's DOM); the feedback loop is
  copy → apply → reload spines.
- **DOM-now analysis only.** The tree shows what is rendered at this moment;
  screens not currently mounted appear only in the manifest list.
- **The pickers require the spines.** This is a property of contract-built
  apps (design/studio-v2.md § Non-goals) — foreign codebases get Wave C/D
  machinery instead.

## The Apex-connected future (Waves C / F2+)

When the same app runs inside STUDIO's preview — or Apex detects its dev
server — the overlay gains the AI half: the co-designer argues about the
design system as a whole, the Surgeon handles what pickers can't, and picker
changes become ordinary file writes to the spines (an ordinary git diff).
One mental model: **pickers for taste, seats for structure.** Standalone
gives you the first; coming home to Apex adds the second.
