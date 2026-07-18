# The Sweep v1 — post-build cleanup protocol

Status: standing protocol, not a one-shot. Run it as the FINAL slice of every
multi-slice build (App Builder slice 10, Consult slice 3, …) and as a
standalone pass whenever the repo feels heavier than its features.

## The principle

A feature is not done when it works. It is done when the repo reads as if
the feature had always been there — no scar tissue, no scaffolding left in
the walls, no map describing last month's building. This repo already has
the law's spirit ("a stale map is worse than none"); the Sweep is its
enforcement arm.

Corollary: **git history is the archive; the working tree is the present.**
Nothing lives in the tree "for reference" — that is what `git log` is for.
The one sanctioned graveyard is `design/reviews/` (explicitly archival, has
its own README saying so) and `personas/.archive/` in user workspaces.

## Residue classes — what AI-built waves actually leave behind

1. **Dead code** — functions/exports nothing calls; bus verbs registered
   with no poster, or posted with no listener; CSS selectors matching no
   DOM; event types emitted that no one consumes; feature-flag branches
   whose flag can never be set.
2. **Dead ends** — seams built for a plan that changed mid-wave (a
   registered hook nothing uses yet and nothing on the roadmap will), TODO
   comments that became lies, half-generalized helpers with one caller.
3. **Extra files** — mockups after the real UI shipped, scratch scripts,
   fixtures for drills that were rewritten, `.tmp`/`.bak`/screenshot
   leftovers, empty directories.
4. **Stale docs** — floorplan drift (a file's one-line job description no
   longer true), spec status lines still saying "proposed" after
   implementation, prompts files for finished builds, INSTALL/README
   describing removed behavior, help-overlay text (`index.html`) and
   tooltips that predate a UI change, CHANGELOG gaps.
5. **Stale state & config** — `state/extensions/<name>/` for extensions that
   changed shape, seatconfig keys nothing reads anymore, sample files that
   no longer match the schema they document.
6. **Dependency residue** — anything in package.json that stopped earning
   its place (this repo treats every dep as a deliberate, argued step — the
   Sweep re-argues them).

## Detection — mechanical first, judgment second

Run the mechanical passes and let them produce the suspect list; apply
judgment only to the suspects. Never sweep by vibes.

- **Bus symmetry.** Every `bus.on('X')` in main must have a `post('X')`
  (or documented external source) somewhere in renderer/extensions, and
  every renderer `post('X')` a main-side listener; same in reverse for
  pushes. Grep both directions, diff the sets. Orphans are dead verbs.
  (Precedent: seatPtyInput was claimed but unregistered and every keystroke
  died silently — symmetry checking catches both directions of that bug.)
- **Export/require graph.** serena's symbol tools + the graphify output
  (where `graphify-out/` exists) for unreferenced exports and orphan
  modules. A module no path reaches from `main.js`, `index.html`, an
  extension manifest, or a test is a suspect.
- **CSS audit.** For each selector in `renderer/styles/*` and extension
  styles, confirm a matching class/id in a `.html` or a string in a `.js`.
  No match → suspect (beware runtime-composed class names — judgment step).
- **File inventory.** `git ls-files` against: referenced-from-code,
  referenced-from-docs, test fixtures actually loaded by a drill. The
  unreferenced remainder is the extra-files suspect list.
- **Doc truth pass.** Read floorplan.md entry-by-entry against the tree
  (both directions: files with no entry, entries with no file, entries
  whose one-liner is now wrong). Read every `design/*.md` status line
  against reality. Specs reference each other (a shared seam, a pattern one
  spec borrows from another) — check those cross-references too: when an
  implementation diverged from its spec, every spec that cited the old shape
  drifted with it. Read the ? overlay and every tooltip touched by the wave.
- **Config pass.** For each key in seatconfig.json / theme / panes sample
  files: find its reader. Sample files must round-trip against the current
  parser.
- **Dep pass.** For each package.json entry, name the file(s) requiring it.

No new npm tooling for any of this — grep, node one-liners, serena, and
graphify cover it. A cleanup pass that adds a dependency has failed.

## Disposal rules

- **Delete, don't comment out.** Commented corpses are the worst residue.
- **Dead but planned?** Then it is not dead — but the plan must exist in a
  design doc the code comments point at. "Might need it later" without a
  doc reference = delete (git remembers).
- **Mockups & prompts files:** delete once implementation ships; their spec
  gains one line ("mockup/prompts removed after implementation, see git
  history"). Specs themselves are permanent, but their status line must be
  a true statement from a closed vocabulary: `proposed` (still intended),
  `implemented` (with divergence notes, exactly as persona-builder-v1.md
  did), `parked` (consciously shelved — one line says why), or `superseded`
  (with a pointer to what replaced it). A spec that sits `proposed` across
  two sweeps with no work started is drift — flip it to `parked` honestly
  or re-argue it.
- **Every deletion is argued in the commit message** — what it was, why it
  is dead, what proves nothing references it.
- **Keep-with-reason:** a suspect that survives gets a why-comment at the
  site (this repo comments the why), so the next Sweep doesn't re-litigate.

## The procedure (one seat, one session)

1. Scope: name the wave being swept (or "full repo"). List the files it
   touched (`git log --stat` over the wave's commits).
2. Run every mechanical pass above; print the suspect lists verbatim.
3. Adjudicate each suspect: DELETE / KEEP (with reason comment) / FIX
   (doc drift, config sample). No third pile, no "later".
4. Apply. Deletions and doc fixes in coherent commits, argued.
5. Gates: `npm test` whole, `APEX_SMOKE=1` exit 0; `npm run test:live` if
   anything near the engine moved. The suite passing WHOLE after deletions
   is the proof they were actually dead.
6. Final evidence: the counts (suspects found / deleted / kept-with-reason /
   docs fixed), and a one-line confession of anything deliberately left.

## Ready-to-paste sweep prompt

```
Read design/sweep-v1.md and follow it exactly. Scope: the <WAVE NAME> wave
(commits <RANGE>). Run every mechanical detection pass and print the suspect
lists verbatim before touching anything. Adjudicate each suspect
DELETE/KEEP/FIX per the disposal rules — commented-out code is never an
outcome, and every KEEP gets a why-comment at the site. Delete the wave's
mockups/prompts files if their feature has shipped, flipping the spec status
line. Fix every floorplan/doc drift you find, including tooltips and the ?
overlay. Argue every deletion in its commit message. Done means: npm test
passes WHOLE after all deletions, APEX_SMOKE=1 exits 0, and your final
message reports the counts (found/deleted/kept/fixed) plus anything
deliberately left and why. If a suspect's deadness is uncertain, KEEP with
a comment and flag it — never guess-delete.
```

## Cadence

- Tail slice of every multi-slice build (the wave sweep — small, focused).
- Full-repo sweep when the suspect lists from wave sweeps start finding
  pre-wave residue, or roughly per release version — whichever bites first.
- The Sweep never runs concurrently with feature slices: clean water, then
  new construction.
