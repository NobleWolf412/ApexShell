# Persona Builder v1 — Slice 4 Review Record

Date: 2026-07-15

## Scope

Crash-safe runtime drafts and the six-card guided interview:

- explicit persona name and one-sentence use-case starter;
- six detailed, provider-neutral interview cards;
- atomic revisioned JSON drafts under ignored extension state;
- workspace isolation, linked-store/file rejection, size/count limits;
- resume, save-before-navigation, and confirmed deletion;
- explicit revision-conflict recovery without silent overwrite;
- headless store, bus, copy-depth, and renderer-flow tests.

This slice does not render a blueprint/canonical, create a persona package,
register a seat, or write draft data into the portable workspace.

## Resident Qwen delegation

The visible phase check delegated only the six-card prose draft to resident
Qwen through `delegate.py`. Executable code, storage, UI state, authority, and
tests remained frontier-owned.

Outcome: **major edits / wash**, logged as Atrium offload row 20 and published
in commit `94fc008`.

Useful material retained:

- the card shape: question, expected-answer explanation, coverage prompts,
  thought-starters, complete example, and Help Me Decide;
- several identity-depth prompts.

Rejected or rewritten:

- a blanket requirement that every tool action receive approval, which erased
  `allowed` / `ask` / `blocked` category behavior;
- role boundaries that duplicated the shared foundation;
- examples that over-anthropomorphized or weakened role authority.

The final source was reviewed on its own merits; Qwen did not substitute for
the independent Claude gate.

## Final local verification

- Persona extension/interview gate: **24/24 PASS**.
- Persona contract gate: **20/20 PASS**.
- Repository JavaScript syntax: **50/50 PASS**.
- `git diff --check`: **PASS**.

## Claude usage preflight

The live Claude usage endpoint was current and comfortable before dispatch:

- session: 1% used;
- weekly all-model: 34% used;
- weekly scoped: 55% used.

No credential value was printed or stored.

## Independent Claude review — PASS

Fresh-context Claude received the approved interview/draft specification,
exact current sources, diff, and printed evidence in tool-disabled read-only
posture and returned:

> VERDICT: PASS
>
> BLOCKERS: None

Claude traced and confirmed:

1. drafts live only under `state/extensions/personas/drafts` and never write
   portable workspace content;
2. workspace identity is checked on list, open, save, and delete;
3. linked stores/files, invalid IDs, malformed/oversized drafts, stale revisions,
   and unconfirmed deletion are rejected;
4. same-directory temp files plus atomic rename protect draft updates;
5. Back, Next, and Drafts persist the current card before navigation;
6. a revision conflict preserves visible text and requires an explicit reopen
   before discarding the unsaved card;
7. the starter clearly separates a persona name from Card 1's deeper identity;
8. all six cards explain expected depth and include coverage, thought-starters,
   complete examples, and Help Me Decide;
9. Action and Tool Use does not grant capability and preserves posture plus
   per-category `allowed` / `ask` / `blocked` decisions;
10. all dynamic content uses text nodes, values, and created elements rather
    than interpolated HTML.

## Parked, non-blocking hardening

- Reject harmless unknown keys in a hand-edited draft's `answers` object.
- Make the impossible missing-card renderer branch return visibly to the draft
  list rather than writing an error into a hidden interview section.
- Extend renderer assertions across include lists, suggestion chips, and example
  copy; their common safe text-node path is already covered structurally.
- Consider a KEEP MY ANSWER conflict path matching the foundation editor; the
  current explicit reopen is safe and does not silently discard.

