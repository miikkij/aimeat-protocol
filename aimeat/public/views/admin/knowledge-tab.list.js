/**
 * @file knowledge-tab.list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 03 of the Knowledge page: every package, in a table, with search, filters
 *   and real paging.
 *
 *   A TABLE BECAUSE TWENTY CARDS DO NOT SCAN AND FORTY-SEVEN NEVER WILL. The old page drew a card
 *   grid in which name, kind, System, author, visibility, maturity, entry count, date, tags and two
 *   buttons all shouted equally, and the one thing that should shout — a flag — was a small chip
 *   that appeared only above zero. The sort was already right (flagged first, then newest); only
 *   the presentation threw it away.
 *
 *   AND BECAUSE IT SHOWED TWENTY OF HOWEVER MANY. The route has always paginated and always
 *   returned the count; the page asked for page one and read only the packages, so an operator
 *   moderating a node saw the first twenty and had no way to learn the rest existed. The footer
 *   states the count on every render, and it is the one thing on this page that must never be
 *   absent.
 * @structure
 *   - Filters — search, the questions an operator actually has, and the page size
 *   - PackageTable (03) — the rows, and the footer that says how many there are
 * @usage Imported by views/admin/knowledge-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Badge } from './shared.js';

const S = (key, params) => t('admin.knowledge.' + key, params);

/** A stroke icon on a 24px grid. Never an emoji: it scales and recolours. */
const SEARCH_ICON = html`
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.3-4.3" /></svg>`;

/** The word a maturity gets: ours translated, anything else printed as it came, and marked. */
function maturityLabel(pkg) {
  if (pkg.maturity_declared) return t('knowledge.maturity.' + pkg.maturity);
  return pkg.maturity || '—';
}

/** A word for one applied filter, so a reader can see what is narrowing the list. */
function filterLabel(key, value) {
  if (key === 'flagged') return S('list.flaggedShort');
  if (key === 'author_key') return S('list.byAuthor', { name: value });
  if (key === 'content_type') {
    const k = t('knowledge.contentType.' + value);
    return S('list.byKind', { kind: k === 'knowledge.contentType.' + value ? value : k });
  }
  return `${key}: ${value}`;
}

/**
 * Search, the questions an operator has, and — when anything is narrowing the list — a row of what
 * is applied, each removable.
 *
 * THE APPLIED ROW EXISTS BECAUSE A FILTER COULD NOT BE ESCAPED. Pressing an author in section 02
 * set a filter that no chip showed and no chip cleared, so the only way back to the whole list was
 * reloading the page. The kind chips also come from the FILTERED facets, so choosing one made the
 * others disappear; this row is what you move through instead.
 */
export function Filters({ q, onQ, filters, onFilter, onClear, facets, summary }) {
  const kinds = (facets.kinds || []).slice(0, 4);
  const applied = Object.entries(filters).filter(([, v]) => v !== undefined && v !== false);
  const clean = applied.length === 0;

  return html`
    <div class="adm-kn-filters">
      <span class="adm-kn-search">
        ${SEARCH_ICON}
        <input type="search" value=${q} placeholder=${S('list.searchPlaceholder')}
          onInput=${e => onQ(e.target.value)} />
      </span>
      <div class="adm-kn-chips">
        <button type="button" class="adm-kn-fchip ${clean ? 'on' : ''}"
          onClick=${onClear}>${S('list.all', { n: num(summary.total) })}</button>
        <button type="button" class="adm-kn-fchip ${filters.flagged ? 'on' : ''}"
          onClick=${() => onFilter({ flagged: !filters.flagged })}>${S('list.flagged', { n: num(summary.flagged) })}</button>
        ${kinds.map(k => html`
          <button type="button" class="adm-kn-fchip ${filters.content_type === k.name ? 'on' : ''}"
            onClick=${() => onFilter({ content_type: filters.content_type === k.name ? undefined : k.name })}>
            ${t('knowledge.contentType.' + k.name) === 'knowledge.contentType.' + k.name ? k.name : t('knowledge.contentType.' + k.name)}
            ${' '}${k.packages}
          </button>`)}
      </div>

      ${clean ? null : html`
        <div class="adm-kn-applied">
          <span class="adm-kn-applied-l">${S('list.narrowedBy')}</span>
          ${applied.map(([key, value]) => html`
            <button type="button" class="adm-kn-drop" onClick=${() => onFilter({ [key]: undefined })}>
              <span>${filterLabel(key, value)}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>`)}
          <button type="button" class="og-door og-door--up" onClick=${onClear}>${S('list.clearAll')}</button>
        </div>`}
    </div>`;
}

export function PackageTable({ data, q, onQ, filters, onFilter, onClear, onPage, onOpen }) {
  const paging = data.paging;
  const list = data.packages;
  const first = (paging.number - 1) * paging.per_page + 1;
  const last = Math.min(paging.total, paging.number * paging.per_page);

  return html`
    <section class="og-sec" id="adm-kn-03">
      <div class="og-sec-h">
        <h2>${S('list.title')}<small>03</small></h2>
      </div>

      <${Filters} q=${q} onQ=${onQ} filters=${filters} onFilter=${onFilter} onClear=${onClear}
        facets=${data.facets} summary=${data.summary} />

      ${list.length === 0 ? html`
        <div class="adm-kn-empty">${S('list.none')}</div>
        <div class="adm-kn-foot">
          <span class="adm-kn-count">${S('list.showingNone', { total: num(data.summary.total) })}</span>
        </div>` : html`
        <div class="adm-kn-scroll">
          <table class="adm-kn-tbl">
            <thead>
              <tr>
                <th>${S('list.name')}</th>
                <th>${S('list.author')}</th>
                <th>${S('list.kind')}</th>
                <th class="num">${S('list.entries')}</th>
                <th>${S('list.seenBy')}</th>
                <th>${S('list.reviewed')}</th>
                <th>${S('list.added')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${list.map(p => html`
                <tr class=${p.flag_count > 0 ? 'adm-kn-row--flagged' : ''}>
                  <td>
                    <b>${p.name}</b>
                    ${p.flag_count > 0
    ? html`<span class="adm-kn-flags"><${Badge} type="danger"
        label=${S('list.flagsN', { n: num(p.flag_count) })} /></span>`
    : null}
                    ${(p.tags || []).length ? html`
                      <span class="adm-kn-tags">
                        ${p.tags.slice(0, 3).map(tag => html`<span class="adm-kn-tag">${tag}</span>`)}
                      </span>` : null}
                  </td>
                  <td class="mono">${p.author || '—'}</td>
                  <td>
                    ${t('knowledge.contentType.' + p.content_type) === 'knowledge.contentType.' + p.content_type
    ? p.content_type : t('knowledge.contentType.' + p.content_type)}
                    ${p.is_system ? html`<span class="adm-kn-sys">${S('list.system')}</span>` : null}
                    <span class="adm-kn-mat ${p.maturity_declared ? '' : 'adm-kn-mat--odd'}">
                      ${maturityLabel(p)}
                    </span>
                  </td>
                  <td class="num">${num(p.entries_count)}</td>
                  <td>${t('knowledge.visibility.' + p.visibility) === 'knowledge.visibility.' + p.visibility
    ? p.visibility : t('knowledge.visibility.' + p.visibility)}</td>
                  <td>
                    ${p.last_review
    ? html`<${Badge} type=${p.last_review.action === 'approve' ? 'success' : 'warning'}
        label=${S('review.action.' + p.last_review.action)} />
      <span class="adm-kn-when">${when(p.last_review.at)}</span>`
    : html`<span class="adm-kn-when">${S('list.notReviewed')}</span>`}
                  </td>
                  <td class="mono">${String(p.created || '').slice(0, 10)}</td>
                  <td class="acts">
                    <button type="button" class="og-door og-door--up" onClick=${() => onOpen(p)}>${S('list.open')}</button>
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>

        <div class="adm-kn-foot">
          <span class="adm-kn-count">
            ${S('list.showing', { first: num(first), last: num(last), total: num(paging.total) })}
            ${paging.total !== data.summary.total
    ? ' · ' + S('list.filteredFrom', { n: num(data.summary.total) })
    : ''}
            ${' · '}${S('list.sorted')}
          </span>
          ${paging.pages > 1 ? html`
            <span class="adm-kn-pages">
              ${Array.from({ length: paging.pages }, (_, i) => i + 1).slice(0, 8).map(n => html`
                <button type="button" class="adm-kn-fchip ${n === paging.number ? 'on' : ''}"
                  onClick=${() => onPage(n)}>${n}</button>`)}
              ${paging.number < paging.pages ? html`
                <button type="button" class="og-door og-door--up adm-kn-next"
                  onClick=${() => onPage(paging.number + 1)}>${S('list.next')}</button>` : null}
            </span>` : null}
        </div>`}
    </section>`;
}
