# Audio & Speech Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two browser libraries (`audio.js` ~60KB, `speech.js` ~15KB) for AI-generated AIMEAT apps, following the existing lib pattern from `libs.ts`.

**Architecture:** Each library is a TypeScript function in `src/routes/lib-*.ts` that returns a JS string. The router in `libs.ts` serves them at `/v1/libs/aimeat-audio.js` and `/v1/libs/aimeat-speech.js`. Audio samples live in `public/lib/samples/` as static MP3 files.

**Tech Stack:** Web Audio API (AudioContext, OscillatorNode, GainNode, BiquadFilterNode, DelayNode, ConvolverNode), SpeechSynthesis API, SpeechRecognition API, MediaRecorder API.

**Spec:** `docs/superpowers/specs/2026-04-30-audio-speech-libraries-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/routes/lib-audio.ts` | `aimeatAudioLib(config)` -- returns full audio.js as string |
| Create | `src/routes/lib-speech.ts` | `aimeatSpeechLib(config)` -- returns full speech.js as string |
| Modify | `src/routes/libs.ts` | Import + route + listing + test harness for both new libs |
| Modify | `public/spa.html` | Importmap entries for `/lib/audio.js`, `/lib/speech.js` |
| Modify | `public/llms-template.txt` | Library table + SDK reference cards |
| Create | `public/lib/audio.js` | Static copy for SPA imports (auto-detect config) |
| Create | `public/lib/speech.js` | Static copy for SPA imports (auto-detect config) |
| Create | `public/lib/samples/piano/*.mp3` | 11 piano samples (Salamander, CC BY 3.0) |
| Create | `public/lib/samples/guitar/*.mp3` | 8 guitar samples (CC0 / generated) |
| Create | `public/lib/samples/bass/*.mp3` | 6 bass samples (CC0 / generated) |
| Create | `public/lib/samples/drums/*.mp3` | 11 drum hit samples (CC0) |
| Create | `public/lib/samples/flute/*.mp3` | 7 flute samples (CC0 / VCSL) |
| Create | `public/lib/samples/LICENSE.md` | Attribution for all sample sources |
| Create | `test/e2e-audio-speech.ts` | E2E API test (library serving, samples) |
| Create | `test/playwright/audio-speech.spec.ts` | Playwright browser tests |

---

## Sample Sources & Acquisition

### Piano -- Salamander Grand Piano (CC BY 3.0)

**Source:** Alexander Holm's Salamander Grand Piano, hosted on Tone.js CDN
**License:** Creative Commons Attribution 3.0 -- allows redistribution in MIT projects with attribution
**Download URLs:** (select 11 notes spanning A2-C7)

```
https://tonejs.github.io/audio/salamander/A2.mp3
https://tonejs.github.io/audio/salamander/C3.mp3
https://tonejs.github.io/audio/salamander/E3.mp3
https://tonejs.github.io/audio/salamander/A3.mp3
https://tonejs.github.io/audio/salamander/C4.mp3
https://tonejs.github.io/audio/salamander/E4.mp3
https://tonejs.github.io/audio/salamander/A4.mp3
https://tonejs.github.io/audio/salamander/C5.mp3
https://tonejs.github.io/audio/salamander/E5.mp3
https://tonejs.github.io/audio/salamander/C6.mp3
https://tonejs.github.io/audio/salamander/C7.mp3
```

**Expected size:** ~300-500KB total (each note 30-70KB)

### Drums -- Freesound CC0 or Tone.js

**Primary source:** Tone.js drum-machine samples at `https://tonejs.github.io/audio/drum-machine/`
**Alternative:** Freesound.org CC0 samples (search by license filter)
**Backup plan:** If licensing is unclear, generate drum samples programmatically using Web Audio API offline rendering (OfflineAudioContext) and save as WAV/MP3. Drum synthesis is already implemented in the library, so a small Node.js script can render each hit to a file.

Files needed: `kick.mp3`, `snare.mp3`, `hihat.mp3`, `hihat-open.mp3`, `crash.mp3`, `ride.mp3`, `tom-high.mp3`, `tom-mid.mp3`, `tom-low.mp3`, `clap.mp3`, `cowbell.mp3`

### Guitar, Bass, Flute -- CC0 / VCSL

**Guitar & Bass:** Freesound.org CC0 samples. Search: `acoustic guitar single note license:CC0`, `bass guitar note license:CC0`. Select 6-8 notes spanning the instrument range.
**Flute:** VCSL (Versilian Community Sample Library) at `https://github.com/sgossner/VCSL` -- CC0 license, contains orchestral instruments including flute. Extract individual notes from the SFZ+WAV pack.

**Alternative for all:** If high-quality CC0 samples prove hard to curate, the library's built-in synthesis is the primary sound source. Samples are an optional upgrade. Ship with piano (Salamander, proven source) and drums first; guitar/bass/flute samples can be added in a follow-up once properly curated.

### License File

Create `public/lib/samples/LICENSE.md`:
```markdown
# Audio Sample Licenses

## Piano (piano/)
Salamander Grand Piano by Alexander Holm
License: CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)
Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html

## Drums (drums/)
[Source and license per file]

## Guitar (guitar/)
[Source and license per file]

## Bass (bass/)
[Source and license per file]

## Flute (flute/)
[Source and license per file]
```

---

## Task 1: Audio Engine Core -- AudioContext, Note Table, Master Output

**Files:**
- Create: `aimeat/src/routes/lib-audio.ts`

This task creates the `lib-audio.ts` file with the core engine that all instruments depend on. The file exports `aimeatAudioLib(config)` returning a JS string, same pattern as `lib-data.ts`.

- [ ] **Step 1: Create `lib-audio.ts` with IIFE shell, AudioContext manager, note frequency table, and master output**

```typescript
// aimeat/src/routes/lib-audio.ts
import type { AimeatConfig } from '../config.js';

export function aimeatAudioLib(config: AimeatConfig): string {
    return `// aimeat-audio.js — AIMEAT Audio Library
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Include: <script src="${config.baseUrl}/v1/libs/aimeat-audio.js"><\\/script>
// Usage: AIMEAT.audio.play('piano', 'C4');
(function(global) {
'use strict';

const NODE_URL = (function() {
  const meta = document.querySelector('meta[name="aimeat-node"]');
  if (meta) return meta.getAttribute('content').replace(/\\/$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return '${config.baseUrl}';
})();

// ── AudioContext singleton ──

let _ctx = null;
let _resumed = false;

function ctx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Auto-resume on first user gesture (browser autoplay policy)
    if (_ctx.state === 'suspended') {
      const resume = () => {
        if (_ctx && _ctx.state === 'suspended') {
          _ctx.resume().then(() => { _resumed = true; });
        }
      };
      ['click', 'touchstart', 'keydown'].forEach(e =>
        document.addEventListener(e, resume, { once: false, passive: true })
      );
    } else {
      _resumed = true;
    }
  }
  return _ctx;
}

// ── Note frequency table (A0-C8, scientific pitch notation) ──

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_MAP = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
const _freqCache = {};

function noteToFreq(note) {
  if (_freqCache[note]) return _freqCache[note];
  let n = note.trim();
  // Handle flats
  const flatKey = n.slice(0, 2);
  if (FLAT_MAP[flatKey]) n = FLAT_MAP[flatKey] + n.slice(2);
  // Parse note name and octave
  const match = n.match(/^([A-G]#?)(\\d)$/);
  if (!match) return null;
  const name = match[1];
  const octave = parseInt(match[2]);
  const semitone = NOTE_NAMES.indexOf(name);
  if (semitone < 0) return null;
  // MIDI note number: C4 = 60, A4 = 69
  const midi = (octave + 1) * 12 + semitone;
  // A4 = 440Hz
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  _freqCache[note] = freq;
  return freq;
}

// ── Master output ──

let _masterGain = null;

function masterNode() {
  if (!_masterGain) {
    _masterGain = ctx().createGain();
    _masterGain.connect(ctx().destination);
  }
  return _masterGain;
}

const master = {
  get volume() { return masterNode().gain.value; },
  set volume(v) { masterNode().gain.value = Math.max(0, Math.min(1, v)); },
  _muted: false,
  _premuteVol: 1,
  get mute() { return master._muted; },
  set mute(v) {
    if (v && !master._muted) {
      master._premuteVol = masterNode().gain.value;
      masterNode().gain.value = 0;
      master._muted = true;
    } else if (!v && master._muted) {
      masterNode().gain.value = master._premuteVol;
      master._muted = false;
    }
  }
};

// ── Active notes registry (for stop) ──

const _active = {};  // key: "instrument:note" → { nodes: [...], stop: fn }

function registerActive(instrument, note, nodes, stopFn) {
  const key = instrument + ':' + (note || '*');
  if (_active[key]) _active[key].stop();
  _active[key] = { nodes, stop: stopFn };
}

function stopActive(instrument, note) {
  if (!instrument) {
    // Stop everything
    Object.keys(_active).forEach(k => { _active[k].stop(); delete _active[k]; });
    return;
  }
  if (note) {
    const key = instrument + ':' + note;
    if (_active[key]) { _active[key].stop(); delete _active[key]; }
  } else {
    // Stop all notes for this instrument
    Object.keys(_active).forEach(k => {
      if (k.startsWith(instrument + ':')) { _active[k].stop(); delete _active[k]; }
    });
  }
}

// ── ADSR envelope helper ──

function applyEnvelope(gainNode, env, startTime) {
  const a = env.attack || 0.01;
  const d = env.decay || 0.1;
  const s = env.sustain !== undefined ? env.sustain : 0.7;
  const r = env.release || 0.1;
  const g = gainNode.gain;
  g.setValueAtTime(0, startTime);
  g.linearRampToValueAtTime(1, startTime + a);
  g.linearRampToValueAtTime(s, startTime + a + d);
  return { releaseAt: function(t) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + r); } };
}

// placeholder for instruments — filled in Task 2
const _instruments = {};
const _sampleBuffers = {};  // instrument → { note → AudioBuffer }
let _customSynths = {};

` + INSTRUMENTS_CODE + SOUNDBOARD_CODE + SAMPLE_LOADER_CODE + CUSTOM_SYNTH_CODE + REALTIME_BRIDGE_CODE + PUBLIC_API_CODE + `

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.audio = audio;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
```

**Note:** The template string concatenation with constants (`INSTRUMENTS_CODE`, etc.) is a placeholder for plan readability. In the actual implementation, all code will be inlined as a single template literal string, same as `lib-auth.ts`. The constants show where each section goes.

- [ ] **Step 2: Verify the file compiles**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors for lib-audio.ts (it won't be imported yet, but the types should check)

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/routes/lib-audio.ts
git commit -m "feat: add lib-audio.ts core engine — AudioContext, note table, master output"
```

---

## Task 2: Built-in Synth Instruments

**Files:**
- Modify: `aimeat/src/routes/lib-audio.ts`

Add the 6 built-in synthesized instruments to the template string: piano (FM), guitar (Karplus-Strong), bass (subtractive), drums (noise+sine), flute (sine+breath), synth (configurable).

- [ ] **Step 1: Add piano instrument (FM synthesis)**

Inside `lib-audio.ts`, add to the template string after the core engine section:

```javascript
// ── Piano: 2-operator FM synthesis ──
_instruments.piano = {
  play: function(note, opts) {
    const freq = noteToFreq(note);
    if (!freq) return;
    const t = ctx().currentTime;
    const vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    const dur = (opts && opts.duration) || 2.0;

    // Modulator (2x frequency, decaying mod index)
    const mod = ctx().createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2;
    const modGain = ctx().createGain();
    modGain.gain.setValueAtTime(freq * 1.5 * vel, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.01, t + dur * 0.8);
    mod.connect(modGain);

    // Carrier
    const car = ctx().createOscillator();
    car.type = 'sine';
    car.frequency.value = freq;
    modGain.connect(car.frequency);  // FM connection

    // Envelope
    const env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.4, t + 0.005);
    env.gain.exponentialRampToValueAtTime(vel * 0.15, t + 0.1);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    car.connect(env);
    env.connect(masterNode());
    mod.start(t);
    car.start(t);
    mod.stop(t + dur + 0.1);
    car.stop(t + dur + 0.1);

    registerActive('piano', note, [mod, car], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.setValueAtTime(env.gain.value, ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      mod.stop(ctx().currentTime + 0.1); car.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};
```

- [ ] **Step 2: Add guitar instrument (Karplus-Strong)**

```javascript
// ── Guitar: Karplus-Strong plucked string ──
_instruments.guitar = {
  play: function(note, opts) {
    const freq = noteToFreq(note);
    if (!freq) return;
    const t = ctx().currentTime;
    const vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    const dur = (opts && opts.duration) || 1.5;

    const bufSize = Math.round(ctx().sampleRate / freq);
    const noiseBuffer = ctx().createBuffer(1, bufSize, ctx().sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * vel;

    const noise = ctx().createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    // Lowpass in feedback = string damping
    const filter = ctx().createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 4;
    filter.Q.value = 0.5;

    const env = ctx().createGain();
    env.gain.setValueAtTime(vel * 0.5, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(env);
    env.connect(masterNode());
    noise.start(t);
    noise.stop(t + dur + 0.05);

    registerActive('guitar', note, [noise], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      noise.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};
```

- [ ] **Step 3: Add bass instrument (subtractive synthesis)**

```javascript
// ── Bass: sawtooth + lowpass + sub-oscillator ──
_instruments.bass = {
  play: function(note, opts) {
    const freq = noteToFreq(note);
    if (!freq) return;
    const t = ctx().currentTime;
    const vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    const dur = (opts && opts.duration) || 0.8;

    // Main sawtooth
    const osc = ctx().createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    // Sub-oscillator (sine, -1 octave)
    const sub = ctx().createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;

    const subGain = ctx().createGain();
    subGain.gain.value = 0.5;
    sub.connect(subGain);

    // Mix
    const mix = ctx().createGain();
    osc.connect(mix);
    subGain.connect(mix);

    // Lowpass filter
    const filter = ctx().createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3, t);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.15);
    filter.Q.value = 2;

    // Envelope
    const env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.5, t + 0.01);
    env.gain.setValueAtTime(vel * 0.5, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    mix.connect(filter);
    filter.connect(env);
    env.connect(masterNode());
    osc.start(t); sub.start(t);
    osc.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);

    registerActive('bass', note, [osc, sub], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      osc.stop(ctx().currentTime + 0.1); sub.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};
```

- [ ] **Step 4: Add drums instrument (per-hit synthesis)**

```javascript
// ── Drums: noise + sine bursts ──
_instruments.drums = {
  play: function(hit, opts) {
    const t = ctx().currentTime;
    const vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    const synths = {
      'kick': function() {
        const osc = ctx().createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
        const g = ctx().createGain();
        g.gain.setValueAtTime(vel, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(g); g.connect(masterNode());
        // Click transient
        const click = ctx().createOscillator(); click.type = 'square';
        click.frequency.value = 800;
        const cg = ctx().createGain();
        cg.gain.setValueAtTime(vel * 0.3, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        click.connect(cg); cg.connect(masterNode());
        osc.start(t); osc.stop(t + 0.5);
        click.start(t); click.stop(t + 0.05);
        return [osc, click];
      },
      'snare': function() {
        // Noise burst
        const bufLen = ctx().sampleRate * 0.15;
        const buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        const noise = ctx().createBufferSource(); noise.buffer = buf;
        const nf = ctx().createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1000;
        const ng = ctx().createGain();
        ng.gain.setValueAtTime(vel * 0.6, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        noise.connect(nf); nf.connect(ng); ng.connect(masterNode());
        // Body tone
        const osc = ctx().createOscillator(); osc.type = 'sine'; osc.frequency.value = 200;
        const og = ctx().createGain();
        og.gain.setValueAtTime(vel * 0.5, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.connect(og); og.connect(masterNode());
        noise.start(t); osc.start(t); osc.stop(t + 0.2);
        return [noise, osc];
      },
      'hihat': function() {
        const bufLen = ctx().sampleRate * 0.05;
        const buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        const noise = ctx().createBufferSource(); noise.buffer = buf;
        const f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        const g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'hihat-open': function() {
        const bufLen = ctx().sampleRate * 0.3;
        const buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        const noise = ctx().createBufferSource(); noise.buffer = buf;
        const f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
        const g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'crash': function() {
        const bufLen = ctx().sampleRate * 1.0;
        const buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        const noise = ctx().createBufferSource(); noise.buffer = buf;
        const f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
        const g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'ride': function() {
        const bufLen = ctx().sampleRate * 0.8;
        const buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        const noise = ctx().createBufferSource(); noise.buffer = buf;
        const f = ctx().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 8000; f.Q.value = 1;
        const g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'clap': function() {
        var nodes = [];
        for (var i = 0; i < 3; i++) {
          var delay = i * 0.01;
          var bufLen = ctx().sampleRate * 0.02;
          var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
          var d = buf.getChannelData(0);
          for (var j = 0; j < bufLen; j++) d[j] = (Math.random() * 2 - 1);
          var noise = ctx().createBufferSource(); noise.buffer = buf;
          var f = ctx().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 3;
          var g = ctx().createGain();
          g.gain.setValueAtTime(vel * 0.4, t + delay);
          g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.08);
          noise.connect(f); f.connect(g); g.connect(masterNode());
          noise.start(t + delay);
          nodes.push(noise);
        }
        return nodes;
      },
      'cowbell': function() {
        var osc1 = ctx().createOscillator(); osc1.type = 'square'; osc1.frequency.value = 587;
        var osc2 = ctx().createOscillator(); osc2.type = 'square'; osc2.frequency.value = 845;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        var f = ctx().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3;
        osc1.connect(g); osc2.connect(g); g.connect(f); f.connect(masterNode());
        osc1.start(t); osc2.start(t);
        osc1.stop(t + 0.5); osc2.stop(t + 0.5);
        return [osc1, osc2];
      }
    };

    // Tom generator
    function makeTom(freq) {
      var osc = ctx().createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.15);
      var g = ctx().createGain();
      g.gain.setValueAtTime(vel * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(g); g.connect(masterNode());
      osc.start(t); osc.stop(t + 0.4);
      return [osc];
    }

    synths['tom-high'] = function() { return makeTom(300); };
    synths['tom-mid'] = function() { return makeTom(220); };
    synths['tom-low'] = function() { return makeTom(150); };

    var fn = synths[hit];
    if (!fn) { console.warn('[aimeat-audio] Unknown drum hit:', hit); return; }
    var nodes = fn();
    registerActive('drums', hit, nodes, function() {
      nodes.forEach(function(n) { try { n.stop(ctx().currentTime + 0.01); } catch(e){} });
    });
  }
};
```

- [ ] **Step 5: Add flute instrument (sine + breath noise + vibrato)**

```javascript
// ── Flute: sine + breath noise + vibrato LFO ──
_instruments.flute = {
  play: function(note, opts) {
    const freq = noteToFreq(note);
    if (!freq) return;
    const t = ctx().currentTime;
    const vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.6;
    const dur = (opts && opts.duration) || 1.5;
    const vibDepth = (opts && opts.vibrato !== undefined) ? opts.vibrato : 0.15;

    // Main sine tone
    const osc = ctx().createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Vibrato LFO
    const lfo = ctx().createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5.5;
    const lfoGain = ctx().createGain();
    lfoGain.gain.value = freq * vibDepth * 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // Breath noise
    const noiseBufLen = ctx().sampleRate * dur;
    const noiseBuf = ctx().createBuffer(1, noiseBufLen, ctx().sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseBufLen; i++) nd[i] = (Math.random() * 2 - 1);
    const noiseNode = ctx().createBufferSource();
    noiseNode.buffer = noiseBuf;
    const noiseFilt = ctx().createBiquadFilter();
    noiseFilt.type = 'bandpass';
    noiseFilt.frequency.value = freq;
    noiseFilt.Q.value = 2;
    const noiseGain = ctx().createGain();
    noiseGain.gain.value = vel * 0.06;

    noiseNode.connect(noiseFilt);
    noiseFilt.connect(noiseGain);

    // Mix
    const env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.3, t + 0.08);
    env.gain.setValueAtTime(vel * 0.3, t + dur - 0.1);
    env.gain.linearRampToValueAtTime(0, t + dur);

    osc.connect(env);
    noiseGain.connect(env);
    env.connect(masterNode());

    lfo.start(t); osc.start(t); noiseNode.start(t);
    lfo.stop(t + dur + 0.1); osc.stop(t + dur + 0.1);

    registerActive('flute', note, [osc, lfo, noiseNode], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      osc.stop(ctx().currentTime + 0.1); lfo.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};
```

- [ ] **Step 6: Add configurable synth instrument**

```javascript
// ── Synth: configurable oscillator ──
_instruments.synth = {
  play: function(note, opts) {
    const freq = noteToFreq(note);
    if (!freq) return;
    const t = ctx().currentTime;
    const vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    const dur = (opts && opts.duration) || 1.0;
    const wave = (opts && opts.wave) || 'sawtooth';
    const filterFreq = (opts && opts.filter) || 2000;

    const osc = ctx().createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;

    // Optional detuned 2nd voice
    const osc2 = ctx().createOscillator();
    osc2.type = wave;
    osc2.frequency.value = freq;
    osc2.detune.value = 7;
    const osc2Gain = ctx().createGain();
    osc2Gain.gain.value = 0.5;
    osc2.connect(osc2Gain);

    const filter = ctx().createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1;

    const env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.3, t + 0.02);
    env.gain.setValueAtTime(vel * 0.3, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(filter);
    osc2Gain.connect(filter);
    filter.connect(env);
    env.connect(masterNode());

    osc.start(t); osc2.start(t);
    osc.stop(t + dur + 0.05); osc2.stop(t + dur + 0.05);

    registerActive('synth', note, [osc, osc2], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      osc.stop(ctx().currentTime + 0.1); osc2.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};
```

- [ ] **Step 7: Verify the file compiles**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add aimeat/src/routes/lib-audio.ts
git commit -m "feat: add 6 built-in synth instruments — piano, guitar, bass, drums, flute, synth"
```

---

## Task 3: Soundboard, Sample Loader, Custom Synth Builder

**Files:**
- Modify: `aimeat/src/routes/lib-audio.ts`

Add soundboard (arbitrary audio file playback), sample loader (upgrade instruments to real samples), and custom synth builder.

- [ ] **Step 1: Add soundboard section**

```javascript
// ── Soundboard: load and play audio files ──

const _soundboardBuffers = {};  // name → AudioBuffer
const _soundboardSources = {};  // name → AudioBufferSourceNode (active)

const soundboard = {
  async load(name, url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to load sound: ' + url);
    const arrayBuf = await resp.arrayBuffer();
    _soundboardBuffers[name] = await ctx().decodeAudioData(arrayBuf);
  },

  async loadAll(map) {
    const entries = Object.entries(map);
    await Promise.all(entries.map(function(e) { return soundboard.load(e[0], e[1]); }));
  },

  play(name, opts) {
    const buf = _soundboardBuffers[name];
    if (!buf) { console.warn('[aimeat-audio] Sound not loaded:', name); return; }
    const source = ctx().createBufferSource();
    source.buffer = buf;
    source.loop = (opts && opts.loop) || false;
    const gain = ctx().createGain();
    gain.gain.value = (opts && opts.volume !== undefined) ? opts.volume : 1;
    source.connect(gain);
    gain.connect(masterNode());
    source.start();
    _soundboardSources[name] = source;
    source.onended = function() { if (_soundboardSources[name] === source) delete _soundboardSources[name]; };
  },

  stop(name) {
    if (_soundboardSources[name]) {
      try { _soundboardSources[name].stop(); } catch(e){}
      delete _soundboardSources[name];
    }
  }
};
```

- [ ] **Step 2: Add sample loader**

```javascript
// ── Sample Loader ──

// Default sample notes per instrument
const SAMPLE_NOTES = {
  piano: ['A2','C3','E3','A3','C4','E4','A4','C5','E5','C6','C7'],
  guitar: ['E2','A2','D3','G3','B3','E4','A4','E5'],
  bass: ['E1','A1','D2','G2','B2','E3'],
  flute: ['C4','E4','A4','C5','E5','A5','C6'],
  drums: ['kick','snare','hihat','hihat-open','crash','ride','tom-high','tom-mid','tom-low','clap','cowbell']
};

async function loadSamples(instrument, opts) {
  const source = (opts && opts.source) || (NODE_URL + '/lib/samples/' + instrument + '/');
  const notes = SAMPLE_NOTES[instrument];
  if (!notes) { console.warn('[aimeat-audio] No sample map for:', instrument); return; }

  if (!_sampleBuffers[instrument]) _sampleBuffers[instrument] = {};

  await Promise.all(notes.map(async function(note) {
    const url = source + note + '.mp3';
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      _sampleBuffers[instrument][note] = await ctx().decodeAudioData(buf);
    } catch(e) { console.warn('[aimeat-audio] Failed to load sample:', url); }
  }));
}

function hasSamples(instrument) {
  return !!_sampleBuffers[instrument] && Object.keys(_sampleBuffers[instrument]).length > 0;
}

// Find nearest sample and compute playback rate
function findNearestSample(instrument, note) {
  const samples = _sampleBuffers[instrument];
  if (!samples) return null;

  // For drums: exact match only
  if (instrument === 'drums') return samples[note] ? { buffer: samples[note], rate: 1 } : null;

  const targetFreq = noteToFreq(note);
  if (!targetFreq) return null;

  let nearest = null;
  let nearestDist = Infinity;
  Object.keys(samples).forEach(function(sn) {
    const sf = noteToFreq(sn);
    if (!sf) return;
    const dist = Math.abs(Math.log2(targetFreq / sf));
    if (dist < nearestDist) { nearestDist = dist; nearest = { buffer: samples[sn], rate: targetFreq / sf }; }
  });

  return nearest;
}

// Play a sample with pitch shift
function playSample(instrument, note, opts) {
  const s = findNearestSample(instrument, note);
  if (!s) return false;

  const vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
  const source = ctx().createBufferSource();
  source.buffer = s.buffer;
  source.playbackRate.value = s.rate;
  const gain = ctx().createGain();
  gain.gain.value = vel;
  source.connect(gain);
  gain.connect(masterNode());
  source.start();

  registerActive(instrument, note, [source], function() {
    try { source.stop(); } catch(e){}
  });
  return true;
}
```

- [ ] **Step 3: Add custom synth builder**

```javascript
// ── Custom Synth Builder ──

function createCustomSynth(config) {
  const name = config.name || ('custom-' + Date.now());
  const oscConfigs = config.oscillators || [{ wave: 'sawtooth', detune: 0 }];
  const envConfig = config.envelope || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.1 };
  const filterConfig = config.filter || null;
  const pitchEnvConfig = config.pitchEnvelope || null;
  const effectsConfig = config.effects || [];

  function buildEffectChain(input) {
    let current = input;
    effectsConfig.forEach(function(fx) {
      if (fx.type === 'distortion') {
        var ws = ctx().createWaveShaper();
        var amount = fx.amount || 0.5;
        var k = amount * 400;
        var samples = 44100;
        var curve = new Float32Array(samples);
        for (var i = 0; i < samples; i++) {
          var x = i * 2 / samples - 1;
          curve[i] = (3 + k) * x * 20 * (Math.PI / 180) / (Math.PI + k * Math.abs(x));
        }
        ws.curve = curve;
        current.connect(ws);
        current = ws;
      } else if (fx.type === 'delay') {
        var dry = ctx().createGain(); dry.gain.value = 1 - (fx.mix || 0.3);
        var wet = ctx().createGain(); wet.gain.value = fx.mix || 0.3;
        var delay = ctx().createDelay(5.0); delay.delayTime.value = fx.time || 0.3;
        var fb = ctx().createGain(); fb.gain.value = fx.feedback || 0.4;
        current.connect(dry); current.connect(delay);
        delay.connect(fb); fb.connect(delay); delay.connect(wet);
        var merge = ctx().createGain();
        dry.connect(merge); wet.connect(merge);
        current = merge;
      } else if (fx.type === 'chorus') {
        var dry = ctx().createGain(); dry.gain.value = 1 - (fx.mix || 0.5);
        var wet = ctx().createGain(); wet.gain.value = fx.mix || 0.5;
        var delay = ctx().createDelay(); delay.delayTime.value = 0.02;
        var lfo = ctx().createOscillator(); lfo.type = 'sine'; lfo.frequency.value = fx.rate || 1.5;
        var depth = ctx().createGain(); depth.gain.value = (fx.depth || 0.7) * 0.01;
        lfo.connect(depth); depth.connect(delay.delayTime); lfo.start();
        current.connect(dry); current.connect(delay); delay.connect(wet);
        var merge = ctx().createGain();
        dry.connect(merge); wet.connect(merge);
        current = merge;
      } else if (fx.type === 'tremolo') {
        var trem = ctx().createGain();
        var lfo = ctx().createOscillator(); lfo.type = 'sine'; lfo.frequency.value = fx.rate || 4;
        var depth = ctx().createGain(); depth.gain.value = fx.depth || 0.5;
        lfo.connect(depth); depth.connect(trem.gain); lfo.start();
        trem.gain.value = 1 - (fx.depth || 0.5) / 2;
        current.connect(trem);
        current = trem;
      } else if (fx.type === 'reverb') {
        var dry = ctx().createGain(); dry.gain.value = 1 - (fx.mix || 0.5);
        var wet = ctx().createGain(); wet.gain.value = fx.mix || 0.5;
        // Simple algorithmic reverb via feedback delays
        var d1 = ctx().createDelay(); d1.delayTime.value = 0.037;
        var d2 = ctx().createDelay(); d2.delayTime.value = 0.053;
        var d3 = ctx().createDelay(); d3.delayTime.value = 0.071;
        var fb = Math.min(0.85, (fx.decay || 2) / 5);
        var fg1 = ctx().createGain(); fg1.gain.value = fb;
        var fg2 = ctx().createGain(); fg2.gain.value = fb * 0.9;
        var fg3 = ctx().createGain(); fg3.gain.value = fb * 0.8;
        d1.connect(fg1); fg1.connect(d1); d2.connect(fg2); fg2.connect(d2); d3.connect(fg3); fg3.connect(d3);
        current.connect(dry); current.connect(d1); current.connect(d2); current.connect(d3);
        var merge = ctx().createGain();
        dry.connect(merge); d1.connect(wet); d2.connect(wet); d3.connect(wet); wet.connect(merge);
        current = merge;
      } else if (fx.type === 'filter') {
        var f = ctx().createBiquadFilter();
        f.type = fx.filterType || fx.type2 || 'lowpass';
        f.frequency.value = fx.frequency || 1000;
        f.Q.value = fx.Q || 1;
        current.connect(f);
        current = f;
      }
    });
    return current;
  }

  const synth = {
    name: name,
    play: function(note, opts) {
      const freq = noteToFreq(note);
      if (!freq) return;
      const t = ctx().currentTime;
      const vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
      const dur = (opts && opts.duration) || 1.0;

      const allOscs = [];
      const mix = ctx().createGain();
      mix.gain.value = vel * 0.4 / oscConfigs.length;

      oscConfigs.forEach(function(oc) {
        const osc = ctx().createOscillator();
        osc.type = oc.wave || 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = oc.detune || 0;
        if (oc.gain !== undefined) {
          const g = ctx().createGain(); g.gain.value = oc.gain;
          osc.connect(g); g.connect(mix);
        } else {
          osc.connect(mix);
        }
        allOscs.push(osc);
      });

      // Filter
      let chain = mix;
      if (filterConfig) {
        const f = ctx().createBiquadFilter();
        f.type = filterConfig.type || 'lowpass';
        f.frequency.value = filterConfig.frequency || 1000;
        f.Q.value = filterConfig.Q || 1;
        mix.connect(f);
        chain = f;
      }

      // Effect chain
      chain = buildEffectChain(chain);

      // Envelope
      const env = ctx().createGain();
      const a = envConfig.attack || 0.01;
      const d = envConfig.decay || 0.1;
      const s = envConfig.sustain !== undefined ? envConfig.sustain : 0.7;
      const r = envConfig.release || 0.1;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + a);
      env.gain.linearRampToValueAtTime(s, t + a + d);
      if (dur) {
        env.gain.setValueAtTime(s, t + dur - r);
        env.gain.linearRampToValueAtTime(0, t + dur);
      }

      chain.connect(env);
      env.connect(masterNode());

      // Pitch envelope
      if (pitchEnvConfig) {
        allOscs.forEach(function(osc) {
          osc.frequency.setValueAtTime(pitchEnvConfig.start || freq, t);
          osc.frequency.exponentialRampToValueAtTime(
            pitchEnvConfig.end || freq, t + (pitchEnvConfig.time || 0.1)
          );
        });
      }

      allOscs.forEach(function(osc) {
        osc.start(t);
        if (dur) osc.stop(t + dur + 0.1);
      });

      registerActive(name, note, allOscs, function() {
        try { env.gain.cancelScheduledValues(ctx().currentTime);
        env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
        allOscs.forEach(function(o) { try{o.stop(ctx().currentTime+0.1);}catch(e){} }); } catch(e){}
      });
    },
    stop: function(note) { stopActive(name, note); }
  };

  // Register as named instrument
  _instruments[name] = synth;
  _customSynths[name] = synth;
  return synth;
}
```

- [ ] **Step 4: Verify the file compiles**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/lib-audio.ts
git commit -m "feat: add soundboard, sample loader, custom synth builder to audio lib"
```

---

## Task 4: Realtime Bridge and Public API

**Files:**
- Modify: `aimeat/src/routes/lib-audio.ts`

Add realtime bridge (connects to AimeatRealtime) and the public `AIMEAT.audio` API object that wraps everything.

- [ ] **Step 1: Add realtime bridge**

```javascript
// ── Realtime Bridge ──

let _rtInstance = null;
let _rtHandlerBroadcast = null;
let _rtHandlerPeerData = null;

function connectRealtime(rt) {
  if (_rtInstance) disconnectRealtime();
  _rtInstance = rt;

  _rtHandlerBroadcast = function(msg) {
    var d = msg.data || msg.payload || msg;
    if (d && d.instrument && (d.note || d.hit)) {
      audio.play(d.instrument, d.note || d.hit, d);
    }
  };
  _rtHandlerPeerData = function(msg) {
    var d = msg.data;
    if (d && d.instrument && (d.note || d.hit)) {
      audio.play(d.instrument, d.note || d.hit, d);
    }
  };

  rt.on('broadcast', _rtHandlerBroadcast);
  rt.on('peer-data', _rtHandlerPeerData);
}

function disconnectRealtime() {
  if (_rtInstance) {
    if (_rtHandlerBroadcast) _rtInstance.off('broadcast', _rtHandlerBroadcast);
    if (_rtHandlerPeerData) _rtInstance.off('peer-data', _rtHandlerPeerData);
    _rtInstance = null;
    _rtHandlerBroadcast = null;
    _rtHandlerPeerData = null;
  }
}
```

- [ ] **Step 2: Add public API object**

```javascript
// ── Public API ──

const audio = {
  play: function(instrument, note, opts) {
    // If samples loaded, prefer them
    if (_sampleBuffers[instrument] && Object.keys(_sampleBuffers[instrument]).length > 0) {
      if (playSample(instrument, note, opts)) return;
    }
    // Custom synth
    if (_customSynths[instrument]) {
      _customSynths[instrument].play(note, opts);
      return;
    }
    // Built-in
    var inst = _instruments[instrument];
    if (!inst) { console.warn('[aimeat-audio] Unknown instrument:', instrument); return; }
    inst.play(note, opts);
  },

  stop: function(instrument, note) {
    stopActive(instrument, note);
  },

  get instruments() {
    var list = Object.keys(_instruments);
    Object.keys(_customSynths).forEach(function(k) {
      if (list.indexOf(k) < 0) list.push(k);
    });
    return list;
  },

  loadSamples: loadSamples,
  hasSamples: hasSamples,
  synth: createCustomSynth,
  soundboard: soundboard,
  master: master,
  connectRealtime: connectRealtime,
  disconnectRealtime: disconnectRealtime,
};
```

- [ ] **Step 3: Assemble the complete `lib-audio.ts` file**

Combine all sections (Task 1-4) into the single `aimeatAudioLib()` function as one continuous template string. Verify the IIFE opens and closes correctly, all variables are declared, and `AIMEAT.audio` is exposed.

- [ ] **Step 4: Verify compilation**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/lib-audio.ts
git commit -m "feat: complete audio.js — realtime bridge, public API, all sections assembled"
```

---

## Task 5: speech.js Library

**Files:**
- Create: `aimeat/src/routes/lib-speech.ts`

Full speech library: TTS, STT, voice commands, provider architecture, capability detection.

- [ ] **Step 1: Create `lib-speech.ts` with complete speech library**

```typescript
// aimeat/src/routes/lib-speech.ts
import type { AimeatConfig } from '../config.js';

export function aimeatSpeechLib(config: AimeatConfig): string {
    return `// aimeat-speech.js — AIMEAT Speech Library
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Include: <script src="${config.baseUrl}/v1/libs/aimeat-speech.js"><\\/script>
// Usage: AIMEAT.speech.say('Hello'); await AIMEAT.speech.listen();
(function(global) {
'use strict';

// ── Event system ──
const _listeners = {};
function emit(event, data) { (_listeners[event] || []).forEach(function(fn) { fn(data); }); }

// ── Capability detection ──
const _supported = {
  get tts() { return typeof window !== 'undefined' && 'speechSynthesis' in window; },
  get stt() { return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window); }
};

// ── Provider slots ──
let _ttsProvider = null;
let _sttProvider = null;

// ── TTS state ──
let _speaking = false;
let _ttsQueue = [];

// ── STT state ──
let _listening = false;
let _recognition = null;
let _mediaRecorder = null;

// ── Voices cache ──
let _voicesLoaded = false;
let _voicesList = [];

function loadVoices() {
  if (!_supported.tts) return [];
  _voicesList = speechSynthesis.getVoices().map(function(v) {
    return { name: v.name, lang: v.lang };
  });
  _voicesLoaded = _voicesList.length > 0;
  return _voicesList;
}
if (typeof window !== 'undefined' && _supported.tts) {
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
  loadVoices();
}

// ── TTS: Native implementation ──

function nativeSay(text, opts) {
  return new Promise(function(resolve) {
    const utt = new SpeechSynthesisUtterance(text);
    if (opts && opts.lang) utt.lang = opts.lang;
    if (opts && opts.rate !== undefined) utt.rate = opts.rate;
    if (opts && opts.pitch !== undefined) utt.pitch = opts.pitch;
    if (opts && opts.volume !== undefined) utt.volume = opts.volume;
    if (opts && opts.voice) {
      const voices = speechSynthesis.getVoices();
      const match = voices.find(function(v) {
        return v.name === opts.voice || v.name.includes(opts.voice);
      });
      if (match) utt.voice = match;
    }
    utt.onstart = function() { emit('start', {}); };
    utt.onend = function() { _speaking = false; processQueue(); emit('end', {}); resolve(); };
    utt.onboundary = function(e) {
      if (e.name === 'word') emit('word', { word: text.substr(e.charIndex, e.charLength || 10).split(/\\s/)[0], index: e.charIndex });
    };
    utt.onerror = function(e) { _speaking = false; processQueue(); emit('error', { error: e.error }); resolve(); };
    _speaking = true;
    speechSynthesis.speak(utt);
  });
}

// ── TTS: Cloud provider playback (returns audio blob → play via AudioContext) ──

async function cloudSay(text, opts) {
  if (!_ttsProvider || !_ttsProvider.say) return;
  try {
    const blob = await _ttsProvider.say(text, opts || {});
    if (!blob) return;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    const source = ac.createBufferSource();
    source.buffer = buf;
    source.connect(ac.destination);
    _speaking = true;
    emit('start', {});
    source.onended = function() { _speaking = false; processQueue(); emit('end', {}); };
    source.start();
  } catch(e) {
    _speaking = false;
    processQueue();
    emit('error', { error: e.message });
  }
}

function processQueue() {
  if (_ttsQueue.length > 0 && !_speaking) {
    var next = _ttsQueue.shift();
    doSay(next.text, next.opts);
  }
}

function doSay(text, opts) {
  if (_ttsProvider) return cloudSay(text, opts);
  if (!_supported.tts) { console.warn('[aimeat-speech] TTS not supported in this browser'); return Promise.resolve(); }
  return nativeSay(text, opts);
}

// ── STT: Native implementation ──

function nativeListen(opts) {
  return new Promise(function(resolve, reject) {
    const SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecog) { reject(new Error('SpeechRecognition not supported')); return; }

    _recognition = new SpeechRecog();
    _recognition.lang = (opts && opts.lang) || 'en-US';
    _recognition.continuous = (opts && opts.continuous) || false;
    _recognition.interimResults = (opts && opts.interimResults) || false;

    var commands = (opts && opts.commands) || null;

    _recognition.onstart = function() { _listening = true; emit('listening', {}); };
    _recognition.onresult = function(e) {
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var result = e.results[i];
        var text = result[0].transcript.trim();
        var final = result.isFinal;
        var confidence = result[0].confidence;
        emit('result', { text: text, final: final, confidence: confidence });
        if (final && commands) matchCommand(text, commands);
        if (final && !_recognition.continuous) {
          resolve({ text: text, confidence: confidence, lang: _recognition.lang });
        }
      }
    };
    _recognition.onerror = function(e) {
      _listening = false;
      emit('error', { error: e.error });
      if (!_recognition.continuous) reject(new Error(e.error));
    };
    _recognition.onend = function() {
      _listening = false;
      emit('stopped', {});
      // Auto-restart for continuous mode
      if (opts && opts.continuous && _recognition) {
        try { _recognition.start(); } catch(e) {}
      }
    };

    _recognition.start();
  });
}

// ── STT: Cloud provider (MediaRecorder → blob → provider) ──

async function cloudListen(opts) {
  if (!_sttProvider || !_sttProvider.listen) throw new Error('No STT provider configured');

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return new Promise(function(resolve, reject) {
    const chunks = [];
    _mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    _listening = true;
    emit('listening', {});

    _mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
    _mediaRecorder.onstop = async function() {
      _listening = false;
      stream.getTracks().forEach(function(t) { t.stop(); });
      emit('stopped', {});
      const blob = new Blob(chunks, { type: 'audio/webm' });
      try {
        const result = await _sttProvider.listen(blob, opts || {});
        var text = typeof result === 'string' ? result : (result.text || result.transcript || '');
        var confidence = typeof result === 'object' ? (result.confidence || 1) : 1;
        emit('result', { text: text, final: true, confidence: confidence });
        resolve({ text: text, confidence: confidence, lang: (opts && opts.lang) || 'en-US' });
      } catch(e) {
        emit('error', { error: e.message });
        reject(e);
      }
    };

    _mediaRecorder.start();

    // Auto-stop after silence timeout (5s default) for one-shot mode
    if (!(opts && opts.continuous)) {
      setTimeout(function() { if (_mediaRecorder && _mediaRecorder.state === 'recording') _mediaRecorder.stop(); }, (opts && opts.timeout) || 5000);
    }
  });
}

// ── Voice Command matching ──

function matchCommand(text, commands) {
  const lower = text.toLowerCase();
  Object.keys(commands).forEach(function(pattern) {
    var parts = pattern.toLowerCase().split(/\\s+/);
    var regex = '^' + parts.map(function(p) {
      if (p.startsWith('*')) return '(.+)';
      return p.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\\\$&');
    }).join('\\\\s+') + '\\$';
    var match = lower.match(new RegExp(regex));
    if (match) {
      var captures = match.slice(1);
      commands[pattern].apply(null, captures);
    }
  });
}

// ── Public API ──

const speech = {
  say: function(text, opts) {
    if (_speaking) {
      _ttsQueue.push({ text: text, opts: opts });
      return;
    }
    return doSay(text, opts);
  },

  stop: function() {
    if (_supported.tts) speechSynthesis.cancel();
    _speaking = false;
    _ttsQueue = [];
  },

  get speaking() { return _speaking; },

  voices: function(opts) {
    if (!_voicesLoaded) loadVoices();
    if (opts && opts.lang) {
      var lang = opts.lang.toLowerCase();
      return _voicesList.filter(function(v) { return v.lang.toLowerCase().startsWith(lang); });
    }
    return _voicesList;
  },

  listen: function(opts) {
    if (_sttProvider) return cloudListen(opts);
    return nativeListen(opts);
  },

  stopListening: function() {
    if (_recognition) { _recognition.continuous = false; try { _recognition.stop(); } catch(e){} _recognition = null; }
    if (_mediaRecorder && _mediaRecorder.state === 'recording') { _mediaRecorder.stop(); _mediaRecorder = null; }
    _listening = false;
  },

  get listening() { return _listening; },

  get supported() { return _supported; },

  use: function(type, provider) {
    if (type === 'tts') _ttsProvider = provider;
    else if (type === 'stt') _sttProvider = provider;
    else console.warn('[aimeat-speech] Unknown provider type:', type);
  },

  on: function(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  },

  off: function(event, fn) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(function(f) { return f !== fn; });
  },
};

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.speech = speech;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/routes/lib-speech.ts
git commit -m "feat: add speech.js — TTS, STT, voice commands, provider architecture"
```

---

## Task 6: Router Integration (`libs.ts`)

**Files:**
- Modify: `aimeat/src/routes/libs.ts`

Add imports, routes, library listing entries, and test harness updates for both new libraries.

- [ ] **Step 1: Add imports at top of `libs.ts`**

After the existing imports (line 6-8 of `libs.ts`), add:

```typescript
import { aimeatAudioLib } from './lib-audio.js';
import { aimeatSpeechLib } from './lib-speech.js';
```

- [ ] **Step 2: Add route handlers**

After the tunnel route (around line 52), add:

```typescript
  // GET /v1/libs/aimeat-audio.js — Audio engine library
  router.get('/v1/libs/aimeat-audio.js', (_req, res) => {
    res.type('application/javascript').send(aimeatAudioLib(config));
  });

  // GET /v1/libs/aimeat-speech.js — Speech library
  router.get('/v1/libs/aimeat-speech.js', (_req, res) => {
    res.type('application/javascript').send(aimeatSpeechLib(config));
  });
```

- [ ] **Step 3: Add to library listing**

In the `/v1/libs` listing array, add entries after the tunnel entry:

```typescript
        {
          name: 'aimeat-audio',
          url: '/v1/libs/aimeat-audio.js',
          description: 'Audio engine: 6 built-in instruments (piano, guitar, bass, drums, flute, synth), custom synth builder, sample loader, soundboard, realtime bridge',
          size_estimate: '~60KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-audio.js"></script>`,
        },
        {
          name: 'aimeat-speech',
          url: '/v1/libs/aimeat-speech.js',
          description: 'Speech: text-to-speech, speech-to-text, voice commands, pluggable providers (ElevenLabs, Whisper, etc.)',
          size_estimate: '~15KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-speech.js"></script>`,
        },
```

- [ ] **Step 4: Add to test harness**

In the dev-mode test harness HTML (around line 133), add script tags:

```html
<script src="/v1/libs/aimeat-audio.js"></script>
<script src="/v1/libs/aimeat-speech.js"></script>
```

Update the log line to include the new libs:

```javascript
tlog('Libraries loaded: auth=' + !!AIMEAT.auth + ' data=' + !!AIMEAT.data + ' storage=' + !!AIMEAT.storage + ' social=' + !!AIMEAT.social + ' wallet=' + !!AIMEAT.wallet + ' work=' + !!AIMEAT.work + ' tunnel=' + !!AIMEAT.tunnel + ' audio=' + !!AIMEAT.audio + ' speech=' + !!AIMEAT.speech);
```

- [ ] **Step 5: Verify compilation and lint**

Run: `cd aimeat && npx tsc --noEmit && cd .. && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add aimeat/src/routes/libs.ts
git commit -m "feat: register audio + speech libraries in router, listing, and test harness"
```

---

## Task 7: Sample Files Acquisition

**Files:**
- Create: `aimeat/public/lib/samples/piano/*.mp3`
- Create: `aimeat/public/lib/samples/drums/*.mp3` (or empty dirs for synth-first approach)
- Create: `aimeat/public/lib/samples/guitar/` (empty, synth-first)
- Create: `aimeat/public/lib/samples/bass/` (empty, synth-first)
- Create: `aimeat/public/lib/samples/flute/` (empty, synth-first)
- Create: `aimeat/public/lib/samples/LICENSE.md`

Piano is the highest priority (Salamander Grand Piano has a proven, freely available source). Other instruments start synth-only with sample directories ready for future population.

- [ ] **Step 1: Create sample directory structure**

```bash
mkdir -p aimeat/public/lib/samples/piano
mkdir -p aimeat/public/lib/samples/guitar
mkdir -p aimeat/public/lib/samples/bass
mkdir -p aimeat/public/lib/samples/drums
mkdir -p aimeat/public/lib/samples/flute
```

- [ ] **Step 2: Download Salamander piano samples**

Download 11 key notes from the Tone.js CDN (Salamander Grand Piano, CC BY 3.0):

```bash
cd aimeat/public/lib/samples/piano
curl -O https://tonejs.github.io/audio/salamander/A2.mp3
curl -O https://tonejs.github.io/audio/salamander/C3.mp3
curl -O https://tonejs.github.io/audio/salamander/E3.mp3
curl -O https://tonejs.github.io/audio/salamander/A3.mp3
curl -O https://tonejs.github.io/audio/salamander/C4.mp3
curl -O https://tonejs.github.io/audio/salamander/E4.mp3
curl -O https://tonejs.github.io/audio/salamander/A4.mp3
curl -O https://tonejs.github.io/audio/salamander/C5.mp3
curl -O https://tonejs.github.io/audio/salamander/E5.mp3
curl -O https://tonejs.github.io/audio/salamander/C6.mp3
curl -O https://tonejs.github.io/audio/salamander/C7.mp3
```

Verify files downloaded and are valid MP3s (each should be 20-80KB):

```bash
ls -la aimeat/public/lib/samples/piano/
```

**If downloads fail:** The Tone.js CDN may rename files. The Salamander samples use note names with `v` velocity suffixes on the original source. Try the FreePats archive at `https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html` and convert from OGG to MP3 using ffmpeg:

```bash
ffmpeg -i input.ogg -b:a 128k output.mp3
```

- [ ] **Step 3: Create LICENSE.md for samples**

Create `aimeat/public/lib/samples/LICENSE.md`:

```markdown
# Audio Sample Licenses

All samples in this directory are used under open licenses that permit
redistribution in MIT-licensed software.

## Piano (piano/)

**Salamander Grand Piano** by Alexander Holm
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html
- CDN: https://tonejs.github.io/audio/salamander/
- Attribution: Piano samples by Alexander Holm, CC BY 3.0

## Drums (drums/)

[To be populated. Built-in synthesis provides drum sounds without samples.]

## Guitar (guitar/)

[To be populated. Built-in Karplus-Strong synthesis provides guitar sounds without samples.]

## Bass (bass/)

[To be populated. Built-in subtractive synthesis provides bass sounds without samples.]

## Flute (flute/)

[To be populated. Built-in synthesis provides flute sounds without samples.]
```

- [ ] **Step 4: Add .gitkeep files to empty instrument directories**

```bash
touch aimeat/public/lib/samples/guitar/.gitkeep
touch aimeat/public/lib/samples/bass/.gitkeep
touch aimeat/public/lib/samples/drums/.gitkeep
touch aimeat/public/lib/samples/flute/.gitkeep
```

- [ ] **Step 5: Commit**

```bash
git add aimeat/public/lib/samples/
git commit -m "feat: add piano samples (Salamander CC BY 3.0) and sample directory structure"
```

---

## Task 8: Static Library Files for SPA

**Files:**
- Create: `aimeat/public/lib/audio.js`
- Create: `aimeat/public/lib/speech.js`
- Modify: `aimeat/public/spa.html`

Create static versions of the libraries for SPA imports (auto-detect config instead of baked-in) and add importmap entries.

- [ ] **Step 1: Create `public/lib/audio.js`**

This is the same code as `lib-audio.ts` generates, but with auto-detect config (no baked `config.baseUrl`). The simplest approach: copy the template string output from `aimeatAudioLib()` but replace the `NODE_URL` fallback from `'${config.baseUrl}'` to `location.origin`.

The static file should have the same IIFE wrapper and use `location.origin` as the fallback NODE_URL.

- [ ] **Step 2: Create `public/lib/speech.js`**

Same approach for speech: IIFE with auto-detect config.

- [ ] **Step 3: Add importmap entries to `spa.html`**

In `public/spa.html`, inside the `"imports"` object of the importmap (around line 184), add:

```json
"/lib/audio.js": "/lib/audio.js",
"/lib/speech.js": "/lib/speech.js",
```

- [ ] **Step 4: Commit**

```bash
git add aimeat/public/lib/audio.js aimeat/public/lib/speech.js aimeat/public/spa.html
git commit -m "feat: add static audio.js + speech.js for SPA imports, importmap entries"
```

---

## Task 9: llms-template.txt Integration

**Files:**
- Modify: `aimeat/public/llms-template.txt`

Add audio and speech to the library table and SDK reference section.

- [ ] **Step 1: Add to the library table**

In `llms-template.txt`, at line 181 (after the AimeatRealtime row), add:

```
| aimeat-audio | `/v1/libs/aimeat-audio.js` | Audio: 6 instruments, custom synth, soundboard, sample loader |
| aimeat-speech | `/v1/libs/aimeat-speech.js` | Speech: TTS, STT, voice commands, pluggable providers |
```

- [ ] **Step 2: Add SDK reference cards**

After the AimeatRealtime reference card section (around line 546), add:

```
**AIMEAT.audio** (`/v1/libs/aimeat-audio.js`):
```javascript
AIMEAT.audio.play('piano', 'C4')                // play a note (synth)
AIMEAT.audio.play('guitar', 'E2', { duration: 0.5, velocity: 0.8 })
AIMEAT.audio.play('drums', 'kick')              // drum hits by name
AIMEAT.audio.play('synth', 'C4', { wave: 'sawtooth', filter: 800 })
AIMEAT.audio.stop('piano', 'C4')                // stop note
AIMEAT.audio.stop('piano')                      // stop instrument
AIMEAT.audio.stop()                             // stop all
AIMEAT.audio.master.volume = 0.7                // master volume 0-1
AIMEAT.audio.master.mute = true                 // mute/unmute
AIMEAT.audio.instruments                        // list available
// Soundboard (audio file playback):
await AIMEAT.audio.soundboard.load('sfx', '/sounds/boom.mp3')
AIMEAT.audio.soundboard.play('sfx', { volume: 0.5 })
await AIMEAT.audio.soundboard.loadAll({ a: 'a.mp3', b: 'b.mp3' })
// Sample upgrade (real recorded sounds):
await AIMEAT.audio.loadSamples('piano')         // from /lib/samples/piano/
AIMEAT.audio.hasSamples('piano')                // true after loading
// Custom synth:
const laser = AIMEAT.audio.synth({
  name: 'laser', oscillators: [{ wave: 'sawtooth' }],
  envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.05 },
  filter: { type: 'lowpass', frequency: 2000 },
  pitchEnvelope: { start: 2000, end: 200, time: 0.15 },
  effects: [{ type: 'distortion', amount: 0.4 }]
})
// Realtime bridge (auto-play incoming note events):
AIMEAT.audio.connectRealtime(rt)
rt.broadcast({ instrument: 'piano', note: 'C4', velocity: 0.8 })
// Built-in instruments: piano, guitar, bass, drums, flute, synth
// Drum hits: kick, snare, hihat, hihat-open, crash, ride, tom-high, tom-mid, tom-low, clap, cowbell
// Notes: C4, F#3, Bb5 (scientific pitch, A0-C8)
// Effects: reverb, delay, distortion, chorus, tremolo, filter
```

**AIMEAT.speech** (`/v1/libs/aimeat-speech.js`):
```javascript
AIMEAT.speech.say('Hello world')                // speak text (TTS)
AIMEAT.speech.say('Tervetuloa', { lang: 'fi-FI', rate: 1.2, pitch: 1.0 })
AIMEAT.speech.stop()                            // stop speaking
AIMEAT.speech.speaking                          // true/false
AIMEAT.speech.voices()                          // list available voices
AIMEAT.speech.voices({ lang: 'fi' })            // filter by language
const r = await AIMEAT.speech.listen()          // one-shot STT
// r = { text: 'Hello', confidence: 0.92, lang: 'en-US' }
AIMEAT.speech.listen({ continuous: true, lang: 'fi-FI' })
AIMEAT.speech.on('result', ({ text, final }) => { ... })
AIMEAT.speech.stopListening()
AIMEAT.speech.listening                         // true/false
AIMEAT.speech.supported                         // { tts: true, stt: true }
// Voice commands:
AIMEAT.speech.listen({ continuous: true, commands: {
  'play *instrument': (inst) => AIMEAT.audio.play(inst, 'C4'),
  'stop': () => AIMEAT.audio.stop(),
}})
// Pluggable providers:
AIMEAT.speech.use('tts', { name: 'elevenlabs', say: async (text, opts) => blob })
AIMEAT.speech.use('stt', { name: 'whisper', listen: async (audioBlob, opts) => result })
```
```

- [ ] **Step 3: Add to starter template options**

In the `spa.html` inline llms section and the `llms-template.txt` starter templates section, add a new template option:

```
- Audio: Standard + /v1/libs/aimeat-audio.js (music, sound effects, instruments)
- Speech: Standard + /v1/libs/aimeat-speech.js (voice control, TTS, STT)
```

- [ ] **Step 4: Commit**

```bash
git add aimeat/public/llms-template.txt aimeat/public/spa.html
git commit -m "feat: add audio + speech reference cards to llms-template.txt"
```

---

## Task 10: E2E API Tests

**Files:**
- Create: `aimeat/test/e2e-audio-speech.ts`

Test that the library endpoints serve valid JavaScript and that samples are accessible.

- [ ] **Step 1: Create `e2e-audio-speech.ts`**

```typescript
// E2E tests for aimeat-audio.js and aimeat-speech.js library endpoints
// Run: cd aimeat && AIMEAT_PORT=40251 npx tsx test/e2e-audio-speech.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

console.log(`\n=== AIMEAT Audio & Speech Libraries E2E Test ===\n`);
console.log(`Server: ${BASE}\n`);

// ── Audio library endpoint ──

console.log('Audio Library');

await test('GET /v1/libs/aimeat-audio.js returns JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-audio.js`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('javascript'), `Expected JS content-type, got: ${ct}`);
    const body = await res.text();
    assert(body.includes('AIMEAT.audio'), 'Should contain AIMEAT.audio');
    assert(body.includes('play'), 'Should contain play function');
    assert(body.includes('piano'), 'Should contain piano instrument');
    assert(body.includes('drums'), 'Should contain drums instrument');
    assert(body.includes('synth'), 'Should contain synth builder');
    assert(body.includes('soundboard'), 'Should contain soundboard');
    assert(body.includes('connectRealtime'), 'Should contain realtime bridge');
    assert(body.length > 10000, `Expected >10KB, got ${body.length} bytes`);
});

await test('audio.js is valid JavaScript (no syntax errors)', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-audio.js`);
    const body = await res.text();
    // Basic syntax check: IIFE should close properly
    assert(body.trim().endsWith(');'), 'Should end with );');
    assert(body.includes('(function(global)'), 'Should start with IIFE');
});

// ── Speech library endpoint ──

console.log('\nSpeech Library');

await test('GET /v1/libs/aimeat-speech.js returns JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-speech.js`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('javascript'), `Expected JS content-type, got: ${ct}`);
    const body = await res.text();
    assert(body.includes('AIMEAT.speech'), 'Should contain AIMEAT.speech');
    assert(body.includes('say'), 'Should contain say function');
    assert(body.includes('listen'), 'Should contain listen function');
    assert(body.includes('voices'), 'Should contain voices function');
    assert(body.includes('use'), 'Should contain use (provider) function');
    assert(body.length > 3000, `Expected >3KB, got ${body.length} bytes`);
});

// ── Library listing ──

console.log('\nLibrary Listing');

await test('GET /v1/libs includes audio and speech', async () => {
    const res = await fetch(`${BASE}/v1/libs`);
    const data = await res.json() as any;
    assert(data.ok === true, 'Expected ok: true');
    const names = data.libraries.map((l: any) => l.name);
    assert(names.includes('aimeat-audio'), 'Should list aimeat-audio');
    assert(names.includes('aimeat-speech'), 'Should list aimeat-speech');
});

// ── Sample files ──

console.log('\nSample Files');

await test('Piano samples are accessible', async () => {
    const notes = ['A2', 'C4', 'A4', 'C7'];
    for (const note of notes) {
        const res = await fetch(`${BASE}/lib/samples/piano/${note}.mp3`);
        assert(res.status === 200, `Piano ${note}.mp3: expected 200, got ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        assert(ct.includes('audio') || ct.includes('mpeg'), `Piano ${note}.mp3: expected audio content-type, got ${ct}`);
        const size = parseInt(res.headers.get('content-length') || '0');
        assert(size > 1000, `Piano ${note}.mp3: expected >1KB, got ${size} bytes`);
    }
});

await test('Sample LICENSE.md exists', async () => {
    const res = await fetch(`${BASE}/lib/samples/LICENSE.md`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.text();
    assert(body.includes('Salamander'), 'Should mention Salamander');
    assert(body.includes('CC BY 3.0'), 'Should mention CC BY 3.0');
});

// ── Summary ──

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Verify the test compiles**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 3: Run the test**

Run: `pnpm test:e2e` (or start a dev server and run the test file directly)
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add aimeat/test/e2e-audio-speech.ts
git commit -m "test: add E2E tests for audio + speech library endpoints and samples"
```

---

## Task 11: Playwright Browser Tests

**Files:**
- Create: `aimeat/test/playwright/audio-speech.spec.ts`

Browser tests that verify libraries load in the test harness and basic API is functional.

- [ ] **Step 1: Create Playwright spec**

```typescript
import { test, expect } from '@playwright/test';

async function loadHarness(page: any) {
    await page.goto('/v1/libs/test-harness');
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 10_000 });
}

test.describe('Audio Library', () => {
    test('AIMEAT.audio loads on test harness', async ({ page }) => {
        await loadHarness(page);
        const hasAudio = await page.evaluate(() => typeof (window as any).AIMEAT.audio);
        expect(hasAudio).toBe('object');
    });

    test('AIMEAT.audio.instruments lists built-in instruments', async ({ page }) => {
        await loadHarness(page);
        const instruments = await page.evaluate(() => (window as any).AIMEAT.audio.instruments);
        expect(instruments).toContain('piano');
        expect(instruments).toContain('guitar');
        expect(instruments).toContain('bass');
        expect(instruments).toContain('drums');
        expect(instruments).toContain('flute');
        expect(instruments).toContain('synth');
    });

    test('AIMEAT.audio.play does not throw for valid instrument', async ({ page }) => {
        await loadHarness(page);
        // Simulate user gesture (required for AudioContext)
        await page.click('h1');
        const error = await page.evaluate(() => {
            try {
                (window as any).AIMEAT.audio.play('piano', 'C4');
                return null;
            } catch (e: any) { return e.message; }
        });
        expect(error).toBeNull();
    });

    test('AIMEAT.audio.master has volume and mute', async ({ page }) => {
        await loadHarness(page);
        await page.click('h1');
        const result = await page.evaluate(() => {
            const a = (window as any).AIMEAT.audio;
            a.play('piano', 'C4'); // init AudioContext
            a.master.volume = 0.5;
            const vol = a.master.volume;
            a.master.mute = true;
            const muted = a.master.mute;
            a.master.mute = false;
            return { vol: Math.abs(vol - 0.5) < 0.01, muted };
        });
        expect(result.vol).toBe(true);
        expect(result.muted).toBe(true);
    });

    test('AIMEAT.audio.synth creates a custom instrument', async ({ page }) => {
        await loadHarness(page);
        await page.click('h1');
        const result = await page.evaluate(() => {
            const a = (window as any).AIMEAT.audio;
            const s = a.synth({
                name: 'test-synth',
                oscillators: [{ wave: 'sine' }],
                envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 },
            });
            return {
                hasPlay: typeof s.play === 'function',
                hasStop: typeof s.stop === 'function',
                name: s.name,
                inList: a.instruments.includes('test-synth'),
            };
        });
        expect(result.hasPlay).toBe(true);
        expect(result.hasStop).toBe(true);
        expect(result.name).toBe('test-synth');
        expect(result.inList).toBe(true);
    });

    test('AIMEAT.audio.soundboard has load/play/stop methods', async ({ page }) => {
        await loadHarness(page);
        const result = await page.evaluate(() => {
            const sb = (window as any).AIMEAT.audio.soundboard;
            return {
                hasLoad: typeof sb.load === 'function',
                hasPlay: typeof sb.play === 'function',
                hasStop: typeof sb.stop === 'function',
                hasLoadAll: typeof sb.loadAll === 'function',
            };
        });
        expect(result.hasLoad).toBe(true);
        expect(result.hasPlay).toBe(true);
        expect(result.hasStop).toBe(true);
        expect(result.hasLoadAll).toBe(true);
    });

    test('AIMEAT.audio.loadSamples and hasSamples work', async ({ page }) => {
        await loadHarness(page);
        await page.click('h1');
        const result = await page.evaluate(() => {
            const a = (window as any).AIMEAT.audio;
            return {
                hasLoadSamples: typeof a.loadSamples === 'function',
                hasHasSamples: typeof a.hasSamples === 'function',
                beforeLoad: a.hasSamples('piano'),
            };
        });
        expect(result.hasLoadSamples).toBe(true);
        expect(result.hasHasSamples).toBe(true);
        expect(result.beforeLoad).toBe(false);
    });

    test('AIMEAT.audio.connectRealtime is a function', async ({ page }) => {
        await loadHarness(page);
        const result = await page.evaluate(() => {
            const a = (window as any).AIMEAT.audio;
            return {
                hasConnect: typeof a.connectRealtime === 'function',
                hasDisconnect: typeof a.disconnectRealtime === 'function',
            };
        });
        expect(result.hasConnect).toBe(true);
        expect(result.hasDisconnect).toBe(true);
    });
});

test.describe('Speech Library', () => {
    test('AIMEAT.speech loads on test harness', async ({ page }) => {
        await loadHarness(page);
        const hasSpeech = await page.evaluate(() => typeof (window as any).AIMEAT.speech);
        expect(hasSpeech).toBe('object');
    });

    test('AIMEAT.speech has all expected methods', async ({ page }) => {
        await loadHarness(page);
        const result = await page.evaluate(() => {
            const s = (window as any).AIMEAT.speech;
            return {
                hasSay: typeof s.say === 'function',
                hasStop: typeof s.stop === 'function',
                hasVoices: typeof s.voices === 'function',
                hasListen: typeof s.listen === 'function',
                hasStopListening: typeof s.stopListening === 'function',
                hasUse: typeof s.use === 'function',
                hasOn: typeof s.on === 'function',
                hasOff: typeof s.off === 'function',
            };
        });
        expect(result.hasSay).toBe(true);
        expect(result.hasStop).toBe(true);
        expect(result.hasVoices).toBe(true);
        expect(result.hasListen).toBe(true);
        expect(result.hasStopListening).toBe(true);
        expect(result.hasUse).toBe(true);
        expect(result.hasOn).toBe(true);
        expect(result.hasOff).toBe(true);
    });

    test('AIMEAT.speech.supported returns capability object', async ({ page }) => {
        await loadHarness(page);
        const result = await page.evaluate(() => {
            const s = (window as any).AIMEAT.speech;
            return {
                hasTts: typeof s.supported.tts === 'boolean',
                hasStt: typeof s.supported.stt === 'boolean',
            };
        });
        expect(result.hasTts).toBe(true);
        expect(result.hasStt).toBe(true);
    });

    test('AIMEAT.speech.speaking is false initially', async ({ page }) => {
        await loadHarness(page);
        const speaking = await page.evaluate(() => (window as any).AIMEAT.speech.speaking);
        expect(speaking).toBe(false);
    });

    test('AIMEAT.speech.listening is false initially', async ({ page }) => {
        await loadHarness(page);
        const listening = await page.evaluate(() => (window as any).AIMEAT.speech.listening);
        expect(listening).toBe(false);
    });
});
```

- [ ] **Step 2: Run Playwright tests**

Run: `pnpm test:playwright -- audio-speech`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/playwright/audio-speech.spec.ts
git commit -m "test: add Playwright browser tests for audio + speech libraries"
```

---

## Task 12: File Headers and Final Verification

**Files:**
- Modify: `aimeat/src/routes/lib-audio.ts` (add header)
- Modify: `aimeat/src/routes/lib-speech.ts` (add header)

- [ ] **Step 1: Add file headers to both lib files**

`lib-audio.ts`:
```typescript
/**
 * @file lib-audio.ts
 * @description AIMEAT Audio Library generator. Returns a self-contained JavaScript IIFE
 *   that provides AIMEAT.audio with 6 built-in synthesized instruments (piano, guitar,
 *   bass, drums, flute, synth), a custom synth builder, soundboard for audio file playback,
 *   sample loader for upgrading to real recorded sounds, and a realtime bridge for
 *   networked jam sessions via AimeatRealtime.
 * @structure aimeatAudioLib(config) -> JS string
 * @usage Served at /v1/libs/aimeat-audio.js via libs.ts router
 * @version-history
 *   v1.0.0 — 2026-04-30 — Initial implementation
 */
```

`lib-speech.ts`:
```typescript
/**
 * @file lib-speech.ts
 * @description AIMEAT Speech Library generator. Returns a self-contained JavaScript IIFE
 *   that provides AIMEAT.speech with text-to-speech, speech-to-text, voice commands,
 *   and a pluggable provider architecture for cloud TTS/STT services.
 * @structure aimeatSpeechLib(config) -> JS string
 * @usage Served at /v1/libs/aimeat-speech.js via libs.ts router
 * @version-history
 *   v1.0.0 — 2026-04-30 — Initial implementation
 */
```

- [ ] **Step 2: Run full verification**

```bash
cd aimeat && npx tsc --noEmit
cd .. && pnpm lint
pnpm test:e2e
pnpm test:playwright -- audio-speech
```

Expected: All pass.

- [ ] **Step 3: Final commit**

```bash
git add aimeat/src/routes/lib-audio.ts aimeat/src/routes/lib-speech.ts
git commit -m "chore: add file headers to lib-audio.ts and lib-speech.ts"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Audio core engine (AudioContext, notes, master) | `lib-audio.ts` |
| 2 | 6 built-in synth instruments | `lib-audio.ts` |
| 3 | Soundboard, sample loader, custom synth | `lib-audio.ts` |
| 4 | Realtime bridge, public API | `lib-audio.ts` |
| 5 | Complete speech.js library | `lib-speech.ts` |
| 6 | Router integration (libs.ts) | `libs.ts` |
| 7 | Sample files (piano MP3s) | `public/lib/samples/` |
| 8 | Static lib files + importmap | `public/lib/audio.js`, `speech.js`, `spa.html` |
| 9 | llms-template.txt reference cards | `llms-template.txt` |
| 10 | E2E API tests | `test/e2e-audio-speech.ts` |
| 11 | Playwright browser tests | `test/playwright/audio-speech.spec.ts` |
| 12 | File headers + final verification | Headers + full test run |

**Parallelizable tasks:** Tasks 5 (speech.js) and 1-4 (audio.js) are independent. Task 7 (samples) is independent of all code tasks. Tasks 10-11 (tests) depend on 1-9 being complete.
