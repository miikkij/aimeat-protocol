/**
 * @file atelier/timeline.js
 * @description The timeline — events on a vertical line, newest first, each with its moment,
 *   its words and an optional tone. It exists so activity views, histories and provenance
 *   trails all read the same way, and so an app never hand-rolls the line, the dots and the
 *   spacing that make a sequence legible.
 * @structure timeline(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.timeline({ target: host, items: [
 *           { id: 'e1', ts: '2026-08-27T10:00:00Z', title: 'Published', tone: 'ok' } ] });
 * @version-history
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, clear, resolve, enter } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

/**
 * @typedef {object} TimelineItem
 * @property {string} id
 * @property {string|number|Date} ts
 * @property {string} title
 * @property {string} [sub]
 * @property {'ok'|'warn'|'err'|'plain'} [tone]
 */

/** Default moment wording: date + time in the viewer's locale. */
function fmtTs(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The timeline.
 * @param {{
 *   target?: string|Element, items: TimelineItem[],
 *   format?: (ts: TimelineItem['ts']) => string,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { items: TimelineItem[] }) => void, destroy: () => void }}
 */
export function timeline(spec) {
  const fmt = spec.format || fmtTs;
  const root = el('ol', { class: 'ak-root ak-timeline' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  /** @param {TimelineItem[]} items */
  function render(items) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    if (!items.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || t('empty'), hint: e.hint || t('emptyHint'),
      });
      return;
    }
    for (const item of items) {
      root.appendChild(el('li', { class: 'ak-timeline__item', 'data-ak-id': item.id }, [
        el('span', { class: 'ak-timeline__dot ak-timeline__dot--' + (item.tone || 'plain'), 'aria-hidden': 'true' }),
        el('div', { class: 'ak-timeline__body' }, [
          el('span', { class: 'ak-timeline__when', text: fmt(item.ts) }),
          el('span', { class: 'ak-timeline__title', text: item.title }),
          item.sub != null ? el('span', { class: 'ak-timeline__sub', text: item.sub }) : null,
        ]),
      ]));
    }
    enter(root);
  }

  render(spec.items || []);

  return {
    el: root,
    /** @param {{ items: TimelineItem[] }} patch */
    set(patch) {
      if (!patch || !patch.items) return;
      render(patch.items);
    },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
