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
import type { AimeatConfig } from '../config.js';

export function aimeatAudioLib(config: AimeatConfig): string {
    return `// aimeat-audio.js — AIMEAT Audio Library
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Include: <script src="${config.baseUrl}/v1/libs/aimeat-audio.js"><\\/script>
// Usage: AIMEAT.audio.play('piano', 'C4');
(function(global) {
'use strict';

var NODE_URL = (function() {
  var meta = document.querySelector('meta[name="aimeat-node"]');
  if (meta) return meta.getAttribute('content').replace(/\\/$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return '${config.baseUrl}';
})();

// ══════════════════════════════════════════════════════
// AudioContext singleton
// ══════════════════════════════════════════════════════

var _ctx = null;

function ctx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') {
      var resume = function() {
        if (_ctx && _ctx.state === 'suspended') _ctx.resume();
      };
      ['click', 'touchstart', 'keydown'].forEach(function(e) {
        document.addEventListener(e, resume, { once: false, passive: true });
      });
    }
  }
  return _ctx;
}

// ══════════════════════════════════════════════════════
// Note frequency table (A0-C8, scientific pitch)
// ══════════════════════════════════════════════════════

var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
var FLAT_MAP = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#','Cs':'C#','Ds':'D#','Fs':'F#','Gs':'G#','As':'A#' };
var _freqCache = {};

function noteToFreq(note) {
  if (_freqCache[note]) return _freqCache[note];
  var n = note.trim();
  var flatKey = n.slice(0, 2);
  if (FLAT_MAP[flatKey]) n = FLAT_MAP[flatKey] + n.slice(2);
  var match = n.match(/^([A-G]#?)(\\d)$/);
  if (!match) return null;
  var name = match[1];
  var octave = parseInt(match[2]);
  var semitone = NOTE_NAMES.indexOf(name);
  if (semitone < 0) return null;
  var midi = (octave + 1) * 12 + semitone;
  var freq = 440 * Math.pow(2, (midi - 69) / 12);
  _freqCache[note] = freq;
  return freq;
}

// ══════════════════════════════════════════════════════
// Master output
// ══════════════════════════════════════════════════════

var _masterGain = null;

function masterNode() {
  if (!_masterGain) {
    _masterGain = ctx().createGain();
    _masterGain.connect(ctx().destination);
  }
  return _masterGain;
}

var master = {
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

// ══════════════════════════════════════════════════════
// Active notes registry (for stop)
// ══════════════════════════════════════════════════════

var _active = {};

function registerActive(instrument, note, nodes, stopFn) {
  var key = instrument + ':' + (note || '*');
  if (_active[key]) _active[key].stop();
  _active[key] = { nodes: nodes, stop: stopFn };
}

function stopActive(instrument, note) {
  if (!instrument) {
    Object.keys(_active).forEach(function(k) { _active[k].stop(); delete _active[k]; });
    return;
  }
  if (note) {
    var key = instrument + ':' + note;
    if (_active[key]) { _active[key].stop(); delete _active[key]; }
  } else {
    Object.keys(_active).forEach(function(k) {
      if (k.startsWith(instrument + ':')) { _active[k].stop(); delete _active[k]; }
    });
  }
}

// ══════════════════════════════════════════════════════
// Instruments
// ══════════════════════════════════════════════════════

var _instruments = {};
var _sampleBuffers = {};
var _customSynths = {};

// ── Piano: 2-operator FM synthesis ──

_instruments.piano = {
  play: function(note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    var dur = (opts && opts.duration) || 2.0;

    var mod = ctx().createOscillator(); mod.type = 'sine';
    mod.frequency.value = freq * 2;
    var modGain = ctx().createGain();
    modGain.gain.setValueAtTime(freq * 1.5 * vel, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.01, t + dur * 0.8);
    mod.connect(modGain);

    var car = ctx().createOscillator(); car.type = 'sine';
    car.frequency.value = freq;
    modGain.connect(car.frequency);

    var env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.4, t + 0.005);
    env.gain.exponentialRampToValueAtTime(vel * 0.15, t + 0.1);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    car.connect(env); env.connect(masterNode());
    mod.start(t); car.start(t);
    mod.stop(t + dur + 0.1); car.stop(t + dur + 0.1);

    registerActive('piano', note, [mod, car], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.setValueAtTime(env.gain.value, ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      mod.stop(ctx().currentTime + 0.1); car.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};

// ── Guitar: Karplus-Strong plucked string ──

_instruments.guitar = {
  play: function(note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    var dur = (opts && opts.duration) || 1.5;

    var bufSize = Math.round(ctx().sampleRate / freq);
    var noiseBuffer = ctx().createBuffer(1, bufSize, ctx().sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * vel;

    var noise = ctx().createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    var filter = ctx().createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 4;
    filter.Q.value = 0.5;

    var env = ctx().createGain();
    env.gain.setValueAtTime(vel * 0.5, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter); filter.connect(env); env.connect(masterNode());
    noise.start(t); noise.stop(t + dur + 0.05);

    registerActive('guitar', note, [noise], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      noise.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};

// ── Bass: sawtooth + lowpass + sub-oscillator ──

_instruments.bass = {
  play: function(note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    var dur = (opts && opts.duration) || 0.8;

    var osc = ctx().createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
    var sub = ctx().createOscillator(); sub.type = 'sine'; sub.frequency.value = freq / 2;
    var subGain = ctx().createGain(); subGain.gain.value = 0.5;
    sub.connect(subGain);

    var mix = ctx().createGain();
    osc.connect(mix); subGain.connect(mix);

    var filter = ctx().createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3, t);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.15);
    filter.Q.value = 2;

    var env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.5, t + 0.01);
    env.gain.setValueAtTime(vel * 0.5, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    mix.connect(filter); filter.connect(env); env.connect(masterNode());
    osc.start(t); sub.start(t);
    osc.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);

    registerActive('bass', note, [osc, sub], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      osc.stop(ctx().currentTime + 0.1); sub.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};

// ── Drums: noise + sine bursts (per-hit) ──

_instruments.drums = {
  play: function(hit, opts) {
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;

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

    var synths = {
      'kick': function() {
        var osc = ctx().createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(g); g.connect(masterNode());
        var click = ctx().createOscillator(); click.type = 'square'; click.frequency.value = 800;
        var cg = ctx().createGain();
        cg.gain.setValueAtTime(vel * 0.3, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        click.connect(cg); cg.connect(masterNode());
        osc.start(t); osc.stop(t + 0.5);
        click.start(t); click.stop(t + 0.05);
        return [osc, click];
      },
      'snare': function() {
        var bufLen = Math.round(ctx().sampleRate * 0.15);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var nf = ctx().createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1000;
        var ng = ctx().createGain();
        ng.gain.setValueAtTime(vel * 0.6, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        noise.connect(nf); nf.connect(ng); ng.connect(masterNode());
        var osc = ctx().createOscillator(); osc.type = 'sine'; osc.frequency.value = 200;
        var og = ctx().createGain();
        og.gain.setValueAtTime(vel * 0.5, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.connect(og); og.connect(masterNode());
        noise.start(t); osc.start(t); osc.stop(t + 0.2);
        return [noise, osc];
      },
      'hihat': function() {
        var bufLen = Math.round(ctx().sampleRate * 0.05);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'hihat-open': function() {
        var bufLen = Math.round(ctx().sampleRate * 0.3);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'crash': function() {
        var bufLen = Math.round(ctx().sampleRate * 1.0);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'ride': function() {
        var bufLen = Math.round(ctx().sampleRate * 0.8);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var f = ctx().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 8000; f.Q.value = 1;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'tom-high': function() { return makeTom(300); },
      'tom-mid': function() { return makeTom(220); },
      'tom-low': function() { return makeTom(150); },
      'clap': function() {
        var nodes = [];
        for (var ci = 0; ci < 3; ci++) {
          var delay = ci * 0.01;
          var bufLen = Math.round(ctx().sampleRate * 0.02);
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

    var fn = synths[hit];
    if (!fn) { console.warn('[aimeat-audio] Unknown drum hit:', hit); return; }
    var nodes = fn();
    registerActive('drums', hit, nodes, function() {
      nodes.forEach(function(n) { try { n.stop(ctx().currentTime + 0.01); } catch(e){} });
    });
  }
};

// ── Flute: sine + breath noise + vibrato LFO ──

_instruments.flute = {
  play: function(note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.6;
    var dur = (opts && opts.duration) || 1.5;
    var vibDepth = (opts && opts.vibrato !== undefined) ? opts.vibrato : 0.15;

    var osc = ctx().createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;

    var lfo = ctx().createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
    var lfoGain = ctx().createGain(); lfoGain.gain.value = freq * vibDepth * 0.02;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);

    var noiseBufLen = Math.round(ctx().sampleRate * dur);
    var noiseBuf = ctx().createBuffer(1, noiseBufLen, ctx().sampleRate);
    var nd = noiseBuf.getChannelData(0);
    for (var i = 0; i < noiseBufLen; i++) nd[i] = (Math.random() * 2 - 1);
    var noiseNode = ctx().createBufferSource(); noiseNode.buffer = noiseBuf;
    var noiseFilt = ctx().createBiquadFilter(); noiseFilt.type = 'bandpass';
    noiseFilt.frequency.value = freq; noiseFilt.Q.value = 2;
    var noiseGain = ctx().createGain(); noiseGain.gain.value = vel * 0.06;
    noiseNode.connect(noiseFilt); noiseFilt.connect(noiseGain);

    var env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.3, t + 0.08);
    env.gain.setValueAtTime(vel * 0.3, t + dur - 0.1);
    env.gain.linearRampToValueAtTime(0, t + dur);

    osc.connect(env); noiseGain.connect(env); env.connect(masterNode());
    lfo.start(t); osc.start(t); noiseNode.start(t);
    lfo.stop(t + dur + 0.1); osc.stop(t + dur + 0.1);

    registerActive('flute', note, [osc, lfo, noiseNode], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      osc.stop(ctx().currentTime + 0.1); lfo.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};

// ── Synth: configurable oscillator ──

_instruments.synth = {
  play: function(note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    var dur = (opts && opts.duration) || 1.0;
    var wave = (opts && opts.wave) || 'sawtooth';
    var filterFreq = (opts && opts.filter) || 2000;

    var osc = ctx().createOscillator(); osc.type = wave; osc.frequency.value = freq;
    var osc2 = ctx().createOscillator(); osc2.type = wave; osc2.frequency.value = freq; osc2.detune.value = 7;
    var osc2Gain = ctx().createGain(); osc2Gain.gain.value = 0.5;
    osc2.connect(osc2Gain);

    var filter = ctx().createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = filterFreq; filter.Q.value = 1;

    var env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.3, t + 0.02);
    env.gain.setValueAtTime(vel * 0.3, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(filter); osc2Gain.connect(filter);
    filter.connect(env); env.connect(masterNode());
    osc.start(t); osc2.start(t);
    osc.stop(t + dur + 0.05); osc2.stop(t + dur + 0.05);

    registerActive('synth', note, [osc, osc2], function() {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
      env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
      osc.stop(ctx().currentTime + 0.1); osc2.stop(ctx().currentTime + 0.1); } catch(e){}
    });
  }
};

// ══════════════════════════════════════════════════════
// Soundboard: load and play audio files
// ══════════════════════════════════════════════════════

var _soundboardBuffers = {};
var _soundboardSources = {};

var soundboard = {
  load: function(name, url) {
    return fetch(url).then(function(resp) {
      if (!resp.ok) throw new Error('Failed to load sound: ' + url);
      return resp.arrayBuffer();
    }).then(function(arrayBuf) {
      return ctx().decodeAudioData(arrayBuf);
    }).then(function(decoded) {
      _soundboardBuffers[name] = decoded;
    });
  },

  loadAll: function(map) {
    var entries = Object.keys(map);
    return Promise.all(entries.map(function(k) { return soundboard.load(k, map[k]); }));
  },

  play: function(name, opts) {
    var buf = _soundboardBuffers[name];
    if (!buf) { console.warn('[aimeat-audio] Sound not loaded:', name); return; }
    var source = ctx().createBufferSource();
    source.buffer = buf;
    source.loop = (opts && opts.loop) || false;
    var gain = ctx().createGain();
    gain.gain.value = (opts && opts.volume !== undefined) ? opts.volume : 1;
    source.connect(gain); gain.connect(masterNode());
    source.start();
    _soundboardSources[name] = source;
    source.onended = function() { if (_soundboardSources[name] === source) delete _soundboardSources[name]; };
  },

  stop: function(name) {
    if (_soundboardSources[name]) {
      try { _soundboardSources[name].stop(); } catch(e){}
      delete _soundboardSources[name];
    }
  }
};

// ══════════════════════════════════════════════════════
// Sample Loader
// ══════════════════════════════════════════════════════

var SAMPLE_NOTES = {
  piano: ['A2','C3','Ds3','A3','C4','Ds4','A4','C5','Ds5','C6','C7'],
  guitar: ['E2','A2','D3','G3','B3','E4','A4','E5'],
  bass: ['E1','A1','D2','G2','B2','E3'],
  flute: ['C4','E4','A4','C5','E5','A5','C6'],
  drums: ['kick','snare','hihat','hihat-open','crash','ride','tom-high','tom-mid','tom-low','clap','cowbell']
};

function loadSamples(instrument, opts) {
  var source = (opts && opts.source) || (NODE_URL + '/lib/samples/' + instrument + '/');
  var notes = SAMPLE_NOTES[instrument];
  if (!notes) { console.warn('[aimeat-audio] No sample map for:', instrument); return Promise.resolve(); }
  if (!_sampleBuffers[instrument]) _sampleBuffers[instrument] = {};

  return Promise.all(notes.map(function(note) {
    var url = source + note + '.mp3';
    return fetch(url).then(function(resp) {
      if (!resp.ok) return null;
      return resp.arrayBuffer();
    }).then(function(buf) {
      if (!buf) return;
      return ctx().decodeAudioData(buf);
    }).then(function(decoded) {
      if (decoded) _sampleBuffers[instrument][note] = decoded;
    }).catch(function() {
      console.warn('[aimeat-audio] Failed to load sample:', url);
    });
  }));
}

function hasSamples(instrument) {
  return !!_sampleBuffers[instrument] && Object.keys(_sampleBuffers[instrument]).length > 0;
}

function findNearestSample(instrument, note) {
  var samples = _sampleBuffers[instrument];
  if (!samples) return null;
  if (instrument === 'drums') return samples[note] ? { buffer: samples[note], rate: 1 } : null;
  var targetFreq = noteToFreq(note);
  if (!targetFreq) return null;
  var nearest = null;
  var nearestDist = Infinity;
  Object.keys(samples).forEach(function(sn) {
    var sf = noteToFreq(sn);
    if (!sf) return;
    var dist = Math.abs(Math.log2(targetFreq / sf));
    if (dist < nearestDist) { nearestDist = dist; nearest = { buffer: samples[sn], rate: targetFreq / sf }; }
  });
  return nearest;
}

function playSample(instrument, note, opts) {
  var s = findNearestSample(instrument, note);
  if (!s) return false;
  var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
  var source = ctx().createBufferSource();
  source.buffer = s.buffer;
  source.playbackRate.value = s.rate;
  var gain = ctx().createGain(); gain.gain.value = vel;
  source.connect(gain); gain.connect(masterNode());
  source.start();
  registerActive(instrument, note, [source], function() {
    try { source.stop(); } catch(e){}
  });
  return true;
}

// ══════════════════════════════════════════════════════
// Custom Synth Builder
// ══════════════════════════════════════════════════════

function createCustomSynth(config) {
  var name = config.name || ('custom-' + Date.now());
  var oscConfigs = config.oscillators || [{ wave: 'sawtooth', detune: 0 }];
  var envConfig = config.envelope || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.1 };
  var filterConfig = config.filter || null;
  var pitchEnvConfig = config.pitchEnvelope || null;
  var effectsConfig = config.effects || [];

  function buildEffectChain(input) {
    var current = input;
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
        current.connect(ws); current = ws;
      } else if (fx.type === 'delay') {
        var dryG = ctx().createGain(); dryG.gain.value = 1 - (fx.mix || 0.3);
        var wetG = ctx().createGain(); wetG.gain.value = fx.mix || 0.3;
        var dly = ctx().createDelay(5.0); dly.delayTime.value = fx.time || 0.3;
        var fb = ctx().createGain(); fb.gain.value = fx.feedback || 0.4;
        current.connect(dryG); current.connect(dly);
        dly.connect(fb); fb.connect(dly); dly.connect(wetG);
        var merge = ctx().createGain();
        dryG.connect(merge); wetG.connect(merge);
        current = merge;
      } else if (fx.type === 'chorus') {
        var cDry = ctx().createGain(); cDry.gain.value = 1 - (fx.mix || 0.5);
        var cWet = ctx().createGain(); cWet.gain.value = fx.mix || 0.5;
        var cDelay = ctx().createDelay(); cDelay.delayTime.value = 0.02;
        var cLfo = ctx().createOscillator(); cLfo.type = 'sine'; cLfo.frequency.value = fx.rate || 1.5;
        var cDepth = ctx().createGain(); cDepth.gain.value = (fx.depth || 0.7) * 0.01;
        cLfo.connect(cDepth); cDepth.connect(cDelay.delayTime); cLfo.start();
        current.connect(cDry); current.connect(cDelay); cDelay.connect(cWet);
        var cMerge = ctx().createGain();
        cDry.connect(cMerge); cWet.connect(cMerge);
        current = cMerge;
      } else if (fx.type === 'tremolo') {
        var trem = ctx().createGain();
        var tLfo = ctx().createOscillator(); tLfo.type = 'sine'; tLfo.frequency.value = fx.rate || 4;
        var tDepth = ctx().createGain(); tDepth.gain.value = fx.depth || 0.5;
        tLfo.connect(tDepth); tDepth.connect(trem.gain); tLfo.start();
        trem.gain.value = 1 - (fx.depth || 0.5) / 2;
        current.connect(trem); current = trem;
      } else if (fx.type === 'reverb') {
        var rDry = ctx().createGain(); rDry.gain.value = 1 - (fx.mix || 0.5);
        var rWet = ctx().createGain(); rWet.gain.value = fx.mix || 0.5;
        var d1 = ctx().createDelay(); d1.delayTime.value = 0.037;
        var d2 = ctx().createDelay(); d2.delayTime.value = 0.053;
        var d3 = ctx().createDelay(); d3.delayTime.value = 0.071;
        var rFb = Math.min(0.85, (fx.decay || 2) / 5);
        var fg1 = ctx().createGain(); fg1.gain.value = rFb;
        var fg2 = ctx().createGain(); fg2.gain.value = rFb * 0.9;
        var fg3 = ctx().createGain(); fg3.gain.value = rFb * 0.8;
        d1.connect(fg1); fg1.connect(d1); d2.connect(fg2); fg2.connect(d2); d3.connect(fg3); fg3.connect(d3);
        current.connect(rDry); current.connect(d1); current.connect(d2); current.connect(d3);
        var rMerge = ctx().createGain();
        rDry.connect(rMerge); d1.connect(rWet); d2.connect(rWet); d3.connect(rWet); rWet.connect(rMerge);
        current = rMerge;
      } else if (fx.type === 'filter') {
        var ff = ctx().createBiquadFilter();
        ff.type = fx.filterType || 'lowpass';
        ff.frequency.value = fx.frequency || 1000;
        ff.Q.value = fx.Q || 1;
        current.connect(ff); current = ff;
      }
    });
    return current;
  }

  var synth = {
    name: name,
    play: function(note, opts) {
      var freq = noteToFreq(note);
      if (!freq) return;
      var t = ctx().currentTime;
      var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
      var dur = (opts && opts.duration) || 1.0;
      var allOscs = [];
      var mix = ctx().createGain();
      mix.gain.value = vel * 0.4 / oscConfigs.length;

      oscConfigs.forEach(function(oc) {
        var o = ctx().createOscillator();
        o.type = oc.wave || 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = oc.detune || 0;
        if (oc.gain !== undefined) {
          var og = ctx().createGain(); og.gain.value = oc.gain;
          o.connect(og); og.connect(mix);
        } else {
          o.connect(mix);
        }
        allOscs.push(o);
      });

      var chain = mix;
      if (filterConfig) {
        var cf = ctx().createBiquadFilter();
        cf.type = filterConfig.type || 'lowpass';
        cf.frequency.value = filterConfig.frequency || 1000;
        cf.Q.value = filterConfig.Q || 1;
        mix.connect(cf); chain = cf;
      }

      chain = buildEffectChain(chain);

      var env = ctx().createGain();
      var a = envConfig.attack || 0.01;
      var d = envConfig.decay || 0.1;
      var s = envConfig.sustain !== undefined ? envConfig.sustain : 0.7;
      var r = envConfig.release || 0.1;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + a);
      env.gain.linearRampToValueAtTime(s, t + a + d);
      if (dur) {
        env.gain.setValueAtTime(s, t + dur - r);
        env.gain.linearRampToValueAtTime(0, t + dur);
      }

      chain.connect(env); env.connect(masterNode());

      if (pitchEnvConfig) {
        allOscs.forEach(function(o) {
          o.frequency.setValueAtTime(pitchEnvConfig.start || freq, t);
          o.frequency.exponentialRampToValueAtTime(pitchEnvConfig.end || freq, t + (pitchEnvConfig.time || 0.1));
        });
      }

      allOscs.forEach(function(o) { o.start(t); if (dur) o.stop(t + dur + 0.1); });

      registerActive(name, note, allOscs, function() {
        try { env.gain.cancelScheduledValues(ctx().currentTime);
        env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
        allOscs.forEach(function(o) { try{o.stop(ctx().currentTime+0.1);}catch(e){} }); } catch(e){}
      });
    },
    stop: function(note) { stopActive(name, note); }
  };

  _instruments[name] = synth;
  _customSynths[name] = synth;
  return synth;
}

// ══════════════════════════════════════════════════════
// Realtime Bridge
// ══════════════════════════════════════════════════════

var _rtInstance = null;
var _rtHandlerBroadcast = null;
var _rtHandlerPeerData = null;

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

// ══════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════

var audio = {
  play: function(instrument, note, opts) {
    if (_sampleBuffers[instrument] && Object.keys(_sampleBuffers[instrument]).length > 0) {
      if (playSample(instrument, note, opts)) return;
    }
    if (_customSynths[instrument]) {
      _customSynths[instrument].play(note, opts);
      return;
    }
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

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.audio = audio;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
