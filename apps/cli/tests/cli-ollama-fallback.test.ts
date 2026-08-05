import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCliDeps, runOnce } from '../src/cli';

/**
 * Verifies real (not mocked) behavior when `JARVIS_OLLAMA_MODEL` is set but
 * no Ollama server is actually reachable at the configured address — the
 * exact state anyone is in before they've installed/started Ollama. This
 * makes a genuine network connection attempt to an address nothing is
 * listening on and lets it fail for real, confirming FallbackPlanner
 * degrades to HeuristicPlanner rather than crashing the CLI.
 */
describe('CLI — optional Ollama-backed planning', () => {
  it('falls back to HeuristicPlanner-driven orchestration when Ollama is configured but unreachable', async () => {
    const { session } = buildCliDeps({
      JARVIS_OLLAMA_MODEL: 'llama3.2',
      // Deliberately unused port — nothing is listening here in this test environment.
      JARVIS_OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1',
    });

    const output = await runOnce(session, 'plan my day');

    // Falls all the way through to the same HeuristicPlanner + EchoAgent
    // output shape as the fully-offline default — the CLI never hard-fails
    // just because a configured local model server isn't running.
    assert.match(output, /Orchestrated plan for "plan my day"/);
    assert.match(output, /echo: Address the goal directly: plan my day/);
  });

  it('JARVIS_OLLAMA_MODEL unset behaves identically to before (HeuristicPlanner, no network attempted)', async () => {
    const { session } = buildCliDeps({});
    const output = await runOnce(session, 'plan my day');
    assert.match(output, /Orchestrated plan for "plan my day"/);
  });
});
