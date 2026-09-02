/**
 * @file phaser/chiptune-patterns.js
 * @description The tables behind chiptune.js: the scales, the chord templates, the six feels
 *   (each a drum kit, a bass line, a melody density and an arpeggio pace), the six named styles,
 *   and the three pure helpers every one of them needs: a seeded random source, a note name to a
 *   MIDI number, and a MIDI number to hertz. Data only and no audio graph, so the sequencer stays
 *   under the file cap and a pattern can be read without reading a scheduler.
 *
 *   A PATTERN IS A STRING OF SIXTEENTHS. In a drum line 'x' is a hit and '.' is a rest, one
 *   character per sixteenth, left to right through the bar; a waltz bar is twelve characters and
 *   every other bar sixteen. A bass line spells its notes: 'r' the chord's root, 'f' its fifth,
 *   'o' the root an octave up, '-' holds the note before it and '.' is a rest. A person can hear
 *   the pattern by reading it, which is the whole reason it is text.
 *
 *   A FEEL IS HOW THE BAND PLAYS; A STYLE IS WHAT THE GAME ASKED FOR. 'pop', 'march', 'waltz',
 *   'chill', 'boss' and 'retro' are feels. 'title', 'level', 'boss', 'shop', 'win' and 'lose'
 *   are styles: a feel plus a tempo, a scale, a root and a starting intensity, and for the two
 *   short ones a fixed sting instead of a generated tune.
 * @structure SCALES · CHORD_TEMPLATES · FEELS · STYLES · rng(seed) · parseNote(value, fallback) ·
 *   midiToHz(n)
 * @usage  import { FEELS, STYLES, SCALES, CHORD_TEMPLATES, rng, parseNote, midiToHz } from './chiptune-patterns.js';
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the tables the chiptune sequencer plays from.
 */

/**
 * The scales, as semitone steps from the root. Chords are stacked thirds on a seven-note scale,
 * so a five-note scale names the seven-note parent its chords come from; the melody still walks
 * the five.
 * @type {Record<string, { steps: number[], parent?: string }>}
 */
export const SCALES = {
  major: { steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { steps: [0, 2, 3, 5, 7, 9, 10] },
  pentatonic: { steps: [0, 2, 4, 7, 9], parent: 'major' },
};

/**
 * Four-bar chord phrases as scale degrees, zero based (0 is I, 4 is V, 5 is vi). In a minor
 * scale the same numbers read i, VI, III and so on, which is how one table serves every mood.
 * @type {number[][]}
 */
export const CHORD_TEMPLATES = [
  [0, 4, 5, 3], // I  V  vi IV
  [5, 3, 0, 4], // vi IV I  V
  [0, 5, 3, 4], // I  vi IV V
  [0, 3, 4, 0], // I  IV V  I
  [0, 3, 0, 4], // I  IV I  V
  [0, 2, 3, 4], // I  iii IV V
  [0, 6, 5, 4], // i  VII VI v   (minor)
  [0, 5, 2, 6], // i  VI III VII (minor)
];

/**
 * @typedef {object} Feel
 * @property {number} meter        beats in a bar: 4, or 3 for the waltz
 * @property {number} tempo        the pace when the style names none
 * @property {number} swing        0 straight .. 1 a full triplet lilt on the off sixteenths
 * @property {'square'|'triangle'|'sawtooth'} lead   the lead's wave
 * @property {'square'|'triangle'} bass  the bass's wave
 * @property {number[]} templates  indexes into CHORD_TEMPLATES this feel picks from
 * @property {{ full: Record<string, string>, light: Record<string, string> }} drums  the kit
 *   above the full-drums threshold and the lighter one below it, one line per part
 * @property {string} bassLine     the bass pattern, one character per sixteenth
 * @property {number} density      how likely a sixteenth is to start a melody note
 * @property {number} rest         how likely a melody note is to leave a gap after itself
 * @property {[number, number]} arp  notes per bar for the arpeggio at low and at high intensity
 */

/** @type {Record<string, Feel>} */
export const FEELS = {
  pop: {
    meter: 4, tempo: 120, swing: 0, lead: 'square', bass: 'triangle', templates: [0, 1, 2, 3],
    drums: {
      full: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      light: { kick: 'x.......x.......', hat: '..x...x...x...x.' },
    },
    bassLine: 'r-r-f-r-r-r-o-f-', density: 0.55, rest: 0.15, arp: [8, 16],
  },
  march: {
    meter: 4, tempo: 116, swing: 0, lead: 'square', bass: 'triangle', templates: [3, 4, 0],
    drums: {
      full: { kick: 'x...x...x...x...', snare: '..x...x...x.x.x.', hat: 'x...x...x...x...' },
      light: { kick: 'x.......x.......', hat: 'x...x...x...x...' },
    },
    bassLine: 'r---f---r---f---', density: 0.6, rest: 0.1, arp: [4, 8],
  },
  waltz: {
    meter: 3, tempo: 150, swing: 0, lead: 'triangle', bass: 'triangle', templates: [3, 4, 5],
    drums: {
      full: { kick: 'x...........', snare: '....x...x...', hat: '..x...x...x.' },
      light: { kick: 'x...........', hat: '....x...x...' },
    },
    bassLine: 'r---f---f---', density: 0.45, rest: 0.2, arp: [3, 6],
  },
  chill: {
    meter: 4, tempo: 92, swing: 0.4, lead: 'triangle', bass: 'triangle', templates: [1, 2, 5],
    drums: {
      full: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: '..x...x...x...x.' },
      light: { kick: 'x.......x.......', hat: '....x.......x...' },
    },
    bassLine: 'r-------f---r---', density: 0.35, rest: 0.3, arp: [4, 8],
  },
  boss: {
    meter: 4, tempo: 160, swing: 0, lead: 'square', bass: 'square', templates: [6, 7, 3],
    drums: {
      full: { kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx' },
      light: { kick: 'x...x...x...x...', hat: 'x.x.x.x.x.x.x.x.' },
    },
    bassLine: 'r-rorr-or-rorr-o', density: 0.7, rest: 0.08, arp: [8, 16],
  },
  retro: {
    meter: 4, tempo: 140, swing: 0, lead: 'square', bass: 'square', templates: [0, 3, 4, 6],
    drums: {
      full: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      light: { kick: 'x...x...x...x...', hat: '..x...x...x...x.' },
    },
    bassLine: 'rorororororororo', density: 0.6, rest: 0.12, arp: [8, 16],
  },
};

/**
 * @typedef {object} Style
 * @property {string} feel         a FEELS name
 * @property {number} tempo        beats per minute
 * @property {string} scale        a SCALES name
 * @property {string} root         the key's root as a note name
 * @property {number} intensity    where the dial starts, 0..1
 * @property {number} [swing]      0..1, the feel's own when absent
 * @property {boolean} [once]      a short one-shot rather than a loop
 * @property {number} [bars]       how many bars a one-shot plays
 * @property {'up'|'down'} [sting] the fixed two-bar phrase a one-shot plays instead of a tune
 */

/** @type {Record<string, Style>} */
export const STYLES = {
  title: { feel: 'pop', tempo: 112, scale: 'major', root: 'C4', intensity: 0.5 },
  level: { feel: 'retro', tempo: 140, scale: 'major', root: 'G4', intensity: 0.6 },
  boss: { feel: 'boss', tempo: 164, scale: 'minor', root: 'E4', intensity: 1 },
  shop: { feel: 'chill', tempo: 92, scale: 'dorian', root: 'D4', swing: 0.45, intensity: 0.3 },
  win: { feel: 'march', tempo: 132, scale: 'major', root: 'C4', intensity: 0.8, once: true, bars: 2, sting: 'up' },
  lose: { feel: 'chill', tempo: 84, scale: 'minor', root: 'A3', intensity: 0.4, once: true, bars: 2, sting: 'down' },
};

/**
 * A seeded random source (mulberry32): the same seed gives the same sequence in every browser,
 * which is what makes a level's tune the same on every visit.
 * @param {number} seed
 * @returns {() => number} a function returning 0 <= n < 1
 */
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The semitone of each letter, C first. */
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The lowest and highest root a key may sit on: below it is mud, above it is a whistle. */
const ROOT_MIN = 36;
const ROOT_MAX = 84;

/**
 * A root as a MIDI note number, from a number or a note name ('C4', 'F#3', 'Bb2').
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseNote(value, fallback) {
  if (typeof value === 'number' && isFinite(value)) return Math.max(ROOT_MIN, Math.min(ROOT_MAX, Math.round(value)));
  if (typeof value === 'string') {
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(value.trim());
    if (m) {
      const semitone = LETTERS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
      const midi = (Number(m[3]) + 1) * 12 + semitone;
      return Math.max(ROOT_MIN, Math.min(ROOT_MAX, midi));
    }
  }
  return fallback;
}

/**
 * @param {number} n  a MIDI note number
 * @returns {number} hertz
 */
export function midiToHz(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}
