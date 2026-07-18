# Browser Switch — bones for ApexShell

*Reference for carrying the per-seat "drive my browser" toggle into ApexShell.
Written from the Dashboard build (Apex household), genericized for the public
shell. This is a mechanism spec, not a patch — Dashboard's `claudeSeat.js` and
ApexShell's have drifted (ApexShell already has the cleaner `buildArgs()`
split), so mimic the hooks below rather than applying a diff.*

## What it is (and isn't)

- **Not a browser extension**, and not an Apex extension-folder plugin. It's a
  small feature woven into the **core seat engine + composer**.
- It rides **Claude Code's own `--chrome` / `--no-chrome` flags** (Claude Code
  ≥ 2.0.73). Those talk to the **official Claude browser extension**
  (≥ 1.0.36) through a **native-messaging host** the CLI registers under
  `HKCU\Software\Google\Chrome\NativeMessagingHosts`. Chromium browsers
  (Chrome, Brave, Edge) read that key, so a Brave install pairs fine.
- So the shell's job is only: **let the operator turn the flag on for one
  seat, safely.** The CLI + extension do the actual browser driving.

## Prereqs to verify on a target machine

1. Claude Code ≥ 2.0.73 (`claude --help` lists `--chrome` / `--no-chrome`).
2. The official Claude browser extension installed in the operator's browser.
3. Native host `com.anthropic.claude_code_browser_extension` registered.
4. First-run pairing: a `--chrome` seat triggers a one-time approval prompt
   inside the browser. Smoke-test it before shipping the toggle.

## The four hook points

### 1. CLI layer — push the flag (`main/engine/claudeSeat.js`)
In `buildArgs()`, take a `chrome` boolean and, right after the
`--permission-mode` push, add it **always-explicit** (same discipline as the
permission mode):

```js
args.push(chrome ? '--chrome' : '--no-chrome');
```

`--no-chrome` is the safe floor: every seat that doesn't ask for it says so out
loud. Thread `chrome` through `startSeat(...)` → `buildArgs({ ..., chrome })`.

### 2. Engine truth (`main/engine/seatHost.js`)
The grant is **host-owned state**, like `mode`/`model`/`effort`:
- On seat create: `entry.chrome = !!(opts.launch && opts.launch.chrome) && !opts.homelab;`
- Surface it on every projection the view reads: `seatNew`, `list()`, and the
  post-reload `reannounce()` — add `chrome: entry.chrome` / `chrome: e.chrome`.
  This is what lets the toggle survive a window reload.

### 3. Enforcement choke point (`main/seats.js`) — the important one
All the safety lives in **one place**, fail-closed. Two paths set it:

- **Fresh seat (`seatCreate`)**, right after building `launch`:
  ```js
  launch.chrome = Boolean(msg.launch && msg.launch.chrome === true && !isAutoSpawned);
  ```
- **Relaunch (`seatRelaunch`)** — a live toggle restarts the seat (see UI). An
  explicit flag in the message wins; otherwise **preserve** the current grant
  so an unrelated restart (effort/permissions change) doesn't silently drop it:
  ```js
  const wantChrome = msg.chrome != null ? (msg.chrome === true) : entry.chrome;
  launch.chrome = Boolean(wantChrome && !isAutoSpawned);
  ```

`isAutoSpawned` = any seat the operator didn't personally launch: background/
scheduled/kick seats, an always-on watch seat, seats spawned by other seats.
The rule: **a literal `true` only, and never for auto-spawned machinery.**

### 4. UI — a live per-seat toggle (`renderer/chatView.js`)
Put a small button in the composer's dial row (beside model/effort/perms), not
in the launch menu — browser control is a mid-session decision:

- Reflect `entry.chrome` (received on `seatNew`) as on/off styling.
- On click: an **in-app confirm** (never the OS `window.confirm` — it looks
  foreign), then `seatRelaunch({ id, chrome: !current })`. The seat restarts
  and resumes its session (history carries via the resume backfill), now with
  the flag flipped. Guard: skip while the seat is mid-turn or has no session
  yet; hide the toggle entirely on an auto-spawned watch seat.

## Consent model (the reason for the choke point)

Portable rules any operator-facing shell should keep:

1. **Default OFF.** Every seat starts `--no-chrome`. Enabling is a deliberate,
   per-seat operator action with a warning.
2. **Auto-spawned machinery never gets it.** Background/scheduled/kick seats
   spawn the CLI outside the interactive path; keep them fail-closed.
3. **Grants die with the run.** The flag lives on the seat process — closing
   the seat or restarting the app drops it. It survives a same-run relaunch
   (the operator restarting to change a dial) but never an app restart or a
   fresh resume-from-history.
4. **Grants flow down, never originate down.** A seat can pass browser access
   to a child only if it was launched with it; spawned/restored seats start
   from zero. No standing/global allowlist entry — `--no-chrome` is the floor.
5. **Interactive stays supervised.** Normal permission prompts remain; the
   extension's visible-action indicator + per-site permissions are the browser
   backstops.

## In-app confirm (bonus, same build)

The native `window.confirm` looks out of place. A tiny promise-based modal
(`ApexConfirm({ title, body, confirmLabel, danger })` in `renderer/bus.js`,
styled in `base.css`) replaces it and is reusable for any high-stakes restart
(e.g. switching a seat into bypass-permissions). Esc/backdrop = cancel, Enter =
confirm, body rendered as `textContent` with `white-space: pre-wrap` (no HTML
injection).

## Acceptance to re-run on the ApexShell side

1. Pairing smoke test: a `--chrome` seat drives one page, reports it.
2. Wire log shows `--no-chrome` on a default seat, `--chrome` on a toggled one.
3. An auto-spawned/background seat provably cannot get the flag.
4. Toggle → confirm → restart round-trips and the grant reflects correctly
   after a window reload.

*— Mox (Apex), for Matt's ApexShell port.*
