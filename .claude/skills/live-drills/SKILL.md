---
name: live-drills
description: Run the REAL-spend proof drills (live-cast, live-chain, live-audit) safely — park the electron launcher stub first, read the right log, judge by the right pass line. Use after touching wrap/kickoff/memory plumbing, chain machinery, or the auditor; never guess-run npx electron.
---

# Live drills — the real-spend proofs

These spend actual Claude sessions. The hermetic suite (`npm test`) proves
wiring; these prove the LIVE loop. Run one only when a change touches what it
gates, and know the pass line before you start.

## The trap that costs a session: the launcher stub

`node_modules/electron/dist/resources/app` hijacks EVERY electron invocation
to main.js — `npx electron test/live-cast` boots the whole app instead of the
drill unless the stub is parked first. Always:

```bash
mv node_modules/electron/dist/resources/app node_modules/electron/dist/resources/app.parked
npx electron test/<drill>
mv node_modules/electron/dist/resources/app.parked node_modules/electron/dist/resources/app
```

Restore the stub even on failure (chain the mv after the run, not inside an
if). A second Apex instance fighting for the mobile port is handled (quiet
retry), but don't run drills while a chain is mid-flight in the real app.

## Which drill proves what

| Drill | Proves | Pass line (in its log) |
|---|---|---|
| `test/live-cast` | The full persona loop: 3-step Architect→Coder→Auditor chain on the REAL cast + dials, permission wall, packets, **memory wrap** | `state.md <persona>/<slug>: <hash> → <hash>  CHANGED` (or `absent → <hash>`) + `LIVE CAST: COMPLETE` |
| `test/live-chain` | A minimal 2-step haiku delegation chain | chain completes, packets parse |
| `test/live-audit` | The live auditor on a watched seat + risky transcript | findings arrive, contract validates |

## Reading the result

- live-cast logs to `%TEMP%\apex-livecast.log` (tail it live:
  `tail -F /c/Users/<user>/AppData/Local/Temp/apex-livecast.log`).
- The REPORT block prints per-step packets, permissions asked, and the
  state.md before/after hashes. `unchanged` on every state.md after a chain
  that did real work = the wrap discipline regressed — that is a FAIL even
  if the chain itself completed.
- The drill waits for wrap turns to settle before reporting; if it logs
  `wrap-wait backstop hit`, a wrap turn hung — check the seat transcripts in
  `~/.claude/projects/<repo-slug>/` (newest .jsonl files, find the
  `[seat-wrapup]` turn and read the reply after it).

## Cost

One live-cast ≈ 3 short seats + 3 wrap turns on the cast's configured dials.
Don't loop it; one green run is the proof.
