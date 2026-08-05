import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { buildCliDeps, runOnce } from '../src/cli';

const CLI_ENTRY = path.join(__dirname, '..', 'dist', 'index.js');

/**
 * Runs the *compiled* CLI as a real child process with piped stdin and
 * collects its stdout. This is deliberately a process-level test, not a
 * function-level one: it's the only way to catch environment-dependent bugs
 * like the readline/piped-stdin issue documented below, which don't
 * reproduce when calling runRepl() directly in-process against a fake
 * stream.
 */
function runCliProcess(input: string): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ stdout, exitCode }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Phase 5 update: the CLI's default agent changed from `EchoAgent` directly
 * to `OrchestratorAgent` (HeuristicPlanner -> AgentRegistry -> Orchestrator,
 * with EchoAgent now used as the orchestrator's default worker rather than
 * the top-level agent). Output format changed accordingly — these tests
 * were updated to match, not just loosened to keep passing. The
 * `Orchestrated plan for "..."` framing plus the original phrase surviving
 * all the way through to the (still-present) "echo:" prefix is what proves
 * the full pipeline — Config -> EventBus -> SessionManager ->
 * OrchestratorAgent -> Orchestrator -> HeuristicPlanner -> AgentRegistry ->
 * EchoAgent — is genuinely wired end-to-end, not just that some string
 * matched.
 */
describe('CLI integration', () => {
  it('routes input through the full orchestrated stack end-to-end', async () => {
    const { session } = buildCliDeps({});
    const output = await runOnce(session, 'hello JARVIS');

    assert.equal(
      output,
      'Orchestrated plan for "hello JARVIS":\n' +
        '1. [done] Address the goal directly: hello JARVIS -> echo: Address the goal directly: hello JARVIS',
    );
  });

  it('debug logging can be toggled via config without changing the response', async () => {
    const { session } = buildCliDeps({ JARVIS_LOG_LEVEL: 'debug' });
    const output = await runOnce(session, 'test input');
    assert.match(output, /Orchestrated plan for "test input"/);
    assert.match(output, /echo: Address the goal directly: test input/);
  });

  it('two independent sessions do not share state', async () => {
    const depsA = buildCliDeps({});
    const depsB = buildCliDeps({});

    const outputA = await runOnce(depsA.session, 'from A');
    const outputB = await runOnce(depsB.session, 'from B');

    assert.match(outputA, /from A/);
    assert.match(outputB, /from B/);
    assert.equal(outputA.includes('from B'), false);
    assert.equal(outputB.includes('from A'), false);
  });

  it('REGRESSION: processes every line from piped (non-TTY) stdin, not just the first', async () => {
    // Guards against a real bug found during Phase 1 manual verification:
    // looping on `rl.question()` silently stops reading after the first
    // line when stdin is piped rather than an interactive TTY. Still
    // relevant after the Phase 5 wiring change since it's a property of the
    // REPL loop itself, independent of which agent is behind it.
    const { stdout, exitCode } = await runCliProcess('good morning\nwhat is my status\nexit\n');

    assert.match(stdout, /good morning/);
    assert.match(stdout, /what is my status/);
    assert.equal(exitCode, 0);
  });
});
