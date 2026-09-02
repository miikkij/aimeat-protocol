/**
 * @file phaser/chiptune-compose.js
 * @description The composer behind chiptune.js: from a seed, a feel, a key and a scale it writes
 *   the whole tune the scheduler then reads, bar by bar. Pure functions over the tables in
 *   chiptune-patterns.js and nothing else, so a tune can be composed and inspected without an
 *   AudioContext, which is also what keeps the sequencer under the file cap.
 *
 *   THE FORM IS A-B-A. Each section is eight bars: a four-bar chord phrase from the feel's own
 *   templates and its answer with the last chord turned into a cadence; a two-bar motif over
 *   bars one to four, a second motif over five to eight, and the last bar resolving to the
 *   chord's root and holding it. A motif is written as scale-degree offsets from the chord's
 *   root, so the same phrase over the next chord lands on that chord, which is what makes a
 *   repeat sound like a sequence rather than a wrong note.
 *
 *   A ONE-SHOT IS A FIXED STING. The win and the lose styles do not compose; they play two bars
 *   written here by hand (a climb to the octave on V then I, or a fall to the root below on iv
 *   then i), because a fanfare is a signal and a signal is the same every time.
 * @structure STEPS_PER_BEAT · degreeMidi · nearestDegree · chordOn · motif · cadence · section ·
 *   stingBars · compose(p) → Bar[]
 * @usage  import { compose, STEPS_PER_BEAT } from './chiptune-compose.js';
 *         const bars = compose({ seed: 7, feel: FEELS.pop, scale: 'major', root: 60, sting: null });
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: extracted from chiptune.js so the sequencer stays under the
 *     file cap; the progression, the motifs, the cadence and the two stings.
 */
import { SCALES, CHORD_TEMPLATES, rng } from './chiptune-patterns.js';

/** The form: eight bars of A, eight of B, A again, then round. */
const SECTION_BARS = 8;
const FORM = ['A', 'B', 'A'];

/** Sixteenths per beat, which is the grid every pattern and every melody is written on. */
export const STEPS_PER_BEAT = 4;

/**
 * @param {number[]} steps  the scale's semitones
 * @param {number} base  the MIDI note of degree 0
 * @param {number} degree  may run past the scale's length or below zero; the octave follows
 * @returns {number}
 */
function degreeMidi(steps, base, degree) {
  const n = steps.length;
  const oct = Math.floor(degree / n);
  return base + oct * 12 + steps[degree - oct * n];
}

/**
 * The scale degree nearest a pitch class, so a melody on a five-note scale can start from a
 * chord root the five do not contain.
 * @param {number[]} steps
 * @param {number} pc  0..11
 * @returns {number}
 */
function nearestDegree(steps, pc) {
  let best = 0;
  let dist = 99;
  for (let i = 0; i < steps.length; i++) {
    const d = Math.min(Math.abs(steps[i] - pc), Math.abs(steps[i] - 12 - pc), Math.abs(steps[i] + 12 - pc));
    if (d < dist) { dist = d; best = i; }
  }
  return best;
}

/**
 * A chord on one degree: root, third and fifth, kept within a sixth of the key's root so the
 * pad never climbs away from the bass.
 * @param {number[]} chordSteps
 * @param {number} root
 * @param {number} degree
 * @returns {number[]}
 */
function chordOn(chordSteps, root, degree) {
  let tones = [degreeMidi(chordSteps, root, degree), degreeMidi(chordSteps, root, degree + 2), degreeMidi(chordSteps, root, degree + 4)];
  if (tones[0] - root > 6) tones = tones.map(function (n) { return n - 12; });
  return tones;
}

/**
 * Two bars of melody as scale-degree offsets from the chord's root, so the same phrase over a
 * different chord lands on that chord. On the beat it sits on a chord tone, the nearest one
 * most of the time so the line does not leap about; between beats it walks a step at a time.
 * Rests are left where the density says nothing starts, and a note may leave a gap after itself.
 * @param {() => number} random
 * @param {import('./chiptune-patterns.js').Feel} feel
 * @param {number} steps  sixteenths in a bar
 * @returns {Array<Array<{ rel: number, len: number }|null>>}
 */
function motif(random, feel, steps) {
  const out = [];
  let rel = 0;
  for (let b = 0; b < 2; b++) {
    const bar = new Array(steps).fill(null);
    let s = 0;
    while (s < steps) {
      const onBeat = s % STEPS_PER_BEAT === 0;
      const starts = (b === 0 && s === 0) || random() < (onBeat ? feel.density + 0.25 : feel.density);
      if (!starts) { s += 1; continue; }
      let len = onBeat ? (random() < 0.5 ? 2 : random() < 0.5 ? 4 : 1) : (random() < 0.6 ? 1 : 2);
      if (s + len > steps) len = steps - s;
      if (onBeat) {
        const tones = [-5, -3, 0, 2, 4];
        let pick = tones[Math.floor(random() * tones.length)];
        if (random() < 0.6) {
          pick = tones[0];
          for (const t of tones) if (Math.abs(t - rel) < Math.abs(pick - rel)) pick = t;
        }
        rel = pick;
      } else {
        rel = Math.max(-4, Math.min(5, rel + (random() < 0.5 ? -1 : 1)));
      }
      bar[s] = { rel: rel, len: random() < feel.rest ? Math.max(1, len - 1) : len };
      s += len;
    }
    out.push(bar);
  }
  return out;
}

/**
 * The first half of the bar as it was, then the chord's root held to the end.
 * @param {Array<{ rel: number, len: number }|null>} line
 * @param {number} steps
 * @returns {Array<{ rel: number, len: number }|null>}
 */
function cadence(line, steps) {
  const half = Math.floor(steps / 2);
  const out = line.map(function (e, s) { return s < half ? e : null; });
  for (let s = 0; s < half; s++) if (out[s] && s + out[s].len > half) out[s] = { rel: out[s].rel, len: half - s };
  out[half] = { rel: 0, len: steps - half };
  return out;
}

/**
 * Eight bars: a four-bar chord phrase and its answer (the last chord turned into a cadence),
 * the first motif over bars one to four, a second over five to eight, and the last bar
 * resolving to the root and holding it.
 * @param {() => number} random
 * @param {import('./chiptune-patterns.js').Feel} feel
 * @param {number} steps
 * @returns {Array<{ degree: number, line: Array<{ rel: number, len: number }|null> }>}
 */
function section(random, feel, steps) {
  const template = CHORD_TEMPLATES[feel.templates[Math.floor(random() * feel.templates.length)]];
  const answer = template.slice();
  answer[3] = random() < 0.5 ? 4 : 0;
  const degrees = template.concat(answer);
  const motifs = [motif(random, feel, steps), motif(random, feel, steps)];
  const bars = [];
  for (let i = 0; i < SECTION_BARS; i++) {
    let line = motifs[i < 4 ? 0 : 1][i % 2].slice();
    if (i === SECTION_BARS - 1) line = cadence(line, steps);
    bars.push({ degree: degrees[i], line: line });
  }
  return bars;
}

/**
 * The fixed phrase a one-shot plays. Up is V then I, the chord climbed in eighths and the
 * octave held; down is iv then i, the chord descended and the root below held.
 * @param {string} direction
 * @param {number} steps
 * @returns {Array<{ degree: number, line: Array<{ rel: number, len: number }|null> }>}
 */
function stingBars(direction, steps) {
  const up = direction !== 'down';
  const climb = up ? [0, 2, 4, 7] : [4, 2, 0, -3];
  const first = new Array(steps).fill(null);
  for (let i = 0; i < climb.length; i++) first[i * 2] = { rel: climb[i], len: 2 };
  const second = new Array(steps).fill(null);
  second[0] = { rel: up ? 7 : -5, len: steps };
  return [{ degree: up ? 4 : 3, line: first }, { degree: 0, line: second }];
}

/**
 * @typedef {object} Bar
 * @property {string} section  'A', 'B' or 'sting'
 * @property {number} root     the chord's root, MIDI
 * @property {number[]} chord  root, third, fifth
 * @property {Array<{ n: number, len: number }|null>} lead  one entry per sixteenth
 */

/**
 * The whole tune, from the seed: every bar's chord and the lead line over it.
 * @param {{ seed: number, feel: import('./chiptune-patterns.js').Feel, scale: string, root: number, sting: string|null }} p
 * @returns {Bar[]}
 */
export function compose(p) {
  const scale = SCALES[p.scale] || SCALES.major;
  const chordSteps = (scale.parent ? SCALES[scale.parent] : scale).steps;
  const steps = p.feel.meter * STEPS_PER_BEAT;
  const random = rng(p.seed);
  /** @type {Array<{ section: string, degree: number, line: Array<{ rel: number, len: number }|null> }>} */
  const plan = [];
  if (p.sting) {
    for (const b of stingBars(p.sting, steps)) plan.push({ section: 'sting', degree: b.degree, line: b.line });
  } else {
    const made = { A: section(random, p.feel, steps), B: section(random, p.feel, steps) };
    for (const name of FORM) for (const b of made[name]) plan.push({ section: name, degree: b.degree, line: b.line });
  }
  const leadBase = p.root + 12;
  return plan.map(function (b) {
    const chord = chordOn(chordSteps, p.root, b.degree);
    const from = nearestDegree(scale.steps, (((chord[0] - p.root) % 12) + 12) % 12);
    return {
      section: b.section,
      root: chord[0],
      chord: chord,
      lead: b.line.map(function (e) {
        return e ? { n: degreeMidi(scale.steps, leadBase, from + e.rel), len: e.len } : null;
      }),
    };
  });
}
