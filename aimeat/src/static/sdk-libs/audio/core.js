/**
 * @file audio/core.js
 * @description Shared core for the aimeat-audio library (SDK-libs migration Phase 2): the Web Audio
 *   context singleton (with autoplay-unlock on first gesture), the scientific-pitch note→frequency
 *   table, the master output node + volume/mute control, the active-notes registry (for stop), and
 *   the shared instrument / sample / custom-synth registries. Imported by instruments.js (which
 *   populates the built-ins) and index.js (soundboard/samples/custom-synth/realtime/public API).
 * @structure ctx() · noteToFreq() · masterNode() · master · registerActive()/stopActive() ·
 *   instruments/sampleBuffers/customSynths registries.
 * @usage import { ctx, noteToFreq, masterNode, registerActive } from './core.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Extracted from lib-audio.ts + audio-lib-part2.ts (SDK-libs migration Phase 2).
 */

// ── AudioContext singleton ──
var _ctx = null;

export function ctx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') {
      var resume = function () {
        if (_ctx && _ctx.state === 'suspended') _ctx.resume();
      };
      ['click', 'touchstart', 'keydown'].forEach(function (e) {
        document.addEventListener(e, resume, { once: false, passive: true });
      });
    }
  }
  return _ctx;
}

// ── Note frequency table (A0-C8, scientific pitch) ──
var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
var FLAT_MAP = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cs': 'C#', 'Ds': 'D#', 'Fs': 'F#', 'Gs': 'G#', 'As': 'A#' };
var _freqCache = {};

export function noteToFreq(note) {
  if (_freqCache[note]) return _freqCache[note];
  var n = note.trim();
  var flatKey = n.slice(0, 2);
  if (FLAT_MAP[flatKey]) n = FLAT_MAP[flatKey] + n.slice(2);
  var match = n.match(/^([A-G]#?)(\d)$/);
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

// ── Master output ──
var _masterGain = null;

export function masterNode() {
  if (!_masterGain) {
    _masterGain = ctx().createGain();
    _masterGain.connect(ctx().destination);
  }
  return _masterGain;
}

export var master = {
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
  },
};

// ── Active notes registry (for stop) ──
var _active = {};

export function registerActive(instrument, note, nodes, stopFn) {
  var key = instrument + ':' + (note || '*');
  if (_active[key]) _active[key].stop();
  _active[key] = { nodes: nodes, stop: stopFn };
}

export function stopActive(instrument, note) {
  if (!instrument) {
    Object.keys(_active).forEach(function (k) { _active[k].stop(); delete _active[k]; });
    return;
  }
  if (note) {
    var key = instrument + ':' + note;
    if (_active[key]) { _active[key].stop(); delete _active[key]; }
  } else {
    Object.keys(_active).forEach(function (k) {
      if (k.startsWith(instrument + ':')) { _active[k].stop(); delete _active[k]; }
    });
  }
}

// ── Shared registries (populated by instruments.js + index.js's sample loader / custom synth) ──
export var instruments = {};
export var sampleBuffers = {};
export var customSynths = {};
