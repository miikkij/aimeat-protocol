/**
 * @file atelier/ops.js
 * @description The operations family — the three blocks an admin or monitoring panel is made
 *   of, so a machine room becomes an arrangement instead of app code:
 *
 *     health   one row per watched thing: a tone lamp, the name, the latest reading — the
 *              "is everything up" wall;
 *     queue    work items with states (waiting / running / done / failed), counted in a strip
 *              and listed with their words — the "what is the system doing" view;
 *     gauge    ONE value on its own dial, bands turning the tone — the number that owns a wall.
 *
 *   All three are data in, picture out, exactly like the chart: the app resolves the source,
 *   set() repaints with motion, tones ride --ak-ok / --ak-warn / --ak-err so every look and
 *   mode answers them. Nothing polls and nothing animates at idle — a live feed arrives
 *   through the mosaic's live wiring or the app's own set() calls.
 * @structure health(spec) · queue(spec) · gauge(spec) — each → { el, set, destroy }
 * @usage
 *   AIMEAT.atelier.health({ target: host, data: { items: [
 *     { id: 'api', label: 'API', tone: 'ok', reading: '82 ms' } ] } });
 *   AIMEAT.atelier.queue({ target: host, data: { items: [
 *     { id: 'j1', title: 'Nightly import', state: 'running', sub: 'row 1 200 of 8 000' } ] } });
 *   AIMEAT.atelier.gauge({ target: host, data: { value: 72, max: 100, label: 'CPU', unit: '%',
 *     bands: [{ upTo: 60, tone: 'ok' }, { upTo: 85, tone: 'warn' }, { upTo: 100, tone: 'err' }] } });
 * @version-history
 *   v0.33.0 — 2026-08-29 — Initial (TARGET-074 next level: the admin panel vocabulary).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
  return node;
}

const TONES = ['ok', 'warn', 'err', 'plain'];
function toneOf(value) { return TONES.indexOf(value) >= 0 ? value : 'plain'; }

/**
 * The health wall.
 * @param {{ target?: string|Element, title?: string,
 *   data?: { items: Array<{ id: string, label: string, tone?: string, reading?: string, sub?: string }> }|null,
 *   empty?: { title?: string, hint?: string }, onPick?: (item: any) => void,
 * }} spec
 */
export function health(spec) {
  const root = el('div', { class: 'ak-root ak-health', role: 'list' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const items = (data && Array.isArray(data.items)) ? data.items : [];
    if (!items.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    for (const item of items) {
      const tone = toneOf(item.tone);
      const row = el(spec.onPick ? 'button' : 'div', {
        class: 'ak-health__row', role: 'listitem', type: spec.onPick ? 'button' : undefined,
      }, [
        el('span', { class: 'ak-health__lamp ak-health__lamp--' + tone, 'aria-hidden': 'true' }),
        el('span', { class: 'ak-health__name' }, [
          el('span', { class: 'ak-health__label', text: item.label || item.id }),
          item.sub ? el('span', { class: 'ak-health__sub', text: item.sub }) : null,
        ]),
        item.reading != null ? el('span', { class: 'ak-health__reading', text: String(item.reading) }) : null,
        el('span', { class: 'ak-sr-only', text: tone === 'ok' ? t('opsOk') : tone === 'err' ? t('opsDown') : tone === 'warn' ? t('opsWarn') : '' }),
      ]);
      if (spec.onPick) row.addEventListener('click', function () { spec.onPick(item); });
      root.appendChild(row);
    }
  }

  render(spec.data);
  return {
    el: root,
    set(patch) { if (patch && 'data' in patch) render(patch.data); },
    destroy() { if (emptyCard) emptyCard.destroy(); root.remove(); },
  };
}

const QUEUE_STATES = ['waiting', 'running', 'done', 'failed'];
const QUEUE_TONE = { waiting: 'plain', running: 'warn', done: 'ok', failed: 'err' };

/**
 * The work queue.
 * @param {{ target?: string|Element, title?: string,
 *   data?: { items: Array<{ id: string, title: string, state?: string, sub?: string }> }|null,
 *   empty?: { title?: string, hint?: string }, onPick?: (item: any) => void,
 * }} spec
 */
export function queue(spec) {
  const root = el('div', { class: 'ak-root ak-queue' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const items = (data && Array.isArray(data.items)) ? data.items : [];
    if (!items.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    // The strip: one chip per state that has members, in lifecycle order.
    const counts = {};
    for (const item of items) {
      const s = QUEUE_STATES.indexOf(item.state) >= 0 ? item.state : 'waiting';
      counts[s] = (counts[s] || 0) + 1;
    }
    const strip = el('div', { class: 'ak-queue__strip', role: 'status' });
    for (const s of QUEUE_STATES) {
      if (!counts[s]) continue;
      strip.appendChild(el('span', { class: 'ak-queue__count ak-queue__count--' + QUEUE_TONE[s] },
        [el('strong', { text: String(counts[s]) }), el('span', { text: ' ' + t('queue.' + s) })]));
    }
    root.appendChild(strip);

    const list = el('div', { class: 'ak-queue__list', role: 'list' });
    for (const item of items) {
      const s = QUEUE_STATES.indexOf(item.state) >= 0 ? item.state : 'waiting';
      const row = el(spec.onPick ? 'button' : 'div', {
        class: 'ak-queue__row', role: 'listitem', type: spec.onPick ? 'button' : undefined,
      }, [
        el('span', { class: 'ak-queue__state ak-queue__state--' + s, text: t('queue.' + s) }),
        el('span', { class: 'ak-queue__words' }, [
          el('span', { class: 'ak-queue__title', text: item.title || item.id }),
          item.sub ? el('span', { class: 'ak-queue__sub', text: item.sub }) : null,
        ]),
      ]);
      if (spec.onPick) row.addEventListener('click', function () { spec.onPick(item); });
      list.appendChild(row);
    }
    root.appendChild(list);
  }

  render(spec.data);
  return {
    el: root,
    set(patch) { if (patch && 'data' in patch) render(patch.data); },
    destroy() { if (emptyCard) emptyCard.destroy(); root.remove(); },
  };
}

/**
 * The gauge: one value on a 240° dial. Bands are cumulative upper bounds in value order; the
 * band the value falls in gives the dial its tone.
 * @param {{ target?: string|Element,
 *   data?: { value: number, max?: number, min?: number, label?: string, unit?: string,
 *            bands?: Array<{ upTo: number, tone?: string }> }|null,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 */
export function gauge(spec) {
  const root = el('figure', { class: 'ak-root ak-gauge', role: 'img' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  const R = 84;
  const CX = 100;
  const CY = 104;
  const SWEEP = 240; // degrees, opening downward
  function angleAt(frac) { return (-SWEEP / 2 - 90) + SWEEP * frac; }
  function pointAt(deg, radius) {
    const rad = (deg * Math.PI) / 180;
    return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
  }
  function arcPath(fromFrac, toFrac, radius) {
    const [x1, y1] = pointAt(angleAt(fromFrac), radius);
    const [x2, y2] = pointAt(angleAt(toFrac), radius);
    const large = (toFrac - fromFrac) * SWEEP > 180 ? 1 : 0;
    return 'M ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2;
  }

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    if (!data || typeof data.value !== 'number') {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    const min = typeof data.min === 'number' ? data.min : 0;
    const max = typeof data.max === 'number' && data.max > min ? data.max : min + 100;
    const frac = Math.max(0, Math.min(1, (data.value - min) / (max - min)));
    const bands = Array.isArray(data.bands) && data.bands.length
      ? data.bands
      : [{ upTo: max, tone: 'plain' }];
    let tone = 'plain';
    for (const band of bands) { if (data.value <= band.upTo) { tone = toneOf(band.tone); break; } }
    if (data.value > bands[bands.length - 1].upTo) tone = toneOf(bands[bands.length - 1].tone);

    root.setAttribute('aria-label', (data.label ? data.label + ': ' : '') + data.value + (data.unit || ''));
    const node = svg('svg', { viewBox: '0 0 200 160', class: 'ak-gauge__svg', 'aria-hidden': 'true' });
    // The track, then each declared band on it, then the needle arc for the value itself.
    node.appendChild(svg('path', { d: arcPath(0, 1, R), class: 'ak-gauge__track' }));
    let from = min;
    for (const band of bands) {
      const f0 = Math.max(0, Math.min(1, (from - min) / (max - min)));
      const f1 = Math.max(0, Math.min(1, (band.upTo - min) / (max - min)));
      if (f1 > f0) node.appendChild(svg('path', { d: arcPath(f0, f1, R), class: 'ak-gauge__band ak-gauge__band--' + toneOf(band.tone) }));
      from = band.upTo;
    }
    const value = svg('path', { d: arcPath(0, Math.max(frac, 0.004), R - 14), class: 'ak-gauge__value ak-gauge__value--' + tone });
    node.appendChild(value);
    root.appendChild(node);
    if (!reducedMotion()) {
      const len = /** @type {SVGPathElement} */ (value).getTotalLength();
      value.setAttribute('stroke-dasharray', String(len));
      value.setAttribute('stroke-dashoffset', String(len));
      requestAnimationFrame(function () { value.classList.add('ak-gauge__value--drawn'); });
    }

    root.appendChild(el('figcaption', { class: 'ak-gauge__words' }, [
      el('span', { class: 'ak-gauge__reading ak-gauge__reading--' + tone },
        [el('strong', { text: String(data.value) }), data.unit ? el('span', { text: data.unit }) : null]),
      data.label ? el('span', { class: 'ak-gauge__label', text: data.label }) : null,
    ]));
  }

  render(spec.data);
  return {
    el: root,
    set(patch) { if (patch && 'data' in patch) render(patch.data); },
    destroy() { if (emptyCard) emptyCard.destroy(); root.remove(); },
  };
}
