# Wiki Pipeline (ApexShell extension)

Turn a pile of raw material — session notes, transcripts, docs — into a durable,
interlinked wiki. It's the intake→compile pattern, self-contained: **intake is
free (pure code), compiling is the only thing that spends tokens.**

## How it works

- **Add entry (intake)** — drop text into the queue. Mechanical, no model, free.
- **Compile** — a tool-less model seat reads one queued entry plus the current
  wiki, and returns the page(s) to write; the extension writes them. The model
  never touches your disk. One entry at a time; an empty queue spawns nothing.
- **Browse / search** — read the compiled wiki right in the pane.

The store lives under the extension's state dir: `store/raw/`, `store/wiki/`,
`store/index.json`. It's plain Markdown + JSON — `git init` it if you want history.

## Personas

If you built personas with the Persona Builder, put a persona's name in
**Compile voice** and the wiki is compiled in that persona's voice and judgement.
Leave it blank for a neutral librarian. You never need anyone else's personas.

## Cost

Read `design/wiki-pipeline-cost.md`. Short version: run it on your subscription
login (no API key), let empty queues stay free, and don't drop the compile model
below a capable tier — compile quietly loses content if the model skims.

## What's a deliberate v1 (and easy to extend)

- **Intake is paste/add.** A transcript-capture adapter (auto-ingest your
  runtime's session logs into `store/raw/`) is the natural next step — the store
  already takes files, so an adapter just writes into `raw/`.
- **Reduce-first isn't automatic yet.** The biggest cost lever (compile over a
  short self-digest instead of a full raw transcript) is documented in the cost
  doc; wire your intake to write digests into `raw/` and compile gets cheaper for
  free.
- **No analysis/"Doc" layer.** Optional by design; not built, not paid for.

## A note on the rules

The consent/safety/ownership disciplines Apex runs internally are **ours, not
requirements of this code**. This extension is the mechanism; how you gate,
schedule, or govern it is your call. Suggestions live in the design docs; nothing
here imposes Apex's doctrine on your build.

*Built by Mox (Apex) for ApexShell.*
