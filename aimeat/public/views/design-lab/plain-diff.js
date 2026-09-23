/**
 * @file public/views/design-lab/plain-diff.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What changes between two drawn elements, in plain words: the design lab measures an
 *   option as it looks today and as the proposal would draw it (views/design-lab/frame.js,
 *   measureValues), and this turns the difference into sentences a person reads without knowing
 *   CSS ("The letters get bigger.", "It loses its frame."). The sentences come from the measured
 *   values, never from hand-written text, so they cannot disagree with the pictures beside them.
 *   Colours are named so the words hold in both themes ("the text colour", not "dark").
 * @structure plainDiff(today, after) → string[] (sentences, already translated)
 * @usage import { plainDiff } from '/views/design-lab/plain-diff.js';
 * @version-history
 *   v1.2.0 — 2026-09-23 — A mark (no letters) gets no letter sentences; "dimmed"; a box needs a frame
 *     or a ground; an unnamed face is "the letters change" (second review).
 *   v1.1.0 — 2026-09-23 — A box that becomes words is said once, not as frame, corner and room
 *     changes; colour words that hold in both themes; no font names (review of the second batch).
 *   v1.0.0 — 2026-09-23 — Initial (Jouni: "can they tell from the pictures alone what changes").
 */
import { t } from '/js/i18n.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const FACES = { 'JetBrains Mono': ['typewriter', 'typewriter letters'], Archivo: ['body', 'the body text\'s letters'], 'Fjalla One': ['headline', 'the headline letters'] };
const faceWord = (family) => {
  const [key, fallback] = FACES[family] ?? ['other', ''];
  return tr(`designLab.face.${key}`, fallback);
};

/** A measured colour ("var(--accent)", "none", "rgb(…)") as words that hold in both themes. */
const COLOURS = {
  '--text': ['text', 'the text colour'], '--on-sun': ['text', 'the text colour'],
  '--accent': ['coral', 'coral'], '--sun': ['sun', 'yellow'], '--text-dim': ['grey', 'grey'], '--muted': ['grey', 'grey'],
  '--card-bg': ['card', 'the card colour'], '--card': ['card', 'the card colour'], '--bg-card': ['card', 'the card colour'],
  '--bg': ['page', 'the page colour'], '--bg-surface': ['lightGrey', 'light grey'], '--bg-dim': ['lightGrey', 'light grey'],
  '--border': ['lightGrey', 'light grey'], '--success': ['green', 'green'], '--success-fg': ['green', 'green'],
  '--danger': ['red', 'red'], '--warn-fg': ['amber', 'amber'], '--info-fg': ['blue', 'blue'],
};
/** @returns {string|null} null when the colour has no name here */
function colourWord(value) {
  if (value === 'a gradient') return tr('designLab.colour.gradient', 'a coral gradient');
  const token = /var\((--[\w-]+)\)/.exec(value || '')?.[1];
  const hit = token && COLOURS[token];
  return hit ? tr(`designLab.colour.${hit[0]}`, hit[1]) : null;
}
const sameColour = (a, b) => (colourWord(a) ?? a) === (colourWord(b) ?? b);

const num = (s) => { const n = parseFloat(String(s || '').replace(/^\./, '0.')); return Number.isFinite(n) ? n : 0; };
/** "Archivo .72rem 800" → { family, size, weight } */
function font(value) {
  const m = /^(.*) (\S+) (\d+)$/.exec(value || '');
  return m ? { family: m[1], size: num(m[2]), weight: Number(m[3]) } : { family: value || '', size: 0, weight: 0 };
}
/** "2px dashed var(--text)" → { width, style, colour }; "none" → null */
function frame(value) {
  if (!value || value === 'none') return null;
  const [width, style, ...rest] = value.split(' ');
  return { width: num(width), style, colour: rest.join(' ') };
}
const room = (padding) => String(padding || '0').split(' ').reduce((sum, p) => sum + num(p), 0);
const differs = (a, b, share) => Math.abs(a - b) > Math.max(a, b) * share;
/** A drawn box: a frame or a ground around the words (round corners alone draw nothing). */
const isBox = (v) => !!frame(v.frame) || v.fill !== 'none';

/**
 * @param {Record<string, string>|null|undefined} today
 * @param {Record<string, string>|null|undefined} after
 * @returns {string[]|null} null while either is still being measured
 */
export function plainDiff(today, after) {
  if (!today || !after) return null;
  const out = [];
  const say = (key, fallback, fill = {}) => {
    let s = tr(`designLab.diff.${key}`, fallback);
    for (const [k, v] of Object.entries(fill)) s = s.replace(`{${k}}`, v);
    out.push(s);
  };
  const a = font(today.font); const b = font(after.font);
  // A mark has no letters: what the font does to it is not read as a change.
  const letters = today.letters !== 'no' || after.letters !== 'no';
  if (letters && a.family !== b.family) {
    const face = faceWord(b.family);
    if (FACES[b.family]) say('face', 'The letters change to {face}.', { face }); else say('facePlain', 'The letters change.');
  }
  if (differs(a.size, b.size, 0.02)) {
    if (letters) say(b.size > a.size ? 'bigger' : 'smaller', b.size > a.size ? 'The letters get bigger.' : 'The letters get smaller.');
    else say(b.size > a.size ? 'markBigger' : 'markSmaller', b.size > a.size ? 'The mark gets bigger.' : 'The mark gets smaller.');
  }
  // Weights of two different faces do not compare: a 500 in one can look thinner than a 400 in another.
  if (letters && a.family === b.family && a.weight !== b.weight) say(b.weight > a.weight ? 'bolder' : 'lighter', b.weight > a.weight ? 'The letters get bolder.' : 'The letters get lighter.');
  if (letters && today.case !== after.case) say(after.case === 'uppercase' ? 'capsOn' : 'capsOff', after.case === 'uppercase' ? 'The words are set in capitals.' : 'The words are no longer in capitals.');
  if (letters && today.tracking !== after.tracking) {
    const wider = num(after.tracking) > num(today.tracking);
    say(wider ? 'wider' : 'closer', wider ? 'The letters move further apart.' : 'The letters move closer together.');
  }
  if (today.dimmed && after.dimmed && today.dimmed !== after.dimmed) {
    say(after.dimmed === 'yes' ? 'dimmedOn' : 'dimmedOff', after.dimmed === 'yes' ? 'It is dimmed while it cannot be pressed.' : 'It is no longer dimmed.');
  }
  const fa = frame(today.frame); const fb = frame(after.frame);
  if (isBox(today) && !isBox(after)) {
    // A button that becomes words: one sentence, not its frame, corners, ground and padding.
    say('boxGone', 'It stops being a box and becomes words.');
  } else {
    if (!fa && fb) {
      const c = colourWord(fb.colour);
      if (c) say('frameAdd', 'It gets a frame in {colour}.', { colour: c }); else say('frameAddPlain', 'It gets a frame.');
    } else if (fa && !fb) say('frameRemove', 'It loses its frame.');
    else if (fa && fb) {
      if (fb.width !== fa.width) say(fb.width > fa.width ? 'frameThicker' : 'frameThinner', fb.width > fa.width ? 'The frame gets thicker.' : 'The frame gets thinner.');
      if (fb.style !== fa.style) say(fb.style === 'dashed' ? 'frameDashed' : 'frameSolid', fb.style === 'dashed' ? 'The frame becomes dashed.' : 'The frame becomes a solid line.');
      if (!sameColour(fa.colour, fb.colour)) {
        const c = colourWord(fb.colour);
        if (c) say('frameColour', 'The frame changes to {colour}.', { colour: c }); else say('frameColourPlain', 'The frame changes colour.');
      }
    }
    // Corners show only on something with a frame or a ground.
    if (today.radius !== after.radius && (isBox(today) || isBox(after))) say(after.radius === 'none' ? 'square' : 'round', after.radius === 'none' ? 'The round corners become square.' : 'The corners become round.');
    if (today.fill === 'none' && after.fill !== 'none') {
      const c = colourWord(after.fill);
      if (c) say('groundAdd', 'It gets a ground in {colour}.', { colour: c }); else say('groundAddPlain', 'It gets a coloured ground.');
    } else if (today.fill !== 'none' && after.fill === 'none') say('groundRemove', 'It loses its coloured ground.');
    else if (!sameColour(today.fill, after.fill)) {
      const c = colourWord(after.fill);
      if (c) say('groundColour', 'The ground changes to {colour}.', { colour: c }); else say('groundColourPlain', 'The ground changes colour.');
    }
    if (differs(room(today.padding), room(after.padding), 0.15)) {
      const more = room(after.padding) > room(today.padding);
      say(more ? 'roomMore' : 'roomLess', more ? 'There is more room inside it.' : 'There is less room inside it.');
    }
  }
  if (today.underline && after.underline && today.underline !== after.underline) {
    say(after.underline === 'yes' ? 'underlineOn' : 'underlineOff', after.underline === 'yes' ? 'The words get an underline.' : 'The words lose their underline.');
  }
  // A dimmed element is seen through its dimming, so its colour name would mislead.
  if (!sameColour(today.colour, after.colour) && after.dimmed !== 'yes') {
    const c = colourWord(after.colour);
    if (!letters) { if (c) say('mark', 'The mark changes to {colour}.', { colour: c }); else say('markPlain', 'The mark changes colour.'); }
    else if (c) say('words', 'The words change to {colour}.', { colour: c }); else say('wordsPlain', 'The words change colour.');
  }
  if (!out.length) say('nothing', 'Nothing you can see changes.');
  return out;
}
