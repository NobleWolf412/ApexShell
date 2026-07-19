# Mobile Face — bones for ApexShell

*STATUS: **implemented in this repo** (`mobile/` + `main/mobile.js` + the
`bus.js` sink patch + `main.js` registration; boot-smoke + route probes green).
This doc remains the mechanism walkthrough — if you're merging into a fork
whose bus has drifted (e.g. a multi-window fan-out), the hooks below are the
contract to preserve; the code is the reference implementation.*

## The shape

The engine, bus, and file-truth state are already **face-agnostic**: seats run
on the desktop machine; a phone is just a *second face* rendering and driving
them. The whole feature is three parts, all additive:

1. **A bus tap** — secondary consumers of everything main posts to the window.
2. **One network lane** (`main/mobile.js`) — an HTTP server (static page +
   transcript replay) and a WebSocket bridge whose frames ARE bus messages,
   verbatim. ~190 lines including the trust wall.
3. **A phone-first page** (`mobile/` — 3 vanilla files, no framework): seat
   chips, chat with streaming, tool rows, permission cards, a checklist
   drawer, a new-seat drawer.

No SDK, no framework, one new dependency (`ws`).

## Hook 1 — the bus tap (`main/bus.js`)

```js
const sinks = [];
function post(type, payload, opts) {
  const msg = Object.assign({ type }, payload);
  if (target && !target.isDestroyed()) target.send('apex:msg', msg);
  if (!(opts && opts.windowOnly))
    for (const fn of sinks) { try { fn(msg); } catch { /* contained */ } }
}
function sink(fn) { sinks.push(fn); }
```

The window keeps receiving everything it always did. `windowOnly` exists for
exactly one message (the desktop echo, below). If your bus already broadcasts
to multiple windows, a sink is just a non-window subscriber on that same fan.

Inbound needs nothing: `bus.inject()` (the smoke-test affordance) already
routes a message through the exact path a renderer post takes. Phone frames
ride it after sanitizing.

## Hook 2 — the lane (`main/mobile.js`)

- **HTTP** serves `mobile/` statics (traversal-guarded: resolved path must
  stay inside the folder) plus `GET /api/replay/<sessionId>` → the engine's
  own `backfill()` from `engine/transcripts.js`. Replay over HTTP, **never**
  through the bus — a bus replay would re-emit the whole transcript into the
  desktop view and duplicate every message there. `backfill()` is a pure
  read; this is the trick that makes history free.
- **WebSocket** (`ws` package, riding the same HTTP server): outbound = a
  bus sink that forwards every post except the floods a phone never renders
  (`ptyData`). Inbound = JSON frames through a **strict whitelist, rebuilt
  field-by-field** — never forward a phone frame as-is:

  | type | sanitized to |
  |---|---|
  | `seatList` / `seatHistory` / `seatPresets` | bare request, no fields |
  | `todoGet`, `seatStop` | `{ id }` |
  | `seatSend` | `{ id, text }` — text only |
  | `seatPerm` | `{ id, requestId, allow, input, updates, choice }` |
  | `seatCreate` | `{ persona, title? }` — **persona seats only** |

  The rebuild is the security wall: a phone frame can never smuggle a PTY
  spawn (`terminal:`), a privileged launch config, or (if you carried the
  browser switch) a `chrome` grant. Consent-gated powers stay desktop-only.

## Hook 3 — the user-turn echo

The engine deliberately never echoes user turns ("the view renders its own
bubble at send time"), so two faces desync without a bridge at the lane:

- `bus.on('seatSend', m => wsBroadcast(userEvt(m)))` — fires for **both**
  origins (desktop IPC and phone inject both route through the bus), so
  phones render every user turn from this echo and **never draw their own
  bubble**. One rendering path, no doubles.
- On a phone-origin send only: `bus.post('seatEvt', userEvt, { windowOnly:
  true })` — the desktop sees the phone's turn live; `windowOnly` stops the
  sink from bouncing it back to the phone that already got the echo.

Register the echo handler *alongside* the engine's `seatSend` handler (the
multi-handler bus allows it); it sees the raw text before any first-turn
brief/env prepends, which is what you want rendered.

## The client (`mobile/`)

Per-seat append-only render logs; the DOM is a projection of the active
seat's log (rebuilt on switch, appended live). Streaming = accumulate
`delta` into a buffer div, finalize on `text`. Permission cards mirror the
desktop's answer shapes exactly (`seatPerm` with `input`, and for question
tools `input: { ...p.input, answers }`). Reconnect with exponential backoff;
on open, send `seatList` and let the normal responses rebuild the view.
Escape-first markdown — nothing unescaped ever reaches `innerHTML`.

## Access + trust (our household's answer — yours is yours)

We put the lane on a **Tailscale-only binding** and let tailnet membership be
the entire auth story. The mechanism, if you want it:

- Discover the machine's Tailscale IPv4 (the CGNAT range `100.64.0.0/10` —
  Tailscale is its only tenant on a typical box) and bind the server to that
  address **only**. Never `0.0.0.0`, never LAN, never loopback. No interface
  up → no server, retry on a timer. Defense-in-depth: also reject any peer
  whose remote address falls outside the range.
- Why we like it: zero exposed ports, zero auth code to get wrong, WireGuard
  encryption for free, and the phone works from anywhere.

If your remote-access story differs (LAN-only, a reverse proxy, real auth),
the lane doesn't care — `listen()` is the only line that changes. But bind to
*something* narrower than `0.0.0.0`: this socket can drive seats that hold a
shell on your machine. Treat the binding decision as the security decision.

## Gates that caught things

1. **Syntax + boot smoke** with the lane registered — a `require` typo dies
   here, not on the operator's first launch.
2. **The lane's own log line** (`face up at http://<ip>:<port>`) — proof it
   bound the right interface, not a bare exit code.
3. **A live HTTP probe of the page over that IP** during a smoke window —
   proves serve + binding + peer check in one request.
4. First live WS round-trip needs a real app restart if the app was already
   running old code — plan for it rather than wondering why the port is dead.

## Known v1 edges

- Codex-lane seats have no transcript under the Claude projects dir — they
  replay live-only unless you add a codex replay path.
- The checklist drawer is read-only; `todoUpdate` is wired server-side if you
  want phone check-offs.
- No images from the phone (`seatSend` is text-only by whitelist choice).
