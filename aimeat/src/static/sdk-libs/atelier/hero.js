/**
 * @file atelier/hero.js
 * @description The focal band and the KPI row — the two components that make a screen read as
 *   designed instead of flat. `hero` is the ONE focal point a screen gets (the anti-flat check
 *   counts them: zero is dry, two is shouting); `statRow` is the figure strip whose numbers
 *   count up when they change.
 *
 *   IMAGERY IS A LAYER UNDER A SCRIM, NEVER THE GROUND TEXT SITS ON. The hero's `image` is a URL
 *   painted behind a mode-following scrim (the stylesheet composites it), so one picture survives
 *   light and dark, and text contrast is the scrim's business — verifiable arithmetic, not hope.
 *   With no image, the stylesheet's gradient mesh is the designed fallback: a zero-image app
 *   still has a finished hero.
 *
 *   The image value reaches CSS as a custom property; a data: URI is refused here for the same
 *   reason the publish gate refuses it — inlined image bytes are the documented way an app file
 *   bloats past its edit loop.
 * @structure hero(spec) → { el, set, destroy } · statRow(spec) → { el, set, destroy } ·
 *   figure(spec) → { el, set, destroy } · rating(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.hero({ target: a.main, title: 'Errands', sub: '3 open',
 *           actions: [{ id: 'add', label: 'Add', kind: 'primary', onClick }] });
 * @version-history
 *   v0.37.0 — 2026-08-30 — rating(): a score as stars — inline SVG on the tokens, partial fill
 *     by clipping, the number and the vote count in words beside it.
 *   v0.33.0 — 2026-08-29 — statRow tiles accept `trend: number[]`: a sparkline under the
 *     number, so a KPI carries its direction without a chart block.
 *   v0.10.0 — 2026-08-28 — A hero that repeats the app's title claims it: when the hero title
 *     equals the shell bar's, the bar heading goes screen-reader-only and the masthead carries the
 *     name alone. All three first-AEB Atelier builds printed the name twice, stacked.
 *   v0.9.0 — 2026-08-27 — figure(): one giant number as the focal point (the Cape Town move —
 *     the data itself is the hero). Counts up on set(), like every figure in the kit.
 *   v0.6.0 — 2026-08-27 — The scrim becomes a child layer (.ak-hero__scrim): the aurora mesh
 *     drifts on ::before and the scrim + grain must paint above it and below the text — a
 *     pseudo cannot sit between another pseudo and the children, a child can.
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1).
 */
import { el, clear, resolve, uid, enter, kinetic, countUp } from './dom.js';
import { i18n } from './i18n.js';

/**
 * @typedef {object} HeroAction
 * @property {string} id
 * @property {string} label
 * @property {'primary'|'ghost'|'plain'} [kind]
 * @property {(action: HeroAction) => void} [onClick]
 */

/**
 * Turn an image URL into the CSS value the stylesheet layers under the scrim. A data: URI is
 * dropped (with a console warning naming the rule) rather than painted.
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function imageLayer(url) {
  if (!url) return null;
  const v = String(url);
  if (/^data:/i.test(v)) {
    console.warn('aimeat-atelier: hero image data: URIs are refused — upload the image to storage and pass its URL.');
    return null;
  }
  return 'url("' + v.replace(/"/g, '%22') + '")';
}

/**
 * The focal band.
 * @param {{
 *   target?: string|Element, title: string, sub?: string, image?: string,
 *   actions?: HeroAction[],
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function hero(spec) {
  const state = { title: spec.title, sub: spec.sub, actions: spec.actions || [] };
  const titleId = uid('ak-hero-title');

  const title = el('h1', { class: 'ak-hero__title', id: titleId });
  const sub = el('p', { class: 'ak-hero__sub' });
  const actions = el('div', { class: 'ak-hero__actions' });
  const inner = el('div', { class: 'ak-hero__inner' }, [title, sub, actions]);
  // The scrim+grain layer: a child, not a pseudo, so it paints ABOVE the drifting aurora
  // (::before) and BELOW the text — the readable zone stays put while the colour wanders.
  const scrim = el('span', { class: 'ak-hero__scrim', 'aria-hidden': 'true' });
  const root = el('div', {
    class: 'ak-root ak-hero',
    'data-ak-hero': true,
    'aria-labelledby': titleId,
  }, [scrim, inner]);

  const layer = imageLayer(spec.image);
  if (layer) { root.style.setProperty('--ak-hero-image', layer); root.classList.add('ak-hero--image'); }

  if (spec.target) resolve(spec.target).appendChild(root);

  // The masthead claims a repeated name. When this hero's title is the same text the shell bar
  // already shows, the bar heading is made screen-reader-only (the class is on the app root; the
  // stylesheet does the hiding) so the name appears once, at display size. Checked on the next
  // frame so it also covers a hero the host mounts after construction (mosaic does).
  requestAnimationFrame(function () {
    const appRoot = root.closest('.ak-app');
    if (!appRoot) return;
    const barTitle = appRoot.querySelector('.ak-app__bar .ak-app__title');
    if (!barTitle) return;
    const same = (barTitle.textContent || '').trim().toLowerCase()
      === String(state.title || '').trim().toLowerCase();
    if (same) appRoot.classList.add('ak-app--hero-titled');
  });

  function render() {
    title.textContent = state.title;
    sub.textContent = state.sub || '';
    sub.hidden = !state.sub;
    clear(actions);
    actions.hidden = !state.actions.length;
    for (const action of state.actions) {
      const kind = action.kind || 'plain';
      actions.appendChild(el('button', {
        type: 'button',
        class: 'ak-btn' + (kind === 'plain' ? '' : ' ak-btn--' + kind),
        'data-ak-id': action.id,
        on: { click: function () { if (action.onClick) action.onClick(action); } },
      }, action.label));
    }
  }
  render();
  enter(inner);
  // The look decides whether this masthead arrives one letter at a time (--ak-kinetic). It must
  // run after the hero is in the document, or the computed style has no look to read.
  requestAnimationFrame(function () { kinetic(title); });

  return {
    el: root,
    /** @param {{ title?: string, sub?: string, image?: string|null, actions?: HeroAction[] }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) state.title = patch.title;
      if (patch.sub !== undefined) state.sub = patch.sub;
      if (patch.actions) state.actions = patch.actions;
      if (patch.image !== undefined) {
        const next = imageLayer(patch.image);
        if (next) { root.style.setProperty('--ak-hero-image', next); root.classList.add('ak-hero--image'); }
        else { root.style.removeProperty('--ak-hero-image'); root.classList.remove('ak-hero--image'); }
      }
      render();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * @typedef {object} StatTile
 * @property {string} id
 * @property {string} label
 * @property {number} value
 * @property {(n: number) => string} [format]
 * @property {string} [hint]
 * @property {number[]} [trend] - a short history drawn as a sparkline under the number
 */

/** The tile's little history: a polyline under the number, drawn from `trend: number[]`. */
function drawTrend(entry, trend) {
  const values = Array.isArray(trend) ? trend.filter((v) => typeof v === 'number') : [];
  if (values.length < 2) {
    if (entry.spark) { entry.spark.remove(); entry.spark = null; }
    return;
  }
  const W2 = 96;
  const H2 = 24;
  let min = Math.min.apply(null, values);
  let max = Math.max.apply(null, values);
  if (max === min) { max = min + 1; }
  const points = values.map((v, i) => {
    const px = (W2 * i) / (values.length - 1);
    const py = 2 + (H2 - 4) * (1 - (v - min) / (max - min));
    return px.toFixed(1) + ',' + py.toFixed(1);
  }).join(' ');
  if (!entry.spark) {
    entry.spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    entry.spark.setAttribute('class', 'ak-statrow__spark');
    entry.spark.setAttribute('viewBox', '0 0 ' + W2 + ' ' + H2);
    entry.spark.setAttribute('aria-hidden', 'true');
    entry.spark.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'polygon'));
    entry.spark.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'polyline'));
    entry.tile.appendChild(entry.spark);
  }
  // The soft ground under the line — the same fill the big charts wear.
  entry.spark.firstChild.setAttribute('points', '0,' + H2 + ' ' + points + ' ' + W2 + ',' + H2);
  entry.spark.lastChild.setAttribute('points', points);
}

/**
 * The KPI row. On `set`, a tile whose value changed counts up to the new figure — the
 * state-change motion arrives with the data, not from app code. A tile carrying `trend`
 * shows its short history as a sparkline under the number.
 * @param {{ target?: string|Element, tiles: StatTile[] }} spec
 * @returns {{ el: HTMLElement, set: (patch: { tiles: StatTile[] }) => void, destroy: () => void }}
 */
export function statRow(spec) {
  /** @type {Map<string, { value: number, node: HTMLElement, label: HTMLElement, hint: HTMLElement, tile: HTMLElement, spark: SVGElement|null }>} */
  const shown = new Map();
  const root = el('div', { class: 'ak-root ak-statrow' });
  if (spec.target) resolve(spec.target).appendChild(root);

  /** @param {StatTile[]} tiles @param {boolean} first */
  function render(tiles, first) {
    const seen = new Set();
    for (const tile of tiles) {
      seen.add(tile.id);
      const fmt = tile.format || function (n) { return String(Math.round(n)); };
      let entry = shown.get(tile.id);
      if (!entry) {
        const value = el('span', { class: 'ak-statrow__value', text: fmt(first ? tile.value : 0) });
        const label = el('span', { class: 'ak-statrow__label', text: tile.label });
        const hint = el('span', { class: 'ak-statrow__hint', text: tile.hint || '' });
        hint.hidden = !tile.hint;
        const tileEl = el('div', { class: 'ak-statrow__tile' }, [value, label, hint]);
        root.appendChild(tileEl);
        entry = { value: first ? tile.value : 0, node: value, label: label, hint: hint, tile: tileEl, spark: null };
        shown.set(tile.id, entry);
      }
      entry.label.textContent = tile.label;
      entry.hint.textContent = tile.hint || '';
      entry.hint.hidden = !tile.hint;
      drawTrend(entry, tile.trend);
      if (entry.value !== tile.value) {
        countUp(entry.node, entry.value, tile.value, { format: fmt });
        entry.value = tile.value;
      } else if (first) {
        entry.node.textContent = fmt(tile.value);
      }
    }
    for (const [id, entry] of shown) {
      if (!seen.has(id)) {
        const tileEl = entry.node.parentNode;
        if (tileEl && tileEl.parentNode) tileEl.parentNode.removeChild(tileEl);
        shown.delete(id);
      }
    }
  }

  render(spec.tiles || [], true);
  enter(root);
  const stopLang = i18n.onChange(function () { /* labels come from the host per tile — nothing of ours to re-render */ });

  return {
    el: root,
    /** @param {{ tiles: StatTile[] }} patch */
    set(patch) {
      if (!patch || !patch.tiles) return;
      render(patch.tiles, false);
    },
    destroy() {
      stopLang();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * The FIGURE: one giant number as the focal point — the Cape Town move, where the data itself
 * is the hero. A display-face numeral at hero scale, a mono small-caps label above it, a context
 * line under it, an optional delta. `set()` counts the value up or down to the new figure.
 * @param {{
 *   target?: string|Element, value: number, label: string, sub?: string, delta?: string,
 *   format?: (n: number) => string,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function figure(spec) {
  const state = { value: spec.value || 0, label: spec.label || '', sub: spec.sub, delta: spec.delta };
  const fmt = spec.format || function (n) { return String(Math.round(n)); };

  const label = el('span', { class: 'ak-figure__label', text: state.label });
  const value = el('span', { class: 'ak-figure__value', text: fmt(state.value) });
  const delta = el('span', { class: 'ak-figure__delta', text: state.delta || '' });
  delta.hidden = !state.delta;
  const sub = el('p', { class: 'ak-figure__sub', text: state.sub || '' });
  sub.hidden = !state.sub;
  const root = el('div', { class: 'ak-root ak-figure' }, [
    label,
    el('div', { class: 'ak-figure__row' }, [value, delta]),
    sub,
  ]);
  if (spec.target) resolve(spec.target).appendChild(root);
  enter(root);

  return {
    el: root,
    /** @param {{ value?: number, label?: string, sub?: string, delta?: string }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.label != null) { state.label = patch.label; label.textContent = state.label; }
      if (patch.sub !== undefined) { state.sub = patch.sub; sub.textContent = state.sub || ''; sub.hidden = !state.sub; }
      if (patch.delta !== undefined) { state.delta = patch.delta; delta.textContent = state.delta || ''; delta.hidden = !state.delta; }
      if (patch.value != null && patch.value !== state.value) {
        countUp(value, state.value, patch.value, { format: fmt });
        state.value = patch.value;
      }
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

const STAR_PATH = 'M8 1.3l2 4.1 4.6.7-3.3 3.2.8 4.5L8 11.7l-4.1 2.1.8-4.5L1.4 6.1 6 5.4z';

/** A row of five star glyphs, drawn once; the caller clips a filled copy over a quiet one. */
function starRow() {
  const ns = 'http://www.w3.org/2000/svg';
  const node = document.createElementNS(ns, 'svg');
  node.setAttribute('viewBox', '0 0 84 16');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('class', 'ak-rating__stars');
  for (let i = 0; i < 5; i++) {
    const star = document.createElementNS(ns, 'path');
    star.setAttribute('d', STAR_PATH);
    star.setAttribute('transform', `translate(${i * 17} 0)`);
    node.appendChild(star);
  }
  return node;
}

/**
 * A score as stars: the number, the five glyphs part-filled to it, and who said so.
 * @param {{ target?: string|Element,
 *   value: number, max?: number, count?: number, label?: string,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { value?: number, count?: number }) => void, destroy: () => void }}
 */
export function rating(spec) {
  const state = { value: Number(spec.value) || 0, max: Number(spec.max) > 0 ? Number(spec.max) : 5, count: spec.count };
  const root = el('div', { class: 'ak-root ak-rating', role: 'img' });
  if (spec.target) resolve(spec.target).appendChild(root);

  const number = el('b', { class: 'ak-rating__value' });
  const track = el('span', { class: 'ak-rating__track' });
  track.appendChild(starRow());
  const fill = el('span', { class: 'ak-rating__fill' });
  fill.appendChild(starRow());
  track.appendChild(fill);
  const words = el('span', { class: 'ak-rating__words' });
  root.appendChild(number);
  root.appendChild(track);
  root.appendChild(words);

  function paint() {
    const frac = Math.min(Math.max(state.value / state.max, 0), 1);
    number.textContent = (Math.round(state.value * 10) / 10).toLocaleString();
    fill.style.width = (frac * 100).toFixed(1) + '%';
    words.textContent = [
      spec.label || '',
      state.count != null ? '(' + Number(state.count).toLocaleString() + ')' : '',
    ].filter(Boolean).join(' ');
    root.setAttribute('aria-label', `${state.value} / ${state.max}` + (state.count != null ? ` · ${state.count}` : ''));
  }
  paint();

  return {
    el: root,
    set(patch) {
      if (patch && typeof patch.value === 'number') state.value = patch.value;
      if (patch && 'count' in patch) state.count = patch.count;
      paint();
    },
    destroy() { root.remove(); },
  };
}
