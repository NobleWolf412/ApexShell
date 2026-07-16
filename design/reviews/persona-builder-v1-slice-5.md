# Persona Builder v1 — Slice 5 Review Record

Date: 2026-07-15

## Scope

Deterministic blueprint and canonical preview:

- safe persona ID suggestion and explicit editable ID;
- explicit action posture and eight `allowed` / `ask` / `blocked` decisions;
- deterministic six-area `blueprint.json` projection;
- canonical Markdown with YAML-safe metadata and marked body sections;
- generated canonical hash binding;
- persisted manual canonical edits and visible drift;
- full-regeneration confirmation for manual or stale work;
- targeted section regeneration that preserves other edits;
- explicit Restore Saved behavior for unsaved canonical text.

Preview state remains in the ignored runtime draft store. No portable persona
package or seat is created in this slice.

## Final local verification

- Persona extension/preview gate: **31/31 PASS**.
- Persona contract gate: **20/20 PASS**.
- Repository JavaScript syntax: **51/51 PASS**.
- `git diff --check`: **PASS**.
- Generated full package fixture: **valid, zero warnings** under Contract v1.

## Claude usage preflight

The live Claude usage endpoint was current and comfortable before dispatch:

- session: 2% used;
- weekly all-model: 34% used;
- weekly scoped: 55% used.

No credential value was printed or stored.

## Independent Claude review — PASS

Fresh-context Claude received the approved authority/hash rules, exact current
sources, diff, and printed evidence in tool-disabled read-only posture and
returned:

> VERDICT: PASS
>
> BLOCKERS: None

Claude traced and confirmed:

1. preview mutations write only ignored runtime draft state;
2. normalized IDs remain safe and are revalidated before rendering;
3. the blueprint contains all six areas, explicit posture/actions, no runtime
   fields, and the generated canonical hash;
4. free-text Action and Tool Use prose is never parsed into permissions;
5. the canonical has complete Markdown body sections outside frontmatter and
   enables no optional modules;
6. manual canonical edits retain the generated baseline hash and visibly drift;
7. omitting only the final newline does not produce false drift;
8. full regeneration requires a second explicit confirmation when manual edits
   or newer interview work would be replaced;
9. targeted regeneration replaces only one marked section and fails closed if
   markers are missing;
10. unsaved canonical text blocks navigation/regeneration until saved or
    explicitly restored;
11. preview tampering, workspace mismatch, and stale draft revisions are
    rejected before persistence;
12. dynamic blueprint/canonical content reaches only text/value sinks.

## Parked, non-blocking hardening

- Normalize or directly test internal newline/tab characters in the one-sentence
  use-case field; JSON-quoted YAML currently round-trips through the contract
  parser, while persona names are already strictly single-line.
- Treat extra trailing blank lines as either normalized or deliberately semantic;
  the current renderer counts them as a real manual edit.
- Guard unsaved canonical text before any future unsolicited/background preview
  refresh; current preview statuses are all user-initiated.
- The tool packet rendered some Unicode as mojibake; on-disk source uses the
  intended punctuation and the repository syntax/diff gates are clean.

