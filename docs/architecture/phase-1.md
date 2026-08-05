# Phase 1 — Foundation & Core Architecture

## What this phase is

The minimal scaffolding every later phase depends on: contracts, an event
bus, config loading, a session manager, one stub agent, and a CLI. Nothing
here is "smart" — that's intentional. The goal is to prove the wiring holds
together before anything real gets built on top of it.

## Architecture

```
                     ┌─────────────────────┐
                     │      CLI Shell       │  apps/cli
                     └──────────┬───────────┘
                                │  calls SessionManager.handleInput()
                     ┌──────────▼───────────┐
                     │      JARVIS Core      │  packages/core
                     │  - SessionManager     │
                     │  - LayeredConfig      │
                     │  - InMemoryEventBus   │
                     └──────────┬───────────┘
                                │  talks only through packages/contracts
                     ┌──────────▼───────────┐
                     │   Contract Registry   │  packages/contracts
                     │  Agent / Tool /       │  (interfaces only)
                     │  ModelProvider /      │
                     │  EventBus / Config    │
                     └──────────┬───────────┘
                                │  implemented by
                     ┌──────────▼───────────┐
                     │      EchoAgent        │  packages/agents/echo
                     │  (Phase 1 only —      │
                     │   proves the contract)│
                     └───────────────────────┘
```

## Key decisions

- **Contracts over implementations.** `packages/contracts` has zero runtime
  logic — only interfaces. Every future agent, tool, and model provider
  implements one of these. `packages/contracts/tests/contracts.test.ts`
  exists purely to prove each interface is satisfiable by a trivial
  implementation, which is a canary for interfaces becoming too complex or
  leaky.
- **Event bus, not direct calls.** `InMemoryEventBus` is a plain typed
  pub/sub map. `SessionManager` publishes `session:request`,
  `session:response`, and `session:error` events; nothing currently
  subscribes to them except the CLI's optional debug logger, but the pattern
  is what lets Phase 5's orchestrator, or observability tooling in a later
  phase, hook in without touching `SessionManager` itself.
- **Config precedence: defaults → config file → environment.** Implemented
  in `LayeredConfig`. No secrets exist in Phase 1 — `.env.example` documents
  the one config value that exists (`JARVIS_LOG_LEVEL`). Real credential
  handling is explicitly Phase 2's job.
- **CommonJS, not ESM.** Chosen for straightforward `require()`-based module
  resolution across the monorepo without needing explicit `.js` extensions
  on every relative import. Revisit if a later phase's tooling (e.g. a
  bundler-based UI in Phase 25) makes ESM the better default.
- **Node's built-in test runner, not Vitest.** The original Phase 1 spec
  called for Vitest. During implementation, this was changed to `node:test`
  — it needs zero dependencies, which fits Phase 1's own "don't add
  dependencies before there's a concrete need" principle better than the
  original choice did.

## A bug found and fixed during this phase

While verifying the CLI end-to-end with piped (non-interactive) stdin, the
REPL loop silently stopped after the first line of input. Root cause: Node's
`readline/promises` `.question()`, called repeatedly in a `while` loop, does
not reliably read subsequent lines when stdin is a pipe rather than a TTY —
the second call hangs rather than returning the next buffered line.

Fix: switched to the `for await (const line of rl)` async-iterator pattern,
which is Node's documented approach for line-by-line consumption and behaves
correctly for both TTY and piped stdin. A regression test
(`apps/cli/tests/cli.integration.test.ts`, `REGRESSION: processes every line
from piped stdin...`) spawns the compiled binary as a real child process and
asserts every line gets a response — this is deliberately a process-level
test because the bug didn't reproduce when calling `runRepl()` in-process
against a mocked stream.

This is left in the docs because it's a useful example of exactly the kind
of "runs, but only sort of" bug that unit tests alone don't catch, and why
Phase 1's acceptance criteria required an actual end-to-end run, not just
green unit tests.

## What's explicitly NOT in Phase 1

- Any real AI model calls (Phase 3)
- Any real agent besides the echo stub (Phase 5 onward)
- Voice, GUI, or any interface besides the plain-text CLI (Phase 8+, 25)
- Any computer/phone/browser automation (Phase 12+)
- Memory persistence beyond in-process state (Phase 6-7)
- Secrets/credentials of any kind (Phase 2)
- A real message broker — `InMemoryEventBus` is single-process only

## Acceptance criteria status

| Criterion | Status |
|---|---|
| Fresh clone → documented command → CLI runs, echoes input | ✅ Verified (arg mode, REPL mode, piped stdin) |
| Contracts contain no implementation logic | ✅ |
| Core has zero direct dependency on EchoAgent internals | ✅ — only imports `Agent` type from contracts |
| High test coverage on core logic paths | ✅ 31 tests across config, event bus, session manager, echo agent, CLI integration, and contract satisfiability |
| CI fails on lint/type/test error | ✅ Workflow defined in `.github/workflows/ci.yml` (not run in this sandbox — no network access to install ESLint/Prettier here; logic verified via `tsc` and `node:test` directly) |
| No secrets in repo | ✅ Manual check + CI secret-scan step |
| README setup takes <10 minutes | ✅ Three commands: `npm install`, `npm run build`, `npm run cli` |
