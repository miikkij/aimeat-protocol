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
import type { AimeatConfig } from '../config.js';

export function aimeatSpeechLib(_config: AimeatConfig): string {
    return `// aimeat-speech.js — AIMEAT Speech Library
// Node: ${_config.nodeId} | Generated: ${new Date().toISOString()}
// Include: <script src="${_config.baseUrl}/v1/libs/aimeat-speech.js"><\\/script>
// Usage: AIMEAT.speech.say('Hello'); await AIMEAT.speech.listen();
(function(global) {
'use strict';

// ══════════════════════════════════════════════════════
// Event system
// ══════════════════════════════════════════════════════

var _listeners = {};
function emit(event, data) { (_listeners[event] || []).forEach(function(fn) { fn(data); }); }

// ══════════════════════════════════════════════════════
// Capability detection
// ══════════════════════════════════════════════════════

var _supported = {
  get tts() { return typeof window !== 'undefined' && 'speechSynthesis' in window; },
  get stt() { return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window); }
};

// ══════════════════════════════════════════════════════
// Provider slots
// ══════════════════════════════════════════════════════

var _ttsProvider = null;
var _sttProvider = null;

// ══════════════════════════════════════════════════════
// TTS state
// ══════════════════════════════════════════════════════

var _speaking = false;
var _ttsQueue = [];

// ══════════════════════════════════════════════════════
// STT state
// ══════════════════════════════════════════════════════

var _listening = false;
var _recognition = null;
var _mediaRecorder = null;

// ══════════════════════════════════════════════════════
// Voices
// ══════════════════════════════════════════════════════

var _voicesLoaded = false;
var _voicesList = [];

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

// ══════════════════════════════════════════════════════
// TTS: Native implementation
// ══════════════════════════════════════════════════════

function nativeSay(text, opts) {
  return new Promise(function(resolve) {
    var utt = new SpeechSynthesisUtterance(text);
    if (opts && opts.lang) utt.lang = opts.lang;
    if (opts && opts.rate !== undefined) utt.rate = opts.rate;
    if (opts && opts.pitch !== undefined) utt.pitch = opts.pitch;
    if (opts && opts.volume !== undefined) utt.volume = opts.volume;
    if (opts && opts.voice) {
      var voices = speechSynthesis.getVoices();
      var match = voices.find(function(v) {
        return v.name === opts.voice || v.name.indexOf(opts.voice) >= 0;
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

// ══════════════════════════════════════════════════════
// TTS: Cloud provider playback
// ══════════════════════════════════════════════════════

function cloudSay(text, opts) {
  if (!_ttsProvider || !_ttsProvider.say) return Promise.resolve();
  _speaking = true;
  emit('start', {});
  return _ttsProvider.say(text, opts || {}).then(function(blob) {
    if (!blob) { _speaking = false; processQueue(); emit('end', {}); return; }
    var ac = new (window.AudioContext || window.webkitAudioContext)();
    return blob.arrayBuffer().then(function(ab) { return ac.decodeAudioData(ab); }).then(function(buf) {
      var source = ac.createBufferSource();
      source.buffer = buf;
      source.connect(ac.destination);
      source.onended = function() { _speaking = false; processQueue(); emit('end', {}); };
      source.start();
    });
  }).catch(function(e) {
    _speaking = false; processQueue();
    emit('error', { error: e.message });
  });
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

// ══════════════════════════════════════════════════════
// STT: Native implementation
// ══════════════════════════════════════════════════════

function nativeListen(opts) {
  return new Promise(function(resolve, reject) {
    var SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
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
      if (opts && opts.continuous && _recognition) {
        try { _recognition.start(); } catch(e) {}
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

  return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    return new Promise(function(resolve, reject) {
      var chunks = [];
      _mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      _listening = true;
      emit('listening', {});

      _mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
      _mediaRecorder.onstop = function() {
        _listening = false;
        stream.getTracks().forEach(function(t) { t.stop(); });
        emit('stopped', {});
        var blob = new Blob(chunks, { type: 'audio/webm' });
        _sttProvider.listen(blob, opts || {}).then(function(result) {
          var text = typeof result === 'string' ? result : (result.text || result.transcript || '');
          var confidence = typeof result === 'object' ? (result.confidence || 1) : 1;
          emit('result', { text: text, final: true, confidence: confidence });
          resolve({ text: text, confidence: confidence, lang: (opts && opts.lang) || 'en-US' });
        }).catch(function(e) {
          emit('error', { error: e.message }); reject(e);
        });
      };

      _mediaRecorder.start();
      if (!(opts && opts.continuous)) {
        setTimeout(function() {
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
  var lower = text.toLowerCase();
  Object.keys(commands).forEach(function(pattern) {
    var parts = pattern.toLowerCase().split(/\\s+/);
    var regex = '^' + parts.map(function(p) {
      if (p.startsWith('*')) return '(.+)';
      return p.replace(/[.*+?^\\\${}()|[\\]\\\\]/g, '\\\\\\$&');
    }).join('\\\\s+') + '\\$';
    var match = lower.match(new RegExp(regex));
    if (match) {
      var captures = match.slice(1);
      commands[pattern].apply(null, captures);
    }
  });
}

// ══════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════

var speech = {
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
