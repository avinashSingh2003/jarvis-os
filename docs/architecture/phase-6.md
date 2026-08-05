# Phase 6 — Memory (Working & Episodic)

## What's built

- `WorkingMemory` / `InMemoryWorkingMemory` — ephemeral, bounded (default 50 turns), in-process only. No approval needed since nothing persists.
- `EpisodicMemory` / `FileEpisodicMemory` — persisted as JSON Lines. The project's "remember only information the user explicitly approves" requirement is enforced in the type itself: `EpisodicMemoryWriteRequest.approved` must be `true`, checked at runtime — `record()` silently (but audibly, see below) refuses to write anything else. Supports `recent()`, `forget(id)`, and `export()` — editing, forgetting, and export/backup, per the project's Memory section.
- Every episodic memory write attempt — approved, rejected, or forgotten — produces a real audit event via Phase 2's `AuditLogger`, tying "auditing" (also called for in the Memory section) directly to the existing mechanism rather than inventing a second one.
- **CLI got four new real commands**: `/recall [n]`, `/remember <text>`, `/history [n]`, `/forget <id>`. Typing `/remember` *is* the explicit approval the contract requires — there's no separate confirmation step because the act of running the command already is one. Verified by actually running the compiled CLI and reading the resulting `episodes.jsonl` and `audit.log` files back off disk — not just by tests passing.
- The CLI now also constructs a real `FileAuditLogger` (`.jarvis-os/audit.log` under the working directory, or `JARVIS_DATA_DIR` if set) — the first time Phase 2's audit logging is wired into the actual running app rather than only proven in its own test suite.

## What this phase deliberately does NOT do

- **No semantic memory, knowledge graph, or RAG** — that's Phase 7.
- **No automatic promotion from working to episodic memory.** Nothing in working memory becomes persistent unless the user explicitly runs `/remember`. An agent someday deciding on its own "this seems worth remembering" and prompting for approval would be a Phase 7+ concern layered on top of this, not something Phase 6 attempts.
- **No memory-aware reasoning.** `HeuristicPlanner` and the orchestrator don't consult working or episodic memory when planning — the plumbing exists, but nothing consumes it for decision-making yet. That's for whichever phase first gives an agent a reason to look back at prior context.
- **`forget()` rewrites the whole file** rather than an in-place delete — fine at personal-assistant scale, called out as a thing to revisit if it ever isn't.

## Test results

23 new tests (144 total across Phases 1-6). Covers working memory's ordering/bounding/clearing, episodic memory's approval gating (including the safety-critical "rejected write creates no file at all" case), persistence across fresh instances, forget/export, optional-metadata handling (`exactOptionalPropertyTypes`-safe — omitted, not set to undefined), a full integration test reading Phase 2's real audit log off disk, and eight new CLI-level tests for the four new commands, each isolated to its own temp data directory to avoid cross-test leakage.

## Addendum: a real, free local model via Ollama

Added after initial Phase 6 delivery, prompted by wanting a genuinely free way to exercise Phase 3/4's real model-calling path (this sandbox has no network, so Phase 3 was only ever verified against injected fake fetch implementations).

[Ollama](https://ollama.com) runs open-weight models locally — no API key, no signup, no per-token cost — and exposes an OpenAI-compatible endpoint at `http://localhost:11434/v1/chat/completions` with the exact same request/response shape `OpenAiCompatibleModelProvider` (Phase 3) already speaks. No new provider code was needed — just new constructor arguments.

**What changed:**
- `FallbackPlanner` (new, in `@jarvis/planner`) — implements `Planner` itself, unlike `PlannerAgent` which wraps a planner behind the `Agent` contract. Lets `Orchestrator` (which takes a plain `Planner`) get the same "try the smart option, fall back to the safe one" behavior `PlannerAgent` already had.
- `apps/cli`'s `buildPlanner()` — if `JARVIS_OLLAMA_MODEL` is set, builds `FallbackPlanner(ModelBackedPlanner(ModelRouter([OpenAiCompatibleModelProvider(...)])), HeuristicPlanner())`. Unset, behavior is identical to before.

**Verified for real, not just mocked:** a test makes a genuine connection attempt to an address nothing is listening on and confirms the real `ECONNREFUSED`-class failure correctly triggers the fallback — this is real network behavior, not a simulated failure. What is *not* verified from this environment (no network here) is a real, successful round-trip to an actually-running Ollama server — that needs to happen on a real machine with Ollama installed.

**To use it:** install Ollama, run `ollama pull llama3.2` (or a smaller model — `llama3.2:1b`, `phi3:mini`, or `gemma2:2b` if your machine has less RAM), then set `JARVIS_OLLAMA_MODEL=llama3.2` before running the CLI. No code changes needed.

### Real-world finding: a genuine successful call, and a silent fallback, both on the first try

Testing against a real, running Ollama server (`llama3.2:1b`) surfaced two distinct real events in back-to-back runs of the identical prompt:

1. **A real success**: Ollama returned valid JSON, and the orchestrator produced a genuine 3-step plan it had never seen before (`"Respond to hello"`, `"Generate a generic response"`, `"Send a greeting from an unknown environment"`) — the first real, live model output in this entire project.
2. **A silent fallback**: the very next run, the HTTP call *also* succeeded (`model:success` fired) but Ollama's raw text wasn't valid JSON this time — small models are inconsistent about strictly following "respond with ONLY JSON" instructions, and nothing pins the sampling, so identical prompts can come back differently formatted. The resulting `PlanParseError` was being silently caught by `FallbackPlanner` with zero visibility — impossible to tell, from outside, whether a fallback happened because of a network failure or an unparseable-but-successful response.

**Fix**: `ModelBackedPlanner` now takes an optional `eventBus` and publishes `planner:parse-error` (with the raw model text) on a parse failure; `FallbackPlanner` now takes an optional `eventBus` and publishes `planner:fallback-used` (with the primary's failure reason) whenever it actually falls back. The CLI's debug mode subscribes to both. Covered by 3 new targeted unit tests using the same injectable-provider pattern used throughout this project — verified logically, not against a live socket (attempting to spin up a real listening HTTP server in this sandbox to fully round-trip the scenario hung repeatedly, consistent with this environment's established no-network-access limitation; the unit tests exercise the identical code path without needing one).


