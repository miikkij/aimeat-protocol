/**
 * @file atelier/timeline.js
 * @description The timeline — events on a vertical line, newest first, each with its moment,
 *   its words and an optional tone. It exists so activity views, histories and provenance
 *   trails all read the same way, and so an app never hand-rolls the line, the dots and the
 *   spacing that make a sequence legible.
 * @structure timeline(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.timeline({ target: host, items: [
 *           { id: 'e1', ts: '2026-08-27T10:00:00Z', title: 'Published', tone: 'ok' } ] });
 * @parts timeline root · item · dot · body · when · title · sub · extra · aside
 * @slots timeline item(item) · when(item) · title(item) · sub(item) · extra(item) · aside(item)
 * @variants timeline dense · plain
 * @tokens timeline --ak-timeline-dot · --ak-timeline-rail · --ak-timeline-gap · --ak-timeline-indent
 * @fork timeline Copy .ak-timeline* out of content.css; the rail is one ::before and the dot is one span, and you give up the keyed line so every event re-enters on every change.
 * @version-history
 *   v0.53.2 — 2026-09-13 — A MOMENT IS FORMATTED ONLY WHEN IT IS ONE. The kit handed every string
 *     to the browser's date reader, which turned an app's own `07/09, 04:10` into 9 July 2001 with
 *     no warning. A Date, a number and an ISO 8601 or HTTP-style string are formatted as before;
 *     any other string is printed as given. The `when` slot now stops the kit's own formatting
 *     from running at all, and an event with no `ts` draws no moment line instead of "undefined".
 *   v0.51.0 — 2026-09-05 — THE EVENT TAKES WHAT THE APP GIVES IT: nine named parts, `extra` and
 *     `aside` left empty for a reference and a right-hand figure, `parts.item` for the whole
 *     event, two variants and four tokens (the dot, the rail's drop, the indent, the gap).
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
import { calendar, dateTime } from '../_core/format.js';
import { emptyState } from './state.js';
import { partEl, slotInto, applyVariant, partValue, fillPart, hasPart } from './parts-model.js';

/**
 * @typedef {object} TimelineItem
 * @property {string} id
 * @property {string|number|Date} [ts]  a Date, epoch milliseconds or an ISO 8601 string is
 *   formatted for the reader; any other string is the app's own wording and is printed as given
 * @property {string} title
 * @property {string} [sub]
 * @property {'ok'|'warn'|'err'|'plain'} [tone]
 */

/**
 * A string the kit may read as a moment: ISO 8601 with its year first, or the HTTP, RSS and
 * Date#toString forms, which name their month and carry a four-digit year. Nothing else, because
 * the browser's date reader accepts far more than that and guesses: `07/09, 04:10` comes back as
 * 9 July 2001, and `07/09/2026` is month-first whatever its writer meant.
 */
const MACHINE_MOMENT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|^(?:[A-Za-z]{3},? )?\d{1,2} [A-Za-z]{3} \d{4}\b|^[A-Za-z]{3} [A-Za-z]{3} \d{2} \d{4}\b/;

/** Default moment wording: date + time in the viewer's locale — except DATE-ONLY input, which
 *  renders as a date. A bare "2026-08-26" parsed as a moment lands on midnight UTC and told
 *  every reader something happened at 3:00 AM (the first design review's finding). A string that
 *  is not a machine moment is printed as written, and an absent moment draws no line. */
function fmtTs(ts) {
  if (ts == null || ts === '') return null;
  // The distinction this file found on its own is what calendar() is for: a bare date is a day on
  // a calendar and must not be re-read in anyone's zone; everything else is a moment and is.
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts)) return calendar(ts, { dateStyle: 'medium' });
  if (typeof ts === 'string' && !MACHINE_MOMENT.test(ts)) return ts;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return dateTime(d, { dateStyle: 'medium', timeStyle: 'short' });
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
  const root = el('ol', { class: 'ak-root ak-timeline', 'data-ak-part': 'root' });
  applyVariant(root, spec, ['dense', 'plain']);
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  /** @param {TimelineItem[]} items */
  /** One event's contents, written into the element that already stands for it (a kept event
   *  keeps its element, which is what stops the whole line re-entering on every change).
   *  @param {HTMLElement} node @param {TimelineItem} item */
  function fillItem(node, item) {
    clear(node);
    const whole = partValue(spec, 'item', item);
    if (whole !== undefined) { fillPart(node, whole); return; }
    node.appendChild(partEl('span', 'ak-timeline__dot ak-timeline__dot--' + (item.tone || 'plain'), 'dot', { 'aria-hidden': 'true' }));
    const body = partEl('div', 'ak-timeline__body', 'body');
    // The kit's wording is worked out only when no `when` slot replaces it, so an app drawing its
    // own moment can leave `ts` off and its own `format` is never called on the item.
    slotInto(body, spec, 'when', hasPart(spec, 'when') ? null : fmt(item.ts), { cls: 'ak-timeline__when', args: [item] });
    slotInto(body, spec, 'title', item.title, { cls: 'ak-timeline__title', args: [item] });
    slotInto(body, spec, 'sub', item.sub == null ? null : item.sub, { cls: 'ak-timeline__sub', args: [item] });
    slotInto(body, spec, 'extra', null, { cls: 'ak-timeline__extra', args: [item] });
    node.appendChild(body);
    slotInto(node, spec, 'aside', null, { cls: 'ak-timeline__aside', args: [item] });
  }

  /** @param {TimelineItem} item @returns {HTMLElement} */
  function buildItem(item) {
    const node = el('li', { class: 'ak-timeline__item', 'data-ak-part': 'item' });
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
