# Voice conversations in AIMEAT apps

Load `/v1/libs/aimeat-auth.js` and `/v1/libs/aimeat-voice.js`. Declare `ai:use` in the app's scopes.
The signed-in owner's provider credentials remain on the node. The built-in stages use the owner's
configured OpenRouter or compatible endpoint. Each stage has its own model and parameters. Nothing
records, calls a provider or persists a transcript until the app starts a session and submits a turn.

```js
const voice = AIMEAT.voice.createSession({
  appId: 'owner/companion.html', // Must equal the signed app grant's full app identity.
  preset: 'balanced',          // balanced | responsive | patient
  language: 'fi-FI',
  input: { mode: 'vad' },      // vad | manual | text
  systemPrompt: 'Answer in Finnish. Keep spoken answers concise.',
  stt: { model: 'your-transcription-model', language: 'fi' },
  llm: { model: 'your-conversation-model', temperature: 0.5 },
  tts: { model: 'your-speech-model', voice: 'your-voice', format: 'pcm', sampleRate: 24000 },
  turn: { silenceMs: 700, minSpeechMs: 250, maxSpeechMs: 30000, bargeIn: true },
  chunking: { minChars: 24, maxChars: 180, maxWaitMs: 350 },
  playback: { bufferMs: 80, maxBufferedMs: 3000, maxPendingSegments: 3 },
});
voice.on('transcript', ({ role, text, final }) => showTranscript(role, text, final));
voice.on('state', ({ state }) => showState(state));
voice.on('error', ({ error }) => showError(error.message));
startButton.onclick = () => voice.start(); // User gesture unlocks audio and requests microphone permission.
stopButton.onclick = () => voice.stop();   // Cancels the turn and releases microphone/audio resources.
```

The model strings above are placeholders. Query the provider catalogue with
`output_modalities=transcription` and `output_modalities=speech`; the default chat catalogue omits
those models. Check each selected TTS model's voice, format, sample rate and channel contract.
PCM means signed 16-bit little-endian samples; the library does not guess a WAV header or resample a
provider's bytes. MP3 is also supported, buffered one bounded segment at a time before decoding.
PCM starts playing incrementally. A provider that does not support PCM must use MP3 explicitly.

## Lifecycle and events

- `start()` opens playback and, unless input.mode is text, the microphone. Call it from a user gesture.
- Manual mode: `begin()` starts recording and interrupts a reply; `commit()` submits the recorded turn.
- VAD mode: local audio energy detects a turn; silenceMs ends it. This is energy detection, not a
  semantic end-of-turn model. Echo cancellation is requested from the browser. Speaker/microphone
  placement and background noise affect interruption; use headphones or manual mode when needed.
- `sendText(text)` skips STT; `sendAudio(blob)` runs STT without requiring manual capture.
- `interrupt()` cancels STT/model/TTS requests, stops scheduled sound and discards the pending queue.
- `stop()` releases devices and allows reconfiguration; `close()` also clears history and listeners.
- `configure(patch)` changes a stopped session. Switching presets resets turn, chunking and playback
  settings to that preset; explicit values in the same patch override it. Models stay unchanged.
  Unknown keys and invalid bounds throw before a call.
- `config`, `history`, `AIMEAT.voice.defaults` and `.presets` return copies.
- `clearHistory()` clears idle conversation history; it is never stored by the library.
- `on(name, handler)` returns an unsubscribe function. Events: state, transcript, segment, audio,
  level, interrupted, timing, usage, error. States: idle, ready, listening, transcribing, thinking,
  speaking, error, closed. A complete turn returns `{text, spoken, turn}`.

Timing events measure milliseconds from submitting the turn. firstAudio is the first audio block
scheduled in the browser, not an acoustic measurement at the speaker. complete includes playback.
Usage events carry each stage's terminal usage, budget and provenance when available. Display the
AI conversation notice and disclose generated content with the existing AIMEAT.ai helpers when
the app displays or publishes it. Synthetic audio is marked in the server stream metadata and its
provenance identifies the generated audio bytes, not the text that was read aloud.

Only fully played segments enter assistant history. On interruption, a partly played segment is
omitted conservatively: the library cannot know which words inside it were audible. User turns are
retained. history.maxTurns bounds memory; closing a session clears it.

## Configuration contract

| Group | Parameters and balanced defaults |
|---|---|
| input | mode manual; echoCancellation, noiseSuppression, autoGainControl true |
| turn | silenceMs 700; minSpeechMs 250; maxSpeechMs 30000; threshold 0.025 RMS; preRollMs 200; bargeIn true; interruptMs 200 |
| stt | provider node; model empty uses owner/node STT default; language empty uses session language; temperature 0 |
| llm | provider node; model empty uses existing model selection; temperature 0.7; topP 1; maxTokens null (no default cap, optional explicit limit); reasoning null |
| tts | provider node; explicit model required; voice alloy; format pcm; sampleRate 24000; channels 1; speed 1; instructions empty |
| chunking | minChars 24; maxChars 180; maxWaitMs 350 |
| playback | bufferMs 80; maxBufferedMs 3000; maxPendingSegments 3; volume 1 |
| history | maxTurns 12 |
| session | appId, language fi-FI, systemPrompt empty, timeoutMs 120000 |

responsive uses silenceMs 450, minChars 12, maxChars 120, maxWaitMs 180, bufferMs 40.
patient uses silenceMs 1200, minChars 50, maxChars 240, maxWaitMs 700, bufferMs 150.
These are starting values, not latency guarantees. Shorter segments start sooner but can sound less
continuous and create more TTS requests. maxPendingSegments applies backpressure to model reads;
maxBufferedMs bounds scheduled audio. There are no automatic paid retries or silent provider fallbacks.

The built-in TTS instructions field maps to OpenRouter's OpenAI provider options. Other vendors'
extra parameters belong in a custom stage adapter. They are never assumed portable.

## Replace any stage

The serializable configuration and executable adapters are separate. Set a stage's provider to
custom to replace just that stage; the others continue to use the node.

```js
const voice = AIMEAT.voice.createSession({
  input: { mode: 'text' },
  llm: { provider: 'custom' },
  tts: { model: 'your-speech-model' },
}, {
  async *complete(messages, { signal, config, turn }) {
    // Feed the app's existing agent, retrieval or tool loop into the same voice coordinator.
    for await (const text of myAgent.reply(messages, { signal })) yield text;
  },
});
```

Adapter signatures:

- `transcribe(blob, context) -> Promise<string>`
- `complete(messages, context) -> AsyncIterable<string>`
- `speak(text, context) -> AsyncIterable<Uint8Array>` in the configured PCM/MP3 format

Every context contains `{signal, config, turn}`. An adapter must honor cancellation and yield only
final user-facing text or audio. A custom adapter owns its credentials, consent and billing path;
never put a permanent provider key into a hosted app. Apps may drive input via sendAudio/sendText
to integrate a different recorder, streaming recognizer or turn detector.

## Server API

`POST /v1/ai/transcribe` remains the shared STT endpoint, with optional temperature and disconnect
cancellation. App tokens are attributed from their signed app identity; a conflicting app_id is 403.

`POST /v1/ai/stream` accepts app_id, messages, optional model, temperature, top_p, max_tokens and
reasoning. `POST /v1/ai/speak` accepts app_id, input (1..4000 characters), model, voice,
response_format (pcm/mp3), speed and instructions. Both require ai:use and return newline-delimited
JSON: start, text/audio, done. After headers, failures are error frames; a stream without done is
not a successful turn. Audio frames contain base64 bytes. Abort the HTTP request to cancel.

The built-in adapters use the authenticated session and refresh once on 401. Every stage shares
the existing daily and application budgets. OpenRouter TTS uses its catalogue's per-character price
for preflight and fallback accounting, then the generation endpoint's actual cost when available.
cost_exact distinguishes an actual cost from an estimate; cost_known is false for a custom speech
provider with neither price nor usage information. Such a provider's speech cost cannot be used to
enforce a monetary ceiling. A cancellation can still incur a provider charge.

The shared usage counter serializes updates within one node process. It does not reserve the cost of
all concurrent in-flight requests across replicas; this is the existing daily budget model, not a
transactional prepaid wallet. Provider-side limits remain appropriate for a hard spending ceiling.

## Browser verification

`/dev/voice/index.html` is a development harness. Its explicit local test mode uses delayed text and
generated PCM to verify the real coordinator and browser audio without external calls. Node mode
uses the actual authenticated STT/LLM/TTS endpoints and requires selected models. Test both manual
and VAD turns, interruption during model generation and playback, invalid settings, restart, and
microphone release. Measure real provider latency separately from the local protocol test.
