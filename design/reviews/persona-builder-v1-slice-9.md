# Persona Builder v1 — Slice 9 Review Record

Date: 2026-07-15

## Scope

Explicit permanent creation of a tested persona draft:

- exact draft revision and accepted canonical-hash gating;
- atomic same-parent staging and rename with ID-specific creation lock;
- no overwrite of an existing package;
- canonical, blueprint, optional collaboration, memory index, and scratchpad;
- Contract v1 validation with rollback of invalid output;
- permanent seat kickoff in foundation → canonical → memory → scratchpad →
  collaboration order;
- runtime provider/model/credentials kept outside the portable package;
- two-click user confirmation;
- grouped preset refresh with per-name collision reporting;
- honest partial success when the package exists but its preset was skipped.

## Delegate check

Nothing in this slice was delegated to resident Qwen. Package creation,
filesystem atomicity, irreversible user-visible registration, collision
ownership, revision/hash authority, and partial-success reporting form one
coupled correctness boundary. Splitting a mechanical fragment out would have
removed the context needed to judge data-loss and false-success paths, while
Qwen's prior Slice 8 persona-behavior draft required major replacement.

## Final local verification

- Persona extension gate: **49/49 PASS**.
- Persona Contract v1 gate: **20/20 PASS**.
- Repository JavaScript syntax: **55/55 PASS**.
- `git diff --check`: **PASS**.

Regression coverage includes reserved `Seat`, case-insensitive and foreign
preset collisions, preservation of valid sibling presets, exact tested-draft
gating, no-overwrite and invalid-package rollback, a post-preflight ownership
race, startup skip reporting, renderer partial-success wording, and accepted
manual canonical `display_name` divergence with no package side effect.

## Claude usage preflights

- Initial full review: five-hour 19%, seven-day 37%.
- First focused correction poll: HTTP 429. Keith had already authorized
  continuing from the recent healthy same-slice reading when an immediate
  follow-up poll throttled.
- Final focused correction review: five-hour 25%, seven-day 38%.

No credential value was printed or stored.

## Claude full review — NEEDS CHANGES

The first fresh-context, tool-disabled review found one material blocker: a
single reserved or foreign-owned preset name made grouped refresh
all-or-nothing. Startup swallowed the error, all Persona Builder presets could
disappear after refresh, and the UI incorrectly suggested a restart would fix
the collision.

Resolution:

- reject the built-in `Seat` name before package creation;
- expose a read-only ownership preflight;
- degrade grouped replacement per item and return registered/skipped names;
- retain every valid sibling preset;
- surface startup errors and skips;
- report package-created/preset-not-registered without promising a restart.

## Claude focused review 1 — NEEDS CHANGES

The first focused rereview found a second path through the same false-success
class. A manually edited and explicitly accepted canonical could change
`display_name` while preflight, uniqueness, and skipped-preset matching still
used the draft name.

Resolution:

- parse canonical frontmatter before acquiring a lock or writing anything;
- require canonical `display_name` to exactly match the validated draft name;
- use that verified name for generated package support files, the returned
  creation result, and post-sync skipped-preset matching;
- reproduce an accepted-hash divergence in a regression and prove no package
  directory is created.

## Claude focused review 2 — PASS

Fresh-context, tool-disabled Claude reviewed only the canonical-name correction
and fresh verification evidence:

> VERDICT: PASS
>
> BLOCKERS: none.

## Parked, non-blocking hardening

- Trim the draft name before the advisory preset preflight for consistency;
  the package boundary already validates and normalizes it.
- Remove one redundant canonical-name validation call.
- Add stale-lock recovery if hard process termination becomes an observed
  operational problem.
- Consider guarding the legacy one-at-a-time `registerPreset` API against
  foreign-owner overwrite; Persona Builder uses the collision-safe group API.

