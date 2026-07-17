# ApexShell — project rules for AI seats

Apex is a standalone **Electron dashboard** for driving AI coding seats: Claude,
Codex, and local (Ollama) lanes, plus personas, a TODO/workflow board, live
trackers, and a working-view. This file is deliberately small — a map, not the
territory. Page into the referenced docs on demand.

## Where things live (read these when relevant, not up front)

- **[floorplan.md](floorplan.md)** — the architecture map: every file's job, the
  extension contribution points, how each seat lane works, and the doc map. Read
  it before moving furniture.
- **[INSTALL.md](INSTALL.md)** — fresh-machine setup + the full `seatconfig.json`
  schema (dials, workspaces, the per-persona tool wall).
- **[connect/](connect)** — one wire-verified guide per lane: `claude.md`,
  `codex.md`, `local.md` (Ollama), `agy.md`.
- **[CHANGELOG.md](CHANGELOG.md)** — what shipped, by version.

## The three laws (full text in floorplan.md § The three laws)

1. **Engine is Electron-free.** `main/engine/` is plain Node, harness-provable
   (`test/engine-harness.js`). Zero Electron imports there, ever.
2. **One door.** The renderer talks to main ONLY through `preload.js` (the typed
   bus). Strict CSP, no node integration.
3. **Vendor-shaped things are extensions.** Core runs with an empty
   `extensions/`. Personas, trees, and services plug in; they aren't baked in.

## Verify before you claim done (non-negotiable)

- Any main/renderer logic change → **`npm test`** (the hermetic drill suite —
  taskboard, audit, skills, persona ×5, linkify; zero LLM spend). Must pass whole.
- Engine or lane change → **`npm run test:live`**.
- Window/renderer change → `APEX_SMOKE=1` smoke (exit 0 = no renderer errors).
- **Renderer edits apply on Reload; main / preload / extension-main edits need
  Update & restart.** Say which when you ship.

## Conventions

- Write code that reads like the code around it — match its idioms, naming, and
  comment density. This repo comments the *why* (constraints the code can't show).
- Prefer symbol-level navigation (serena) and the dependency graph (graphify,
  where `graphify-out/` exists) over guess-and-grep.
- New npm dependencies are a deliberate, argued step — not a default.
