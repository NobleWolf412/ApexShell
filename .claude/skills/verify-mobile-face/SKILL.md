---
name: verify-mobile-face
description: Gate any change to the mobile face (main/mobile.js, main/bus.js sinks, mobile/ client) — smoke-boot on a side port, probe both bindings and the security guards, prove a WS round-trip through the real whitelist. Run before claiming a phone-face change done.
---

# Verify the mobile face

The phone lane has no drill in the hermetic suite — its gates are live
probes. All of them run against a smoke boot on a SIDE port so they never
fight the real app's 8890.

## 1. Syntax first (a require typo should die here)

```bash
node --check main/mobile.js && node --check main/bus.js && node --check mobile/app.js
```

## 2. Smoke boot + HTTP probes (one command)

```bash
APEX_SMOKE=1 APEX_MOBILE_PORT=8899 npx electron . > /dev/null 2>&1 & sleep 6
curl -s -o /dev/null -w "tailnet page: %{http_code}\n"  --max-time 3 http://<tailscale-ip>:8899/
curl -s -o /dev/null -w "loopback twin: %{http_code}\n" --max-time 3 http://127.0.0.1:8899/
curl -s -o /dev/null -w "manifest: %{http_code}\n"      --max-time 3 http://<tailscale-ip>:8899/manifest.json
curl -s -o /dev/null -w "traversal: %{http_code}\n"     --max-time 3 "http://<tailscale-ip>:8899/../main/seats.js"
curl -s -o /dev/null -w "artifact leak: %{http_code}\n" --max-time 3 "http://<tailscale-ip>:8899/api/artifact?p=C:/Windows/win.ini"
wait; echo "SMOKE EXIT: $?"
```

Get `<tailscale-ip>` from `node -e "console.log(require('./main/mobile.js').tailscaleIp())"`.

PASS: page 200 on BOTH bindings, manifest 200, traversal NOT 200 (403/404 —
curl may normalize `../` before sending; either code means nothing leaked),
artifact leak 403, smoke exit 0. Also check the lane's own log line —
`state/logs/mobile-<date>.log` must say `face up at http://<ts-ip>:8899` (the
right interface, not a bare exit code).

## 3. WS round-trip through the real whitelist

```js
// scratch script; require ws by absolute path so it resolves outside the repo
const WebSocket = require('<repo>/node_modules/ws');
const ws = new WebSocket('ws://127.0.0.1:8899');
ws.on('open', () => ws.send(JSON.stringify({ type: 'taskList' })));
ws.on('message', (raw) => { const m = JSON.parse(raw);
  if (m.type === 'taskList') { console.log('WS OK, tasks:', (m.tasks||[]).length); process.exit(0); } });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 8000);
```

Run it DURING the smoke window (launch smoke in background, probe, then wait).

## Rules of the lane (check the diff against these)

- Inbound frames are REBUILT field-by-field in `INBOUND` — never forward a
  phone frame as-is. New verb = new sanitizer, narrowest possible fields.
- No launch configs, PTY spawns, or consent-gated grants from a phone, ever.
- The running app serves client files (`mobile/`) fresh per request — client
  edits need only a phone reload; `main/mobile.js`/`bus.js` edits need
  Update & restart before the whitelist change is live.
