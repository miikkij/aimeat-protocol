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
 *   v0.50.0 — 2026-09-05 — EVENTS ARE KEPT BY THEIR ID. The line was rebuilt on every set and
 *     re-ran its entrance over every event each time, so five events arriving one at a time
 *     animated fifteen rows. Reconciled now: a new event rises in on its own, one that is gone
 *     fades out where it stood, and the rest stand still.
 *   v0.10.0 — 2026-08-27 — Date-only timestamps render as dates: "2026-08-26" no longer becomes
 *     "3:00 AM" through the midnight-UTC parse (first design review).
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, clear, resolve } from './dom.js';
import { keyedRows } from './arrive.js';
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

/** Default moment wording: date + time in the viewer's locale — except DATE-ONLY input, which
 *  renders as a date. A bare "2026-08-26" parsed as a moment lands on midnight UTC and told
 *  every reader something happened at 3:00 AM (the first design review's finding). */
function fmtTs(ts) {
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts)) {
    return new Date(ts + 'T12:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' });
  }
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
  /** One event's contents, written into the element that already stands for it (a kept event
   *  keeps its element, which is what stops the whole line re-entering on every change).
   *  @param {HTMLElement} node @param {TimelineItem} item */
  function fillItem(node, item) {
    clear(node);
    node.appendChild(el('span', {
      class: 'ak-timeline__dot ak-timeline__dot--' + (item.tone || 'plain'), 'aria-hidden': 'true',
    }));
    node.appendChild(el('div', { class: 'ak-timeline__body' }, [
      el('span', { class: 'ak-timeline__when', text: fmt(item.ts) }),
      el('span', { class: 'ak-timeline__title', text: item.title }),
      item.sub != null ? el('span', { class: 'ak-timeline__sub', text: item.sub }) : null,
    ]));
  }

  /** @param {TimelineItem} item @returns {HTMLElement} */
  function buildItem(item) {
    const node = el('li', { class: 'ak-timeline__item' });
    fillItem(node, item);
    return node;
  }

  function render(items) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    if (!items.length) {
      clear(root);
      const e = spec.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || t('empty'), hint: e.hint || t('emptyHint'),
      });
      return;
    }
    keyedRows(root, items, {
      key: function (item, i) { return item.id != null ? String(item.id) : 'ev-' + i; },
      build: buildItem,
      update: fillItem,
    });
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
