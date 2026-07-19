/**
 * @file speech/index.js
 * @description Pilot migration of the aimeat-speech library (SDK-libs migration Phase 0). Exposes
 *   `AIMEAT.speech` — text-to-speech, speech-to-text, voice-command matching, and a pluggable
 *   provider architecture for cloud TTS/STT (ElevenLabs, Whisper, …). This is the real, JSDoc-typed
 *   ESM source that esbuild bundles to the classic IIFE served, unchanged, at /v1/libs/aimeat-speech.js.
 *   Behavior is identical to the former `aimeatSpeechLib()` string generator — the only differences
 *   are: (1) the non-deterministic `Generated:` timestamp comment is gone, and (2) the global attach
 *   goes through the shared `_core/namespace` helper instead of an inline `global.AIMEAT` block.
 * @structure emit() · capability detection · TTS (native + cloud) · STT (native + cloud) · voice
 *   command matching · the `speech` public API · attach('speech', …).
 * @usage <script src="/v1/libs/aimeat-speech.js"></script>
 *   AIMEAT.speech.say('Hello'); await AIMEAT.speech.listen();
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated verbatim from src/routes/lib-speech.ts (SDK-libs migration Phase 0).
 */
import { attach } from '../_core/namespace.js';

// ══════════════════════════════════════════════════════
// Event system
// ══════════════════════════════════════════════════════

/** @type {Record<string, Array<(data: any) => void>>} */
const _listeners = {};
function emit(event, data) { (_listeners[event] || []).forEach(function (fn) { fn(data); }); }

// ══════════════════════════════════════════════════════
// Capability detection
// ══════════════════════════════════════════════════════

const _supported = {
  get tts() { return typeof window !== 'undefined' && 'speechSynthesis' in window; },
  get stt() { return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window); },
};

// ══════════════════════════════════════════════════════
// Provider slots
// ══════════════════════════════════════════════════════

/** @type {any} */
let _ttsProvider = null;
/** @type {any} */
let _sttProvider = null;

// ══════════════════════════════════════════════════════
// TTS state
// ══════════════════════════════════════════════════════

let _speaking = false;
/** @type {Array<{ text: string, opts: any }>} */
let _ttsQueue = [];

// ══════════════════════════════════════════════════════
// STT state
// ══════════════════════════════════════════════════════

let _listening = false;
/** @type {any} */
let _recognition = null;
/** @type {MediaRecorder | null} */
let _mediaRecorder = null;

// ══════════════════════════════════════════════════════
// Voices
// ══════════════════════════════════════════════════════

let _voicesLoaded = false;
/** @type {Array<{ name: string, lang: string }>} */
let _voicesList = [];

function loadVoices() {
  if (!_supported.tts) return [];
  _voicesList = speechSynthesis.getVoices().map(function (v) {
    return { name: v.name, lang: v.lang };
  });
  _voicesLoaded = _voicesList.length > 0;
  return _voicesList;
}
if (typeof window !== 'undefined' && _supported.tts) {
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
  loadVoices();
}

// ══════════════════════════════════════════════════════
// TTS: Native implementation
// ══════════════════════════════════════════════════════

function nativeSay(text, opts) {
  return new Promise(function (resolve) {
    const utt = new SpeechSynthesisUtterance(text);
    if (opts && opts.lang) utt.lang = opts.lang;
    if (opts && opts.rate !== undefined) utt.rate = opts.rate;
    if (opts && opts.pitch !== undefined) utt.pitch = opts.pitch;
    if (opts && opts.volume !== undefined) utt.volume = opts.volume;
    if (opts && opts.voice) {
      const voices = speechSynthesis.getVoices();
      const match = voices.find(function (v) {
        return v.name === opts.voice || v.name.indexOf(opts.voice) >= 0;
      });
      if (match) utt.voice = match;
    }
    utt.onstart = function () { emit('start', {}); };
    utt.onend = function () { _speaking = false; processQueue(); emit('end', {}); resolve(undefined); };
    utt.onboundary = function (e) {
      if (e.name === 'word') emit('word', { word: text.substr(e.charIndex, e.charLength || 10).split(/\s/)[0], index: e.charIndex });
    };
    utt.onerror = function (e) { _speaking = false; processQueue(); emit('error', { error: e.error }); resolve(undefined); };
    _speaking = true;
    speechSynthesis.speak(utt);
  });
}

// ══════════════════════════════════════════════════════
// TTS: Cloud provider playback
// ══════════════════════════════════════════════════════

function cloudSay(text, opts) {
  if (!_ttsProvider || !_ttsProvider.say) return Promise.resolve();
  _speaking = true;
  emit('start', {});
  return _ttsProvider.say(text, opts || {}).then(function (blob) {
    if (!blob) { _speaking = false; processQueue(); emit('end', {}); return; }
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    return blob.arrayBuffer().then(function (ab) { return ac.decodeAudioData(ab); }).then(function (buf) {
      const source = ac.createBufferSource();
      source.buffer = buf;
      source.connect(ac.destination);
      source.onended = function () { _speaking = false; processQueue(); emit('end', {}); };
      source.start();
    });
  }).catch(function (e) {
    _speaking = false; processQueue();
    emit('error', { error: e.message });
  });
}

function processQueue() {
  if (_ttsQueue.length > 0 && !_speaking) {
    const next = _ttsQueue.shift();
    if (next) doSay(next.text, next.opts);
  }
}

function doSay(text, opts) {
  if (_ttsProvider) return cloudSay(text, opts);
  if (!_supported.tts) { console.warn('[aimeat-speech] TTS not supported in this browser'); return Promise.resolve(); }
  return nativeSay(text, opts);
}

// ══════════════════════════════════════════════════════
// STT: Native implementation
// ══════════════════════════════════════════════════════

function nativeListen(opts) {
  return new Promise(function (resolve, reject) {
    const SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecog) { reject(new Error('SpeechRecognition not supported')); return; }

    _recognition = new SpeechRecog();
    _recognition.lang = (opts && opts.lang) || 'en-US';
    _recognition.continuous = (opts && opts.continuous) || false;
    _recognition.interimResults = (opts && opts.interimResults) || false;

    const commands = (opts && opts.commands) || null;

    _recognition.onstart = function () { _listening = true; emit('listening', {}); };
    _recognition.onresult = function (e) {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript.trim();
        const final = result.isFinal;
        const confidence = result[0].confidence;
        emit('result', { text: text, final: final, confidence: confidence });
        if (final && commands) matchCommand(text, commands);
        if (final && !_recognition.continuous) {
          resolve({ text: text, confidence: confidence, lang: _recognition.lang });
        }
      }
    };
    _recognition.onerror = function (e) {
      _listening = false;
      emit('error', { error: e.error });
      if (!_recognition.continuous) reject(new Error(e.error));
    };
    _recognition.onend = function () {
      _listening = false;
      emit('stopped', {});
      if (opts && opts.continuous && _recognition) {
        try { _recognition.start(); } catch { /* recognition already stopped */ }
      }
    };

    _recognition.start();
  });
}

// ══════════════════════════════════════════════════════
// STT: Cloud provider (MediaRecorder -> blob -> provider)
// ══════════════════════════════════════════════════════

function cloudListen(opts) {
  if (!_sttProvider || !_sttProvider.listen) return Promise.reject(new Error('No STT provider configured'));

  return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    return new Promise(function (resolve, reject) {
      /** @type {Blob[]} */
      const chunks = [];
      _mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      _listening = true;
      emit('listening', {});

      _mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data); };
      _mediaRecorder.onstop = function () {
        _listening = false;
        stream.getTracks().forEach(function (t) { t.stop(); });
        emit('stopped', {});
        const blob = new Blob(chunks, { type: 'audio/webm' });
        _sttProvider.listen(blob, opts || {}).then(function (result) {
          const text = typeof result === 'string' ? result : (result.text || result.transcript || '');
          const confidence = typeof result === 'object' ? (result.confidence || 1) : 1;
          emit('result', { text: text, final: true, confidence: confidence });
          resolve({ text: text, confidence: confidence, lang: (opts && opts.lang) || 'en-US' });
        }).catch(function (e) {
          emit('error', { error: e.message }); reject(e);
        });
      };

      _mediaRecorder.start();
      if (!(opts && opts.continuous)) {
        setTimeout(function () {
          if (_mediaRecorder && _mediaRecorder.state === 'recording') _mediaRecorder.stop();
        }, (opts && opts.timeout) || 5000);
      }
    });
  });
}

// ══════════════════════════════════════════════════════
// Voice Command matching
// ══════════════════════════════════════════════════════

function matchCommand(text, commands) {
  const lower = text.toLowerCase();
  Object.keys(commands).forEach(function (pattern) {
    const parts = pattern.toLowerCase().split(/\s+/);
    const regex = '^' + parts.map(function (p) {
      if (p.startsWith('*')) return '(.+)';
      return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('\\s+') + '$';
    const match = lower.match(new RegExp(regex));
    if (match) {
      const captures = match.slice(1);
      commands[pattern].apply(null, captures);
    }
  });
}

// ══════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════

const speech = {
  say: function (text, opts) {
    if (_speaking) {
      _ttsQueue.push({ text: text, opts: opts });
      return;
    }
    return doSay(text, opts);
  },

  stop: function () {
    if (_supported.tts) speechSynthesis.cancel();
    _speaking = false;
    _ttsQueue = [];
  },

  get speaking() { return _speaking; },

  voices: function (opts) {
    if (!_voicesLoaded) loadVoices();
    if (opts && opts.lang) {
      const lang = opts.lang.toLowerCase();
      return _voicesList.filter(function (v) { return v.lang.toLowerCase().startsWith(lang); });
    }
    return _voicesList;
  },

  listen: function (opts) {
    if (_sttProvider) return cloudListen(opts);
    return nativeListen(opts);
  },

  stopListening: function () {
    if (_recognition) { _recognition.continuous = false; try { _recognition.stop(); } catch { /* already stopped */ } _recognition = null; }
    if (_mediaRecorder && _mediaRecorder.state === 'recording') { _mediaRecorder.stop(); _mediaRecorder = null; }
    _listening = false;
  },

  get listening() { return _listening; },

  get supported() { return _supported; },

  use: function (type, provider) {
    if (type === 'tts') _ttsProvider = provider;
    else if (type === 'stt') _sttProvider = provider;
    else console.warn('[aimeat-speech] Unknown provider type:', type);
  },

  on: function (event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  },

  off: function (event, fn) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(function (f) { return f !== fn; });
  },
};

// ── Expose globally ──
attach('speech', speech);
