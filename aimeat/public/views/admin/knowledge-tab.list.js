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
 *   v2.0.0 — 2026-09-27 — Every part is a library component that gets data (admin page group G7): the
 *     search is the SearchLine with its magnifier, the questions Filters, what is applied tags on
 *     the sun that remove themselves, the table the List (a reported package's name in coral, a
 *     column's name said before its value once the rows stack), the foot More with the pages as
 *     filter Tabs. No class.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Badge } from './shared.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Who, Cell, Desc, Num, When, Doors, Filters as FilterRow, Filter, SearchLine, More } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Row as Line, Stack } from '/components/Layout.js';

const S = (key, params) => t('admin.knowledge.' + key, params);

/** The word a maturity gets: ours translated, anything else printed as it came, and marked. */
function maturityLabel(pkg) {
  if (pkg.maturity_declared) return t('knowledge.maturity.' + pkg.maturity);
  return pkg.maturity || '—';
}

/** A kind's word: ours translated, anything else as it came. */
function kindLabel(kind) {
  return t('knowledge.contentType.' + kind) === 'knowledge.contentType.' + kind ? kind : t('knowledge.contentType.' + kind);
}

/** A word for one applied filter, so a reader can see what is narrowing the list. */
function filterLabel(key, value) {
  if (key === 'flagged') return S('list.flaggedShort');
  if (key === 'author_key') return S('list.byAuthor', { name: value });
  if (key === 'content_type') return S('list.byKind', { kind: kindLabel(value) });
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
    <${Stack} gap="small" below="medium">
      <${Line} gap="large" wrap>
        <${SearchLine} find beside value=${q} placeholder=${S('list.searchPlaceholder')}
          onInput=${e => onQ(e.target.value)} />
        <${FilterRow} label=${S('list.title')}>
          <${Filter} on=${clean} onClick=${onClear}>${S('list.all', { n: num(summary.total) })}<//>
          <${Filter} on=${!!filters.flagged} onClick=${() => onFilter({ flagged: !filters.flagged })}>${S('list.flagged', { n: num(summary.flagged) })}<//>
          ${kinds.map(k => html`
            <${Filter} key=${k.name} on=${filters.content_type === k.name} count=${k.packages}
              onClick=${() => onFilter({ content_type: filters.content_type === k.name ? undefined : k.name })}>${kindLabel(k.name)}<//>`)}
        <//>
      <//>

      ${clean ? null : html`
        <${Line} gap="small" wrap>
          <${Note} kind="meta" inline>${S('list.narrowedBy')}<//>
          ${applied.map(([key, value]) => html`
            <${Mark} key=${key} tone="sun" whole onRemove=${() => onFilter({ [key]: undefined })}>${filterLabel(key, value)}<//>`)}
          <${Action} small onClick=${onClear}>${S('list.clearAll')}<//>
        <//>`}
    <//>`;
}

export function PackageTable({ data, q, onQ, filters, onFilter, onClear, onPage, onOpen }) {
  const paging = data.paging;
  const list = data.packages;
  const first = (paging.number - 1) * paging.per_page + 1;
  const last = Math.min(paging.total, paging.number * paging.per_page);

  const count = list.length === 0
    ? S('list.showingNone', { total: num(data.summary.total) })
    : `${S('list.showing', { first: num(first), last: num(last), total: num(paging.total) })}${paging.total !== data.summary.total
      ? ' · ' + S('list.filteredFrom', { n: num(data.summary.total) })
      : ''} · ${S('list.sorted')}`;

  return html`
    <${Section} id="adm-kn-03" num="03" title=${S('list.title')}>
      <${Filters} q=${q} onQ=${onQ} filters=${filters} onFilter=${onFilter} onClear=${onClear}
        facets=${data.facets} summary=${data.summary} />

      <${List} cols="name-who-kind-n-seen-review-when-doors" labels stackWide empty=${S('list.none')}
        head=${[S('list.name'), S('list.author'), S('list.kind'), { label: S('list.entries'), num: true }, S('list.seenBy'), S('list.reviewed'), S('list.added'), '']}>
        ${list.map(p => html`
          <${Row} key=${p.package_id} rail=${p.flag_count > 0 ? 'notice' : undefined}>
            <${Name} attention=${p.flag_count > 0} tag=${(p.tags || []).slice(0, 3)}
              after=${p.flag_count > 0 ? html` <${Badge} type="danger" label=${S('list.flagsN', { n: num(p.flag_count) })} />` : null}>${p.name}<//>
            <${Cell} meta>${p.author || '—'}<//>
            <${Who} sub=${maturityLabel(p)} warn=${!p.maturity_declared}>
              ${kindLabel(p.content_type)}${p.is_system ? html` <${Mark}>${S('list.system')}<//>` : null}<//>
            <${Num}>${num(p.entries_count)}<//>
            <${Desc}>${t('knowledge.visibility.' + p.visibility) === 'knowledge.visibility.' + p.visibility
              ? p.visibility : t('knowledge.visibility.' + p.visibility)}<//>
            ${p.last_review
              ? html`<${Desc} sub=${when(p.last_review.at)}><${Badge} type=${p.last_review.action === 'approve' ? 'success' : 'warning'}
                  label=${S('review.action.' + p.last_review.action)} /><//>`
              : html`<${Cell} meta>${S('list.notReviewed')}<//>`}
            <${When}>${String(p.created || '').slice(0, 10)}<//>
            <${Doors}><${Action} small row onClick=${() => onOpen(p)}>${S('list.open')}<//><//>
          <//>`)}
      <//>

      <${More} wrap note=${count}>
        ${list.length > 0 && paging.pages > 1 ? html`
          <${Tabs} tone="filter" label=${S('list.title')} value=${paging.number} onSelect=${onPage}
            items=${Array.from({ length: paging.pages }, (_, i) => i + 1).slice(0, 8).map(n => ({ value: n, label: String(n) }))}>
            ${paging.number < paging.pages ? html`
              <${Action} small onClick=${() => onPage(paging.number + 1)}>${S('list.next')}<//>` : null}
          <//>` : null}
      <//>
    <//>`;
}
