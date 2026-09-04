/**
 * @file science/quantity.js
 * @description One measured value, drawn five ways. The wish's own line — "lämpötilaa voi näyttää
 *   eritavalla, mutta myös olla interaktiivinen, ja IoT:ssä olla yksi mittareista" — is this file:
 *   the same 21 °C is a figure, a chip, a dial, a recent line or a thermometer depending on what the
 *   cell asks for, and nothing about the number changes when the face does.
 *
 *   IT DRAWS; IT DOES NOT FETCH. Every function here takes the answer it is given and returns an
 *   element. Reading a memory key, following it and working out a formula happen elsewhere, so a
 *   face can be dropped into a page, a worksheet, a mosaic block or an MCP App frame unchanged.
 *
 *   Colours are the Atelier kit's `--ak-*` tokens with the node's own theme as the fallback, so a
 *   quantity wears whatever look the page it lands on is wearing.
 * @structure FACES · quantityEl · figureFace · chipFace · gaugeFace · sparklineFace ·
 *   thermometerFace · toneFor
 * @usage
 *   import { quantityEl } from './quantity.js';
 *   el.append(quantityEl({ value: 21, unit: 'degC', formatted: '21 °C' }, { as: 'gauge', min: -30, max: 40 }));
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 2).
 */

/** The faces a quantity can wear. A cell names one; anything unknown falls back to the figure. */
export const FACES = ['figure', 'chip', 'gauge', 'sparkline', 'thermometer'];

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  return node;
};
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

/** Where a value sits between its bounds, 0 to 1, and 0 when there is nothing to sit between. */
function fraction(value, min, max) {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : lo + 1;
  if (hi === lo) return 0;
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

/**
 * The tone a reading wears, from the bands a cell declares: the first band whose `upTo` the value has
 * not passed. Same shape as the mosaic's own gauge block, so a band written for one is read by both.
 */
export function toneFor(value, bands) {
  if (!Array.isArray(bands) || !bands.length) return 'accent';
  for (const band of bands) if (Number.isFinite(band?.upTo) && value <= band.upTo) return band.tone || 'accent';
  return bands[bands.length - 1]?.tone || 'accent';
}

const TONE_VAR = {
  ok: 'var(--ak-ok, var(--success-fg, #047857))',
  warn: 'var(--ak-warn, var(--warn, #B45309))',
  err: 'var(--ak-err, var(--accent, #E8564A))',
  accent: 'var(--ak-accent, var(--accent, #E8564A))',
  dim: 'var(--ak-muted, var(--text-dim, #6B7280))',
};
const toneColour = (tone) => TONE_VAR[tone] || TONE_VAR.accent;

/**
 * One quantity as an element.
 * @param {{ value?: number, unit?: string|null, formatted?: string, ok?: boolean, error?: object }} answer
 * @param {{ as?: string, label?: string, min?: number, max?: number, bands?: Array, history?: number[] }} [opts]
 */
export function quantityEl(answer, opts) {
  const o = opts || {};
  const face = FACES.indexOf(o.as) >= 0 ? o.as : 'figure';
  if (!answer || answer.ok === false || answer.value === undefined || answer.value === null) {
    return waitingEl(answer, o, face);
  }
  if (face === 'chip') return chipFace(answer, o);
  if (face === 'gauge') return gaugeFace(answer, o);
  if (face === 'sparkline') return sparklineFace(answer, o);
  if (face === 'thermometer') return thermometerFace(answer, o);
  return figureFace(answer, o);
}

/** A cell with no answer yet keeps its shape and says what it is waiting for. */
function waitingEl(answer, o, face) {
  const box = el('div', 'sci-q sci-q--waiting sci-q--' + face);
  if (o.label) box.append(el('span', 'sci-q-label', o.label));
  box.append(el('span', 'sci-q-empty', answer?.error?.message || '—'));
  return box;
}

/** The big number: what a figure block does, with the unit kept small beside it. */
export function figureFace(answer, o) {
  const box = el('div', 'sci-q sci-q--figure');
  if (o.label) box.append(el('span', 'sci-q-label', o.label));
  const line = el('div', 'sci-q-figure');
  line.append(el('b', null, formattedNumber(answer)));
  if (answer.unit) line.append(el('small', null, unitText(answer)));
  box.append(line);
  return box;
}

/** A reading small enough to sit in a sentence. */
export function chipFace(answer, o) {
  const box = el('span', 'sci-q sci-q--chip');
  if (o.label) box.append(el('span', 'sci-q-chip-label', o.label));
  box.append(el('span', 'sci-q-chip-value', answer.formatted ?? String(answer.value)));
  return box;
}

/** A dial: one needle over an arc, the arc tinted by the band the value falls in. */
export function gaugeFace(answer, o) {
  const box = el('div', 'sci-q sci-q--gauge');
  if (o.label) box.append(el('span', 'sci-q-label', o.label));
  const W = 160, H = 96, cx = W / 2, cy = H - 10, r = 62;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sci-gauge', role: 'img', 'aria-label': `${o.label || 'reading'}: ${answer.formatted ?? answer.value}` });
  const arc = (from, to, colour, width) => {
    const p = (t) => [cx + r * Math.cos(Math.PI * (1 - t)), cy - r * Math.sin(Math.PI * (1 - t))];
    const [x1, y1] = p(from), [x2, y2] = p(to);
    return svgEl('path', { d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`, fill: 'none', stroke: colour, 'stroke-width': width, 'stroke-linecap': 'butt' });
  };
  svg.append(arc(0, 1, 'var(--ak-line, var(--border, #E5E7EB))', 10));
  const f = fraction(answer.value, o.min, o.max);
  const tone = toneColour(toneFor(answer.value, o.bands));
  if (f > 0) svg.append(arc(0, f, tone, 10));
  const angle = Math.PI * (1 - f);
  svg.append(svgEl('line', {
    x1: cx, y1: cy, x2: cx + (r - 16) * Math.cos(angle), y2: cy - (r - 16) * Math.sin(angle),
    stroke: 'var(--ak-ink, var(--text, #1A1A2E))', 'stroke-width': 3, 'stroke-linecap': 'round',
  }));
  svg.append(svgEl('circle', { cx, cy, r: 4, fill: 'var(--ak-ink, var(--text, #1A1A2E))' }));
  box.append(svg);
  box.append(el('div', 'sci-q-under', answer.formatted ?? String(answer.value)));
  return box;
}

/** The recent history as one line, with the reading beside it. Nothing moves at idle. */
export function sparklineFace(answer, o) {
  const box = el('div', 'sci-q sci-q--spark');
  if (o.label) box.append(el('span', 'sci-q-label', o.label));
  const points = (Array.isArray(o.history) ? o.history : []).filter(n => Number.isFinite(n));
  const row = el('div', 'sci-q-sparkrow');
  if (points.length >= 2) {
    const W = 120, H = 28;
    const lo = Math.min(...points), hi = Math.max(...points);
    const span = hi - lo || 1;
    const d = points.map((p, i) => `${i ? 'L' : 'M'} ${(i / (points.length - 1)) * W} ${H - ((p - lo) / span) * (H - 4) - 2}`).join(' ');
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sci-spark', 'aria-hidden': 'true' });
    svg.append(svgEl('path', { d, fill: 'none', stroke: toneColour(toneFor(answer.value, o.bands)), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    row.append(svg);
  }
  row.append(el('b', 'sci-q-sparkvalue', answer.formatted ?? String(answer.value)));
  box.append(row);
  return box;
}

/** A column that fills: the reading a person recognises from a wall. */
export function thermometerFace(answer, o) {
  const box = el('div', 'sci-q sci-q--therm');
  if (o.label) box.append(el('span', 'sci-q-label', o.label));
  const f = fraction(answer.value, o.min, o.max);
  const tone = toneColour(toneFor(answer.value, o.bands));
  const W = 34, H = 120, bulb = 12;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sci-therm', role: 'img', 'aria-label': `${o.label || 'reading'}: ${answer.formatted ?? answer.value}` });
  const top = 8, bottom = H - bulb - 8, tube = bottom - top;
  svg.append(svgEl('rect', { x: W / 2 - 6, y: top, width: 12, height: tube, rx: 6, fill: 'var(--ak-line, var(--border, #E5E7EB))' }));
  svg.append(svgEl('rect', { x: W / 2 - 6, y: top + tube * (1 - f), width: 12, height: tube * f, rx: 6, fill: tone }));
  svg.append(svgEl('circle', { cx: W / 2, cy: bottom + bulb / 2, r: bulb, fill: tone }));
  box.append(svg);
  box.append(el('div', 'sci-q-under', answer.formatted ?? String(answer.value)));
  return box;
}

/** The number without its unit, so a face can set the two apart. */
function formattedNumber(answer) {
  const text = answer.formatted ?? String(answer.value);
  const unit = unitText(answer);
  return unit && text.endsWith(unit) ? text.slice(0, -unit.length).trim() : text;
}

const UNIT_WORDS = { degC: '°C', degF: '°F', degK: 'K', R: '°R', percent: '%' };
function unitText(answer) {
  if (!answer.unit) return '';
  return UNIT_WORDS[answer.unit] || answer.unit;
}
