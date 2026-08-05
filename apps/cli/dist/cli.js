"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCliDeps = buildCliDeps;
exports.runOnce = runOnce;
exports.processLine = processLine;
exports.runRepl = runRepl;
exports.main = main;
const readline = __importStar(require("node:readline/promises"));
const node_process_1 = require("node:process");
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const core_1 = require("@jarvis/core");
const agent_echo_1 = require("@jarvis/agent-echo");
const planner_1 = require("@jarvis/planner");
const orchestrator_1 = require("@jarvis/orchestrator");
const security_1 = require("@jarvis/security");
const memory_1 = require("@jarvis/memory");
const model_router_1 = require("@jarvis/model-router");
const knowledge_1 = require("@jarvis/knowledge");
const voice_1 = require("@jarvis/voice");
/**
 * Builds the real reasoning-model router if `JARVIS_OLLAMA_MODEL` is
 * configured — talking to a local Ollama server via the same
 * `OpenAiCompatibleModelProvider` built in Phase 3, since Ollama's
 * OpenAI-compatible endpoint speaks that exact shape. Returns undefined
 * (no model) otherwise. Shared by both `buildPlanner()` and the Phase 7
 * `RagAgent`, so there's exactly one place that constructs it.
 */
function buildReasoningRouter(config, eventBus) {
    const ollamaModel = config.get('JARVIS_OLLAMA_MODEL');
    if (!ollamaModel) {
        return undefined;
    }
    const ollamaProvider = new model_router_1.OpenAiCompatibleModelProvider({
        name: 'ollama',
        kind: 'reasoning',
        baseUrl: config.get('JARVIS_OLLAMA_BASE_URL') ?? 'http://localhost:11434/v1',
        apiKey: 'ollama', // required by the shared provider shape; ignored by Ollama itself
        model: ollamaModel,
    });
    return new model_router_1.ModelRouter({ providers: [ollamaProvider], eventBus });
}
/**
 * Builds the planner used by the CLI's orchestrator. Defaults to
 * `HeuristicPlanner` (no model, no network). If a reasoning router is
 * available, wraps a real `ModelBackedPlanner` in a `FallbackPlanner`, so
 * an unreachable/not-yet-started Ollama server degrades to the heuristic
 * planner rather than crashing the CLI.
 */
function buildPlanner(eventBus, router) {
    const heuristic = new planner_1.HeuristicPlanner();
    if (!router) {
        return heuristic;
    }
    const modelBacked = new planner_1.ModelBackedPlanner({ router, eventBus });
    return new planner_1.FallbackPlanner(modelBacked, heuristic, eventBus);
}
/**
 * Builds the embedding provider used by Phase 7's semantic memory. Defaults
 * to `HashEmbeddingProvider` (deterministic, offline, not real ML — see
 * docs/architecture/phase-7.md). If `JARVIS_OLLAMA_EMBEDDING_MODEL` is set
 * (e.g. "nomic-embed-text", pulled in Ollama first), wraps a real
 * `OllamaEmbeddingProvider` in a `FallbackEmbeddingProvider`, so semantic
 * search always works even if Ollama isn't running.
 */
function buildEmbeddingProvider(config, eventBus) {
    const hash = new knowledge_1.HashEmbeddingProvider();
    const ollamaEmbeddingModel = config.get('JARVIS_OLLAMA_EMBEDDING_MODEL');
    if (!ollamaEmbeddingModel) {
        return hash;
    }
    const ollamaEmbedding = new knowledge_1.OllamaEmbeddingProvider({
        baseUrl: config.get('JARVIS_OLLAMA_BASE_URL') ?? 'http://localhost:11434/v1',
        model: ollamaEmbeddingModel,
    });
    return new knowledge_1.FallbackEmbeddingProvider(ollamaEmbedding, hash, eventBus);
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
function buildSpeechRecognizer(config) {
    const binaryPath = config.get('JARVIS_WHISPER_BINARY');
    const modelPath = config.get('JARVIS_WHISPER_MODEL');
    if (binaryPath && modelPath) {
        return new voice_1.WhisperCppSpeechRecognizer({ binaryPath, modelPath });
    }
    return new voice_1.NullSpeechRecognizer({ cannedText: '' });
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
function buildCliDeps(env = process.env) {
    const config = new core_1.LayeredConfig({ env });
    const eventBus = new core_1.InMemoryEventBus();
    const reasoningRouter = buildReasoningRouter(config, eventBus);
    const planner = buildPlanner(eventBus, reasoningRouter);
    const registry = new orchestrator_1.AgentRegistry({ defaultAgent: new agent_echo_1.EchoAgent() });
    const orchestrator = new orchestrator_1.Orchestrator({ planner, registry, eventBus });
    const agent = new orchestrator_1.OrchestratorAgent({ orchestrator });
    const dataDir = config.get('JARVIS_DATA_DIR') ?? path.join(process.cwd(), '.jarvis-os');
    const auditLogger = new security_1.FileAuditLogger({ filePath: path.join(dataDir, 'audit.log') });
    const workingMemory = new memory_1.InMemoryWorkingMemory();
    const episodicMemory = new memory_1.FileEpisodicMemory({
        filePath: path.join(dataDir, 'episodes.jsonl'),
        auditLogger,
    });
    const embeddingProvider = buildEmbeddingProvider(config, eventBus);
    const semanticMemory = new knowledge_1.FileSemanticMemory({
        filePath: path.join(dataDir, 'facts.jsonl'),
        embeddingProvider,
        auditLogger,
    });
    const ragAgent = new knowledge_1.RagAgent({
        semanticMemory,
        eventBus,
        ...(reasoningRouter !== undefined ? { router: reasoningRouter } : {}),
    });
    const voiceCommandProcessor = new voice_1.VoiceCommandProcessor({ recognizer: buildSpeechRecognizer(config) });
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
    const session = new core_1.SessionManager({ eventBus, agent });
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
async function runOnce(session, line) {
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
async function processLine(line, deps) {
    const trimmed = line.trim();
    if (trimmed.startsWith('/')) {
        return handleMetaCommand(trimmed, deps);
    }
    deps.workingMemory.addTurn({ role: 'user', content: line, timestamp: new Date().toISOString() });
    const output = await runOnce(deps.session, line);
    deps.workingMemory.addTurn({ role: 'agent', content: output, timestamp: new Date().toISOString() });
    return output;
}
async function handleMetaCommand(command, deps) {
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
            const response = await deps.ragAgent.handle({ id: (0, node_crypto_1.randomUUID)(), input: arg });
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
            }
            catch (error) {
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
            return (`Unknown command: /${name}. Available: /recall [n], /remember <text>, /history [n], ` +
                `/forget <id>, /teach <fact>, /ask <question>, /facts [n], /listen <audio-file-path>.`);
    }
}
function parsePositiveInt(raw, fallback) {
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
async function runRepl(deps) {
    const rl = readline.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
    node_process_1.stdout.write('JARVIS OS — CLI (orchestrated mode). Type "exit" to quit, or:\n' +
        '  /recall [n]        /remember <text>   /history [n]   /forget <id>\n' +
        '  /teach <fact>      /ask <question>    /facts [n]     /listen <audio-file-path>\n');
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
            node_process_1.stdout.write(`${output}\n`);
            rl.prompt();
        }
    }
    finally {
        rl.close();
    }
}
async function main(argv = process.argv.slice(2)) {
    const deps = buildCliDeps();
    if (argv.length > 0) {
        const output = await processLine(argv.join(' '), deps);
        node_process_1.stdout.write(`${output}\n`);
        return;
    }
    await runRepl(deps);
}
//# sourceMappingURL=cli.js.map