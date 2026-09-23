/**
 * @file public/views/admin/agents-tab.list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 02 of the Agents page (design canvas "AIMEAT Admin Agents"): the search
 *   field, the five filter chips that are the numeral strip's counts made pressable, and the table
 *   that says for the first time what each agent may do. An agent's name opens its record directly
 *   above the table (the pattern admin Capabilities uses), so the table keeps its column heads.
 *   Everything here runs on the agent list the page already fetched; there is no second read, no
 *   sort parameter and no page number to ask the node for.
 *
 * @structure
 *   - AgentsList(props) — the toolbar, the opened record, the table, the footer
 *   - trustCell / scopeCell: the two columns whose reading is not the raw value
 *
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Section, Toolbar, Table, Chip, Text):
 *     the hand-made grid, chips and field leave. The list is the shared table with its five column
 *     heads, stacking on a phone, and the opened record sits above it with its close word.
 *   v1.1.0 — 2026-09-13 — Compose the shared poster list heading.
 *   v1.0.0 — 2026-09-12 — Initial, with the Agents page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Stack, Toolbar, Table, Chip, Action, Text, scrollToId } from '/components/poster-parts.js';
import { trustKind, trustText, isAwake } from './agents-tab.derive.js';
import AgentRecord, { seenWords, RECORD_ID } from './agents-tab.record.js';

const A = (key, params) => t('dashboard.agentsTab.' + key, params);

/** How many rows a page of the table shows, and how many more the door adds. */
export const PAGE = 40;
/** How many scope words fit the column before the rest become a count. */
const SCOPES_SHOWN = 2;

/** The five filters, in the order the strip counts them. */
const FILTERS = [
  ['all', 'chipAll', 'total'], ['awake', 'chipAwake', 'awake'], ['silent', 'chipSilent', 'silent'],
  ['node', 'chipNode', 'nodeMade'], ['low', 'chipLow', 'low'],
];

/**
 * The trust reading.
 *
 * 50.0 is what an agent is registered with and it only moves when somebody reads that agent's
 * profile, so the page dims it rather than letting a wall of identical numbers read as a measured
 * ranking. Under 40 is coloured, because that is a score somebody has actually computed.
 */
function trustCell(agent) {
  const kind = trustKind(agent.trust_score);
  if (kind === 'unknown') return html`<${Text} kind="mono" tone="muted">${A('trustUnknown')}<//>`;
  const tone = kind === 'low' ? 'danger' : kind === 'registered' ? 'muted' : 'plain';
  return html`<${Text} kind="mono" tone=${tone}>${trustText(agent.trust_score)}<//>`;
}

/** The scopes column: the first two words, then how many more there are. */
function scopeCell(agent) {
  const scopes = agent.default_scopes;
  if (!scopes?.length) return html`<${Chip} tone="muted">${A('scopesNone')}<//>`;
  const shown = scopes.slice(0, SCOPES_SHOWN);
  const rest = scopes.length - shown.length;
  return html`
    ${shown.map(s => html`<${Chip} key=${s}>${s}<//>`)}
    ${rest > 0 && html`<${Text} kind="mono" tone="muted">+${rest}<//>`}`;
}

export default function AgentsList({
  rows, total, counts, now, filter, onFilter, query, onQuery, limit, onMore,
  openGaii, onToggle, detail, detailLoading, onOwner, onOrigins,
}) {
  const shown = rows.slice(0, limit);
  const oldestFirst = filter === 'silent';
  const openAgent = openGaii ? rows.find(a => a.gaii === openGaii) || null : null;
  /** Open or close a record; an opened one is brought to the top of the content area. */
  const toggle = (gaii) => {
    const opening = openGaii !== gaii;
    onToggle(gaii);
    if (opening) setTimeout(() => scrollToId(RECORD_ID), 0);
  };

  return html`
    <${Section} title=${A('listTitle')} count="02"
      actions=${html`<${Text} kind="caption" tone="muted">${oldestFirst ? A('sortOldest') : A('sortNewest')}<//>`}>
      <${Stack}>
        <${Toolbar} label=${A('listTitle')}
          search=${{ label: A('findLabel'), placeholder: A('findPlaceholder'), value: query, onInput: e => onQuery(e.target.value) }}
          filters=${FILTERS.map(([id, label, count]) => ({ id, label: `${A(label)} ${counts[count]}`, selected: filter === id,
    tone: id === 'low' ? 'coral' : undefined, onClick: () => onFilter(id) }))} />

        ${openAgent && html`<${AgentRecord} agent=${openAgent} detail=${detail} loading=${detailLoading} now=${now}
          onClose=${() => onToggle(openAgent.gaii)} onOwner=${() => onOwner(openAgent.owner)} onOrigins=${onOrigins} />`}

        ${shown.length === 0
    ? html`<${Text} tone="muted">${A('nothingMatches')}<//>`
    : html`<${Table} density="compact" collapse=${600} label=${A('listTitle')}
            headers=${[A('colAgent'), A('colOwner'), A('colMayDo'), A('colTrust'), A('colSeen'), '']}
            rows=${shown.map(a => {
    const open = openGaii === a.gaii;
    return [
      html`<${Stack} density="compact">
        <${Action} kind="text" expanded=${open} onClick=${() => toggle(a.gaii)}>${a.display_name || a.gaii.split('#')[0]}<//>
        <${Text} kind="mono" tone="muted">${a.gaii}<//>
      <//>`,
      html`<${Action} kind="text" onClick=${() => onOwner(a.owner)}>${a.owner}<//>`,
      html`<${Stack} direction="wrap" align="center" density="compact">${scopeCell(a)}<//>`,
      trustCell(a),
      html`<${Text} kind="mono" tone=${isAwake(a, now) ? 'success' : 'muted'}>${seenWords(a.last_seen, now)}<//>`,
      html`<${Action} onClick=${() => toggle(a.gaii)} expanded=${open}>${open ? A('close') : A('open')}<//>`,
    ];
  })} />`}

        <${Stack} direction="horizontal" align="between">
          <${Text} kind="caption" tone="muted">${A('footShown', { shown: Math.min(shown.length, rows.length), total: rows.length })}${
  rows.length !== total ? A('footOf', { total }) : ''}<//>
          ${rows.length > shown.length && html`
            <${Action} onClick=${onMore}>${A('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}<//>`}
        <//>
        <${Text} kind="caption" tone="muted">${A('trustLegend')}<//>
      <//>
    <//>`;
}
