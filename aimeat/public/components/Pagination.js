import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * @file Pagination.js
 * @description Canonical pagination primitives backed by `.pagination` /
 *   `.load-more` in theme.css. Consolidates the near-identical per-view
 *   prev/page/next clones (.adm-mem-pagination, and the prev/"Page X"/next
 *   shape of .mk-pagination) and the "Load more" button pattern. All colors
 *   come from theme tokens so both flip correctly in dark mode.
 *
 *   Two exports:
 *   - `Pagination` — a prev / "Page X / Y" / next control (arrow buttons with a
 *     disabled state at the ends). Matches the existing admin pagination shape.
 *     Does NOT render numbered page buttons (the .hb-pagination numbered variant
 *     is intentionally left in place — different UI).
 *   - `LoadMore` — a centered "load more" button (themed `.load-more` wrapper +
 *     canonical `.btn-outline`), with an optional loading state.
 * @structure
 *   Pagination({ page, totalPages, onPage, prevLabel?, nextLabel?, pageLabel? })
 *     — `page` is 1-based; `onPage(n)` fires with the requested page. Buttons
 *     auto-disable at the first/last page. `pageLabel` overrides the default
 *     "{page} / {totalPages}" middle text (pass a string or node).
 *   LoadMore({ onMore, loading?, label? })
 *     — renders a centered `.btn-outline`; disabled + shows `label` unchanged
 *     while `loading` is truthy (caller supplies any "loading…" text itself).
 * @usage
 *   import { Pagination, LoadMore } from '/components/index.js';
 *   html`<${Pagination} page=${page} totalPages=${pages} onPage=${go}
 *     prevLabel=${t('common.prev')} nextLabel=${t('common.next')} />`
 *   html`<${LoadMore} onMore=${loadMore} loading=${loading}
 *     label=${t('pkv.loadMore')} />`
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#17): canonical Pagination +
 *     LoadMore, backed by .pagination / .load-more in theme.css.
 */

/**
 * Pagination — prev / "Page X / Y" / next control with arrow buttons.
 * @param {{ page: number, totalPages: number, onPage: (n:number)=>void,
 *   prevLabel?: string, nextLabel?: string, pageLabel?: any }} props
 */
export function Pagination({ page, totalPages, onPage, prevLabel, nextLabel, pageLabel }) {
  return html`<div class="pagination">
    <button
      class="btn-outline btn-sm"
      disabled=${page <= 1}
      onClick=${() => onPage(page - 1)}
    >← ${prevLabel ?? 'Prev'}</button>
    <span class="pagination-info">${pageLabel ?? html`${page} / ${totalPages}`}</span>
    <button
      class="btn-outline btn-sm"
      disabled=${page >= totalPages}
      onClick=${() => onPage(page + 1)}
    >${nextLabel ?? 'Next'} →</button>
  </div>`;
}

/**
 * LoadMore — centered "load more" button.
 * @param {{ onMore: ()=>void, loading?: boolean, label?: any }} props
 */
export function LoadMore({ onMore, loading, label }) {
  return html`<div class="load-more">
    <button class="btn-outline" disabled=${!!loading} onClick=${onMore}>
      ${label ?? 'Load more'}
    </button>
  </div>`;
}
