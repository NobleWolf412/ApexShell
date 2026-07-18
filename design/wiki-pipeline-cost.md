# The Wiki Pipeline Costs Tokens — how, how much, how often, how to keep it cheap

*A plain explainer for anyone running the intake→compile wiki pipeline. Usage
is real money (subscription window or metered credits), so this spells out where
the spend actually goes and how to keep it down **without** making the wiki worse.
The tuning numbers are from Apex's own running pipeline — treat them as a
reference point, not a promise; your corpus and model will differ.*

## The one-sentence version

**Intake is free; compile is where the tokens go.** Reading raw material and
folding it into wiki pages is a model reasoning step, and that's the bill. Run it
on your subscription (not an API key), only when there's new material, over a
small digest instead of a giant raw transcript, and it stays cheap.

## Where the cost is (and isn't)

The pipeline is two stages, and only one of them spends tokens:

| Stage | What it does | Token cost |
|---|---|---|
| **Intake** (Iris's job) | Mechanical: capture new transcripts, dedupe, compute the "not-yet-compiled" queue, pre-build context briefs, commit. **Pure code, no model.** | **Zero.** Run it as often as you like. |
| **Compile** (Clio's job) | Judgement: a model reads one new entry + the current wiki + a brief, then writes/updates the interlinked pages. | **This is the whole bill.** One model session per entry. |
| **Analysis** (Doc's job) | Optional behavioral/quality layer over the same material. | Extra model cost — **skip it entirely if you don't want it.** It is not required for a working wiki. |

So when you think "the pipeline is expensive," you mean **compile**. Everything
below is about compile.

## How compile spends tokens

One entry at a time, each in a fresh model session (Apex calls this
*transaction-per-file*): read the raw entry + the wiki index/relevant pages + a
pre-built brief → reason → write the page(s) → commit. The **input** side
dominates, and the biggest input is the raw material itself.

That matters because **raw session transcripts are big** — in Apex they run
~0.5–1.5 MB of JSONL each (roughly 150k–450k tokens). Compiling a raw transcript
*directly* means paying to read all of it. That's the single largest, most
avoidable cost in the whole pipeline (see the reduce-first lever below).

## How much (Apex's real numbers, as a yardstick)

- **Per entry:** one bounded model session. A normal session entry compiles in
  ~1.5–5 min of wall-clock at steady state; a large one (a ~330k-token outlier)
  ran ~15–45 min. Wall-clock roughly tracks tokens read.
- **Per day at steady state:** in one measured snapshot, ~24 compiles across a
  day, with the scheduler firing ~41 times — i.e. **fewer than half the wake-ups
  actually did anything**, because most woke to an empty queue and cost nothing.
- **Backlog vs steady state:** the first run pays to compile the whole backlog
  once; after that you only pay for genuinely new material. Steady state is small.

Your mileage varies with corpus size, entry size, and model — but the shape
holds: **big one-time backlog, small ongoing trickle, and empty wake-ups are
free.**

## How often — and why "often" isn't the cost driver

Compile runs on a cadence you set (Apex uses a 30-min timer; hourly is fine for
most people). **Frequency barely matters, because a wake-up with nothing to
compile is free** — the queue is empty, the run exits, no model is spawned. You
pay per *entry*, not per *tick*. So a tight cadence just means "compile new
material sooner," not "spend more." Widen it if you want fewer, larger batches;
tighten it if you want the wiki fresher. Either way the token bill is ~the same.

## The billing lane — the biggest single decision

What meters is **the credentials**, not the mode. It's a common myth that
"headless = metered"; it isn't:

- **Subscription login** (interactive *or* headless `claude -p`, with **no**
  `ANTHROPIC_API_KEY` set) → **flat-rate**, drawn from your normal subscription
  window. `claude -p` on a subscription login is *not* metered — verified.
- **An API key (`ANTHROPIC_API_KEY` set) / the Agent-SDK credit path** → metered
  credits at full API list rates, no rollover. This — not headless mode — is the
  expensive lane, and it's easy to leave on by accident.

**Recommendation: run the pipeline under your subscription login and make sure no
API key is set for it.** Headless vs. interactive doesn't change the bill; the
credentials do. This one choice dwarfs every other optimization.

## How to keep it cheap — without hurting the wiki

Ordered by leverage. The first two are where the real savings are.

1. **Reduce before you compile (biggest lever).** Don't feed the model the whole
   raw transcript. Have each session end with a short structured self-digest
   *while it's still warm* (what mattered, what was decided, what was a dead end),
   and compile **over the digest**, keeping the raw transcript only as a fallback.
   A warm self-summary beats a cold re-read of a megabyte of JSONL — you cut the
   dominant input cost and **quality goes up, not down**, because the summary is
   authored by the context that actually lived the session.
2. **Only pay when there's work.** Derive an uncompiled-queue mechanically (in
   code, free) and skip the model entirely when it's empty. Never spin a model up
   "just to check." (Apex's <50%-utilization number above is this lever working.)
3. **Pre-warm with free mechanical work.** Have the intake step assemble the
   cross-references / relevant index slice into a small brief per entry. That's
   code, not model — it shrinks what the compile session has to hunt for.
4. **Batch when convenient.** One session that drains several queued entries
   amortizes the per-session overhead vs. one-session-per-file. Helps when a
   backlog builds; not required in steady state.
5. **Right-size the model to a quality floor — don't go under it.** Compile is a
   *silent-loss* surface: a too-small/too-fast model will skim a bulk context and
   quietly drop content, and you won't see it until you read the page. In Apex's
   own A/B, a cheap skim-tier model (Haiku-class) failed compile and a
   Sonnet-class frontier model held — so we pin the capable tier for compile even
   though it costs more per token. **Save tokens by reading *less* (levers 1–3),
   not by thinking *worse*.** Coding-quality verdicts don't transfer here; test
   any cheaper model against your own corpus before trusting it to compile.
6. **Drop Doc.** The analysis layer is optional. If you just want a compiled
   wiki, don't run it — that's a whole model lane you simply don't pay for.

## The anti-patterns (what NOT to do to save money)

- **Don't downgrade the compile model below the quality floor** — you'll get a
  cheaper wiki that's quietly missing things (see lever 5).
- **Don't compile raw transcripts directly if you can digest first** — you're
  paying to re-read everything the session already knew.
- **Don't run it on a metered API key** when a subscription login would do.
- **Don't slow the cadence to "save money"** — empty ticks are already free;
  you'd just make the wiki stale for no saving.

*— Mox (Apex), for the ApexShell wiki pipeline. Numbers are Apex's own; the
levers are general.*
