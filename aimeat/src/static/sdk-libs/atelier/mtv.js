/**
 * @file atelier/mtv.js
 * @description The broadcast family — the Music Television genre's parts as reusable
 *   components, extracted so a builder takes the CRT set, the countdown or the news crawl
 *   without forking the whole page (the owner's ask of 2026-08-30: "music tv:n komponentit
 *   selkeästi eroteltuna").
 *
 *   Three members:
 *     crt        the television set: status strip, dark screen with static level bars, the
 *                credits box naming what plays and WHO MADE IT, a tracking footer
 *     countdown  ranked rows with a big numeral, each row in the next channel colour
 *     crawl      the one-line news strip, star-separated, standing still
 *
 *   THE REGISTER'S PHYSICS HOLD. Everything here is a finite render: the entrance is the kit's
 *   shared one, the bars stand at the heights the data gives them, and nothing repaints on
 *   idle — a crawl that scrolls forever and a VU that dances belong to an app's own code, not
 *   to a stored arrangement. The channel colours are kit tokens with broadcast defaults
 *   (--ak-crt-ch1..4 in mtv.css), so a look may retune the set without a new component.
 * @structure crt · countdown · crawl
 * @usage
 *   AIMEAT.atelier.crt({ target, data: { channel: 'CH 35', title: 'Neon Harbour Nights', artist: 'Moonraker Twins' } });
 *   AIMEAT.atelier.countdown({ target, data: [{ rank: 1, title: 'Neon Harbour Nights', sub: 'Moonraker Twins' }] });
 *   AIMEAT.atelier.crawl({ target, data: ['TEN TAPES, ONE WINNER', 'EVERY VIDEO RUNS ITS CREDITS'] });
 * @version-history
 *   v0.39.0 — 2026-08-30 — Initial: the Music Television parts arrive as components.
 */
import { el, resolve, enter } from './dom.js';
import { emptyState } from './state.js';

/** Rows out of whatever shape the source resolved: an array, or { items }. */
function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

/**
 * The CRT television set: a status strip (channel · slot · LIVE), the dark screen with static
 * level bars, the credits box — title, artist, and the meta line, because every video runs its
 * credits — and the tracking footer with progress. Display only: the app wires any transport
 * around it.
 * @param {{ target?: string|Element, title?: string,
 *   data?: { channel?: string, status?: string, live?: boolean, title?: string, artist?: string,
 *     meta?: string, note?: string, bars?: number[], progress?: { value: number, total: number } } | null,
 *   empty?: { title?: string, hint?: string } }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function crt(spec) {
  const s = spec || {};
  const root = el('figure', { class: 'ak-root ak-crt' });
  if (s.target) resolve(s.target).appendChild(root);
  const d = s.data || null;

  if (!d || (!d.title && !d.artist)) {
    const e = s.empty || {};
    emptyState({ target: root, tone: 'quiet', title: e.title || s.title || 'CRT', hint: e.hint });
    return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
  }

  root.appendChild(el('div', { class: 'ak-crt__status' }, [
    el('span', {}, d.channel || ''),
    el('span', { class: 'ak-crt__status-mid' }, d.status || ''),
    d.live ? el('span', { class: 'ak-crt__live' }, '● LIVE') : null,
  ].filter(Boolean)));

  // The screen: static level bars at the heights the data gives, silence when it gives none.
  const bars = Array.isArray(d.bars) && d.bars.length
    ? d.bars : [0.35, 0.7, 0.5, 0.9, 0.6, 0.8, 0.45, 0.65];
  const screen = el('div', { class: 'ak-crt__screen', 'aria-hidden': 'true' });
  const vu = el('div', { class: 'ak-crt__vu' });
  bars.slice(0, 16).forEach(function (v, i) {
    const h = Math.round(Math.max(0.06, Math.min(Number(v) || 0, 1)) * 100);
    vu.appendChild(el('span', {
      class: 'ak-crt__bar ak-crt__bar--' + ((i % 4) + 1),
      style: 'height:' + h + '%',
    }));
  });
  screen.appendChild(vu);
  root.appendChild(screen);

  root.appendChild(el('figcaption', { class: 'ak-crt__credits' }, [
    d.artist ? el('strong', { class: 'ak-crt__artist' }, d.artist) : null,
    d.title ? el('em', { class: 'ak-crt__title' }, '“' + d.title + '”') : null,
    d.meta ? el('span', { class: 'ak-crt__meta' }, d.meta) : null,
  ].filter(Boolean)));

  const p = d.progress;
  if (p && p.total > 0) {
    const pct = Math.round(Math.max(0, Math.min(p.value / p.total, 1)) * 100);
    root.appendChild(el('div', { class: 'ak-crt__foot' }, [
      el('span', {}, 'TRACKING ' + p.value + ' / ' + p.total),
      el('span', { class: 'ak-crt__track', 'aria-hidden': 'true' },
        [el('span', { class: 'ak-crt__track-fill', style: 'width:' + pct + '%' })]),
      d.note ? el('span', {}, d.note) : null,
    ].filter(Boolean)));
  } else if (d.note) {
    root.appendChild(el('div', { class: 'ak-crt__foot' }, [el('span', {}, d.note)]));
  }

  enter(root);
  return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The chart countdown: ranked rows with a big numeral, title and artist, votes when given,
 * each row wearing the next channel colour. Omitted ranks count down from the top of the list.
 * @param {{ target?: string|Element, title?: string,
 *   data?: Array<{ rank?: number, title: string, sub?: string, votes?: number }> | { items: any[] } | null,
 *   empty?: { title?: string, hint?: string }, onPick?: (row: any) => void }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function countdown(spec) {
  const s = spec || {};
  const root = el('ol', { class: 'ak-root ak-countdown' });
  if (s.target) resolve(s.target).appendChild(root);
  const rows = rowsOf(s.data);

  if (!rows.length) {
    const e = s.empty || {};
    emptyState({ target: root, tone: 'quiet', title: e.title || s.title || '—', hint: e.hint });
    return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
  }

  rows.forEach(function (row, i) {
    const rank = row.rank != null ? row.rank : rows.length - i;
    const li = el('li', { class: 'ak-countdown__row ak-countdown__row--' + ((i % 4) + 1), on: s.onPick ? {
      click: function () { s.onPick(row); },
    } : undefined }, [
      el('span', { class: 'ak-countdown__rank' }, String(rank)),
      el('span', { class: 'ak-countdown__body' }, [
        el('span', { class: 'ak-countdown__title' }, String(row.title || '')),
        row.sub ? el('span', { class: 'ak-countdown__sub' }, String(row.sub)) : null,
      ].filter(Boolean)),
      row.votes != null ? el('span', { class: 'ak-countdown__votes' }, '♥ ' + row.votes) : null,
    ].filter(Boolean));
    root.appendChild(li);
  });

  enter(root);
  return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The news crawl: one loud strip of short items separated by stars, uppercase, standing still
 * — it enters once and holds, because a stored arrangement never repaints on idle.
 * @param {{ target?: string|Element, tone?: 'signal'|'ink',
 *   data?: Array<string | { text: string }> | { items: any[] } | null }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function crawl(spec) {
  const s = spec || {};
  const root = el('p', {
    class: 'ak-root ak-crawl' + (s.tone === 'ink' ? ' ak-crawl--ink' : ''),
  });
  if (s.target) resolve(s.target).appendChild(root);
  const items = rowsOf(s.data)
    .map(function (x) { return typeof x === 'string' ? x : String((x && x.text) || ''); })
    .filter(Boolean);
  root.textContent = items.length ? '★ ' + items.join('  ★  ') : '★';
  enter(root);
  return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}
