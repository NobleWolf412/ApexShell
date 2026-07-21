# INSTALL — the model-executable runbook

You are (most likely) an AI assistant asked to install this app on the
machine you run on. This file is the build; `floorplan.md` is the map you
read afterward, before you move any furniture; `connect/` holds one guide
per AI lane. Follow the steps in order, verify as you go, and report what
you connected and what you skipped.

## 0. What you are building

"Apex" — a standalone Electron window: tracker panes (top), dock tabs
(left), AI seats (right). After this install the human launches it and
lives in it; you remain its ongoing manager (adding panes, wiring lanes,
applying updates) whenever they ask.

## 1. Prerequisites — check before touching anything

- **Node.js ≥ 20** with npm (`node -v`). node-pty compiles a native module
  on install; on Windows the prebuilt binary normally lands without a
  toolchain. If `npm install` fails on node-pty, that machine needs the
  platform's C++ build tools — say so plainly rather than improvising.
- **git** (you presumably arrived via clone).
- **Platform honesty:** Windows 11 is the proven platform (ConPTY behaviors
  are hardened there). macOS/Linux are expected-to-work but unverified —
  if you are on one, proceed, but label everything you verify as
  first-time-on-this-platform.

## 2. Build the house

```
cd <repo>/            # the folder holding package.json
npm install
```

Two dependencies install (`electron`, `node-pty`). No build step exists.

## 3. First launch + smoke

Headless proof (exit 0 = window booted, zero renderer console errors):

- PowerShell: `$env:APEX_SMOKE='1'; npx electron .`
- POSIX: `APEX_SMOKE=1 npx electron .`

Then a real launch: `npx electron .` — the window opens maximized: tracker
bar on top showing the sample Demo Tracker, VIEWER/TERMINAL tabs left, a lone
`+` seat button right. Pull TERMINAL once and confirm a shell prompt appears
in the configured workspace. That is a healthy bare install.

On Windows, run `scripts/make-launcher.ps1` after `npm install`. It builds a
pinnable `Apex.exe` + desktop shortcut without bundling the live source.
Re-run it after any later `npm install` because npm replaces Electron's
distribution folder.

## 4. Set the workspace

Seats spawn in a working directory. Set it once in `seatconfig.json`
(top-level key, created if absent):

```json
{ "_workspace": "C:/Users/<user>/Projects" }
```

Unset, seats spawn at the user's home folder. Extensions may override this
(see floorplan.md § Extensions).

### seatconfig.json — full schema

The file is UI-written (the AI-bar defaults panel, the workspace picker) — you
rarely hand-edit it — but here is its whole shape:

```jsonc
{
  "_workspace": "C:/Users/you/scratch",        // bare default cwd for blank seats
  "_workspaces": [                              // the named-workspace picker
    { "name": "scratch",   "path": "C:/Users/you/scratch" },
    { "name": "my-app",    "path": "C:/Users/you/my-app" }
  ],
  "_default": { "model": "opus", "effort": "medium", "permissions": "manual" },
  "<Persona>": {                                // one block per persona/preset
    "default": { "model": "fable", "effort": "high", "permissions": "manual" },
    "current": { "model": "fable", "effort": "high", "permissions": "manual" },
    "tools": "Read,Glob,Grep,WebSearch,WebFetch,Write,Bash,TodoWrite",
    "disallowedTools": "mcp__serena__replace_symbol_body,mcp__serena__rename_symbol",
    "watch": true                               // auto-watch: live auditor on this persona's chain steps
  }
}
```

- **`current` vs `default`**: dials resolve `current` → `default` → `_default`
  → hard `manual`. "Set as default" copies resolved `current` into `default`;
  "reset" copies `default` back into `current`.
- **`model`**: `fable` | `opus` | `sonnet` | `haiku` (or `codex-sol|terra|luna`,
  `qwen`, `agy` for the alternate lanes). **`effort`**: `low|medium|high|xhigh|max`.
  **`permissions`**: `manual|auto|acceptEdits|dontAsk|bypassPermissions`.
- **`tools` / `disallowedTools`** (top-level per persona, optional): the
  read-only wall. `tools` is the CLI's built-in allowlist; `disallowedTools`
  is hard deny-rules and is the only lever that reaches MCP tools. Omit both
  for a full-toolset persona.
- **`watch`** (top-level per persona, optional): auto-watch. `true` = whenever
  a Task Board chain step launches this persona, the live auditor is flipped
  on for that seat automatically (and off again when the step wraps). Meant
  for implementer personas (Coder) so drift is caught mid-step without a
  full review hand-off; the manual 👁 toggle is unaffected.

## 5. Wire the AI lanes — one guide per lane, connect/

Check what exists on this machine and wire only that. Each guide states
the detection command, what the shell does with the lane, and the known
platform traps:

- `connect/claude.md` — Claude Code CLI (subscription). The main chat lane:
  full streamed seats with permission cards, usage bars, resume.
- `connect/codex.md` — OpenAI Codex CLI (ChatGPT subscription). Terminal
  seat + usage tracking.
- `connect/local.md` — a local model via Ollama (gpt-oss:20b). Offline chat +
  gated file tools.
- `connect/agy.md` — Antigravity/Gemini CLI. PTY-only; read the trap note
  before anything else.

A lane whose CLI is missing is simply skipped — the shell's empty states
point the human at these same guides later.

## 6. Trackers

Copy `main/monitors/panes.sample.json` → `main/monitors/panes.json` and
replace the demo pane with the human's real ones as they name them
(services, queues, feeds — anything pollable). The sample's `_readme`
documents the schema; `floorplan.md` § Monitors documents source modules.

## 7. Verify — the definition of installed

1. Smoke exits 0 (step 3).
2. One seat per connected lane opens and answers a hello (Claude lane: the
   permission card appears when the seat first touches a tool — Allow it
   and see the action land).
3. The tracker shows the human's first real pane (or the demo, if none yet).
4. The TERMINAL dock opens a shell, accepts a command, and NEW replaces it.
5. `Update & restart` (☰ menu) relaunches cleanly and restores open CLAUDE
   chats (the resumable lane). Terminal, local-model, and agy seats do not
   survive a restart by design — a toast names them honestly.

Report the result as a table: lane → connected/skipped/failed + why.

## 8. Ongoing management (you, later)

- **Updates:** `git pull`, then the window's code-changed badge / ☰ →
  Update & restart applies it seat-safely. Renderer-only changes need only
  Reload. The app watches its own source and badges honestly.
- **New panes/tabs/seats:** read `floorplan.md` first, then edit config or
  drop an extension folder — never patch shell core for a per-machine want.
- **State lives in `state/`** (gitignored): logs, chat history index,
  usage ledger, learned model windows. Deleting it is a factory reset of
  memory, not of function.
