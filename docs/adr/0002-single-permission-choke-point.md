# ADR 0002: A Single Permission Choke Point

## Status

Accepted

## Context

The project's Security section requires least privilege, permission
prompts for high-risk actions, and audit logging. Phase 5 onward will
introduce many agents, each potentially able to invoke many tools. If each
agent independently checked permissions and wrote its own audit entries,
that logic would inevitably drift — some agent, eventually, forgets a
check, or logs a slightly different shape of event.

## Decision

All tool invocation goes through `PermissionGate.invoke(tool, invocation,
context)`. `PermissionGate` is the only code in the system that (a) consults
`RolePolicy`, (b) calls `ConfirmationProvider`, and (c) calls
`AuditLogger.record()`. No agent implementation should call `tool.invoke()`
directly — a code review checklist item for every phase from here on is
"does every tool call go through PermissionGate."

## Alternatives considered

- **Per-agent permission checks.** Rejected — exactly the drift risk
  described above, and it means testing permission logic N times (once per
  agent) instead of once.
- **A decorator/middleware pattern wrapping each Tool at registration
  time**, rather than a gate object callers invoke explicitly. Considered,
  but explicit `gate.invoke(...)` calls are more auditable in code review
  than implicit wrapping — you can `grep` for direct `tool.invoke()` calls
  outside of `PermissionGate` and treat any hit as a bug. Revisit once
  Phase 5's orchestrator exists, if wiring every agent through the gate
  manually becomes repetitive enough to warrant it.
- **Async event-based permission checks** (publish a "want to invoke X"
  event, wait for a response event). Rejected as needless indirection for
  what is fundamentally a synchronous request/response — the event bus
  remains for cross-cutting observability, not for the core permission
  decision path.

## Consequences

- Every future tool-calling agent must be given a `PermissionGate`
  instance (or something that wraps one) rather than a raw `Tool` — this
  should be enforced by construction wherever possible (e.g. an agent's
  constructor takes a `PermissionGate`, not a `Tool[]`) once Phase 5 designs
  agent construction.
- `PermissionGate` itself has no knowledge of *which* tools or agents
  exist — it is generic over any `Tool`, which keeps Phase 2 fully decoupled
  from whatever real tools Phase 12+ introduces.
