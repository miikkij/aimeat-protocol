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
 * @structure hero(spec) → { el, set, destroy } · statRow(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.hero({ target: a.main, title: 'Errands', sub: '3 open',
 *           actions: [{ id: 'add', label: 'Add', kind: 'primary', onClick }] });
 * @version-history
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1).
 */
import { el, clear, resolve, uid, enter, countUp } from './dom.js';
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
  const root = el('div', {
    class: 'ak-root ak-hero',
    'data-ak-hero': true,
    'aria-labelledby': titleId,
  }, [inner]);

  const layer = imageLayer(spec.image);
  if (layer) { root.style.setProperty('--ak-hero-image', layer); root.classList.add('ak-hero--image'); }

  if (spec.target) resolve(spec.target).appendChild(root);

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
 */

/**
 * The KPI row. On `set`, a tile whose value changed counts up to the new figure — the
 * state-change motion arrives with the data, not from app code.
 * @param {{ target?: string|Element, tiles: StatTile[] }} spec
 * @returns {{ el: HTMLElement, set: (patch: { tiles: StatTile[] }) => void, destroy: () => void }}
 */
export function statRow(spec) {
  /** @type {Map<string, { value: number, node: HTMLElement, label: HTMLElement, hint: HTMLElement }>} */
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
        root.appendChild(el('div', { class: 'ak-statrow__tile' }, [value, label, hint]));
        entry = { value: first ? tile.value : 0, node: value, label: label, hint: hint };
        shown.set(tile.id, entry);
      }
      entry.label.textContent = tile.label;
      entry.hint.textContent = tile.hint || '';
      entry.hint.hidden = !tile.hint;
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
