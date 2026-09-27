/**
 * @file public/views/admin/agents-tab.list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 02 of the Agents page (design canvas "AIMEAT Admin Agents"): the search
 *   field, the five filter chips that are the numeral strip's counts made pressable, and the table
 *   that says for the first time what each agent may do. A row opens into its record in place.
 *   Everything here runs on the agent list the page already fetched; there is no second read, no
 *   sort parameter and no page number to ask the node for. Every part is a library component; the
 *   page passes data and writes no class.
 *
 * @structure
 *   - AgentsList(props) — the find row, the head, the rows, the opened record, the footer
 *   - trustCell / scopeCell: the two columns whose reading is not the raw value
 *
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the List (one row per agent, its record in the
 *     row's panel), the filter Tabs with their counts, TextField, More, Mark, Tinted.
 *   v1.1.0 — 2026-09-13 — Compose the shared poster list heading.
 *   v1.0.0 — 2026-09-12 — Initial, with the Agents page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section } from '/components/Section.js';
import { List, Row as Item, Name, Num, When, Cell, Doors, More } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tinted } from '/components/Figure.js';
import { TextField } from '/components/TextField.js';
import { Tabs } from '/components/Tabs.js';
import { Row as Line } from '/components/Layout.js';
import { trustKind, trustText, isAwake } from './agents-tab.derive.js';
import AgentRecord, { seenWords } from './agents-tab.record.js';

const A = (key, params) => t('dashboard.agentsTab.' + key, params);

/** How many rows a page of the table shows, and how many more the door adds. */
export const PAGE = 40;
/** How many scope words fit the column before the rest become a count. */
const SCOPES_SHOWN = 2;

/**
 * The trust column.
 *
 * 50.0 is what an agent is registered with and it only moves when somebody reads that agent's
 * profile, so the page dims it rather than letting a wall of identical numbers read as a measured
 * ranking. Under 40 is coloured, because that is a score somebody has actually computed.
 */
function trustCell(agent) {
  const kind = trustKind(agent.trust_score);
  if (kind === 'unknown') return html`<${Tinted} tone="dim">${A('trustUnknown')}<//>`;
  const tone = kind === 'low' ? 'notice' : kind === 'registered' ? 'dim' : undefined;
  return html`<${Tinted} tone=${tone}>${trustText(agent.trust_score)}<//>`;
}

/** The scopes column: the first two words, then how many more there are. */
function scopeCell(agent) {
  const scopes = agent.default_scopes;
  if (!scopes?.length) return html`<${Mark}>${A('scopesNone')}<//>`;
  const shown = scopes.slice(0, SCOPES_SHOWN);
  const rest = scopes.length - shown.length;
  return html`
    ${shown.map(s => html`<${Mark} key=${s}>${s}<//>`)}
    ${rest > 0 && html`<${Note} kind="meta" inline>+${rest}<//>`}`;
}

export default function AgentsList({
  rows, total, counts, now, filter, onFilter, query, onQuery, limit, onMore,
  openGaii, onToggle, detail, detailLoading, onOwner, onOrigins,
}) {
  const shown = rows.slice(0, limit);
  const oldestFirst = filter === 'silent';
  const chips = [
    { value: 'all', label: A('chipAll'), count: counts.total },
    { value: 'awake', label: A('chipAwake'), count: counts.awake },
    { value: 'silent', label: A('chipSilent'), count: counts.silent },
    { value: 'node', label: A('chipNode'), count: counts.nodeMade },
    { value: 'low', label: A('chipLow'), count: counts.low, attention: true },
  ];

  return html`
    <${Section} num="02" title=${A('listTitle')}
      doors=${html`<${Note} kind="meta" inline>${oldestFirst ? A('sortOldest') : A('sortNewest')}<//>`}>

      <${Line} wrap align="end" gap="large" below="medium">
        <${TextField} search id="adm-ag-q" label=${A('findLabel')} value=${query}
          placeholder=${A('findPlaceholder')} onInput=${(v) => onQuery(v)} />
        <${Tabs} tone="filter" kind="toggle" value=${[filter]} label=${A('findLabel')}
          onSelect=${onFilter} items=${chips} />
      <//>

      <${List} cols="name-who-tags-n-when-doors" empty=${A('nothingMatches')}
        head=${[A('colAgent'), A('colOwner'), A('colMayDo'), { label: A('colTrust'), num: true }, A('colSeen'), '']}>
        ${shown.map(a => {
    const open = openGaii === a.gaii;
    return html`
          <${Item} key=${a.gaii} open=${open}>
            <${Name} onOpen=${() => onToggle(a.gaii)} attention=${open} meta=${a.gaii} clip>
              ${a.display_name || a.gaii.split('#')[0]}
            <//>
            <${Cell} clip><${Action} small soft onClick=${() => onOwner(a.owner)}>${a.owner}<//><//>
            <${Cell} line>${scopeCell(a)}<//>
            <${Num}>${trustCell(a)}<//>
            <${When}><${Tinted} tone=${isAwake(a, now) ? 'fine' : undefined}>${seenWords(a.last_seen, now)}<//><//>
            <${Doors}>
              <${Action} small soft onClick=${() => onToggle(a.gaii)}>${open ? A('close') : A('open')}<//>
            <//>
            ${open && html`<${AgentRecord} agent=${a} detail=${detail} loading=${detailLoading} now=${now}
              onClose=${() => onToggle(a.gaii)} onOwner=${() => onOwner(a.owner)} onOrigins=${onOrigins} />`}
          <//>`;
  })}
      <//>

      <${More}
        note=${`${A('footShown', { shown: Math.min(shown.length, rows.length), total: rows.length })}${
  rows.length !== total ? A('footOf', { total }) : ''}`}
        label=${A('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}
        onMore=${rows.length > shown.length ? onMore : null} />
      <${Note} kind="hint">${A('trustLegend')}<//>
    <//>`;
}
