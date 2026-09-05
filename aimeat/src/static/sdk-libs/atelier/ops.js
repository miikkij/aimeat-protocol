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
 *   v0.50.0 — 2026-09-05 — THE QUEUE MOVES. It had no entrance of any kind and was rebuilt whole
 *     on every set, which is the worst shape for the one block whose subject IS change: a job
 *     arriving, running and finishing all looked like the same silent repaint. The list is kept
 *     now and reconciled by job id — a new job rises in, a finished one fades out where it stood,
 *     and a job that changed state repaints in place without re-entering.
 *   v0.33.0 — 2026-08-29 — Initial (TARGET-074 next level: the admin panel vocabulary).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { keyedRows } from './arrive.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

/** Which job a kept row is showing right now, so a pick reports what is under the finger. */
const JOB = new WeakMap();

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
/** One job's row contents, written into the element that already stands for it.
 *  @param {HTMLElement} row @param {any} item */
function fillJob(row, item) {
  const s = QUEUE_STATES.indexOf(item.state) >= 0 ? item.state : 'waiting';
  clear(row);
  row.appendChild(el('span', { class: 'ak-queue__state ak-queue__state--' + s, text: t('queue.' + s) }));
  row.appendChild(el('span', { class: 'ak-queue__words' }, [
    el('span', { class: 'ak-queue__title', text: item.title || item.id }),
    item.sub ? el('span', { class: 'ak-queue__sub', text: item.sub }) : null,
  ]));
}

export function queue(spec) {
  const root = el('div', { class: 'ak-root ak-queue' });
  // THE LIST OUTLIVES THE RENDER, which is the whole point: a job kept across a change keeps its
  // element, so only what actually changed moves. The strip above it is one line of counts and is
  // rewritten each time.
  const strip = el('div', { class: 'ak-queue__strip', role: 'status' });
  const list = el('div', { class: 'ak-queue__list', role: 'list' });
  root.appendChild(strip);
  root.appendChild(list);
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    const items = (data && Array.isArray(data.items)) ? data.items : [];
    if (!items.length) {
      clear(strip);
      keyedRows(list, [], { key: function () { return ''; }, build: function () { return el('div'); } });
      strip.hidden = true;
      list.hidden = true;
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    strip.hidden = false;
    list.hidden = false;
    // The strip: one chip per state that has members, in lifecycle order.
    const counts = {};
    for (const item of items) {
      const s = QUEUE_STATES.indexOf(item.state) >= 0 ? item.state : 'waiting';
      counts[s] = (counts[s] || 0) + 1;
    }
    clear(strip);
    for (const s of QUEUE_STATES) {
      if (!counts[s]) continue;
      strip.appendChild(el('span', { class: 'ak-queue__count ak-queue__count--' + QUEUE_TONE[s] },
        [el('strong', { text: String(counts[s]) }), el('span', { text: ' ' + t('queue.' + s) })]));
    }

    // Work moving between states is exactly what a queue shows, so a row that changed state
    // repaints where it stands, a new job rises in, and a finished one fades out of the line.
    keyedRows(list, items, {
      key: function (item, i) { return item && item.id != null ? String(item.id) : 'job-' + i; },
      build: function (item) {
        const row = el(spec.onPick ? 'button' : 'div', {
          class: 'ak-queue__row', role: 'listitem', type: spec.onPick ? 'button' : undefined,
        });
        JOB.set(row, item);
        fillJob(row, item);
        if (spec.onPick) row.addEventListener('click', function () { spec.onPick(JOB.get(row)); });
        return row;
      },
      update: function (row, item) { JOB.set(row, item); fillJob(row, item); },
    });
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

  // A half-circle dial (the target board's shape): a quiet track, the value drawn on it in
  // its band's tone, the band BOUNDARIES as small ticks, and a marker dot at the value's end.
  const R = 96;
  const CX = 120;
  const CY = 118;
  function pointAt(frac, radius) {
    const rad = Math.PI + Math.PI * Math.max(0, Math.min(1, frac));
    return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
  }
  function arcPath(fromFrac, toFrac, radius) {
    const [x1, y1] = pointAt(fromFrac, radius);
    const [x2, y2] = pointAt(toFrac, radius);
    return 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' A ' + radius + ' ' + radius + ' 0 0 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
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
    const bands = Array.isArray(data.bands) && data.bands.length ? data.bands : [];
    let tone = 'plain';
    for (const band of bands) { if (data.value <= band.upTo) { tone = toneOf(band.tone); break; } }
    if (bands.length && data.value > bands[bands.length - 1].upTo) tone = toneOf(bands[bands.length - 1].tone);

    root.setAttribute('aria-label', (data.label ? data.label + ': ' : '') + data.value + (data.unit || ''));
    const node = svg('svg', { viewBox: '0 0 240 132', class: 'ak-gauge__svg', 'aria-hidden': 'true' });
    node.appendChild(svg('path', { d: arcPath(0, 1, R), class: 'ak-gauge__track' }));
    const value = svg('path', { d: arcPath(0, Math.max(frac, 0.005), R), class: 'ak-gauge__value ak-gauge__value--' + tone });
    node.appendChild(value);
    // Band boundaries as ticks — the scale's story without painting the whole rainbow.
    for (const band of bands.slice(0, -1)) {
      const f = Math.max(0, Math.min(1, (band.upTo - min) / (max - min)));
      const [x1, y1] = pointAt(f, R - 12);
      const [x2, y2] = pointAt(f, R + 12);
      node.appendChild(svg('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'ak-gauge__tickmark' }));
    }
    const [dx, dy] = pointAt(frac, R);
    node.appendChild(svg('circle', { cx: dx, cy: dy, r: 8, class: 'ak-gauge__marker ak-gauge__marker--' + tone }));
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
      data.sub ? el('span', { class: 'ak-gauge__label', text: data.sub }) : null,
    ]));
  }

  render(spec.data);
  return {
    el: root,
    set(patch) { if (patch && 'data' in patch) render(patch.data); },
    destroy() { if (emptyCard) emptyCard.destroy(); root.remove(); },
  };
}
