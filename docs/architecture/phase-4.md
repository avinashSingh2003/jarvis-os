# Phase 4 — Executive Planner & Reasoning Layer

## What's built

- `Planner` contract (`createPlan(goal): Promise<Plan>`), added to `@jarvis/contracts`.
- `HeuristicPlanner` — no model, no network, always returns a single-step plan. Same defensive role as `LocalEchoModelProvider` (Phase 3) and `EchoAgent` (Phase 1): a safe, always-available fallback.
- `ModelBackedPlanner` — prompts a `kind: 'reasoning'` model (via Phase 3's `ModelRouter`, so it inherits cross-provider fallback for free) for a JSON step list, and parses the response defensively: strips markdown fences the model wasn't supposed to add, and throws a `PlanParseError` (carrying the raw response) on anything else malformed rather than guessing.
- `PlannerAgent` — implements Phase 1's `Agent` contract directly. Takes a primary planner and an optional fallback; if the primary throws for *any* reason (model unreachable, garbled response, whatever), it transparently retries with the fallback and reports `usedFallback: true` in the response metadata rather than silently hiding that a fallback occurred.

## What this phase deliberately does NOT do

- **Not wired into the CLI.** `apps/cli` still uses `EchoAgent` by default, and Phase 1's CLI tests are untouched. A plan that nothing executes is a demo, not a feature — real wiring (where `PlannerAgent`'s output actually drives dispatched work) makes sense once Phase 5's orchestrator exists to act on the steps.
- **No real model call verified.** Same limitation as Phase 3 — every test here uses a scripted/fake `ModelProvider`. The parsing logic, fence-stripping, and fallback behavior are all real and thoroughly tested; an actual model's willingness to follow the "respond with only JSON" instruction has not been verified against a live API.
- **No plan execution, retries, or re-planning.** A `Plan` is inert data. Making an agent revise a plan after a step fails is future work, once there are real steps that can fail.

## Test results

17 new tests (105 total across Phases 1-4). Covers: the heuristic fallback's determinism, JSON parsing including fence-stripping and three distinct malformed-response cases, `PlannerAgent`'s fallback behavior (success / primary-fails-with-fallback / primary-fails-no-fallback), and a full integration scenario chaining a real `ModelRouter` through both success and two different failure modes (unreachable provider, garbled response) into the same observable `usedFallback` signal.
