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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the toolbar with the questions as
 *     filters, applied filters as tabs that remove themselves, the shared table, pages as tabs.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Badge } from './shared.js';
import { Section, Stack, Table, Toolbar, Chip, Action, Text } from '/components/poster-parts.js';

const S = (key, params) => t('admin.knowledge.' + key, params);

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

  return html`<${Stack}>
    <${Toolbar}
      search=${{ ariaLabel: S('list.searchPlaceholder'), placeholder: S('list.searchPlaceholder'), value: q, onInput: e => onQ(e.target.value) }}
      filters=${[
        { id: 'all', label: S('list.all', { n: num(summary.total) }), selected: clean, onClick: onClear },
        { id: 'flagged', label: S('list.flagged', { n: num(summary.flagged) }), selected: !!filters.flagged, onClick: () => onFilter({ flagged: !filters.flagged }) },
        ...kinds.map(k => ({
          id: 'kind-' + k.name,
          label: `${t('knowledge.contentType.' + k.name) === 'knowledge.contentType.' + k.name ? k.name : t('knowledge.contentType.' + k.name)} ${k.packages}`,
          selected: filters.content_type === k.name,
          onClick: () => onFilter({ content_type: filters.content_type === k.name ? undefined : k.name }),
        })),
      ]} />

    ${clean ? null : html`<${Stack} direction="wrap" align="center" density="compact">
      <${Text} kind="label">${S('list.narrowedBy')}<//>
      ${applied.map(([key, value]) => html`<${Action} key=${key} kind="tab" selected=${true}
        label=${filterLabel(key, value)} onClick=${() => onFilter({ [key]: undefined })}>${filterLabel(key, value)} ✗<//>`)}
      <${Action} kind="text" onClick=${onClear}>${S('list.clearAll')}<//>
    <//>`}
  <//>`;
}

export function PackageTable({ data, q, onQ, filters, onFilter, onClear, onPage, onOpen }) {
  const paging = data.paging;
  const list = data.packages;
  const first = (paging.number - 1) * paging.per_page + 1;
  const last = Math.min(paging.total, paging.number * paging.per_page);
  const kindOf = (p) => (t('knowledge.contentType.' + p.content_type) === 'knowledge.contentType.' + p.content_type
    ? p.content_type : t('knowledge.contentType.' + p.content_type));
  const seenOf = (p) => (t('knowledge.visibility.' + p.visibility) === 'knowledge.visibility.' + p.visibility
    ? p.visibility : t('knowledge.visibility.' + p.visibility));

  return html`<${Section} id="adm-kn-03" title=${S('list.title')} count="03">
    <${Stack}>
      <${Filters} q=${q} onQ=${onQ} filters=${filters} onFilter=${onFilter} onClear=${onClear}
        facets=${data.facets} summary=${data.summary} />

      ${list.length === 0 ? html`
        <${Text} tone="muted">${S('list.none')}<//>
        <${Text} kind="mono" tone="muted">${S('list.showingNone', { total: num(data.summary.total) })}<//>` : html`
        <${Table} collapse=${900} label=${S('list.title')}
          headers=${[S('list.name'), S('list.author'), S('list.kind'), S('list.entries'), S('list.seenBy'), S('list.reviewed'), S('list.added'), '']}
          rows=${list.map(p => [
            html`<${Stack} density="compact">
              <${Stack} direction="wrap" align="center" density="compact">
                <strong>${p.name}</strong>
                ${p.flag_count > 0 ? html`<${Badge} type="danger" label=${S('list.flagsN', { n: num(p.flag_count) })} />` : null}
              <//>
              ${(p.tags || []).length ? html`<${Stack} direction="wrap" density="compact">
                ${p.tags.slice(0, 3).map(tag => html`<${Chip} key=${tag} tone="muted">${tag}<//>`)}
              <//>` : null}
            <//>`,
            { text: p.author || '—', mono: true },
            html`<${Stack} direction="wrap" align="center" density="compact">
              <span>${kindOf(p)}</span>
              ${p.is_system ? html`<${Chip}>${S('list.system')}<//>` : null}
              <${Chip} tone=${p.maturity_declared ? 'muted' : 'coral'}>${maturityLabel(p)}<//>
            <//>`,
            { text: num(p.entries_count), align: 'end' },
            seenOf(p),
            p.last_review
              ? html`<${Stack} density="compact"><${Badge} type=${p.last_review.action === 'approve' ? 'success' : 'warning'}
                  label=${S('review.action.' + p.last_review.action)} /><${Text} kind="mono" tone="muted">${when(p.last_review.at)}<//><//>`
              : html`<${Text} kind="caption" tone="muted">${S('list.notReviewed')}<//>`,
            { text: String(p.created || '').slice(0, 10), mono: true },
            html`<${Action} onClick=${() => onOpen(p)}>${S('list.open')}<//>`,
          ])} />

        <${Stack} direction="wrap" align="between">
          <${Text} kind="mono" tone="muted">
            ${S('list.showing', { first: num(first), last: num(last), total: num(paging.total) })}
            ${paging.total !== data.summary.total
              ? ' · ' + S('list.filteredFrom', { n: num(data.summary.total) })
              : ''}
            ${' · '}${S('list.sorted')}<//>
          ${paging.pages > 1 ? html`<${Stack} direction="wrap" align="center" density="compact">
            ${Array.from({ length: paging.pages }, (_, i) => i + 1).slice(0, 8).map(n => html`
              <${Action} key=${n} kind="tab" selected=${n === paging.number} onClick=${() => onPage(n)}>${n}<//>`)}
            ${paging.number < paging.pages ? html`
              <${Action} onClick=${() => onPage(paging.number + 1)}>${S('list.next')}<//>` : null}
          <//>` : null}
        <//>`}
    <//>
  <//>`;
}
