import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildCliDeps, processLine } from '../src/cli';

describe('CLI /listen command', () => {
  let tmpDir: string;
  let audioFilePath: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cli-listen-test-'));
    audioFilePath = path.join(tmpDir, 'recording.wav');
    fs.writeFileSync(audioFilePath, 'placeholder — not real audio bytes');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function freshDeps() {
    return buildCliDeps({ JARVIS_DATA_DIR: path.join(tmpDir, 'data') });
  }

  it('shows usage when no path is given', async () => {
    const output = await processLine('/listen', freshDeps());
    assert.match(output, /Usage: \/listen/);
  });

  it('reports a clear error (not a crash) for a nonexistent audio file', async () => {
    const output = await processLine(`/listen ${path.join(tmpDir, 'nonexistent.wav')}`, freshDeps());
    assert.match(output, /Could not transcribe/);
    assert.match(output, /not found/);
  });

  it('with the default (no whisper.cpp configured) recognizer, transcribes and dispatches through the same orchestrator path as typed text', async () => {
    const output = await processLine(`/listen ${audioFilePath}`, freshDeps());

    // Default NullSpeechRecognizer returns an empty canned transcript, but
    // the important thing is that the full pipeline ran without error and
    // reached the orchestrator, exactly like typed input would.
    assert.match(output, /^Heard: ""/);
    assert.match(output, /Orchestrated plan for/);
  });
});
