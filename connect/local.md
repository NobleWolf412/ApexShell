# connect/local — the local-model lane (Ollama)

An offline seat: chat + web search/fetch + gated file tools, no
subscription. Quality is a local model's — treat it as the bulk/mechanical
lane, not the judgment lane.

## Detect / set up

- Ollama serving at `http://localhost:11434` (`ollama --version`, then
  `curl localhost:11434` answers).
- Models (first is the wired default, second the fallback):
  - `ollama pull gpt-oss:20b` — a MoE coder (~3.6B active of 20B), so it
    runs at usable speed on CPU-only boxes; ~14GB. Native tool-calling.
    On smaller machines pull only the fallback and edit `MODEL` in
    `main/engine/localSeat.js`.
  - `ollama pull llama3.1:8b`
  - Any Ollama model with native tool-calling works here — the lane is
    vendor-neutral. Avoid dense models ≥13B on CPU-only boxes (too slow),
    and plain code models (codellama/codestral/deepseek-coder) or Gemma,
    which don't emit `tool_calls` and so break the gated file tools.

## What the shell does

Blank seat with the model dial set to `qwen` → the local lane:

- Chat with tool rounds: `web_search`, `web_fetch`, `read_file`,
  `list_dir` auto-run (surfaced as chips); `write_file` blocks on the SAME
  permission card a Claude seat gets — the human is the gate.
- File scope = the seat's working directory + the temp dir. Nothing else.
- The system prompt forces live-web verification for anything current — a
  local model's training data is stale and it will otherwise argue about
  what year it is. Keep that prompt's discipline if you touch it.
- Keep-alive 30m; exact token counts flow to the usage tracker's per-day
  ledger (`state/usage-local.json`).
- No `--resume`: local chats persist to `state/transcripts/` for the
  record, but a closed local seat is closed.

## Dial notes

Effort/permissions dials grey out where the lane has no lever — qwen has
no effort control, and its only permission surface is the write gate.
