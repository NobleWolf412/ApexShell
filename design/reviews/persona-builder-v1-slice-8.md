# Persona Builder v1 — Slice 8 Review Record

Date: 2026-07-15

## Scope

Disposable behavioral testing for an unregistered persona draft:

- persona-derived cases for introduction, normal work, disagreement,
  uncertainty, action posture, and optional collaboration handoff;
- expectations quoted from the approved blueprint and contracts rather than a
  generic engineer personality;
- current Claude usage shown before a separate explicit Start action;
- five-minute expiry for prepared usage approval;
- draft revision and canonical-hash gating before launch;
- hidden Claude session with no roster entry, history record, tools, or session
  persistence;
- isolated temporary working directory removed on exit;
- observed prompt/expectation/response transcript with human pass/revise
  marking;
- stop, error, provider-exit, duplicate-start, and application-dispose cleanup.

No portable package or permanent seat preset is written in this slice.

## Delegate check

The local Qwen received only bounded prompt ideation. It covered the requested
test labels but hard-coded six generic-engineer behaviors instead of evaluating
an unknown persona against its own blueprint. The result was graded
**major-edits / wash** in Atrium row 21. Frontier retained only the ambiguity
and handoff scaffolding and replaced every expectation with persona-derived
evidence.

## Final local verification

- Persona extension/test-seat gate: **44/44 PASS**.
- Persona contract gate: **20/20 PASS**.
- Repository JavaScript syntax: **54/54 PASS**.
- `git diff --check`: **PASS**.
- Provider wire event: `init.tools` is an empty array before the first test
  case; any missing/nonempty list blocks the run.
- Hidden session roster: zero entries.
- Post-run disposable transcript directories: zero.
- Post-run disposable temporary directories: zero.

## Live proof sequence

1. The first hidden-session proof returned correct boundary behavior and no
   roster entry, but inherited the repository working directory and mentioned
   Git state. This was treated as an isolation defect.
2. The service was changed to launch inside its own empty
   `apex-disposable-*` temporary directory. The repeated proof returned correct
   behavior with no workspace leakage and removed the scratch directory.
3. A hostile Read-canary probe proved the first join-safe attempt,
   `--tools=`, did **not** reliably remove the Read tool. That form was removed.
4. The Windows launcher now resolves native `claude.exe` and uses
   `shell:false`, preserving the documented `--tools` plus true empty argument.
   Legacy `.cmd`/`.bat` installs use a quoted-empty fallback.
5. The engine now exposes Claude's provider-reported init tool list and Persona
   Builder fails closed unless the list is present and empty. The final live
   wire proof returned `tools: []`, roster zero, and no residual transcript or
   scratch directory.

No canary value was disclosed.

## Claude usage preflights

Successful readings during the live/review sequence were:

- five-hour 11%, seven-day 36%;
- five-hour 15%, seven-day 36%;
- five-hour 16%, seven-day 36%.

Several immediate follow-up polls received HTTP 429. Keith had explicitly
authorized continuing from the recent healthy readings. No credential value
was printed or stored.

## Claude review round 1 — NEEDS CHANGES

Fresh-context, tool-disabled Claude received the complete Slice 8 design,
exact changed sources/diff, local evidence, and both initial live proofs. It
identified three blockers:

1. Windows shell argument joining could discard the empty `--tools` value;
2. a duplicate or stale Start message could terminate an unrelated running
   test;
3. prepared usage approval never expired.

Resolution:

- native Windows Claude launches bypass the shell and preserve an actual empty
  tools argument;
- provider init must report an empty tool list, and any tool/permission event
  aborts the test;
- only a handler's own partially started run can enter destructive failure
  cleanup; rejected duplicate messages leave the active run untouched;
- prepared usage approval expires after five minutes;
- renderer state keeps Stop visible when a request is rejected mid-run;
- regression coverage now includes duplicate start, expiry, tool, permission,
  nonempty provider tools, stop, and dead-seat paths.

## Claude focused re-review — PASS

After the corrections and provider-wire proof, fresh-context, tool-disabled
Claude reviewed the exact corrected sources/diff and evidence and returned:

> Verdict: **PASS**
>
> No safety, persistence, usage-authorization, correctness, or data-loss
> blocker remains.

The initial full review packet included all extension wiring, usage service,
and the new tester module. The focused packet intentionally contained only the
material correction surface.

## Parked, non-blocking hardening

- Reorder duplicate-start preconditions for a more specific “already running”
  message.
- Consider suppressing the normal Apex environment brief in disposable tests
  if it proves behaviorally distracting; its tool guidance is inert because
  provider tools must be empty.
- Live-probe the quoted-empty `.cmd` fallback if a machine without native
  `claude.exe` enters supported deployment scope.
- Sweep abandoned `apex-disposable-*` directories at startup after a hard
  machine/process termination.

