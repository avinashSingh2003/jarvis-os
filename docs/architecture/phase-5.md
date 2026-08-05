# Phase 5 — Multi-Agent Orchestrator Framework

## What's built

- `AgentRegistry` — maps a capability tag (matched against `PlanStep.suggestedAgentKind`) to an `Agent`, falling back to a default agent when there's no match. No real specialized agent exists yet (Phase 12+), so today most capabilities fall through to the default — the registry's job is making a future `register('coding', codingAgent)` a one-liner, not being interesting on its own.
- `Orchestrator` — `planner.createPlan(goal)` → for each step, `registry.resolve(step.suggestedAgentKind)` → dispatch → collect every outcome (success *and* failure — a failed step doesn't vanish from the result). `continueOnStepError` (default `true`) controls whether one failing step blocks the rest.
- `OrchestratorAgent` — implements the Phase 1 `Agent` contract, exactly like `EchoAgent` and `PlannerAgent` before it.
- **The CLI's default agent changed** — first real behavior change since Phase 1. `apps/cli` now wires `HeuristicPlanner → AgentRegistry(default: EchoAgent) → Orchestrator → OrchestratorAgent` instead of using `EchoAgent` directly. Confirmed by actually running the compiled CLI, not just by tests passing — see the transcript in the delivered conversation.
- `ModelBackedPlanner` (Phase 4) was extended to parse the optional `suggestedAgentKind` field it always had a slot for but never populated — needed for capability-based routing to mean anything. Regression-tested, and confirmed via `exactOptionalPropertyTypes` discipline (the field is omitted entirely when absent, never set to `undefined`).

## What this phase deliberately does NOT do

- **`PermissionGate` (Phase 2) is not yet part of the dispatch path.** Agents dispatched by the orchestrator don't call any real `Tool` yet, so there's nothing for the permission gate to mediate. This becomes load-bearing once Phase 12+ gives agents actual tools to call — noted explicitly so it isn't forgotten.
- **CLI still defaults to `HeuristicPlanner`, not `ModelBackedPlanner`.** Keeps the CLI fully functional with zero configuration (no API key, no network). Swapping in a real model-backed planner is a one-variable change in `apps/cli/src/cli.ts` once real provider credentials exist in `LocalEncryptedSecretStore` — documented inline in that file rather than built as automatic env-detection, to avoid adding config-sensing complexity nothing has asked for yet.
- **No retries, no re-planning after a step fails, no parallel step execution.** Steps run sequentially; a failure is recorded and (by default) skipped past, not retried or used to revise the plan.

## A deliberate breaking change, called out rather than hidden

Phase 1's CLI integration tests asserted exact `"echo: ..."` output. That output format is genuinely different now (`Orchestrated plan for "...": 1. [done] ... -> echo: ...`), so those tests were rewritten to match the new real behavior — not loosened just to keep them green. The piped-stdin regression test from Phase 1 (the `readline`/non-TTY bug) still applies unchanged, since it's a property of the REPL loop itself, independent of which agent sits behind it.

## Test results

17 new tests (122 total across Phases 1-5). Covers: registry resolution and override behavior, orchestrator dispatch/capability-routing/error-continuation/event-observability, `OrchestratorAgent`'s output formatting for both clean and mixed-outcome runs, and a full integration test using real `EchoAgent` + real `ModelBackedPlanner` (with a scripted provider) proving capability-based routing end-to-end through the `Agent` contract boundary.
