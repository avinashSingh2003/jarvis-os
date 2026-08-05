import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildCliDeps, processLine } from '../src/cli';

/**
 * Each test gets its own subdirectory under a shared temp root (mirroring
 * the "different filename per test" convention used in
 * packages/security/tests/secret-store.test.ts) rather than sharing one
 * `.jarvis-os` directory across tests, which would let episodes recorded in
 * one test leak into another test's /history output.
 */
describe('CLI memory commands (/recall, /remember, /history, /forget)', () => {
  let tmpRoot: string;

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cli-memory-test-'));
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function freshDeps(testName: string) {
    return buildCliDeps({ JARVIS_DATA_DIR: path.join(tmpRoot, testName) });
  }

  it('/recall reports no turns before any conversation has happened', async () => {
    const deps = freshDeps('recall-empty');
    const output = await processLine('/recall', deps);
    assert.match(output, /no turns in working memory/);
  });

  it('a normal (non-command) turn is recorded into working memory, then /recall shows it', async () => {
    const deps = freshDeps('recall-after-turn');
    await processLine('hello there', deps);

    const output = await processLine('/recall', deps);
    assert.match(output, /\[user\] hello there/);
    assert.match(output, /\[agent\]/); // the orchestrator's response was recorded too
  });

  it('/remember without text shows usage instead of silently doing nothing', async () => {
    const deps = freshDeps('remember-usage');
    const output = await processLine('/remember', deps);
    assert.match(output, /Usage: \/remember/);
  });

  it('/remember stores an episode, and /history then shows it', async () => {
    const deps = freshDeps('remember-then-history');
    const rememberOutput = await processLine('/remember I like dark mode', deps);
    assert.match(rememberOutput, /Remembered as episode/);

    const historyOutput = await processLine('/history', deps);
    assert.match(historyOutput, /I like dark mode/);
  });

  it('/forget removes a previously remembered episode', async () => {
    const deps = freshDeps('remember-then-forget');
    const rememberOutput = await processLine('/remember temporary fact', deps);
    const id = /episode (\S+)\./.exec(rememberOutput)?.[1];
    assert.ok(id);

    const forgetOutput = await processLine(`/forget ${id}`, deps);
    assert.equal(forgetOutput, `Forgot episode ${id}.`);

    const historyOutput = await processLine('/history', deps);
    assert.equal(historyOutput.includes('temporary fact'), false);
  });

  it('/forget on an unknown id reports that clearly rather than pretending success', async () => {
    const deps = freshDeps('forget-unknown');
    const output = await processLine('/forget nonexistent-id', deps);
    assert.match(output, /No episode found with id/);
  });

  it('an unrecognized slash command gets a helpful message, not silence or a crash', async () => {
    const deps = freshDeps('unknown-command');
    const output = await processLine('/bogus', deps);
    assert.match(output, /Unknown command: \/bogus/);
  });

  it('episodic memory persists to a real file, and the audit log records the write', async () => {
    const dataDir = path.join(tmpRoot, 'persistence-check');
    const deps = buildCliDeps({ JARVIS_DATA_DIR: dataDir });
    await processLine('/remember isolated fact', deps);

    const episodesPath = path.join(dataDir, 'episodes.jsonl');
    const auditPath = path.join(dataDir, 'audit.log');
    assert.equal(fs.existsSync(episodesPath), true);
    assert.equal(fs.existsSync(auditPath), true);

    assert.match(fs.readFileSync(episodesPath, 'utf-8'), /isolated fact/);
    assert.match(fs.readFileSync(auditPath, 'utf-8'), /memory:record/);
  });
});
