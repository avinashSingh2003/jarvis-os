# Phase 2 — Security & Secrets Management

## What this phase is

The security substrate every later agent and tool will run through: an
encrypted secret store, a role-based permission gate, and an append-only
audit trail. Nothing in this phase does anything a user would notice yet —
there are no real agents calling real tools. That's intentional; see "What
this phase deliberately does NOT do" below.

## Architecture

```
                     Agent / caller
                          │
                          │  PermissionGate.invoke(tool, invocation, context)
                          ▼
              ┌───────────────────────┐
              │     PermissionGate     │  packages/security/permissions
              │  1. RolePolicy.decisionFor(role, tool.riskLevel)
              │  2. if 'confirm': ConfirmationProvider.confirm(...)
              │  3. if allowed: tool.invoke(invocation)
              │  4. ALWAYS: AuditLogger.record(...)
              └───────────┬───────────┘
                 │        │        │
                 ▼        ▼        ▼
          RolePolicy  Confirmation  AuditLogger
          (Default-    Provider     (File-
           RolePolicy)  (CLI or     AuditLogger
                         test stub)  → JSONL)

    Separately: SecretStore (LocalEncryptedSecretStore)
    — used directly by whatever needs a credential, not mediated
      by PermissionGate. Secrets and tool-permission are related
      concerns but distinct mechanisms.
```

## Key decisions

- **One choke point, not scattered checks.** `PermissionGate.invoke()` is
  the only sanctioned way to call `Tool.invoke()`. Every future agent and
  every future tool call in later phases is expected to go through it. This
  mirrors Phase 1's "contracts over implementations" philosophy: one place
  to get right, one place tests can cover exhaustively, instead of
  permission logic duplicated (and inevitably drifting) across every agent.
- **Every path produces exactly one audit event — including denials.** The
  project's Security section calls for audit logging; a log that only
  records successes isn't an audit trail, it's a success log. Denied,
  errored, and allowed all get recorded identically.
- **AES-256-GCM, not a simpler cipher.** GCM's authentication tag means
  "wrong key" and "tampered file" are caught by the same mechanism, for
  free, rather than needing a separate integrity check. Verified directly
  in tests: flipping one byte of ciphertext makes decryption fail exactly
  like a wrong master key would.
- **Redaction is heuristic, not a security boundary.** `redactSensitiveKeys`
  catches key names like `apiKey`/`password`/`token` before they reach the
  audit log. It's a safety net for accidental leakage through metadata, not
  a substitute for simply never passing raw secret values into audit
  metadata in the first place. Documented as such directly in the code.
- **RBAC is one hardcoded matrix (`DefaultRolePolicy`), not a policy
  engine.** Three roles, three risk levels, nine cells. A configurable
  policy system (per-tool overrides, custom roles, delegation) is
  deliberately deferred — we don't have more than one real tool yet to
  prove a more complex design against.

## What this phase deliberately does NOT do

- **Not wired into the CLI or SessionManager.** Phase 1's `EchoAgent`
  doesn't call any tools, so there is nothing for `PermissionGate` to
  mediate yet in the actual running app. Wiring it in now would mean
  either inventing a fake tool call just to exercise the CLI (which adds
  code with no real purpose) or leaving it dormant and untested in
  production wiring (worse than not wiring it at all). Real wiring happens
  once Phase 5 (orchestrator) and Phase 12+ (computer control) give agents
  actual tools to call.
- **No hardware-backed key storage (Secure Enclave / TPM / OS keychain).**
  The project's Security section calls for this eventually. Phase 2 uses a
  software-only AES-256-GCM file, protected by a master key the user
  supplies via environment variable. Revisit once a specific platform
  target (Phase 12's macOS/Windows/Linux desktop control) makes a native
  keychain integration concrete rather than speculative.
- **No multi-process-safe audit log writes.** `FileAuditLogger` uses a
  plain `appendFile` with no file locking. Fine for Phase 2's single-process
  test harness; would need revisiting the moment multiple agent processes
  write concurrently.
- **No configurable/per-tool policy engine.** See "RBAC is one hardcoded
  matrix" above.

## A design inconsistency caught during implementation

The initial `AuditEvent` contract draft required callers to supply a
`timestamp` field, while its own doc comment said "implementations set
this — callers do not supply it." Those two statements contradicted each
other. Caught before any implementation was built against it: the contract
was split into `AuditEventInput` (what a caller provides — no timestamp)
and `AuditEvent` (the stored form, `AuditEventInput` + a `timestamp` the
`AuditLogger` implementation stamps itself). This is the kind of thing code
review is supposed to catch; it's noted here because the original spec
document was reviewed by the same process that wrote it, so it's worth
being explicit that it did catch its own mistake rather than silently
shipping a contract whose implementation wouldn't have matched its
documentation.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| Secrets never stored or logged in plaintext | ✅ Verified: dedicated tests read the raw `.enc` file and the raw audit log off disk and assert the plaintext value is absent from both |
| Wrong master key / tampered file both rejected | ✅ Verified via GCM auth-tag failure in both cases |
| Every tool invocation produces an audit record regardless of outcome | ✅ Verified: allow/deny/confirm-approve/confirm-decline/error paths each checked |
| High-risk actions always require explicit confirmation (owner/assistant) | ✅ `DefaultRolePolicy` |
| Guest role cannot invoke high-risk tools even with confirmation available | ✅ Denied outright; test confirms the confirmation provider is never even called |
| No secrets in repo | ✅ `.env.example` documents `JARVIS_MASTER_KEY` with no value; CI secret-scan step from Phase 1 still applies |
| Full scenario runs end-to-end against real disk I/O, not mocks | ✅ `packages/security/tests/integration.test.ts` |
