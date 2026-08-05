import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { InMemoryEventBus, LayeredConfig, SessionManager } from '@jarvis/core';
import { EchoAgent } from '@jarvis/agent-echo';
import { HeuristicPlanner, ModelBackedPlanner, FallbackPlanner } from '@jarvis/planner';
import { AgentRegistry, Orchestrator, OrchestratorAgent } from '@jarvis/orchestrator';
import { FileAuditLogger } from '@jarvis/security';
import { InMemoryWorkingMemory, FileEpisodicMemory } from '@jarvis/memory';
import { ModelRouter, OpenAiCompatibleModelProvider } from '@jarvis/model-router';
import {
  HashEmbeddingProvider,
  OllamaEmbeddingProvider,
  FallbackEmbeddingProvider,
  FileSemanticMemory,
  RagAgent,
} from '@jarvis/knowledge';
import { NullSpeechRecognizer, WhisperCppSpeechRecognizer, VoiceCommandProcessor } from '@jarvis/voice';
import type {
  Agent,
  AppConfig,
  EmbeddingProvider,
  EpisodicMemory,
  EventBus,
  Planner,
  SemanticMemory,
  WorkingMemory,
} from '@jarvis/contracts';

/**
 * Builds the real reasoning-model router if `JARVIS_OLLAMA_MODEL` is
 * configured — talking to a local Ollama server via the same
 * `OpenAiCompatibleModelProvider` built in Phase 3, since Ollama's
 * OpenAI-compatible endpoint speaks that exact shape. Returns undefined
 * (no model) otherwise. Shared by both `buildPlanner()` and the Phase 7
 * `RagAgent`, so there's exactly one place that constructs it.
 */
function buildReasoningRouter(config: AppConfig, eventBus: EventBus): ModelRouter | undefined {
  const ollamaModel = config.get('JARVIS_OLLAMA_MODEL');
  if (!ollamaModel) {
    return undefined;
  }

  const ollamaProvider = new OpenAiCompatibleModelProvider({
    name: 'ollama',
    kind: 'reasoning',
    baseUrl: config.get('JARVIS_OLLAMA_BASE_URL') ?? 'http://localhost:11434/v1',
    apiKey: 'ollama', // required by the shared provider shape; ignored by Ollama itself
    model: ollamaModel,
  });
  return new ModelRouter({ providers: [ollamaProvider], eventBus });
}

/**
 * Builds the planner used by the CLI's orchestrator. Defaults to
 * `HeuristicPlanner` (no model, no network). If a reasoning router is
 * available, wraps a real `ModelBackedPlanner` in a `FallbackPlanner`, so
 * an unreachable/not-yet-started Ollama server degrades to the heuristic
 * planner rather than crashing the CLI.
 */
function buildPlanner(eventBus: EventBus, router: ModelRouter | undefined): Planner {
  const heuristic = new HeuristicPlanner();
  if (!router) {
    return heuristic;
  }
  const modelBacked = new ModelBackedPlanner({ router, eventBus });
  return new FallbackPlanner(modelBacked, heuristic, eventBus);
}

/**
 * Builds the embedding provider used by Phase 7's semantic memory. Defaults
 * to `HashEmbeddingProvider` (deterministic, offline, not real ML — see
 * docs/architecture/phase-7.md). If `JARVIS_OLLAMA_EMBEDDING_MODEL` is set
 * (e.g. "nomic-embed-text", pulled in Ollama first), wraps a real
 * `OllamaEmbeddingProvider` in a `FallbackEmbeddingProvider`, so semantic
 * search always works even if Ollama isn't running.
 */
function buildEmbeddingProvider(config: AppConfig, eventBus: EventBus): EmbeddingProvider {
  const hash = new HashEmbeddingProvider();
  const ollamaEmbeddingModel = config.get('JARVIS_OLLAMA_EMBEDDING_MODEL');
  if (!ollamaEmbeddingModel) {
    return hash;
  }

  const ollamaEmbedding = new OllamaEmbeddingProvider({
    baseUrl: config.get('JARVIS_OLLAMA_BASE_URL') ?? 'http://localhost:11434/v1',
    model: ollamaEmbeddingModel,
  });
  return new FallbackEmbeddingProvider(ollamaEmbedding, hash, eventBus);
}

/**
 * Builds the speech recognizer used by Phase 8's `/listen` command.
 * Defaults to `NullSpeechRecognizer` (no binary needed, returns canned
 * text — mainly useful for testing the pipeline itself). If
 * `JARVIS_WHISPER_BINARY` and `JARVIS_WHISPER_MODEL` are both set, uses a
 * real `WhisperCppSpeechRecognizer` — see docs/architecture/phase-8.md for
 * setup. No fallback wrapping here (unlike planner/embedding): if you've
 * gone to the trouble of installing whisper.cpp, a silent fallback to
 * canned text on failure would be more confusing than a clear error.
 */
function buildSpeechRecognizer(config: AppConfig) {
  const binaryPath = config.get('JARVIS_WHISPER_BINARY');
  const modelPath = config.get('JARVIS_WHISPER_MODEL');

  if (binaryPath && modelPath) {
    return new WhisperCppSpeechRecognizer({ binaryPath, modelPath });
  }
  return new NullSpeechRecognizer({ cannedText: '' });
}

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
export function buildCliDeps(env: NodeJS.ProcessEnv = process.env): CliDeps {
  const config = new LayeredConfig({ env });
  const eventBus = new InMemoryEventBus();

  const reasoningRouter = buildReasoningRouter(config, eventBus);
  const planner = buildPlanner(eventBus, reasoningRouter);
  const registry = new AgentRegistry({ defaultAgent: new EchoAgent() });
  const orchestrator = new Orchestrator({ planner, registry, eventBus });
  const agent = new OrchestratorAgent({ orchestrator });

  const dataDir = config.get('JARVIS_DATA_DIR') ?? path.join(process.cwd(), '.jarvis-os');
  const auditLogger = new FileAuditLogger({ filePath: path.join(dataDir, 'audit.log') });
  const workingMemory = new InMemoryWorkingMemory();
  const episodicMemory = new FileEpisodicMemory({
    filePath: path.join(dataDir, 'episodes.jsonl'),
    auditLogger,
  });

  const embeddingProvider = buildEmbeddingProvider(config, eventBus);
  const semanticMemory = new FileSemanticMemory({
    filePath: path.join(dataDir, 'facts.jsonl'),
    embeddingProvider,
    auditLogger,
  });
  const ragAgent = new RagAgent({
    semanticMemory,
    eventBus,
    ...(reasoningRouter !== undefined ? { router: reasoningRouter } : {}),
  });

  const voiceCommandProcessor = new VoiceCommandProcessor({ recognizer: buildSpeechRecognizer(config) });

  if (config.get('JARVIS_LOG_LEVEL') === 'debug') {
    eventBus.subscribe('session:request', (request) => {
      // eslint-disable-next-line no-console
      console.error('[debug] request:', request);
    });
    eventBus.subscribe('session:response', (response) => {
      // eslint-disable-next-line no-console
      console.error('[debug] response:', response);
    });
    for (const type of [
      'model:attempt',
      'model:success',
      'model:provider-failed',
      'model:all-failed',
      'planner:parse-error',
      'planner:fallback-used',
      'embedding:fallback-used',
      'rag:retrieved',
      'orchestrator:plan-created',
      'orchestrator:step-dispatch',
      'orchestrator:step-success',
      'orchestrator:step-error',
      'orchestrator:run-complete',
    ]) {
      eventBus.subscribe(type, (payload) => {
        // eslint-disable-next-line no-console
        console.error(`[debug] ${type}:`, payload);
      });
    }
  }

  const session = new SessionManager({ eventBus, agent });
  return {
    config,
    eventBus,
    session,
    workingMemory,
    episodicMemory,
    semanticMemory,
    ragAgent,
    voiceCommandProcessor,
  };
}

/** Runs a single line of input through the session and returns the agent's text output. */
export async function runOnce(session: SessionManager, line: string): Promise<string> {
  const response = await session.handleInput(line);
  return response.output;
}

/**
 * Routes a line of input to either a "/" meta-command (memory recall/
 * remember/history/forget) or the normal orchestrator path. Normal
 * (non-command) turns are recorded into `workingMemory` on both sides of
 * the exchange — this is the only place that happens, so it can't be
 * forgotten in one code path and not another.
 */
export async function processLine(line: string, deps: CliDeps): Promise<string> {
  const trimmed = line.trim();

  if (trimmed.startsWith('/')) {
    return handleMetaCommand(trimmed, deps);
  }

  deps.workingMemory.addTurn({ role: 'user', content: line, timestamp: new Date().toISOString() });
  const output = await runOnce(deps.session, line);
  deps.workingMemory.addTurn({ role: 'agent', content: output, timestamp: new Date().toISOString() });
  return output;
}

async function handleMetaCommand(command: string, deps: CliDeps): Promise<string> {
  const [rawName, ...rest] = command.slice(1).split(' ');
  const name = (rawName ?? '').toLowerCase();
  const arg = rest.join(' ').trim();

  switch (name) {
    case 'recall': {
      const limit = parsePositiveInt(arg, 10);
      const turns = deps.workingMemory.getRecentTurns(limit);
      if (turns.length === 0) {
        return '(no turns in working memory yet — nothing said this session)';
      }
      return turns.map((t) => `[${t.role}] ${t.content}`).join('\n');
    }

    case 'remember': {
      if (!arg) {
        return 'Usage: /remember <text to remember>';
      }
      // Typing this command IS the explicit approval the Episode contract requires.
      const episode = await deps.episodicMemory.record({ summary: arg, approved: true });
      return episode ? `Remembered as episode ${episode.id}.` : 'Could not remember that.';
    }

    case 'history': {
      const limit = parsePositiveInt(arg, 10);
      const episodes = await deps.episodicMemory.recent(limit);
      if (episodes.length === 0) {
        return '(no remembered episodes yet — use /remember <text> to store one)';
      }
      return episodes.map((e) => `${e.id} (${e.timestamp}): ${e.summary}`).join('\n');
    }

    case 'forget': {
      if (!arg) {
        return 'Usage: /forget <episode-id>';
      }
      const forgotten = await deps.episodicMemory.forget(arg);
      return forgotten ? `Forgot episode ${arg}.` : `No episode found with id "${arg}".`;
    }

    case 'teach': {
      if (!arg) {
        return 'Usage: /teach <fact to remember>';
      }
      // Typing this command IS the explicit approval the SemanticFact contract requires.
      const fact = await deps.semanticMemory.record({ text: arg, approved: true });
      return fact ? `Taught fact ${fact.id}.` : 'Could not store that fact.';
    }

    case 'ask': {
      if (!arg) {
        return 'Usage: /ask <question>';
      }
      const response = await deps.ragAgent.handle({ id: randomUUID(), input: arg });
      return response.output;
    }

    case 'facts': {
      const limit = parsePositiveInt(arg, 10);
      const facts = (await deps.semanticMemory.export()).slice(-limit);
      if (facts.length === 0) {
        return '(no taught facts yet — use /teach <fact> to store one)';
      }
      return facts.map((f) => `${f.id} (${f.timestamp}): ${f.text}`).join('\n');
    }

    case 'listen': {
      if (!arg) {
        return 'Usage: /listen <path-to-audio-file>';
      }
      let result;
      try {
        result = await deps.voiceCommandProcessor.processFile(arg);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Could not transcribe "${arg}": ${message}`;
      }
      if (result.command === null) {
        return `Heard: "${result.transcript}" — but no wake word was detected, so nothing was dispatched.`;
      }
      // Route the transcribed command through the exact same orchestrator
      // path as typed input — voice and text converge here.
      const output = await runOnce(deps.session, result.command);
      return `Heard: "${result.transcript}"\n${output}`;
    }

    default:
      return (
        `Unknown command: /${name}. Available: /recall [n], /remember <text>, /history [n], ` +
        `/forget <id>, /teach <fact>, /ask <question>, /facts [n], /listen <audio-file-path>.`
      );
  }
}

function parsePositiveInt(raw: string, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

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
export async function runRepl(deps: CliDeps): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  stdout.write(
    'JARVIS OS — CLI (orchestrated mode). Type "exit" to quit, or:\n' +
      '  /recall [n]        /remember <text>   /history [n]   /forget <id>\n' +
      '  /teach <fact>      /ask <question>    /facts [n]     /listen <audio-file-path>\n',
  );
  rl.setPrompt('> ');
  rl.prompt();

  try {
    for await (const line of rl) {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        rl.prompt();
        continue;
      }
      if (['exit', 'quit'].includes(trimmed.toLowerCase())) {
        break;
      }

      const output = await processLine(line, deps);
      stdout.write(`${output}\n`);
      rl.prompt();
    }
  } finally {
    rl.close();
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const deps = buildCliDeps();

  if (argv.length > 0) {
    const output = await processLine(argv.join(' '), deps);
    stdout.write(`${output}\n`);
    return;
  }

  await runRepl(deps);
}
