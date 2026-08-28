/**
 * @file atelier/waveform.js
 * @description The waveform — a row of mirrored bars drawn from a list of numbers: sound made
 *   visible (kaiku, band-jam and freepartylights all hand-rolled this), equally any sparkline
 *   of magnitudes. DATA IN, WAVE OUT: the app hands values (a mic frame, an analysis, a
 *   history) and calls set() to repaint — the component owns nothing audio, so it needs no
 *   permissions and renders anywhere, the bench included. Colours ride the look's accent
 *   spectrum from quiet to loud.
 *
 *   The bound source resolves to ONE record: { values: number[], max? } — values are
 *   magnitudes ≥ 0; max pins the scale (default: the largest value).
 * @structure waveform(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.waveform({ target: host, data: { values: [0.1, 0.4, 0.9, 0.5] } });
 * @version-history
 *   v0.20.0 — 2026-08-28 — Initial (TARGET-074, the harvest: the sound strip the audio apps
 *     kept re-inventing).
 */
import { el, clear, resolve } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

const W = 720;
const H = 120;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
  return node;
}

/**
 * The waveform.
 * @param {{
 *   target?: string|Element, data?: { values: number[], max?: number }|null, title?: string,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: { values: number[], max?: number }|null }) => void, destroy: () => void }}
 */
export function waveform(spec) {
  const root = el('figure', { class: 'ak-root ak-waveform', role: 'img' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  /** @param {{ values: number[], max?: number }|null|undefined} data */
  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const values = data && Array.isArray(data.values)
      ? data.values.filter((v) => typeof v === 'number' && Number.isFinite(v)).map((v) => Math.max(v, 0))
      : [];
    if (!values.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    root.setAttribute('aria-label', spec.title || t('empty'));

    const max = data && typeof data.max === 'number' && data.max > 0 ? data.max : Math.max(...values, 0.0001);
    const node = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ak-waveform__svg', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
    const slot = W / values.length;
    const barW = Math.max(Math.min(slot * 0.62, 14), 1.5);
    values.forEach((v, i) => {
      const half = Math.max((Math.min(v / max, 1) * (H - 8)) / 2, 1.2);
      // Louder bars lean further into the accent: quiet is the dim ink, loud is the brand.
      const strength = Math.round(Math.min(v / max, 1) * 100);
      node.appendChild(svg('rect', {
        x: i * slot + (slot - barW) / 2, y: H / 2 - half, width: barW, height: half * 2,
        rx: barW / 2, class: 'ak-waveform__bar',
        style: `fill: color-mix(in oklab, var(--ak-accent) ${strength}%, var(--ak-ink-dim))`,
      }));
    });
    root.appendChild(node);
  }

  render(spec.data);

  return {
    el: root,
    /** @param {{ data: { values: number[], max?: number }|null }} patch */
    set(patch) {
      if (!patch) return;
      render(patch.data);
    },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
