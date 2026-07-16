# Persona Builder v1 — Slice 2 Review Record

Date: 2026-07-15

## Scope

Additive workspace onboarding for the Persona Builder:

- generic per-extension ignored runtime state directory;
- explicit native directory-picker service;
- Persona Builder extension manifest and main/renderer halves;
- atomic workspace-setting persistence under shell runtime state;
- read-only selected-workspace status;
- first-run PERSONAS dock;
- headless service, main-flow, and renderer-flow gate.

This slice does not create `foundation.md`, `personas/`, persona packages, or
wiki content in the selected workspace.

## Local verification

- Persona extension gate: **11/11 PASS**.
- Persona contract gate: **20/20 PASS**.
- Repository JavaScript syntax: **47/47 PASS**.
- `git diff --check`: **PASS**.

No second Apex window was opened. Renderer registration, status rendering,
and choose-message behavior were exercised with a deterministic headless DOM
fixture.

## Claude usage preflights

The live Claude usage endpoint was checked before each dispatch. Both readings
were current and comfortable:

- session: 7% used;
- weekly all-model: 34% used;
- weekly scoped: 55% used.

The first dispatch exceeded its local 60-second process allowance before a
verdict. Its single identifiable orphaned review process was terminated without
touching other Claude seats. The second dispatch received a fresh preflight,
used a tool-disabled exact packet, and completed normally. No credential value
was printed or stored.

## Independent Claude review — PASS

Fresh-context Claude received the full design contract, exact current sources,
tracked diff, and printed local evidence. The review was read-only and returned:

> VERDICT: PASS
>
> BLOCKERS: None

Claude traced and confirmed:

1. extension failure isolation still encloses state-path setup, module loading,
   and registration;
2. state directories cannot escape the ignored per-extension root;
3. the Electron picker remains lazy and cancellation is non-mutating;
4. only `state/extensions/personas/workspace.json` is written, atomically;
5. the selected workspace is inspected read-only;
6. malformed config, picker errors, and cancellation all recover visibly;
7. bus request/status flow always re-enables the renderer control;
8. dynamic renderer values use `textContent`, preserving the shell CSP.

## Parked, non-blocking hardening

- Count only contract-valid package directories once package validation is
  connected; the current onboarding count is directory-based.
- Align folder-picker copy with the native create-folder affordance.
- Extend edge coverage for relative state roots, non-directory selections,
  reselection overwrite, and the renderer's unavailable/error branches.
- Empty per-extension state directories are currently created eagerly for
  main-side extensions; harmless, but lazy creation can be reconsidered if the
  extension surface grows.

