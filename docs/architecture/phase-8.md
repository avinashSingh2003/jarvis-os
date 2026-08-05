# Phase 8 — Voice Recognition & Wake Word

## What's built

- `SpeechRecognizer` contract + `NullSpeechRecognizer` (offline canned-text stand-in, same defensive role as `EchoAgent`) + `WhisperCppSpeechRecognizer` (real, shells out to a local `whisper.cpp` binary via an injectable `ProcessRunner` — same testability pattern as `HttpFetch` in Phase 3).
- `WakeWordDetector` contract + `KeywordWakeWordDetector` — a **text-level** substring check on an already-transcribed string. Explicitly not real acoustic wake-word detection (see scoping below).
- `VoiceCommandProcessor` — ties recognition and optional wake-word gating together: transcribe, then (if a detector is configured) only return a dispatchable command if the phrase was present.
- **CLI got `/listen <audio-file-path>`**: transcribes a local audio file and routes the result through the exact same orchestrator path as typed text. Verified for real — success, a missing-file error, and the usage message all behave correctly against the compiled binary.

## Scoping decisions, made explicit rather than glossed over

- **No live/continuous microphone capture.** This needs native audio I/O bindings (nothing in this environment could test them at all) plus macOS microphone-permission handling — a genuine "Phase 12, native Mac integration" problem, not something to bolt on speculatively from a sandbox with no audio hardware whatsoever. `/listen` operates on a file you already have, not a live stream.
- **"Wake word" here means a text-level check, not acoustic detection.** Real always-on wake-word systems (openWakeWord, Porcupine) run a small trained model continuously on raw audio, before any transcription happens, so they can stay low-power and instant. `KeywordWakeWordDetector` checks a transcript that's already been produced — useful for gating a manually-triggered command, not for building an always-listening device.
- **Ollama does not do speech-to-text.** Checked directly rather than assumed: Ollama's own model library has no ASR support. The free/local equivalent to what Ollama does for text and `nomic-embed-text` does for embeddings is a *separate* tool for voice — `whisper.cpp` — not an Ollama model. `WhisperCppSpeechRecognizer` requires whisper.cpp built and a model downloaded separately, which is real additional setup, called out plainly rather than implied to be as easy as `ollama pull`.
- **No automatic fallback from whisper.cpp to the canned-text stand-in.** Unlike the planner/embedding fallback chains, a silent fallback here would mean "you thought you configured real speech recognition, but it silently returned nothing useful" — worse than a clear error. If `JARVIS_WHISPER_BINARY`/`JARVIS_WHISPER_MODEL` are set and the binary fails, `/listen` reports the failure plainly instead.

## Test results

30 new tests (223 total across Phases 1-8). Covers: `defaultProcessRunner` against real (not mocked) child processes — success, non-zero exit, and a genuinely nonexistent command; `NullSpeechRecognizer`'s real file-existence check; `WhisperCppSpeechRecognizer`'s argument construction, both timestamped and plain output parsing, non-zero exit handling, spawn-failure wrapping, and empty-output rejection, all via an injected fake process runner; `KeywordWakeWordDetector`'s case sensitivity and multi-phrase matching; `VoiceCommandProcessor`'s three distinct outcomes (no gating / phrase present / phrase absent); a full integration test simulating whisper.cpp-style timestamped output through wake-word gating; and CLI-level tests for `/listen` covering success, a missing file, and the usage message.
