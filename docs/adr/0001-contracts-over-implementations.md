# ADR 0001: Contracts Over Implementations

## Status

Accepted

## Context

Project Jarvis OS needs to support ~25 phases of development over a long
time horizon, with many independent agents, tools, and model providers being
added, replaced, or removed without destabilizing the rest of the system.
The project's own stated philosophy explicitly rules out monolithic
architecture.

## Decision

Every cross-module interaction goes through an interface defined in
`packages/contracts`, never through a direct import of a concrete class from
another module. Phase 1 ships five such interfaces (`Agent`, `Tool`,
`ModelProvider`, `EventBus`, `AppConfig`) with zero implementation logic
alongside them. `packages/core` and `apps/cli` depend on `@jarvis/contracts`
but never on `@jarvis/agent-echo` internals beyond the `Agent` shape it
satisfies.

## Alternatives considered

- **Direct imports with an internal "god module."** Simpler short-term, but
  directly contradicts the "avoid monolithic architecture" requirement and
  would force every future agent addition to touch Core.
- **A full plugin-loader / dynamic-discovery system in Phase 1.** Rejected
  as premature — we don't yet have more than one real agent to prove the
  pattern against. Revisit once Phase 5 (orchestrator) needs to load agents
  dynamically rather than via hardcoded construction.
- **A schema-first approach (e.g. generating types from a shared JSON
  Schema/Protobuf definition).** Would help if/when non-TypeScript services
  (Python-based model providers in Phase 3) need the same contracts.
  Deferred until that's a concrete need rather than a speculative one.

## Consequences

- Adding a new agent in a later phase means implementing `Agent`; it does
  not require any change to `packages/core`.
- Contracts must stay minimal. Any interface change is a breaking change for
  every implementer, so `packages/contracts/tests/contracts.test.ts` exists
  specifically to catch interfaces that have become awkward to implement.
- The event bus (`InMemoryEventBus`) is intentionally the dumbest possible
  implementation of `EventBus`. If Phase 5 needs cross-process delivery,
  retries, or persistence, that's a new `EventBus` implementation — not a
  change to any code that currently depends on the interface.
