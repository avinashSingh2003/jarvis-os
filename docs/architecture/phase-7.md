# Phase 7 — Semantic Memory, Knowledge Graph, RAG

## What's built

- `EmbeddingProvider` contract + `HashEmbeddingProvider` (deterministic, offline, bag-of-words hashing — NOT real ML, a testable stand-in like `EchoAgent`/`LocalEchoModelProvider`) + `OllamaEmbeddingProvider` (real, via Ollama's confirmed OpenAI-compatible `/v1/embeddings` endpoint) + `FallbackEmbeddingProvider` (mirrors `FallbackPlanner`; publishes `embedding:fallback-used` with the failure reason).
- `SemanticMemory`/`FileSemanticMemory` — same approval-gating and audit-logging discipline as Phase 6's `EpisodicMemory`, but stores atemporal facts with their embedding, retrieved by cosine similarity rather than recency.
- `KnowledgeGraph`/`FileKnowledgeGraph` — plain subject-predicate-object triples with pattern-matching queries. Built and tested as infrastructure for later phases; not wired into the CLI this phase (no obvious single command for it yet — that's for whichever future specialized agent reasons over relationships).
- `RagAgent` — implements the `Agent` contract. Retrieval always happens; using a model to synthesize an answer is optional and gracefully degrades to presenting the raw retrieved facts if no model is configured or the model call fails.
- **CLI got three new commands**: `/teach <fact>`, `/ask <question>`, `/facts [n]` — same "typing the command is the approval" pattern as `/remember` in Phase 6. Verified for real: taught two facts, asked a question, got back a properly similarity-ranked answer, confirmed via the actual `facts.jsonl` written to disk.

## What this phase deliberately does NOT do

- **`HashEmbeddingProvider` is not real semantic search.** It ranks by literal word overlap, not meaning — it cannot tell that "UI theme" relates to "dark mode" the way an actual embedding model would. This was caught directly: an early integration test assumed word-overlap-free paraphrase would rank correctly and it didn't, which is honest, expected behavior of a documented non-ML stand-in, not a retrieval bug — fixed by using a fair test query, not by changing the retrieval logic.
- **Knowledge graph not wired into the CLI.** Deliberately deferred — it's foundational infrastructure more than something with an obvious `/command` today.
- **No automatic fact extraction.** Nothing watches a conversation and proposes "this seems worth teaching" — that requires the same explicit-approval discipline as everything else in this project's memory layers, and is a reasonable thing for a future phase to build on top of `/teach`, not something Phase 7 invents unprompted.
- **No re-embedding on provider switch.** Facts keep whatever embedding was computed at write time; switching `HashEmbeddingProvider` ↔ `OllamaEmbeddingProvider` on an existing store produces inconsistent similarity scores between old and new facts. Documented as a known limitation.

## Two real bugs caught during this phase (both test issues, not production bugs)

1. `OllamaEmbeddingProvider`'s error message said "unexpected shape" while the test expected "unexpected response shape" — a wording mismatch against the convention `OpenAiCompatibleModelProvider` already established. Fixed by aligning the message, for consistency across the codebase, not just to satisfy the test.
2. The Phase 7 integration test asked a paraphrased question expecting the crude hash-based embedding to rank the right fact first — it didn't, because there wasn't enough literal word overlap. This is `HashEmbeddingProvider` working exactly as documented (bag-of-words, not real semantics); the fix was choosing a fair test query, not "fixing" the retrieval logic, which was already correct.

## Test results

41 new tests (193 total across Phases 1-7). Covers: embedding determinism and similarity ordering, cosine similarity edge cases (zero vectors, mismatched lengths), the real Ollama embeddings request/response shape via injected fetch, fallback-provider observability, semantic memory's approval gating/persistence/similarity-ranked search/forget/export, knowledge graph triple dedup and pattern queries, `RagAgent`'s three distinct outcomes (no facts / model-synthesized / raw-facts fallback), and a full integration test reading Phase 2's real audit log off disk after a mix of approved and rejected writes.
