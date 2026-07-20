/**
 * @file audio/index.js
 * @description Entry for the aimeat-audio library (SDK-libs migration Phase 2). Assembles the public
 *   AIMEAT.audio surface from the shared core (core.js: context/notes/master/active + registries) and
 *   the built-in instruments (instruments.js, imported for its registration side-effect), and adds the
 *   soundboard (audio-file playback), the sample loader (upgrade to recorded sounds under /lib/samples),
 *   the custom synth builder (oscillators + envelope + filter + effects chain), and the realtime bridge
 *   for networked jam sessions via AimeatRealtime. esbuild bundles this + its imports into the IIFE
 *   served, unchanged, at /v1/libs/aimeat-audio.js. Merges the former lib-audio.ts + audio-lib-part2.ts;
 *   NODE_URL now comes from _core/config.
 * @structure imports core + './instruments.js' + NODE_URL/attach; soundboard; loadSamples/hasSamples/
 *   findNearestSample/playSample; createCustomSynth; realtime bridge; the `audio` API; attach('audio', …).
 * @usage <script src="/v1/libs/aimeat-audio.js"></script>  AIMEAT.audio.play('piano', 'C4');
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated + merged from lib-audio.ts + audio-lib-part2.ts (SDK-libs migration Phase 2).
 */
import { NODE_URL } from '../_core/config.js';
import { attach } from '../_core/namespace.js';
import { ctx, noteToFreq, masterNode, master, registerActive, stopActive, instruments, sampleBuffers, customSynths } from './core.js';
import './instruments.js'; // side-effect: registers the 6 built-in instruments onto the shared registry

// ══════════════════════════════════════════════════════
// Soundboard: load and play audio files
// ══════════════════════════════════════════════════════

var _soundboardBuffers = {};
var _soundboardSources = {};

var soundboard = {
  load: function (name, url) {
    return fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error('Failed to load sound: ' + url);
      return resp.arrayBuffer();
    }).then(function (arrayBuf) {
      return ctx().decodeAudioData(arrayBuf);
    }).then(function (decoded) {
      _soundboardBuffers[name] = decoded;
    });
  },

  loadAll: function (map) {
    var entries = Object.keys(map);
    return Promise.all(entries.map(function (k) { return soundboard.load(k, map[k]); }));
  },

  play: function (name, opts) {
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
    source.onended = function () { if (_soundboardSources[name] === source) delete _soundboardSources[name]; };
  },

  stop: function (name) {
    if (_soundboardSources[name]) {
      try { _soundboardSources[name].stop(); } catch { /* already stopped */ }
      delete _soundboardSources[name];
    }
  },
};

// ══════════════════════════════════════════════════════
// Sample Loader
// ══════════════════════════════════════════════════════

var SAMPLE_NOTES = {
  piano: ['A2', 'C3', 'Ds3', 'A3', 'C4', 'Ds4', 'A4', 'C5', 'Ds5', 'C6', 'C7'],
  guitar: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'E5'],
  'guitar-steel': ['E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'E5'],
  'guitar-el': ['E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'E5'],
  bass: ['E1', 'A1', 'D2', 'G2', 'B2', 'E3'],
  flute: ['C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6'],
  strings: ['C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'G5', 'C6'],
  organ: ['C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'G5', 'C6'],
  epiano: ['C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'G5', 'C6'],
  trumpet: ['E3', 'A3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5'],
  drums: ['kick', 'snare', 'hihat', 'hihat-open', 'crash', 'ride', 'tom-high', 'tom-mid', 'tom-low', 'clap', 'cowbell'],
};

function loadSamples(instrument, opts) {
  var source = (opts && opts.source) || (NODE_URL + '/lib/samples/' + instrument + '/');
  var notes = SAMPLE_NOTES[instrument];
  if (!notes) { console.warn('[aimeat-audio] No sample map for:', instrument); return Promise.resolve(); }
  if (!sampleBuffers[instrument]) sampleBuffers[instrument] = {};

  return Promise.all(notes.map(function (note) {
    var url = source + note + '.mp3';
    return fetch(url).then(function (resp) {
      if (!resp.ok) return null;
      return resp.arrayBuffer();
    }).then(function (buf) {
      if (!buf) return;
      return ctx().decodeAudioData(buf);
    }).then(function (decoded) {
      if (decoded) sampleBuffers[instrument][note] = decoded;
    }).catch(function () {
      console.warn('[aimeat-audio] Failed to load sample:', url);
    });
  }));
}

function hasSamples(instrument) {
  return !!sampleBuffers[instrument] && Object.keys(sampleBuffers[instrument]).length > 0;
}

function findNearestSample(instrument, note) {
  var samples = sampleBuffers[instrument];
  if (!samples) return null;
  if (instrument === 'drums') return samples[note] ? { buffer: samples[note], rate: 1 } : null;
  var targetFreq = noteToFreq(note);
  if (!targetFreq) return null;
  var nearest = null;
  var nearestDist = Infinity;
  Object.keys(samples).forEach(function (sn) {
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
  registerActive(instrument, note, [source], function () {
    try { source.stop(); } catch { /* already stopped */ }
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
    effectsConfig.forEach(function (fx) {
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
    play: function (note, opts) {
      var freq = noteToFreq(note);
      if (!freq) return;
      var t = ctx().currentTime;
      var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
      var dur = (opts && opts.duration) || 1.0;
      var allOscs = [];
      var mix = ctx().createGain();
      mix.gain.value = vel * 0.4 / oscConfigs.length;

      oscConfigs.forEach(function (oc) {
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
        allOscs.forEach(function (o) {
          o.frequency.setValueAtTime(pitchEnvConfig.start || freq, t);
          o.frequency.exponentialRampToValueAtTime(pitchEnvConfig.end || freq, t + (pitchEnvConfig.time || 0.1));
        });
      }

      allOscs.forEach(function (o) { o.start(t); if (dur) o.stop(t + dur + 0.1); });

      registerActive(name, note, allOscs, function () {
        try { env.gain.cancelScheduledValues(ctx().currentTime);
          env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
          allOscs.forEach(function (o) { try { o.stop(ctx().currentTime + 0.1); } catch { /* already stopped */ } }); } catch { /* already stopped */ }
      });
    },
    stop: function (note) { stopActive(name, note); },
  };

  instruments[name] = synth;
  customSynths[name] = synth;
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

  _rtHandlerBroadcast = function (msg) {
    var d = msg.data || msg.payload || msg;
    if (d && d.instrument && (d.note || d.hit)) {
      audio.play(d.instrument, d.note || d.hit, d);
    }
  };
  _rtHandlerPeerData = function (msg) {
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
  play: function (instrument, note, opts) {
    if (sampleBuffers[instrument] && Object.keys(sampleBuffers[instrument]).length > 0) {
      if (playSample(instrument, note, opts)) return;
    }
    if (customSynths[instrument]) {
      customSynths[instrument].play(note, opts);
      return;
    }
    var inst = instruments[instrument];
    if (!inst) { console.warn('[aimeat-audio] Unknown instrument:', instrument); return; }
    inst.play(note, opts);
  },

  stop: function (instrument, note) {
    stopActive(instrument, note);
  },

  get instruments() {
    var list = Object.keys(instruments);
    Object.keys(customSynths).forEach(function (k) {
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
attach('audio', audio);
