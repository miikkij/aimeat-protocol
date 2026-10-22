/**
 * @file audio/core.js
 * @description Shared core for the aimeat-audio library (SDK-libs migration Phase 2): the Web Audio
 *   context singleton (with autoplay-unlock on first gesture), the scientific-pitch note→frequency
 *   table, the master output node + volume/mute control, the active-notes registry (for stop), and
 *   the shared instrument / sample / custom-synth registries. Imported by instruments.js (which
 *   populates the built-ins) and index.js (soundboard/samples/custom-synth/realtime/public API).
 * @structure ctx() · noteToFreq() · masterNode() (gain → limiter) · bus() · startTime()/destOf() · master ·
 *   registerActive()/rekeyActive()/stopActive() · instruments/sampleBuffers/customSynths registries.
 * @usage import { ctx, noteToFreq, masterNode, registerActive } from './core.js';
 * @version-history
 *   v1.2.0 — 2026-10-22 — A note can be placed at an exact AudioContext time (opts.when) and sent
 *     into any node or a named bus (opts.destination), the way Band Jam's own engine had to do it:
 *     startTime(), destOf(), bus(). The master runs through a limiter (master.limiter, on by default)
 *     so a busy mix does not clip. A note scheduled ahead replaces the one before it at its own start,
 *     not when it is scheduled, and stop() cancels notes that have not started yet.
 *   v1.1.0 — 2026-09-13 — rekeyActive(): a note played through a stand-in voice is filed under the
 *     instrument the caller named, so stop() on that name reaches it.
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

// ── Master output: gain → limiter → speakers ──
var _masterGain = null;
var _limiter = null;
var _limiterOn = true;
var _masterRouted = false;

function routeMaster() {
  var c = ctx();
  if (_masterRouted) _masterGain.disconnect();
  if (_limiterOn && _limiter) _masterGain.connect(_limiter);
  else _masterGain.connect(c.destination);
  _masterRouted = true;
}
export function masterNode() {
  if (!_masterGain) {
    var c = ctx();
    _masterGain = c.createGain();
    if (typeof c.createDynamicsCompressor === 'function') {
      // A limiter, not a compressor: it only acts within a few dB of full scale.
      _limiter = c.createDynamicsCompressor();
      _limiter.threshold.value = -3; _limiter.knee.value = 3; _limiter.ratio.value = 20;
      _limiter.attack.value = 0.002; _limiter.release.value = 0.15;
      _limiter.connect(c.destination);
    }
    routeMaster();
  }
  return _masterGain;
}

// ── Named buses: a gain per part of the mix (drums, band, fx…), each into the master ──
var _buses = {};
export function bus(name) {
  name = String(name || 'main');
  if (!_buses[name]) {
    var g = ctx().createGain();
    g.connect(masterNode());
    _buses[name] = g;
  }
  return _buses[name];
}

// ── Scheduling: when a note starts (opts.when, AudioContext seconds) and where it goes ──
export function startTime(opts) {
  var now = ctx().currentTime;
  var w = opts && typeof opts.when === 'number' && isFinite(opts.when) ? opts.when : 0;
  return w > now ? w : now;
}
export function destOf(opts) {
  var d = opts && opts.destination;
  if (typeof d === 'string') return bus(d);
  if (d && typeof d.connect === 'function' && (!d.context || d.context === ctx())) return d;
  return masterNode();
}

export var master = {
  get volume() { return masterNode().gain.value; },
  set volume(v) { masterNode().gain.value = Math.max(0, Math.min(1, v)); },
  _muted: false,
  _premuteVol: 1,
  get limiter() { return _limiterOn; },
  set limiter(v) { _limiterOn = !!v; if (_masterGain) routeMaster(); },
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
// Notes scheduled ahead (opts.when): they replace the note before them when they START.
var _pending = [];

export function registerActive(instrument, note, nodes, stopFn, at) {
  var key = instrument + ':' + (note || '*');
  var delay = typeof at === 'number' ? at - ctx().currentTime : 0;
  if (delay > 0.005 && typeof setTimeout === 'function') {
    var p = { key: key, entry: { nodes: nodes, stop: stopFn } };
    p.timer = setTimeout(function () {
      var i = _pending.indexOf(p);
      if (i < 0) return;
      _pending.splice(i, 1);
      if (_active[p.key]) _active[p.key].stop();
      _active[p.key] = p.entry;
    }, delay * 1000);
    _pending.push(p);
    return;
  }
  if (_active[key]) _active[key].stop();
  _active[key] = { nodes: nodes, stop: stopFn };
}
function dropPending(match) {
  _pending = _pending.filter(function (p) {
    if (!match(p.key)) return true;
    clearTimeout(p.timer);
    p.entry.stop();   // every voice's stop guards its own nodes (a source not yet started included)
    return false;
  });
}

/**
 * File a playing note under another instrument name. A sample-only instrument played before its bank
 * has loaded sounds through a built-in voice, which registers the note under ITS name; moving the
 * entry is what lets `stop('strings', 'C4')` reach the voice that is actually sounding.
 * @param {string} fromInstrument  The name the voice registered under (e.g. 'synth').
 * @param {string} toInstrument    The name the caller asked for (e.g. 'strings').
 * @param {string} [note]
 */
export function rekeyActive(fromInstrument, toInstrument, note) {
  var from = fromInstrument + ':' + (note || '*');
  for (var k = _pending.length - 1; k >= 0; k--) {
    if (_pending[k].key === from) { _pending[k].key = toInstrument + ':' + (note || '*'); return; }
  }
  var entry = _active[from];
  if (!entry) return;
  delete _active[from];
  var to = toInstrument + ':' + (note || '*');
  if (_active[to]) _active[to].stop();
  _active[to] = entry;
}

export function stopActive(instrument, note) {
  dropPending(function (k) {
    if (!instrument) return true;
    return note ? k === instrument + ':' + note : k.indexOf(instrument + ':') === 0;
  });
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
