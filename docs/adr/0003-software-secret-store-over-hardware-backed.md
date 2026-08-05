# ADR 0003: Software-Only Encrypted Secret Store for Phase 2

## Status

Accepted

## Context

The project's Security section calls for "hardware-backed secure storage
where available" (Secure Enclave on macOS, TPM on Windows/Linux, OS
keychains). Phase 2 needs *some* secret storage now, since Phase 3
(multi-model AI routing) will need to hold API keys almost immediately
after.

## Decision

Ship `LocalEncryptedSecretStore`: a single AES-256-GCM encrypted JSON file,
keyed by a user-supplied master key (`JARVIS_MASTER_KEY`), with no
OS-native or hardware-backed component.

## Alternatives considered

- **OS keychain integration now** (macOS Keychain via native bindings,
  Windows Credential Manager, `libsecret` on Linux). Rejected for Phase 2:
  every option requires either a native Node addon (a build/dependency
  concern this monorepo has otherwise avoided) or shelling out to
  platform-specific CLIs, and the project doesn't yet have a concrete
  desktop-integration phase built (that's Phase 12). Building keychain
  integration before there's a real desktop app phase to integrate it
  with is exactly the kind of "build ahead of need" Phase 1 and 2 have
  both avoided elsewhere.
- **A third-party secret-management package** (e.g. `keytar`). Same native
  Node addon issue, plus an external dependency for something Node's
  built-in `crypto` module already does well.
- **Plaintext file, `.gitignore`'d.** Rejected outright — directly
  contradicts "never expose API keys or secrets," and provides no
  protection against the file being read by anything else running on the
  same machine.

## Consequences

- Real credentials (Phase 3's model provider API keys, later phases' OAuth
  tokens) are protected against casual disk access and tampering, but not
  against a compromised, currently-running process with the master key in
  its environment — the same threat model as most local `.env`-based
  secret handling.
- The `SecretStore` interface has no OS-keychain-specific concepts baked
  into it (no "keychain item" or "credential ID" fields) — it is
  intentionally minimal (`get`/`set`/`delete`/`list` by string key), so a
  future `MacKeychainSecretStore` or similar can implement the same
  interface without a contract change.
- Revisit this decision explicitly once Phase 12 (Desktop Control) gives a
  concrete reason to integrate with a specific OS's native secret storage.
