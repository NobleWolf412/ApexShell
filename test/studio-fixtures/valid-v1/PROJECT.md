---
schema_version: 1
name: valid-project
display_name: "Valid Project"
description: "A minimal, fully valid App Builder blueprint fixture."
---

# Valid Project

<!-- app-builder:vision:start -->
## Vision and Users

A lightweight kanban for solo makers who abandon heavyweight trackers; it turns a vague weekend idea into a single scannable board so momentum never dies between sessions. Success looks like a maker opening the board on Monday and instantly knowing the next move.
<!-- app-builder:vision:end -->

<!-- app-builder:scope:start -->
## Scope and MVP Cut

The MVP ships a single board with drag-to-reorder cards, a one-line quick-add, and local-first persistence; it deliberately omits accounts, sharing, and any server sync in v1.
<!-- app-builder:scope:end -->

<!-- app-builder:platform:start -->
## Platform and Stack

Targets the desktop web app first, packaged later; Node and a small vanilla renderer, no framework lock-in.
<!-- app-builder:platform:end -->

<!-- app-builder:architecture:start -->
## Architecture Sketch

A renderer owns the board DOM; an engine module owns persistence and card ordering. The risky seam is offline write ordering.
<!-- app-builder:architecture:end -->

<!-- app-builder:delivery:start -->
## Milestones and Delivery

Milestone one lands the renderer board; milestone two lands the engine persistence layer. Lift-off means npm test is green and a card survives a reload.
<!-- app-builder:delivery:end -->

<!-- app-builder:risks:start -->
## Risks and Open Questions

Open question: does local-first ordering need a CRDT, or is last-write-enough for a single user?
<!-- app-builder:risks:end -->
