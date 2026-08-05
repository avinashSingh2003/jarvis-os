import { SessionManager } from '@jarvis/core';
import { VoiceCommandProcessor } from '@jarvis/voice';
import type { Agent, AppConfig, EpisodicMemory, EventBus, SemanticMemory, WorkingMemory } from '@jarvis/contracts';
export interface CliDeps {
    config: AppConfig;
    eventBus: EventBus;
    session: SessionManager;
    workingMemory: WorkingMemory;
    episodicMemory: EpisodicMemory;
    semanticMemory: SemanticMemory;
    ragAgent: Agent;
    voiceCommandProcessor: VoiceCommandProcessor;
}
/**
 * Wires Config -> EventBus -> Agent -> SessionManager. This is the one
 * place that knows about every concrete implementation; everything else
 * only sees contracts.
 *
 * Phase 5: the CLI's default agent is `OrchestratorAgent`. Its planner
 * defaults to `HeuristicPlanner` (no model, no network required) — see
 * `buildPlanner()` below for how a real model gets wired in optionally.
 *
 * Phase 6: adds `workingMemory` (ephemeral, this-session-only) and
 * `episodicMemory` (persisted to `.jarvis-os/episodes.jsonl` under the
 * current working directory, gated on explicit approval — see
 * docs/architecture/phase-6.md). Every episodic memory write attempt is
 * recorded through a real `FileAuditLogger` (`.jarvis-os/audit.log`) — the
 * first time Phase 2's audit logging is actually wired into the running
 * CLI rather than only proven in its own tests.
 *
 * Optional real model backend: set `JARVIS_OLLAMA_MODEL` (e.g. "llama3.2")
 * to route through a real local model via Ollama's OpenAI-compatible
 * endpoint instead of the no-model `HeuristicPlanner` — genuinely free, no
 * API key, runs entirely on your machine (see docs/architecture/phase-6.md
 * for setup). `FallbackPlanner` still falls back to `HeuristicPlanner` if
 * Ollama isn't running or the model call fails, so the CLI never hard-fails
 * just because a local model server isn't up.
 *
 * Phase 7: adds `semanticMemory` (approval-gated, similarity-searchable
 * facts — see docs/architecture/phase-7.md) and `ragAgent` (retrieval +
 * optional model synthesis, used by the `/ask` command). Set
 * `JARVIS_OLLAMA_EMBEDDING_MODEL` (e.g. "nomic-embed-text") for real
 * semantic search via Ollama; otherwise a deterministic offline
 * hash-based pseudo-embedding is used, which still supports meaningful
 * (if less accurate) similarity search with zero setup.
 */
export declare function buildCliDeps(env?: NodeJS.ProcessEnv): CliDeps;
/** Runs a single line of input through the session and returns the agent's text output. */
export declare function runOnce(session: SessionManager, line: string): Promise<string>;
/**
 * Routes a line of input to either a "/" meta-command (memory recall/
 * remember/history/forget) or the normal orchestrator path. Normal
 * (non-command) turns are recorded into `workingMemory` on both sides of
 * the exchange — this is the only place that happens, so it can't be
 * forgotten in one code path and not another.
 */
export declare function processLine(line: string, deps: CliDeps): Promise<string>;
/**
 * Interactive REPL loop. Exits on "exit"/"quit" (case-insensitive) or EOF.
 *
 * Deliberately uses the `for await...of rl` async-iterator pattern rather
 * than looping on `rl.question()`. Repeated `question()` calls do not
 * reliably read subsequent lines when stdin is piped (non-TTY) — verified
 * empirically: a second `question()` call in a loop hangs indefinitely on
 * piped input even though buffered lines remain unread. The async-iterator
 * form is Node's documented pattern for line-by-line consumption and behaves
 * correctly for both an interactive TTY and piped/scripted input.
 */
export declare function runRepl(deps: CliDeps): Promise<void>;
export declare function main(argv?: readonly string[]): Promise<void>;
//# sourceMappingURL=cli.d.ts.map