# Persona Builder v1 — Build Specification

Status: implemented (workspace/foundation/interview/preview/validation/
disposable test/permanent creation/import all live in `extensions/personas/`),
plus one post-v1 addition this spec did not cover: **relationship
recommendations** (`lib/relationships.js`) — on the collaboration step the
builder suggests who the new persona should work with (heuristic role
pairings, optional disposable-seat AI pass tailored by an optional
workspace `project-context.md`); accepted suggestions fill accepts/emits and
suggested routes save as Task Board templates (`taskRouteSave`). The "later
workflow layer" this spec deferred now exists: `main/tasks.js` +
`renderer/taskBoard.js` (see floorplan.md § The workflow layer).

## Outcome

Apex Shell ships a portable persona template and a guided builder. The user
creates their own cast. No Apex persona (Mox, Jinx, Iris, Clio, Drafty, Sable,
Doc, or any successor) ships with the product.

The builder creates identities. Runtime/provider configuration seats those
identities. The workflow layer (`main/tasks.js`) coordinates teams. A later
wiki extension provides intake, compilation, query, and analysis. These remain
cleanly separated.

## Non-goals for v1

- Ship or clone the Apex cast.
- Bind a persona identity to Claude, Gemini, Codex, or any model vendor.
- Automate coder/reviewer routing.
- Build the wiki extension.
- Rewrite imported personas automatically.
- Duplicate shared foundation rules into every canonical.

## Portable workspace

The user chooses the persona-workspace location during Workspace Setup. The
choice is stored in Apex Shell runtime configuration; the workspace itself is
portable and may be Git-tracked independently.

```text
<persona-workspace>/
├── foundation.md
└── personas/
    └── <persona-id>/
        ├── <persona-id>.md
        ├── blueprint.json
        ├── collaboration.json       optional
        ├── memory/
        │   └── MEMORY.md
        ├── scratchpad.md
        └── assets/                  optional
```

## Authority

- `<persona-id>.md` is the authoritative identity. It remains readable,
  editable, and usable without the builder.
- `blueprint.json` is the approved interview snapshot and builder provenance.
  It never overrides the canonical.
- `collaboration.json` is the optional machine-readable handoff contract.
- `foundation.md` carries shared house rules once for the whole workspace.
- Provider, model, credentials, executable path, working directory, usage
  state, and live permissions remain outside the portable package.

`blueprint.json` records a hash of the canonical it produced. If the canonical
changes outside the builder, reopening the persona produces a review prompt.
The builder never regenerates over the changed canonical silently.

## Shared foundation

`foundation.md` contains only transferable house rules:

- The user alone creates or permanently changes a persona.
- Load the canonical, memory index, and scratchpad when seated.
- State uncertainty honestly and verify checkable claims.
- Explain actions and their state changes.
- Protect secrets and sensitive information.
- Ask before destructive or externally visible actions.
- Keep provider/model binding outside identity.
- Preserve independent contexts during peer review.
- Send structured evidence packets, not entire conversations, across handoffs.
- Generated identity prose is a draft until the user accepts it.

The Apex root instructionset is not distributed. It contains operator history,
the Apex cast, Homelab rules, wiki ownership, and infrastructure policy that do
not belong in another user's system.

## Canonical frontmatter

Required portable fields:

```yaml
schema_version: 1
name: persona-id
display_name: Display Name
description: One-sentence purpose of the persona.
```

Optional portable fields:

```yaml
aliases: []
modules: []
```

Existing Apex fields such as `tier`, `class`, `delegates`, and `enabled` are
accepted compatibility extensions. They are not required of a portable persona.

## Default canonical template

```markdown
---
schema_version: 1
name: persona-id
display_name: Display Name
description: One-sentence purpose of the persona.
aliases: []
modules: []
---

# Display Name

## Identity and Background

<!-- Who this persona is: background, stable traits, values, perspective,
     and relationship to the user or team. A name alone is insufficient. -->

## Role and Mission

<!-- Work owned, expected deliverables, definition of success, exclusions,
     and when another role should take over. -->

## Communication Style

<!-- Tone, detail level, formatting, jargon, disagreement style, decision
     framing, and habits to avoid. -->

## Persona-Specific Boundaries

<!-- Limits and approval rules unique to this persona. Do not repeat the
     shared foundation. -->

## Working Method

<!-- How work begins, priorities, verification, debugging, testing,
     documentation, uncertainty handling, and definition of done. -->

## Action and Tool Use

<!-- Advisor / assisted operator / operator / automated worker posture;
     allowed action categories and actions that always require approval. -->

## Optional Role Modules

<!-- Add only modules selected in the approved blueprint: Collaboration and
     Handoffs, Role-Specific Methods, Peer Relationships, Visual Identity,
     or a user-defined module. Role-shaped headings are allowed. -->
```

The six semantic areas are required; their final headings may be renamed to fit
the role. The builder validates semantic coverage from the blueprint mapping,
not from exact heading text.

## Guided interview

Each card contains a plain-language question, an explanation of the expected
depth, suggested choices, a complete example, free text, and **Help me decide**.

1. **Identity and background** — name, nickname, pronouns if relevant,
   professional or fictional background, stable traits, values, perspective,
   and relationship to the user/team.
2. **Role and mission** — responsibilities, problems handled, artifacts,
   trusted decisions, success, exclusions, and handoff triggers.
3. **Communication style** — tone, length, structure, jargon, disagreement,
   recommendation strength, decision requests, and habits to avoid.
4. **Boundaries and approval rules** — prohibited actions, explicit approval
   gates, sensitive information, escalation, and pre-approved routines.
5. **Working method** — starting move, priorities, verification, debugging,
   testing, documentation, uncertainty, recovery, and completion.
6. **Action and tool use** — operating posture plus read/edit/command/web/
   connector/external-action categories. This describes behavior when a tool
   exists; it does not grant a tool or credential.

Action posture choices:

- `advisor`
- `assisted-operator`
- `operator`
- `automated-worker`

## Builder state machine

1. **Workspace Setup** — choose workspace; review/create shared foundation.
2. **Start** — name, one-sentence use case, new or imported persona.
3. **Interview** — six cards, one at a time; Back, Save draft, Skip for now,
   Help me decide; crash-safe automatic draft persistence.
4. **Blueprint Review** — show structured answers; highlight missing or
   contradictory decisions before prose generation.
5. **Canonical Draft** — render only approved answers. Missing areas remain
   visibly incomplete; the model may clarify prose but not invent identity.
6. **Validate** — deterministic checks plus advisory semantic review.
7. **Test Seat** — disposable seat exercises introduction, normal work,
   disagreement, uncertainty, boundary behavior, action posture, and optional
   team handoff. It is not registered permanently.
8. **Targeted Revision** — change an answer or selected section; regenerate
   only affected prose. Manual canonical editing remains available.
9. **Create Persona** — explicit user action writes the package atomically and
   registers the permanent seat preset.

Until Create Persona, all state is a draft. The AI writes canonical prose; the
user authors and approves identity.

## Blueprint shape

`blueprint.json` preserves sub-answers rather than one opaque paragraph per
card so targeted revision remains possible:

```json
{
  "schema_version": 1,
  "canonical_hash": "",
  "identity": {},
  "mission": {},
  "communication": {},
  "boundaries": {},
  "working_method": {},
  "action_posture": {
    "mode": "operator",
    "actions": {
      "read_files": "allowed",
      "edit_files": "allowed",
      "run_commands": "allowed",
      "search_web": "allowed",
      "use_connectors": "ask",
      "send_external": "ask",
      "change_system": "ask",
      "delete_data": "blocked"
    }
  }
}
```

Action decisions are `allowed`, `ask`, or `blocked`. Portable action categories
are `read_files`, `edit_files`, `run_commands`, `search_web`, `use_connectors`,
`send_external`, `change_system`, and `delete_data`. These are behavioral
expectations, not runtime grants; the seated provider still enforces its own
permissions.

No secret value, credential, provider binding, executable path, or machine path
is stored in the blueprint.

## Collaboration contract

Collaboration is optional and provider-independent:

```json
{
  "schema_version": 1,
  "capabilities": ["implement", "test"],
  "accepts": ["task", "review_findings"],
  "emits": ["review_request", "implementation_result"],
  "default_access": "read-write"
}
```

An independent reviewer may instead declare `code_review`, `debugging`, and
`test_analysis`; accept `review_request` and `failure_report`; emit
`review_findings` and `diagnostic_result`; and default to `read-only`.

The first future workflow is checkpoint review:

```text
task → coding persona → review packet → independent reviewer
     → evidence-backed findings → coding persona → user approval
```

The packet contains the objective, exact diff, changed-file list, and printed
test evidence. It does not contain the coding persona's entire conversation.
Review begins at an explicit checkpoint or completed commit, not on every file
save. V1 may expose a manual **Send to reviewer** action; automatic routing is a
separate later layer.

## Validation

### Deterministic errors

- Persona ID is empty, unsafe, or does not match its folder/canonical filename.
- Required frontmatter is missing or malformed.
- JSON is malformed or the schema version is unsupported.
- Declared optional module file/contract is missing.
- A path escapes the configured persona workspace.
- The package would overwrite an existing persona.

### Warnings

- One of the six interview areas is incomplete.
- Canonical hash differs from the approved blueprint.
- Action posture and persona-specific approvals appear inconsistent.
- Collaboration declares read-only review but the action posture requests
  routine writes.
- A handoff is emitted with no declared consumer in a selected team.

### Suggestions

- Mission, voice, or definition of done is too thin to guide behavior.
- Responsibilities overlap another imported persona.
- A shared rule appears duplicated from `foundation.md`.

Errors are deterministic and blocking. Warnings require user review.
Suggestions are advisory. Heuristic analysis never rewrites or blocks identity
on its own.

Mechanical repair is offered only behind an explicit click: create a missing
empty memory index or scratchpad, normalize a safe filename before creation, or
refresh the stored canonical hash after the user accepts external edits.
Identity prose, boundaries, responsibilities, and relationships are never
auto-fixed.

## Import and current-Apex audit

Imported personas enter audit mode:

1. Copy nothing and change nothing initially.
2. Validate package structure and frontmatter.
3. Map existing canonical sections to the six semantic areas with user review.
4. Build an initial blueprint from that approved mapping.
5. Report missing, duplicated, or contradictory areas.
6. Offer targeted revisions one persona at a time.

The seven Apex personas are test fixtures, not templates. Mature user-facing,
infrastructure-shaped, role-specialist, and intentionally incomplete canonicals
must all import without being flattened into one voice or section order.

## Write safety

- All writes remain beneath the configured persona workspace.
- Persona IDs are normalized and path traversal is rejected.
- Package creation uses a same-directory temporary folder plus atomic rename.
- Existing persona folders are never overwritten.
- Draft deletion and permanent persona removal are separate, explicit actions.
- No external message, publication, connector call, or credential access is
  required to build a persona.

## Implementation sequence

1. **Contract library** — schema constants, safe IDs, paths, parsing, hashing,
   deterministic validation, fixtures, and tests. No UI.
2. **Persona extension skeleton** — manifest, dock tab, workspace configuration,
   and empty-state onboarding. Shell core remains generic.
3. **Foundation setup** — create/import/edit shared house rules through the UI.
4. **Draft store + interview** — crash-safe drafts and six guided cards.
5. **Blueprint/canonical renderer** — preview, targeted regeneration, manual edit,
   hash drift detection.
6. **Collaboration editor** — capability, accepts/emits, and access fields.
7. **Validator and import** — plain-language report, safe repairs, legacy mapping.
8. **Disposable test seat** — test prompts, observed transcript, revise/create.
9. **Permanent registration** — write atomically and add the seat preset.
10. **Apex fixture audit** — run all seven current personas without bulk edits.

## Required verification

- Minimal valid persona.
- Full coder and read-only reviewer packages.
- Invalid ID and path-traversal attempts.
- Missing frontmatter and malformed JSON.
- Unsupported schema version.
- Canonical hash drift with no overwrite.
- Existing-persona collision.
- Crash/restart draft recovery.
- Shared-foundation duplication warning.
- Conflicting action/collaboration posture.
- Legacy Apex canonical import with custom role modules.
- Runtime/provider fields rejected from portable identity data.
- Complete package creation constrained to the selected workspace.

## Independent review gate

Every implementation slice receives its own tests and printed evidence. Before
opening a fresh-context Claude peer-review seat, Mox checks live Claude usage.
If usage is stale, unavailable, or constrained, Mox asks Keith before dispatch.
Claude receives the approved specification, exact diff, and printed evidence in
read-only review posture. Mox adjudicates every finding, fixes confirmed defects,
reruns gates, and requests re-review after material corrections subject to the
same usage preflight. Resident Qwen delegation never substitutes for this gate.

