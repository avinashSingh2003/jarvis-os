# Phase 3 — Multi-Model AI Routing Layer

## What's built

- `ModelProvider` implementations: `OpenAiCompatibleModelProvider` (targets the widely-copied `/chat/completions` shape), `AnthropicMessagesModelProvider` (targets the structurally different Messages API — different auth header, different response shape), and `LocalEchoModelProvider` (a no-network stub proving the `kind: 'local'` path, same role `EchoAgent` played in Phase 1 — **not** a real local-inference integration).
- `ModelRouter` — selects candidates by `kind` or by exact `preferredProviderName`, and falls through to the next candidate on failure. This is the literal mechanism behind "never depend on a single AI provider": if a provider throws, the next one of the same kind is tried automatically. Optional `EventBus` hooks (`model:attempt` / `model:success` / `model:provider-failed` / `model:all-failed`) give observability without coupling the router to any specific logging setup.
- Every HTTP-based provider takes an injectable `HttpFetch` instead of calling global `fetch` directly, so request construction and response parsing are fully unit-tested without any real network call. `defaultFetch` wires in the real thing.

## Ties to Phase 2

Provider API keys are pulled from `LocalEncryptedSecretStore`, not plain environment variables — see `packages/model-router/tests/integration.test.ts`. Model provider credentials are exactly what Phase 2's secret store exists to protect.

## What this phase deliberately does NOT do

- **No real network calls verified.** This sandbox has no network access. Request/response handling is verified thoroughly via injected fake fetch implementations; an actual call to `api.openai.com` or `api.anthropic.com` has not been made or can be made from here. That's on you to verify with a real key.
- **No real local model inference.** `LocalEchoModelProvider` is a deterministic stub. Wiring in something like `ollama` or `llama.cpp` is future work once a concrete backend is chosen.
- **No persistent circuit-breaker/health tracking.** Each `.complete()` call tries candidates fresh; there's no memory of "provider X has been failing for the last 10 minutes, deprioritize it." Revisit once real usage data exists.
- **Not wired into any agent yet.** `EchoAgent` doesn't call a model. Real wiring happens once Phase 4 (Executive Planner & Reasoning Layer) needs an agent that actually calls out to a model.

## Two real bugs caught by `exactOptionalPropertyTypes` during the build

1. `defaultFetch` was passing `body: undefined` explicitly into `RequestInit` when a request had no body — TypeScript correctly flagged this as invalid under `exactOptionalPropertyTypes`. Fixed with a conditional spread so the key is omitted entirely rather than present-with-undefined.
2. `ModelRouter`'s `eventBus` field was declared `eventBus?: EventBus` but assigned `options.eventBus` (type `EventBus | undefined`) directly in the constructor — same class of error as issue 1. Fixed by widening the field's declared type to `EventBus | undefined` explicitly.

Both are exactly the kind of subtle "works at runtime, technically unsound" issue the strict compiler flags in this monorepo are supposed to catch — recorded here as evidence they're doing their job, not just adding friction.

## Test results

22 new tests (88 total across Phases 1-3, all passing in the same regression run). Covers: provider request/response shape verification for both HTTP-based providers (including error paths and secret-leak checks in thrown error messages), full router candidate-selection and fallback logic, event-bus observability, and the SecretStore-backed integration scenario.
