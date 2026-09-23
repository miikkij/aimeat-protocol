/**
 * @file public/views/design-lab/plain-diff.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What changes between two drawn elements, in plain words: the design lab measures an
 *   option as it looks today and as the proposal would draw it (views/design-lab/frame.js,
 *   measureValues), and this turns the difference into sentences a person reads without knowing
 *   CSS ("The letters get bigger.", "It loses its frame."). The sentences come from the measured
 *   values, never from hand-written text, so they cannot disagree with the pictures beside them.
 * @structure plainDiff(today, after) → string[] (sentences, already translated)
 * @usage import { plainDiff } from '/views/design-lab/plain-diff.js';
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial (Jouni: "can they tell from the pictures alone what changes").
 */
import { t } from '/js/i18n.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const FACES = { 'JetBrains Mono': 'typewriter', Archivo: 'body', 'Fjalla One': 'headline' };
const faceWord = (family) => tr(`designLab.face.${FACES[family] ?? 'other'}`, FACES[family] ?? family);

/** A measured colour ("var(--accent)", "none", "rgb(…)") as a plain word. */
const COLOURS = {
  '--text': 'dark', '--on-sun': 'dark', '--accent': 'coral', '--sun': 'sun', '--text-dim': 'grey',
  '--card-bg': 'white', '--card': 'white', '--bg-card': 'white', '--bg': 'paper', '--bg-surface': 'lightGrey',
  '--bg-dim': 'lightGrey', '--border': 'lightGrey', '--muted': 'grey', '--success': 'green', '--success-fg': 'green',
  '--danger': 'red', '--warn-fg': 'yellow', '--info-fg': 'blue',
};
function colourWord(value) {
  const token = /var\((--[\w-]+)\)/.exec(value || '')?.[1];
  const key = (token && COLOURS[token]) || 'other';
  return tr(`designLab.colour.${key}`, key);
}

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
  if (a.family !== b.family) say('face', 'The letters change to the {face} face.', { face: faceWord(b.family) });
  if (differs(a.size, b.size, 0.02)) say(b.size > a.size ? 'bigger' : 'smaller', b.size > a.size ? 'The letters get bigger.' : 'The letters get smaller.');
  if (a.weight !== b.weight) say(b.weight > a.weight ? 'bolder' : 'lighter', b.weight > a.weight ? 'The letters get bolder.' : 'The letters get lighter.');
  if (today.case !== after.case) say(after.case === 'uppercase' ? 'capsOn' : 'capsOff', after.case === 'uppercase' ? 'The words are set in capitals.' : 'The words are no longer in capitals.');
  if (today.tracking !== after.tracking) {
    const wider = num(after.tracking) > num(today.tracking);
    say(wider ? 'wider' : 'closer', wider ? 'The letters move further apart.' : 'The letters move closer together.');
  }
  const fa = frame(today.frame); const fb = frame(after.frame);
  if (!fa && fb) say('frameAdd', 'It gets a {colour} frame.', { colour: colourWord(fb.colour) });
  else if (fa && !fb) say('frameRemove', 'It loses its frame.');
  else if (fa && fb) {
    if (fb.width !== fa.width) say(fb.width > fa.width ? 'frameThicker' : 'frameThinner', fb.width > fa.width ? 'The frame gets thicker.' : 'The frame gets thinner.');
    if (fb.style !== fa.style) say(fb.style === 'dashed' ? 'frameDashed' : 'frameSolid', fb.style === 'dashed' ? 'The frame becomes dashed.' : 'The frame becomes a solid line.');
    if (colourWord(fb.colour) !== colourWord(fa.colour)) say('frameColour', 'The frame turns {colour}.', { colour: colourWord(fb.colour) });
  }
  if (today.radius !== after.radius) say(after.radius === 'none' ? 'square' : 'round', after.radius === 'none' ? 'The round corners become square.' : 'The corners become round.');
  if (today.fill === 'none' && after.fill !== 'none') say('groundAdd', 'It gets a {colour} ground.', { colour: colourWord(after.fill) });
  else if (today.fill !== 'none' && after.fill === 'none') say('groundRemove', 'It loses its coloured ground.');
  else if (colourWord(today.fill) !== colourWord(after.fill) || (colourWord(today.fill) === tr('designLab.colour.other', 'other') && today.fill !== after.fill)) {
    say('groundColour', 'The ground turns {colour}.', { colour: colourWord(after.fill) });
  }
  if (colourWord(today.colour) !== colourWord(after.colour)) say('words', 'The words turn {colour}.', { colour: colourWord(after.colour) });
  if (differs(room(today.padding), room(after.padding), 0.15)) {
    const more = room(after.padding) > room(today.padding);
    say(more ? 'roomMore' : 'roomLess', more ? 'There is more room inside it.' : 'There is less room inside it.');
  }
  if (!out.length) say('nothing', 'Nothing you can see changes.');
  return out;
}
