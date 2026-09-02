/**
 * @file phaser/chiptune.js
 * @description Music with no file behind it: a procedural chiptune sequencer that plays four
 *   voices (a pulse lead, a pulse or triangle bass, noise drums, and an arpeggio that settles
 *   into a pad when things are calm) through the audio bus, in a key and a scale, at a tempo,
 *   with a swing, from a seed. The same seed gives the same tune on every visit, so a level has
 *   its own music without the app shipping a single byte of audio.
 *
 *   THE CLOCK IS THE AUDIO CLOCK. A 25 ms timer writes every note that falls within the next
 *   150 ms onto the AudioContext's own timeline, and nothing is ever started with a per-note
 *   timeout: a tab whose timers are throttled still hears the notes on time, because they were
 *   written before the throttle mattered. The bar and beat events come off the same scheduler
 *   and carry the audio time the beat lands, so a game can flash exactly then rather than when
 *   the message happened to arrive.
 *
 *   IT PLAYS THROUGH THE BUS, NEVER ROUND IT. The bus keeps no music gain node of its own (its
 *   music level is applied to Phaser sounds one by one), so the sequencer keeps one, reads
 *   bus.settings() every tick to follow the music level and the mute, and connects it to the
 *   game's own master node (bus.destination, or game.sound.destination) so master and mute reach
 *   it the way they reach a loaded track. It starts only once the bus is unlocked; asked earlier,
 *   it waits on bus.onUnlock and starts then.
 *
 *   INTENSITY IS A DIAL, NOT A SWITCH. 0 is the pad and the bass, 0.5 brings the melody in, 1 is
 *   the full kit and sixteenth-note arpeggios. The channel gains crossfade along the same curve
 *   the scheduler reads, so raising it when enemies appear is a swell and never a cut.
 *
 *   THE CPU BILL IS SMALL BY CONSTRUCTION. One oscillator (or one noise source) per note, eight
 *   gain envelopes that are reused rather than created, and a hard cap of eight voices at once.
 *   A ninth note is dropped, and the arpeggio is written last in every step so it is the one
 *   that goes. Less motion has no effect here: motion is not sound, and a person who asked for
 *   a stiller screen did not ask for a quieter game.
 * @structure chiptune(bus, spec) → handle { play · stop · pause · resume · intensity · tempo ·
 *   key · seed · mute · now · on · state · spec · destroy }: the graph, the voice slots, the
 *   scheduler and the dial. The tune itself comes from chiptune-compose.js (a progression, an
 *   A-B-A form of eight-bar sections, a melody with rests and repeats, or a fixed sting for the
 *   one-shots) and the tables from chiptune-patterns.js.
 * @usage
 *   const tune = AIMEAT.phaser.chiptune(bus, 'level');
 *   tune.on('beat', (ev) => scene.time.delayedCall(ev.inMs, flash));
 *   tune.play();                        // waits for the unlock when the bus is still locked
 *   tune.intensity(1, 800);             // the boss walks in
 *   tune.stop(600);
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the four voices, the look-ahead scheduler, the seeded tune,
 *     the intensity crossfade, the six named styles and the bar and beat events.
 */
import { SCALES, FEELS, STYLES, rng, parseNote, midiToHz } from './chiptune-patterns.js';
import { compose, STEPS_PER_BEAT } from './chiptune-compose.js';

/** How often the scheduler looks, and how far ahead of the clock it writes. */
const TICK_MS = 25;
const LOOKAHEAD = 0.15;

/** The quietest a ramp may aim for: an exponential ramp cannot reach zero. */
const SILENCE = 0.0001;

/** Voices sounding at once, at most. A ninth note is dropped rather than made. */
const VOICE_CAP = 8;

/** The pace a caller may ask for, in beats per minute. */
const TEMPO_MIN = 40;
const TEMPO_MAX = 300;

/** How long the dial takes to move when the caller names no time, and the fade a stop uses. */
const DIAL_MS = 600;
const STOP_MS = 400;

/** The tail a one-shot is given after its last bar, so the held note is not cut. */
const TAIL_S = 0.6;

/**
 * Where each channel comes in on the dial: silent at or below its from, full at or above its to,
 * and crossfaded in between. The bass and the arpeggio are always there.
 */
const CHANNELS = {
  bass: { from: 0, to: 0 },
  arp: { from: 0, to: 0 },
  lead: { from: 0.25, to: 0.5 },
  drums: { from: 0.5, to: 0.85 },
};

/** Below this the arpeggio channel holds the chord as a pad instead of picking it. */
const PAD_BELOW = 0.35;
/** From here the arpeggio runs at its faster pace. */
const ARP_FAST_FROM = 0.7;
/** From here the full kit plays; below it the kick and the hat alone. */
const DRUMS_FULL_FROM = 0.8;

/**
 * The voices: a mix level and an envelope (attack, decay, sustain fraction, release) in seconds,
 * plus for the drums their own length and for the kick its pitch sweep.
 */
const VOICE = {
  lead: { peak: 0.16, a: 0.01, d: 0.06, s: 0.7, r: 0.05 },
  bass: { peak: 0.2, a: 0.005, d: 0.08, s: 0.6, r: 0.04 },
  arp: { peak: 0.09, a: 0.005, d: 0.05, s: 0.4, r: 0.03 },
  pad: { peak: 0.06, a: 0.25, d: 0.2, s: 0.8, r: 0.3 },
  kick: { peak: 0.55, a: 0.002, d: 0.1, s: 0.2, r: 0.05, dur: 0.22, hz: 160, sweep: 45 },
  snare: { peak: 0.28, a: 0.002, d: 0.08, s: 0.3, r: 0.04, dur: 0.16 },
  hat: { peak: 0.09, a: 0.001, d: 0.02, s: 0.3, r: 0.01, dur: 0.045 },
};

/** The arpeggio walks the chord up and back: root, third, fifth, octave, fifth, third. */
const ARP_WALK = [0, 1, 2, 3, 2, 1];

/**
 * @param {number} v
 * @returns {number} the same number held inside 0..1
 */
function clamp01(v) {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

// ── Playing ────────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ChiptuneSpec
 * @property {'title'|'level'|'boss'|'shop'|'win'|'lose'|string} [style]  a named style; the
 *   other fields override what it says
 * @property {'pop'|'march'|'waltz'|'chill'|'boss'|'retro'|string} [feel]  how the band plays
 * @property {number} [tempo]      beats per minute, 40..300
 * @property {number} [swing]      0..1
 * @property {number} [seed]       the tune; the same seed is the same tune
 * @property {number|string} [root]  the key's root, MIDI or a note name such as 'C4'
 * @property {'major'|'minor'|'dorian'|'pentatonic'|string} [scale]
 * @property {number} [intensity]  where the dial starts, 0..1
 * @property {boolean} [once]      play the given number of bars and stop
 * @property {number} [bars]       how many bars a one-shot plays
 * @property {number} [volume]     0..1 under the bus's music level
 * @property {any} [game]          the Phaser.Game, when the bus does not expose its context
 * @property {any} [context]       an AudioContext, for the same case
 * @property {any} [destination]   the node to play into, for the same case
 */

/**
 * @typedef {object} Position
 * @property {number} bar        counted from play()
 * @property {number} beat       within the bar, from 0
 * @property {number} step       the sixteenth within the bar, from 0
 * @property {number} phase      0..1 through the bar
 * @property {number} time       the audio clock now
 * @property {number} intensity  where the dial is now
 */

/**
 * A tune for one bus.
 * @param {any} bus  the bus from audio(game)
 * @param {ChiptuneSpec|string} [spec]  a style name or the full shape
 * @returns {any} the handle
 */
export function chiptune(bus, spec) {
  const given = /** @type {ChiptuneSpec} */ (typeof spec === 'string' ? { style: spec } : (spec || {}));
  if (given.style && !STYLES[given.style]) {
    console.warn('[aimeat-phaser] chiptune knows no style "' + given.style + '", so it plays "title".');
  }
  const base = given.style ? (STYLES[given.style] || STYLES.title) : null;
  const feelName = given.feel && FEELS[given.feel] ? given.feel : (base ? base.feel : 'pop');
  const feel = FEELS[feelName];
  const once = given.once != null ? !!given.once : !!(base && base.once);
  const st = {
    feel: feel,
    feelName: feelName,
    tempo: 0,
    swing: clamp01(given.swing != null ? given.swing : (base && base.swing != null ? base.swing : feel.swing)),
    seed: given.seed != null ? (Number(given.seed) >>> 0) : 1,
    root: parseNote(given.root, parseNote(base ? base.root : 'C4', 60)),
    scale: SCALES[given.scale] ? given.scale : (base ? base.scale : 'major'),
    once: once,
    bars: given.bars > 0 ? Math.floor(given.bars) : (base && base.bars ? base.bars : 2),
    sting: once && base && base.sting ? base.sting : null,
    volume: given.volume != null ? clamp01(given.volume) : 1,
  };
  const stepsPerBar = feel.meter * STEPS_PER_BEAT;

  const ctx = /** @type {any} */ ((bus && bus.context) || given.context
    || (given.game && given.game.sound && given.game.sound.context) || null);
  const out = (bus && bus.destination) || given.destination
    || (given.game && given.game.sound && given.game.sound.destination) || (ctx ? ctx.destination : null);
  const live = !!(ctx && typeof ctx.createOscillator === 'function' && out);
  if (!live) {
    console.warn('[aimeat-phaser] chiptune has no Web Audio to play through: pass the game '
      + '(chiptune(bus, { style, game })) or give the bus a context. This tune stays silent.');
  }

  /** @type {import('./chiptune-compose.js').Bar[]} */
  let bars = [];
  let pending = true;
  let state = 'idle';
  let dead = false;
  let selfMuted = false;
  let level = -1;
  /** @type {any} */
  let timer = null;
  /** @type {(() => void)|null} */
  let offUnlock = null;

  /** The scheduler's place: the sixteenth and bar it will write next, and when that lands. */
  let step = 0;
  let bar = 0;
  let nextStepTime = 0;
  let arpCount = 0;
  let stopping = false;
  let stopAt = 0;
  /** A one-shot has written its last bar and only waits for the tail to ring out. */
  let done = false;
  /** The bars written so far that now() may fall into, newest last. */
  /** @type {Array<{ bar: number, start: number, dur: number, x: number }>} */
  const barLog = [];

  /** The dial's move: where it came from, where it goes and over which span of audio time. */
  const ramp = { from: clamp01(given.intensity != null ? given.intensity : (base ? base.intensity : 0.5)), to: 0, start: 0, end: 0 };
  ramp.to = ramp.from;

  /** @type {Record<string, Array<(ev: any) => void>>} */
  const listeners = { start: [], bar: [], beat: [], end: [] };

  // The graph is made on the first start, so a handle built before the unlock costs nothing.
  /** @type {GainNode|null} */
  let levelGain = null;
  /** @type {GainNode|null} */
  let fadeGain = null;
  /** @type {Record<string, GainNode>} */
  const channels = {};
  /** @type {Array<{ gain: GainNode, busyUntil: number, channel: string }>} */
  const slots = [];
  /** @type {AudioBuffer|null} */
  let noise = null;

  /**
   * @param {string} name
   * @param {any} ev
   */
  function emit(name, ev) {
    for (const fn of listeners[name].slice()) fn(ev);
  }

  /**
   * @param {number} bpm
   * @returns {number}
   */
  function clampTempo(bpm) {
    const n = typeof bpm === 'number' && isFinite(bpm) ? bpm : feel.tempo;
    return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, n));
  }
  st.tempo = clampTempo(given.tempo != null ? given.tempo : (base ? base.tempo : feel.tempo));

  /** @returns {number} one sixteenth, in seconds, at the tempo now */
  function stepDur() {
    return 60 / st.tempo / STEPS_PER_BEAT;
  }

  /**
   * @param {number} t  audio time
   * @returns {number} where the dial is at that moment
   */
  function intensityAt(t) {
    if (t >= ramp.end || ramp.end <= ramp.start) return ramp.to;
    if (t <= ramp.start) return ramp.from;
    return ramp.from + (ramp.to - ramp.from) * ((t - ramp.start) / (ramp.end - ramp.start));
  }

  /**
   * @param {string} name  a channel
   * @param {number} x  the dial
   * @returns {number} the channel's crossfade, 0..1
   */
  function levelOf(name, x) {
    const c = CHANNELS[name];
    if (c.to <= c.from) return 1;
    return x <= c.from ? 0 : x >= c.to ? 1 : (x - c.from) / (c.to - c.from);
  }

  /**
   * Move one channel's gain along the dial's move, with a knee wherever the channel starts or
   * finishes coming in, so the gain follows the same curve the scheduler reads.
   * @param {string} name
   * @param {number} from
   * @param {number} to
   * @param {number} start
   * @param {number} end
   */
  function rampChannel(name, from, to, start, end) {
    const p = channels[name].gain;
    p.cancelScheduledValues(start);
    p.setValueAtTime(Math.max(SILENCE, levelOf(name, from)), start);
    const c = CHANNELS[name];
    if (c.to > c.from && end > start && to !== from) {
      const knees = [c.from, c.to]
        .map(function (knee) { return (knee - from) / (to - from); })
        .filter(function (f) { return f > 0 && f < 1; })
        .sort(function (a, b) { return a - b; });
      for (const f of knees) {
        p.linearRampToValueAtTime(Math.max(SILENCE, levelOf(name, from + (to - from) * f)), start + f * (end - start));
      }
    }
    p.linearRampToValueAtTime(Math.max(SILENCE, levelOf(name, to)), Math.max(end, start + 0.001));
  }

  function ensureGraph() {
    if (levelGain) return;
    levelGain = ctx.createGain();
    levelGain.gain.value = SILENCE;
    levelGain.connect(out);
    fadeGain = ctx.createGain();
    fadeGain.gain.value = SILENCE;
    fadeGain.connect(levelGain);
    for (const name in CHANNELS) {
      const g = ctx.createGain();
      g.gain.value = SILENCE;
      g.connect(fadeGain);
      channels[name] = g;
    }
  }

  /**
   * Follow the bus: its music level and its mute, and this handle's own mute, on the one gain
   * that sits in front of everything.
   * @param {boolean} force
   */
  function applyLevel(force) {
    const s = bus && typeof bus.settings === 'function' ? bus.settings() : null;
    const music = s && typeof s.music === 'number' ? clamp01(s.music) : 1;
    const want = selfMuted || (s && s.muted) ? 0 : music * st.volume;
    if (!force && want === level) return;
    level = want;
    levelGain.gain.setTargetAtTime(Math.max(SILENCE, want), ctx.currentTime, 0.03);
  }

  /**
   * Move the fade gain, which is the one play, pause and stop share.
   * @param {number} to
   * @param {number} ms
   * @param {number} [at]  when the move begins; now when absent
   */
  function fadeTo(to, ms, at) {
    const from = at != null ? at : ctx.currentTime;
    const p = fadeGain.gain;
    p.cancelScheduledValues(from);
    p.setValueAtTime(Math.max(SILENCE, typeof p.value === 'number' ? p.value : SILENCE), from);
    p.linearRampToValueAtTime(Math.max(SILENCE, to), from + Math.max(0.001, ms / 1000));
  }

  /**
   * A gain envelope to reuse, free at the note's time. The same channel's slot is preferred,
   * then one that has already gone quiet, then a new one while the cap allows, then any slot
   * free by then; past that the note is dropped.
   * @param {string} channel
   * @param {number} at
   * @param {number} until
   * @returns {{ gain: GainNode, busyUntil: number, channel: string }|null}
   */
  function takeSlot(channel, at, until) {
    const now = ctx.currentTime;
    let slot = null;
    for (const s of slots) if (s.busyUntil <= at && s.channel === channel) { slot = s; break; }
    if (!slot) for (const s of slots) if (s.busyUntil <= now) { slot = s; break; }
    if (!slot && slots.length < VOICE_CAP) {
      const g = ctx.createGain();
      g.gain.value = SILENCE;
      slot = { gain: g, busyUntil: 0, channel: '' };
      slots.push(slot);
    }
    if (!slot) for (const s of slots) if (s.busyUntil <= at) { slot = s; break; }
    if (!slot) return null;
    if (slot.channel !== channel) {
      slot.gain.disconnect();
      slot.gain.connect(channels[channel]);
      slot.channel = channel;
    }
    slot.busyUntil = until;
    return slot;
  }

  /**
   * Write one envelope onto a reused gain. Attack, decay and release are cut to fit a short note.
   * @param {AudioParam} p
   * @param {number} at
   * @param {number} dur
   * @param {{ peak: number, a: number, d: number, s: number, r: number }} v
   */
  function envelope(p, at, dur, v) {
    const a = Math.min(v.a, dur * 0.2);
    const d = Math.min(v.d, dur * 0.3);
    const r = Math.min(v.r, dur * 0.3);
    const sustain = Math.max(SILENCE, v.peak * v.s);
    p.cancelScheduledValues(at);
    p.setValueAtTime(SILENCE, at);
    p.linearRampToValueAtTime(v.peak, at + a);
    p.exponentialRampToValueAtTime(sustain, at + a + d);
    p.setValueAtTime(sustain, at + dur - r);
    p.exponentialRampToValueAtTime(SILENCE, at + dur);
  }

  /**
   * One oscillator for one note.
   * @param {string} channel
   * @param {string} wave
   * @param {number} hz
   * @param {number} at
   * @param {number} dur
   * @param {{ peak: number, a: number, d: number, s: number, r: number }} v
   * @param {number} [sweepTo]  the kick's landing pitch
   * @returns {boolean} whether it was written
   */
  function tone(channel, wave, hz, at, dur, v, sweepTo) {
    const slot = takeSlot(channel, at, at + dur);
    if (!slot) return false;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(hz, at);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, at + dur * 0.4);
    envelope(slot.gain.gain, at, dur, v);
    osc.connect(slot.gain);
    osc.onended = function () { osc.disconnect(); };
    osc.start(at);
    osc.stop(at + dur);
    return true;
  }

  /**
   * One noise burst for one drum hit. The buffer is a quarter second made once, from a fixed
   * seed, so every hit reads the same bytes.
   * @param {number} at
   * @param {number} dur
   * @param {{ peak: number, a: number, d: number, s: number, r: number }} v
   * @returns {boolean}
   */
  function burst(at, dur, v) {
    const slot = takeSlot('drums', at, at + dur);
    if (!slot) return false;
    if (!noise) {
      const rate = ctx.sampleRate || 44100;
      noise = ctx.createBuffer(1, Math.floor(rate / 4), rate);
      const data = noise.getChannelData(0);
      const random = rng(0x5eed);
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    envelope(slot.gain.gain, at, dur, v);
    src.connect(slot.gain);
    src.onended = function () { src.disconnect(); };
    src.start(at);
    src.stop(at + dur);
    return true;
  }

  /**
   * Is the channel audible at any point of a note's own span? A note that begins just before
   * its gain lifts is still there when it does; one that would be silent throughout is never
   * written, so a quiet channel costs no voices.
   * @param {string} name  a channel
   * @param {number} at
   * @param {number} dur
   * @returns {boolean}
   */
  function wanted(name, at, dur) {
    return levelOf(name, intensityAt(at)) > 0 || levelOf(name, intensityAt(at + dur)) > 0;
  }

  /** Write every voice of the sixteenth the scheduler stands on, then move on one. */
  function scheduleStep() {
    const t = nextStepTime;
    const s = step;
    const b = bar;
    const dur = stepDur();
    if (s === 0) {
      if (pending) {
        bars = compose({ seed: st.seed, feel: st.feel, scale: st.scale, root: st.root, sting: st.sting });
        pending = false;
      }
      barLog.push({ bar: b, start: t, dur: dur * stepsPerBar, x: intensityAt(t) });
      if (barLog.length > 3) barLog.shift();
    }
    const here = barLog[barLog.length - 1];
    const data = bars[b % bars.length];
    const at = t + (s % 2 === 1 ? st.swing * dur / 3 : 0);

    // The bass: the pattern's letter on this sixteenth, held through the dashes after it.
    const letter = feel.bassLine.charAt(s % feel.bassLine.length);
    if (letter === 'r' || letter === 'f' || letter === 'o') {
      let len = 1;
      while (s + len < stepsPerBar && feel.bassLine.charAt((s + len) % feel.bassLine.length) === '-') len++;
      const n = letter === 'r' ? data.root - 12 : letter === 'f' ? data.chord[2] - 12 : data.root;
      const v = feel.bass === 'square' ? { peak: 0.13, a: VOICE.bass.a, d: VOICE.bass.d, s: VOICE.bass.s, r: VOICE.bass.r } : VOICE.bass;
      tone('bass', feel.bass, midiToHz(n), at, len * dur * 0.9, v);
    }

    // The lead, once the dial has brought it in.
    const ev = data.lead[s];
    if (ev && wanted('lead', at, ev.len * dur)) tone('lead', feel.lead, midiToHz(ev.n), at, ev.len * dur * 0.92, VOICE.lead);

    // The drums: the full kit past the threshold, the kick and the hat below it.
    if (wanted('drums', at, VOICE.kick.dur)) {
      const kit = here.x >= DRUMS_FULL_FROM ? feel.drums.full : feel.drums.light;
      if (kit.kick && kit.kick.charAt(s) === 'x') tone('drums', 'sine', VOICE.kick.hz, at, VOICE.kick.dur, VOICE.kick, VOICE.kick.sweep);
      if (kit.snare && kit.snare.charAt(s) === 'x') burst(at, VOICE.snare.dur, VOICE.snare);
      if (kit.hat && kit.hat.charAt(s) === 'x') burst(at, VOICE.hat.dur, VOICE.hat);
    }

    // The arpeggio last, so it is the voice that gives way at the cap; a pad when things are calm.
    if (here.x < PAD_BELOW) {
      if (s === 0) for (const n of data.chord) tone('arp', 'triangle', midiToHz(n), at, here.dur * 0.98, VOICE.pad);
    } else {
      const perBar = here.x >= ARP_FAST_FROM ? feel.arp[1] : feel.arp[0];
      const every = Math.max(1, Math.round(stepsPerBar / perBar));
      if (s % every === 0) {
        const walk = ARP_WALK[arpCount % ARP_WALK.length];
        arpCount++;
        const n = walk === 3 ? data.chord[0] + 12 : data.chord[walk];
        tone('arp', 'square', midiToHz(n), at, every * dur * 0.8, VOICE.arp);
      }
    }

    step = s + 1;
    nextStepTime = t + dur;
    if (step >= stepsPerBar) { step = 0; bar = b + 1; }
    const inMs = Math.max(0, Math.round((t - ctx.currentTime) * 1000));
    if (s % STEPS_PER_BEAT === 0) emit('beat', { bar: b, beat: s / STEPS_PER_BEAT, time: t, inMs: inMs });
    if (s === 0) emit('bar', { bar: b, section: data.section, time: t, inMs: inMs });
  }

  /** The timer's work: follow the bus, write what falls inside the look-ahead, end when due. */
  function tick() {
    if (dead || state !== 'playing') return;
    applyLevel(false);
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (!done && nextStepTime < horizon && !(stopping && nextStepTime >= stopAt)) {
      if (st.once && bar >= st.bars) {
        // The last bar is written: it rings out under a fade that starts where it ends, and
        // nothing more is written.
        done = true;
        stopping = true;
        stopAt = nextStepTime + TAIL_S;
        fadeTo(SILENCE, TAIL_S * 1000, nextStepTime);
        break;
      }
      scheduleStep();
    }
    if (stopping && ctx.currentTime >= stopAt) end();
  }

  function end() {
    if (timer) { clearInterval(timer); timer = null; }
    stopping = false;
    state = 'idle';
    emit('end', { time: ctx.currentTime });
  }

  function start() {
    offUnlock = null;
    if (dead) return;
    ensureGraph();
    const now = ctx.currentTime;
    state = 'playing';
    stopping = false;
    done = false;
    step = 0;
    bar = 0;
    arpCount = 0;
    barLog.length = 0;
    nextStepTime = now + 0.05;
    ramp.from = ramp.to;
    ramp.start = now;
    ramp.end = now;
    for (const name in CHANNELS) rampChannel(name, ramp.to, ramp.to, now, now);
    applyLevel(true);
    fadeTo(1, 20);
    timer = setInterval(tick, TICK_MS);
    emit('start', { time: nextStepTime });
  }

  /** @returns {boolean} may the page make a sound yet, as far as the bus knows? */
  function unlocked() {
    if (bus && typeof bus.unlocked === 'boolean') return bus.unlocked;
    return !ctx.state || ctx.state === 'running';
  }

  /**
   * The bar now() falls into: the newest one that has started, or the first one written.
   * @returns {{ bar: number, start: number, dur: number, x: number }|null}
   */
  function heard() {
    const t = ctx.currentTime;
    for (let i = barLog.length - 1; i >= 0; i--) if (barLog[i].start <= t) return barLog[i];
    return barLog.length ? barLog[0] : null;
  }

  const api = {
    /**
     * Start, or resume. False when there is no Web Audio, when the handle is destroyed, or when
     * the bus is still locked; in that last case the tune starts by itself on the unlock.
     * @returns {boolean}
     */
    play() {
      if (dead || !live) return false;
      if (state === 'playing') return true;
      if (state === 'paused') return api.resume();
      if (state === 'waiting') return false;
      if (!unlocked()) {
        state = 'waiting';
        offUnlock = bus && typeof bus.onUnlock === 'function' ? bus.onUnlock(start) : null;
        return false;
      }
      start();
      return true;
    },

    /**
     * Fade out and end. The notes keep coming under the fade, so a long one is a real ending.
     * @param {number} [fadeMs]  default 400
     * @returns {void}
     */
    stop(fadeMs) {
      if (dead) return;
      if (state === 'waiting') {
        if (offUnlock) offUnlock();
        offUnlock = null;
        state = 'idle';
        return;
      }
      if (state === 'idle') return;
      const ms = fadeMs != null && isFinite(fadeMs) ? Math.max(0, fadeMs) : STOP_MS;
      if (state === 'paused' || ms === 0) { end(); return; }
      stopping = true;
      stopAt = ctx.currentTime + ms / 1000;
      fadeTo(SILENCE, ms);
    },

    /** Hold the place and go quiet. @returns {boolean} */
    pause() {
      if (state !== 'playing') return false;
      if (stopping) { end(); return false; }
      fadeTo(SILENCE, 60);
      if (timer) { clearInterval(timer); timer = null; }
      state = 'paused';
      return true;
    },

    /** Carry on from the held place. @returns {boolean} */
    resume() {
      if (state !== 'paused') return false;
      nextStepTime = ctx.currentTime + 0.05;
      fadeTo(1, 60);
      state = 'playing';
      timer = setInterval(tick, TICK_MS);
      return true;
    },

    /**
     * Move the dial. Called with no argument it reports where the dial is now.
     * @param {number} [x]  0..1
     * @param {number} [ms]  how long the move takes, default 600
     * @returns {number}
     */
    intensity(x, ms) {
      if (x == null || dead) return intensityAt(live ? ctx.currentTime : 0);
      const now = live ? ctx.currentTime : 0;
      const span = ms != null && isFinite(ms) ? Math.max(0, ms) / 1000 : DIAL_MS / 1000;
      const from = intensityAt(now);
      ramp.from = from;
      ramp.to = clamp01(x);
      ramp.start = now;
      ramp.end = now + span;
      if (levelGain) for (const name in CHANNELS) rampChannel(name, from, ramp.to, now, now + span);
      return ramp.to;
    },

    /**
     * @param {number} [bpm]  40..300; takes effect on the next sixteenth
     * @returns {number}
     */
    tempo(bpm) {
      if (bpm != null) st.tempo = clampTempo(bpm);
      return st.tempo;
    },

    /**
     * Change key; the tune is regenerated on the next bar. Called with nothing it reports.
     * @param {number|string} [root]  MIDI or a note name
     * @param {string} [scale]  major, minor, dorian or pentatonic
     * @returns {{ root: number, scale: string }}
     */
    key(root, scale) {
      if (root != null) { st.root = parseNote(root, st.root); pending = true; }
      if (scale != null && SCALES[scale]) { st.scale = scale; pending = true; }
      return { root: st.root, scale: st.scale };
    },

    /**
     * Another tune; regenerated on the next bar. Called with nothing it reports the seed.
     * @param {number} [n]
     * @returns {number}
     */
    seed(n) {
      if (n != null) { st.seed = Number(n) >>> 0; pending = true; }
      return st.seed;
    },

    /**
     * This tune's own mute, beside the bus's. Reports when called with nothing.
     * @param {boolean} [on]
     * @returns {boolean}
     */
    mute(on) {
      if (on != null) {
        selfMuted = !!on;
        if (levelGain) applyLevel(true);
      }
      return selfMuted;
    },

    /**
     * Where the music is, for syncing a picture to it.
     * @returns {Position}
     */
    now() {
      const t = live ? ctx.currentTime : 0;
      const b = live ? heard() : null;
      if (!b) return { bar: 0, beat: 0, step: 0, phase: 0, time: t, intensity: intensityAt(t) };
      const phase = Math.max(0, Math.min(0.9999, (t - b.start) / b.dur));
      return {
        bar: b.bar,
        beat: Math.floor(phase * feel.meter),
        step: Math.floor(phase * stepsPerBar),
        phase: phase,
        time: t,
        intensity: intensityAt(t),
      };
    },

    /**
     * Hear the scheduler: 'beat' and 'bar' carry the audio time the moment lands and inMs, the
     * milliseconds until then; 'start' and 'end' bracket a play.
     * @param {'start'|'bar'|'beat'|'end'} name
     * @param {(ev: any) => void} fn
     * @returns {() => void} stop listening
     */
    on(name, fn) {
      if (!listeners[name] || typeof fn !== 'function') return function () { /* nothing to stop */ };
      listeners[name].push(fn);
      return function () {
        const i = listeners[name].indexOf(fn);
        if (i >= 0) listeners[name].splice(i, 1);
      };
    },

    /** @returns {'idle'|'waiting'|'playing'|'paused'} */
    get state() {
      return /** @type {any} */ (state);
    },

    /** The feel and the numbers in force, for a settings screen or a debug line. */
    get spec() {
      return { style: given.style || null, feel: feelName, tempo: st.tempo, swing: st.swing, seed: st.seed, root: st.root, scale: st.scale, once: st.once, bars: st.bars };
    },

    /** Silence everything at once and leave nothing running. */
    destroy() {
      if (dead) return;
      dead = true;
      if (offUnlock) offUnlock();
      offUnlock = null;
      if (timer) { clearInterval(timer); timer = null; }
      if (levelGain) levelGain.disconnect();
      state = 'idle';
      for (const name in listeners) listeners[name].length = 0;
    },
  };

  return api;
}
