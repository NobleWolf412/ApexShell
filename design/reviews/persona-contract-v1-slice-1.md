# Persona Contract v1 — Slice 1 Review Record

Date: 2026-07-15

## Scope

Isolated, read-only Persona Contract v1 library:

- safe persona IDs;
- workspace-contained paths with real-path checks;
- frontmatter parsing;
- canonical hashing;
- native and legacy-import package validation;
- portable/runtime data separation;
- optional collaboration-contract validation;
- deterministic headless tests.

No extension manifest or runtime registration exists in this slice, so Apex
Shell does not load the new library yet.

## Local verification

- Persona contract gate: **20/20 PASS**.
- Repository JavaScript syntax: **43/43 PASS**.
- `git diff --check`: **PASS**.

## Claude usage preflights

Before every review dispatch, the live Claude usage endpoint was checked. All
three readings were current and comfortable:

- session: 6% used;
- weekly all-model: 34% used;
- weekly scoped: 55% used.

No credential value was printed or stored in the review record.

## Review rounds

### Round 1 — CHANGES REQUIRED

Accepted findings:

1. Import mode could warn for a missing `name` and then immediately hard-fail
   the same absence through the unconditional mismatch check.
2. The specified read-only-collaboration versus routine-write warning was not
   implemented.
3. Raw CRLF/LF differences could produce false canonical-drift warnings.

Resolution:

- missing legacy names now warn during import; present mismatches remain errors;
- action categories use `allowed` / `ask` / `blocked`, and explicitly allowed
  write-class actions conflict visibly with read-only collaboration;
- canonical hashing normalizes line endings;
- regressions added.

Adjudicated rejection: an explicitly unsupported schema version remains a
deterministic error during import. Interpreting an unknown schema as legacy
would be unsafe.

### Round 2 — CHANGES REQUIRED

Accepted finding: the implementation correctly blocked a present mismatched
name, but the claimed regression test did not exist. The review also noted that
the adjudicated unsupported-schema behavior lacked direct evidence and that
numeric coercion allowed Boolean `true` to masquerade as schema version `1`.

Resolution:

- added the exact present-name-mismatch import regression;
- added the explicit unsupported-schema import regression;
- changed schema checks to strict numeric equality;
- added the Boolean-schema regression.

### Round 3 — PASS

Fresh-context Claude traced all corrected branches and the twenty test gates,
confirmed the library performs no writes, and returned:

> BLOCKERS: None found. VERDICT: PASS.

## Parked, non-blocking hardening

- End-to-end symlink-escape fixture where the platform permits reliable symlink
  creation; the implementation already performs real-path containment checks.
- Writer collision, atomic package creation, and crash/restart draft recovery
  belong to their later implementation slices.
- Heuristic suggestions belong to the later semantic-review layer; this library
  intentionally implements deterministic findings only.
