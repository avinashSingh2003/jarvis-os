# JARVIS OS

**Phase 1: Foundation & Core Architecture.**

This is the walking skeleton every later phase plugs into: typed contracts, an
in-memory event bus, layered config, a session manager, one deliberately dumb
"echo" agent to prove the wiring, and a CLI as the first (and currently only)
user interface.

No AI models, no voice, no computer/phone control, no memory persistence, and
no real agents live here yet — those are later phases. See
[`docs/architecture/phase-1.md`](docs/architecture/phase-1.md) for the full
spec and rationale, and the project roadmap for what comes next.

## Requirements

- Node.js >= 20 (developed against Node 22)
- npm >= 10

## Setup

```bash
npm install
npm run build
```

## Run the CLI

```bash
# Interactive mode
npm run cli

# One-shot mode
node apps/cli/dist/index.js "hello JARVIS"

# With debug event logging
JARVIS_LOG_LEVEL=debug node apps/cli/dist/index.js "hello JARVIS"
```

Copy `.env.example` to `.env` and adjust if you want to change config without
setting environment variables inline.

## Test

```bash
npm test
```

Tests run on Node's built-in test runner (`node:test`) — no test framework
dependency required. This was a deliberate change from the original plan to
use Vitest: Phase 1's own philosophy is to avoid pulling in dependencies
before there's a concrete need for them, and the built-in runner is
sufficient for what Phase 1 actually tests.

## Lint & format

```bash
npm run lint
npm run format        # rewrites files
npm run format:check  # CI-safe, no rewrites
```

## Project layout

```
jarvis-os/
├── apps/cli/                  # Phase 1 user interface (text in/out)
├── packages/contracts/        # Shared interfaces — no implementation logic
├── packages/core/              # Config loader, event bus, session manager
├── packages/agents/echo/       # Stub agent proving the Agent contract end-to-end
├── packages/security/          # Phase 2: encrypted secrets, audit logging, RBAC/permission gate
├── packages/tools/demo/        # Phase 2: stub read-only + high-risk tools proving the Tool contract
├── docs/architecture/          # Per-phase specs
├── docs/adr/                   # Architecture Decision Records
└── .github/workflows/ci.yml    # Build, lint, format-check, test, secret scan
```

## Design principle this phase establishes

Every component talks to every other component only through the interfaces
in `packages/contracts`, and only via the event bus for cross-cutting
concerns — never through direct imports of a concrete implementation. Core
has zero knowledge that `EchoAgent` specifically exists; it only knows about
the `Agent` interface. This is what lets Phase 5 swap the echo agent for a
real multi-agent orchestrator without changing `core` or `apps/cli` at all.

## Phase 2 — Security & Secrets Management

`packages/security` adds three things every later phase's tools and agents
will depend on:

- **`LocalEncryptedSecretStore`** — AES-256-GCM encrypted secret storage.
  Requires a `JARVIS_MASTER_KEY` (see `.env.example`). Never stores or logs
  plaintext secret values.
- **`FileAuditLogger`** — append-only JSONL audit trail. Every permission
  decision — allowed, denied, or errored — gets exactly one entry, with
  credential-shaped metadata keys redacted before they hit disk.
- **`PermissionGate`** — the single choke point for invoking a `Tool`. Looks
  up a role-based decision (`DefaultRolePolicy`: owner/assistant/guest ×
  read-only/low-risk/high-risk), asks for confirmation when the policy calls
  for it, and always logs the outcome.

`packages/tools/demo` ships two stub tools (`system-clock`, read-only, and
`reset-counter`, high-risk but fully simulated/in-memory) whose only job is
to give `PermissionGate` something real to mediate — the same role
`EchoAgent` played for the `Agent` contract in Phase 1.

**This is not yet wired into the CLI.** There's no real agent calling real
tools until Phase 5 (orchestrator) and Phase 12+ (computer control) exist —
wiring a permission system into a system with nothing to protect would be
security theater. Phase 2 proves itself via
`packages/security/tests/integration.test.ts`, which runs a full
guest-vs-owner, allow/deny/confirm scenario end-to-end and then reads the
raw audit log and encrypted secrets file off disk to confirm what actually
landed there.

## Known environment note

If you're setting this up somewhere without registry access, `npm install`
will fail to fetch `typescript`, `@types/node`, `tsx`, `eslint`, and
`prettier`. All of this code was written and verified against those exact
tools; there's nothing environment-specific in the source itself.
