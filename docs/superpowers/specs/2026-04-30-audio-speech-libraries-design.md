# Audio & Speech Libraries Design Spec

> **Date:** 2026-04-30
> **Status:** Design
> **Scope:** Two new browser libraries for AI-generated apps: `audio.js` (instruments, synth, soundboard) and `speech.js` (TTS, STT, providers)

---

## 1. Problem

AI-generated AIMEAT apps that need audio (band apps, drum machines, soundboards, games with SFX) must currently use the raw Web Audio API or load Tone.js from a CDN. This is too much context for AI chats to generate reliably -- they hallucinate AudioContext setup, forget to resume after user gesture, and produce broken oscillator configurations.

Similarly, speech (TTS/STT) requires boilerplate around the browser's SpeechSynthesis/SpeechRecognition APIs that AI chats handle inconsistently.

## 2. Solution

Two self-contained libraries following the existing AIMEAT lib pattern (`aimeat-auth.js`, `aimeat-data.js`, etc.):

| Library | Namespace | Purpose | Size target |
|---------|-----------|---------|-------------|
| `audio.js` | `AIMEAT.audio` | Instruments, synth engine, sample loading, soundboard, realtime bridge | ~60KB |
| `speech.js` | `AIMEAT.speech` | Text-to-speech, speech-to-text, provider architecture | ~15KB |

**Primary audience:** AI-generated apps. The API must be so simple that any AI chat produces working audio code on first try.

---

## 3. audio.js -- Detailed Design

### 3.1 Architecture

```
AIMEAT.audio
├── Core Engine
│   ├── AudioContext management (singleton, auto-resume on user gesture)
│   ├── Master output (volume, mute)
│   └── Note frequency table (A0-C8, scientific pitch notation)
├── Built-in Instruments (synth-based, zero loading)
│   ├── piano    — FM synthesis (2-operator)
│   ├── guitar   — Karplus-Strong (plucked string simulation)
│   ├── bass     — Subtractive (sawtooth + lowpass filter)
│   ├── drums    — Noise + sine bursts + envelopes (per-hit type)
│   ├── flute    — Sine + breath noise + vibrato LFO
│   └── synth    — Configurable oscillator (sine/saw/square/tri)
├── Soundboard
│   └── Load and play arbitrary audio files (mp3/ogg/wav)
├── Sample Loader
│   └── Upgrade any instrument from synth to real samples
├── Custom Synth Builder
│   └── Full access to oscillators, envelopes, filters, effects
└── Realtime Bridge
    └── Connect to AimeatRealtime for networked instrument events
```

### 3.2 Core API

#### Play / Stop

```js
// Simplest possible: play a note
AIMEAT.audio.play('piano', 'C4');
AIMEAT.audio.play('guitar', 'E2', { duration: 0.5, velocity: 0.8 });
AIMEAT.audio.play('bass', 'E1', { duration: 1.0 });
AIMEAT.audio.play('flute', 'A4', { vibrato: 0.3 });
AIMEAT.audio.play('synth', 'C4', { wave: 'sawtooth', filter: 800 });

// Stop
AIMEAT.audio.stop('piano', 'C4');   // single note
AIMEAT.audio.stop('piano');          // all notes on instrument
AIMEAT.audio.stop();                 // everything
```

#### Master Output

```js
AIMEAT.audio.master.volume = 0.7;    // 0-1
AIMEAT.audio.master.mute = true;
AIMEAT.audio.master.mute = false;
```

#### Available Instruments

```js
AIMEAT.audio.instruments;
// → ['piano', 'guitar', 'bass', 'drums', 'flute', 'synth']
// Custom synths and loaded soundboard clips also appear here
```

### 3.3 Drums

Drums use hit names instead of musical notes:

```js
AIMEAT.audio.play('drums', 'kick');
AIMEAT.audio.play('drums', 'snare');
AIMEAT.audio.play('drums', 'hihat');
AIMEAT.audio.play('drums', 'hihat-open');
AIMEAT.audio.play('drums', 'crash');
AIMEAT.audio.play('drums', 'ride');
AIMEAT.audio.play('drums', 'tom-high');
AIMEAT.audio.play('drums', 'tom-mid');
AIMEAT.audio.play('drums', 'tom-low');
AIMEAT.audio.play('drums', 'clap');
AIMEAT.audio.play('drums', 'cowbell');
```

Velocity affects dynamics: `AIMEAT.audio.play('drums', 'kick', { velocity: 0.3 })` is soft.

### 3.4 Soundboard

Load and play arbitrary audio files:

```js
// Load a single sound
await AIMEAT.audio.soundboard.load('applause', '/sounds/applause.mp3');
await AIMEAT.audio.soundboard.load('rimshot', 'https://example.com/rimshot.ogg');

// Play
AIMEAT.audio.soundboard.play('applause');
AIMEAT.audio.soundboard.play('rimshot', { volume: 0.5, loop: false });

// Stop
AIMEAT.audio.soundboard.stop('applause');

// Batch load
await AIMEAT.audio.soundboard.loadAll({
  applause: '/sounds/applause.mp3',
  rimshot: '/sounds/rimshot.ogg',
  fanfare: '/sounds/fanfare.mp3'
});
```

### 3.5 Sample Loader

Upgrade any built-in instrument from synthesis to real recorded samples:

```js
// Default: load from AIMEAT node's own sample bank
await AIMEAT.audio.loadSamples('piano');
// Fetches from /lib/samples/piano/*.mp3

// Custom source
await AIMEAT.audio.loadSamples('piano', {
  source: 'https://tonejs.github.io/audio/salamander/'
});

// After loading, .play() automatically uses samples instead of synth
AIMEAT.audio.play('piano', 'C4');  // now real piano sound

// Check if samples are loaded
AIMEAT.audio.hasSamples('piano');  // true/false
```

**Sample interpolation:** The sample bank stores 10-12 key notes per instrument (e.g., A2, C3, E3, A3, C4, E4, A4, C5, E5, C6, C7). Notes between samples are pitch-shifted from the nearest sample using `AudioBufferSourceNode.playbackRate`.

### 3.6 Custom Synth Builder

Full access to design custom sounds -- game effects, sci-fi, ambient, or novel instruments:

```js
const laser = AIMEAT.audio.synth({
  name: 'laser',
  oscillators: [
    { wave: 'sawtooth', detune: 0 },
    { wave: 'square', detune: 7 }
  ],
  envelope: {
    attack: 0.01,
    decay: 0.1,
    sustain: 0,
    release: 0.05
  },
  filter: {
    type: 'lowpass',
    frequency: 2000,
    Q: 5
  },
  pitchEnvelope: {
    start: 2000,    // start frequency (Hz)
    end: 200,       // end frequency (Hz)
    time: 0.15      // sweep duration (s)
  },
  effects: [
    { type: 'distortion', amount: 0.4 }
  ]
});

// Use like any instrument
AIMEAT.audio.play('laser', 'C4');

// Or use the synth object directly
laser.play('C4', { velocity: 0.9 });
laser.stop();
```

#### Synth Config Reference

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Instrument name (used with `AIMEAT.audio.play(name, ...)`) |
| `oscillators` | array | `{ wave, detune, gain }` -- wave: 'sine', 'square', 'sawtooth', 'triangle' |
| `envelope` | object | `{ attack, decay, sustain, release }` -- ADSR in seconds (sustain: 0-1 level) |
| `filter` | object | `{ type, frequency, Q }` -- type: 'lowpass', 'highpass', 'bandpass' |
| `pitchEnvelope` | object | `{ start, end, time }` -- frequency sweep in Hz |
| `effects` | array | Chain of effects (see below) |

#### Available Effects

| Effect | Parameters | Description |
|--------|-----------|-------------|
| `reverb` | `decay` (s), `mix` (0-1) | Convolution reverb |
| `delay` | `time` (s), `feedback` (0-1), `mix` (0-1) | Echo/delay |
| `distortion` | `amount` (0-1) | Waveshaper distortion |
| `chorus` | `rate` (Hz), `depth` (0-1), `mix` (0-1) | Chorus modulation |
| `tremolo` | `rate` (Hz), `depth` (0-1) | Volume modulation |
| `filter` | `type`, `frequency`, `Q` | Additional filter in chain |

### 3.7 Realtime Bridge

Connect audio.js to AimeatRealtime for networked jam sessions:

```js
// One-liner: all incoming broadcast note events play automatically
AIMEAT.audio.connectRealtime(rt);

// Expected broadcast message format:
rt.broadcast({
  instrument: 'piano',
  note: 'C4',
  velocity: 0.8,
  duration: 0.5        // optional
});

// The bridge listens for 'broadcast' and 'peer-data' events
// and calls AIMEAT.audio.play() for messages with instrument + note fields

// Disconnect
AIMEAT.audio.disconnectRealtime();
```

**Loose coupling still works:** Apps can skip the bridge and wire it manually:
```js
rt.on('broadcast', msg => {
  if (msg.data.instrument) {
    AIMEAT.audio.play(msg.data.instrument, msg.data.note, msg.data);
  }
});
```

### 3.8 Built-in Instrument Synthesis Details

| Instrument | Technique | Notes |
|------------|-----------|-------|
| **piano** | 2-operator FM synthesis. Carrier: sine. Modulator: sine at 2x frequency, decaying mod index. Fast attack, medium decay, low sustain. | Note range: A0-C8 |
| **guitar** | Karplus-Strong: short noise burst into filtered delay line. Delay length = 1/frequency. Lowpass filter in feedback loop simulates string damping. | Range: E2-E6 |
| **bass** | Subtractive: sawtooth oscillator through lowpass filter (cutoff ~400Hz). Short attack, medium sustain. Sub-oscillator (sine, -1 octave) for weight. | Range: E1-E4 |
| **drums** | Per-hit synthesis. Kick: sine sweep 150Hz->50Hz + click. Snare: noise burst + sine 200Hz. Hihat: filtered noise (highpass 7kHz). Toms: sine at different pitches. Clap: layered noise bursts. | Named hits |
| **flute** | Sine oscillator + bandpass-filtered noise (breath). Vibrato via LFO on pitch (5-6Hz, controllable depth). Soft attack envelope. | Range: C4-C7 |
| **synth** | Configurable: any wave type, filter, envelope. Defaults to sawtooth + lowpass 2kHz. Supports detuned unison (2-voice). | Range: A0-C8 |

### 3.9 AudioContext Management

The library handles all AudioContext complexity internally:

- **Singleton:** One AudioContext shared across all instruments
- **Auto-resume:** Automatically resumes on first user gesture (click/touch/keydown) to comply with browser autoplay policy
- **Lazy init:** AudioContext is created on first `.play()` call, not on script load
- **State handling:** If context is suspended (tab backgrounded), queues notes and plays when resumed

### 3.10 Note Format

Standard scientific pitch notation:

- Notes: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
- Octave: 0-8 (middle C = C4, A440 = A4)
- Flats: Db, Eb, Gb, Ab, Bb (converted internally to sharps)
- Examples: `'C4'`, `'F#3'`, `'Bb5'`, `'A0'`

---

## 4. speech.js -- Detailed Design

### 4.1 Architecture

```
AIMEAT.speech
├── TTS (Text-to-Speech)
│   ├── Native: browser SpeechSynthesis (default)
│   └── Provider slot: pluggable external TTS
├── STT (Speech-to-Text)
│   ├── Native: browser SpeechRecognition (default)
│   └── Provider slot: pluggable external STT
├── Voice Commands
│   └── Pattern matching on STT results
└── Capability Detection
    └── .supported.tts / .supported.stt
```

### 4.2 TTS API

```js
// Simple
AIMEAT.speech.say('Hello world');
AIMEAT.speech.say('Tervetuloa', { lang: 'fi-FI' });

// Full options
AIMEAT.speech.say('Important message', {
  lang: 'en-US',
  rate: 1.2,           // speed 0.5-2.0
  pitch: 1.0,          // pitch 0.5-2.0
  volume: 0.8,         // volume 0-1
  voice: 'Google UK English Female'   // specific voice by name
});

// Control
AIMEAT.speech.stop();              // stop speaking
AIMEAT.speech.speaking;            // true/false

// Queue: multiple calls queue automatically
AIMEAT.speech.say('First.');
AIMEAT.speech.say('Second.');      // plays after first finishes

// List available voices
const voices = AIMEAT.speech.voices();
// -> [{ name: 'Google UK English Female', lang: 'en-GB' }, ...]
const finnish = AIMEAT.speech.voices({ lang: 'fi' });

// Events
AIMEAT.speech.on('start', () => { /* speech started */ });
AIMEAT.speech.on('end', () => { /* speech ended */ });
AIMEAT.speech.on('word', ({ word, index }) => { /* per-word callback */ });
```

### 4.3 STT API

```js
// One-shot: listen and return text
const result = await AIMEAT.speech.listen();
// -> { text: 'Hello world', confidence: 0.92, lang: 'en-US' }

// With options
const result = await AIMEAT.speech.listen({
  lang: 'fi-FI',
  continuous: false,
  interimResults: true
});

// Continuous listening
AIMEAT.speech.listen({ continuous: true });
AIMEAT.speech.on('result', ({ text, final }) => {
  if (final) console.log('Final:', text);
  else console.log('Interim:', text);
});
AIMEAT.speech.stopListening();

// State
AIMEAT.speech.listening;  // true/false
```

### 4.4 Voice Commands

Pattern-based matching on STT results:

```js
AIMEAT.speech.listen({
  continuous: true,
  commands: {
    'play *instrument': (instrument) => AIMEAT.audio.play(instrument, 'C4'),
    'stop': () => AIMEAT.audio.stop(),
    'volume *level': (level) => {
      AIMEAT.audio.master.volume = parseFloat(level) / 100;
    },
    'say hello': () => AIMEAT.speech.say('Hello!'),
  }
});
```

Wildcard `*name` captures one or more words. Matching is case-insensitive. Commands are checked against the final STT result.

### 4.5 Provider Architecture

Native browser APIs are the default. External providers can be plugged in with the same API surface:

```js
// TTS provider
AIMEAT.speech.use('tts', {
  name: 'elevenlabs',
  say: async (text, opts) => {
    const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/...', {
      method: 'POST',
      headers: { 'xi-api-key': opts.apiKey },
      body: JSON.stringify({ text, voice_settings: { ... } })
    });
    const blob = await res.blob();
    return blob;  // library plays this via AudioContext
  },
  voices: async () => { /* return voice list */ }
});

// STT provider
AIMEAT.speech.use('stt', {
  name: 'whisper',
  listen: async (audioBlob, opts) => {
    const form = new FormData();
    form.append('file', audioBlob);
    form.append('language', opts.lang);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${opts.apiKey}` },
      body: form
    });
    return await res.json();
  }
});

// Usage stays the same after provider swap
AIMEAT.speech.say('Now using ElevenLabs');
const result = await AIMEAT.speech.listen();
```

When a cloud STT provider is active, `speech.js` records audio via `MediaRecorder` and passes the blob to the provider's `listen()` function.

### 4.6 Capability Detection

```js
AIMEAT.speech.supported;          // { tts: true, stt: true }
AIMEAT.speech.supported.tts;      // true if SpeechSynthesis available
AIMEAT.speech.supported.stt;      // true if SpeechRecognition available
// Note: stt is false on Firefox (no SpeechRecognition API)
// Cloud providers work regardless of native support
```

### 4.7 Events

| Event | Payload | When |
|-------|---------|------|
| `start` | `{}` | TTS speech started |
| `end` | `{}` | TTS speech ended (queue empty) |
| `word` | `{ word, index }` | TTS reached a word boundary |
| `result` | `{ text, final, confidence }` | STT result (interim or final) |
| `listening` | `{}` | STT microphone activated |
| `stopped` | `{}` | STT stopped listening |
| `error` | `{ error }` | Any error (permission denied, network, etc.) |

---

## 5. Implementation Pattern

Both libraries follow the existing lib pattern from `libs.ts`:

### 5.1 File Structure

```
aimeat/src/routes/
├── libs.ts                    -- Router (add audio + speech routes)
├── lib-audio.ts               -- audio.js generator function
└── lib-speech.ts              -- speech.js generator function

aimeat/public/lib/
├── audio.js                   -- Also served as static file for SPA imports
├── speech.js                  -- Also served as static file for SPA imports
└── samples/                   -- Instrument sample bank
    ├── piano/                 -- ~300KB (10-12 key notes)
    │   ├── A2.mp3
    │   ├── C3.mp3
    │   ├── E3.mp3
    │   ├── A3.mp3
    │   ├── C4.mp3
    │   ├── E4.mp3
    │   ├── A4.mp3
    │   ├── C5.mp3
    │   ├── E5.mp3
    │   ├── C6.mp3
    │   └── C7.mp3
    ├── guitar/                -- ~200KB
    ├── bass/                  -- ~150KB
    ├── drums/                 -- ~250KB
    │   ├── kick.mp3
    │   ├── snare.mp3
    │   ├── hihat.mp3
    │   ├── hihat-open.mp3
    │   ├── crash.mp3
    │   ├── ride.mp3
    │   ├── tom-high.mp3
    │   ├── tom-mid.mp3
    │   ├── tom-low.mp3
    │   ├── clap.mp3
    │   └── cowbell.mp3
    └── flute/                 -- ~150KB
```

### 5.2 Dual Serving

Libraries are served from two paths:

1. **`/v1/libs/aimeat-audio.js`** -- Generated by `lib-audio.ts`, includes baked-in config (nodeId, baseUrl). For AI-generated apps via `<script src>`.
2. **`/lib/audio.js`** -- Static file in `public/lib/`. For SPA imports via importmap. Does not include baked config (uses auto-detection like realtime.js).

The static file (`public/lib/audio.js`) is the canonical source. The route handler (`lib-audio.ts`) wraps it with config injection. This avoids maintaining two copies.

**Decision: generate-only vs. static+wrapper.** The existing libs (auth, data, social, etc.) are generate-only (TypeScript functions that output JS strings). For audio.js, the same pattern should be used for consistency, since:
- The lib needs `config.baseUrl` baked in for sample URL resolution
- Audio.js is ~60KB -- maintaining it as a template string is unwieldy but matches the pattern
- The `public/lib/audio.js` static file serves as the SPA-importable version with auto-detect

### 5.3 Sample Serving

Samples are static files served by Express's static file handler. The `/lib/samples/` path is already covered by the existing `express.static('public')` middleware.

Sample URL pattern: `${config.baseUrl}/lib/samples/{instrument}/{note}.mp3`

### 5.4 Distribution / Packaging

Samples must be included in npm distribution:

1. **Build script** (`package.json` `build`): Already copies `public/` to `dist/public/` -- samples in `public/lib/samples/` are included automatically.

2. **`package.json` `files`**: Current value is `["dist/", "prisma/", ...]`. Since `dist/` includes `dist/public/lib/samples/`, samples are included in the npm tarball automatically.

3. **`aimeat init`**: No special handling needed. Samples ship with the package. When a user runs `npm i -g aimeat && aimeat init`, the samples are already present in the installed package's `public/lib/samples/` directory.

4. **Docker**: Dockerfile copies the full build output. Samples included.

5. **Size budget**: Total samples ~1MB. Acceptable for an npm package that includes a full server.

### 5.5 Importmap Integration

Add to `public/spa.html` importmap for SPA cache busting:

```json
"/lib/audio.js": "/lib/audio.js",
"/lib/speech.js": "/lib/speech.js"
```

### 5.6 Library Listing

Add both libraries to the `/v1/libs` listing in `libs.ts`:

```js
{
  name: 'aimeat-audio',
  url: '/v1/libs/aimeat-audio.js',
  description: 'Audio engine: 6 built-in instruments, custom synth builder, sample loader, soundboard, realtime bridge',
  size_estimate: '~60KB',
  include: `<script src="${config.baseUrl}/v1/libs/aimeat-audio.js"></script>`,
},
{
  name: 'aimeat-speech',
  url: '/v1/libs/aimeat-speech.js',
  description: 'Speech: text-to-speech, speech-to-text, voice commands, pluggable providers (ElevenLabs, Whisper, etc.)',
  size_estimate: '~15KB',
  include: `<script src="${config.baseUrl}/v1/libs/aimeat-speech.js"></script>`,
}
```

### 5.7 Test Harness

Add to the existing dev-mode test harness in `libs.ts`:

```html
<script src="/v1/libs/aimeat-audio.js"></script>
<script src="/v1/libs/aimeat-speech.js"></script>
```

And log:
```js
tlog('... audio=' + !!AIMEAT.audio + ' speech=' + !!AIMEAT.speech);
```

---

## 6. llms-template.txt Integration

Add audio and speech library reference cards to `public/llms-template.txt` so AI chats know the API exists:

```
## Audio Library
Include: <script src="{{BASE_URL}}/v1/libs/aimeat-audio.js"></script>

AIMEAT.audio.play(instrument, note, opts?)
  instruments: 'piano', 'guitar', 'bass', 'drums', 'flute', 'synth'
  note: 'C4', 'F#3', 'Bb5' (scientific pitch) or drum hit name
  opts: { duration, velocity, wave, filter, vibrato }
AIMEAT.audio.stop(instrument?, note?)
AIMEAT.audio.master.volume = 0.7
AIMEAT.audio.soundboard.load(name, url)
AIMEAT.audio.soundboard.play(name, opts?)
AIMEAT.audio.loadSamples(instrument)  // upgrade to real sounds
AIMEAT.audio.synth({ name, oscillators, envelope, filter, effects })
AIMEAT.audio.connectRealtime(rt)  // auto-play incoming note events

Drums: kick, snare, hihat, hihat-open, crash, ride, tom-high, tom-mid, tom-low, clap, cowbell

## Speech Library
Include: <script src="{{BASE_URL}}/v1/libs/aimeat-speech.js"></script>

AIMEAT.speech.say(text, { lang, rate, pitch, volume, voice })
AIMEAT.speech.stop()
AIMEAT.speech.voices({ lang })
AIMEAT.speech.listen({ lang, continuous })  // returns { text, confidence }
AIMEAT.speech.on('result', ({ text, final }) => ...)
AIMEAT.speech.stopListening()
AIMEAT.speech.supported  // { tts: true, stt: true }
```

---

## 7. Scope Boundaries

### In scope
- audio.js with 6 built-in synth instruments + soundboard + custom synth + sample loader + realtime bridge
- speech.js with native TTS/STT + provider architecture + voice commands
- Sample bank (~1MB total) for piano, guitar, bass, drums, flute
- Integration with libs.ts router, library listing, test harness
- llms-template.txt reference cards
- importmap entries in spa.html

### Out of scope (future)
- MIDI input/output support
- Audio recording/export (WAV/MP3 rendering)
- Multi-track sequencer/DAW features
- Audio visualization (spectrum, waveform) -- use Canvas + AudioAnalyser directly
- Streaming audio between peers (already handled by realtime.js WebRTC)
- Cloud TTS/STT provider implementations (only the provider interface ships)
- Audio file upload to AIMEAT storage (use aimeat-storage.js for that)

---

## 8. Success Criteria

1. An AI chat given only the llms-template.txt reference card can produce a working drum machine app on first try
2. `AIMEAT.audio.play('piano', 'C4')` produces audible sound with zero setup
3. All synth instruments sound recognizably like their real counterparts (not just beeps)
4. Sample loading upgrades instrument quality with a single line
5. Realtime bridge enables a working band-app in under 20 lines of app code
6. `AIMEAT.speech.say('Hello')` speaks immediately with no configuration
7. Provider swap is transparent -- same API, better quality
8. Both libraries work standalone (no dependency on each other or other AIMEAT libs)
9. Total audio.js size stays under 70KB uncompressed
10. Samples ship with npm package and work after `npm i -g aimeat`
