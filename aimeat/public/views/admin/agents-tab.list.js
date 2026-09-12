/**
 * @file public/views/admin/agents-tab.list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 02 of the Agents page (design canvas "AIMEAT Admin Agents"): the search
 *   field, the five filter chips that are the numeral strip's counts made pressable, and the table
 *   that says for the first time what each agent may do. A row opens into its record in place.
 *   Everything here runs on the agent list the page already fetched; there is no second read, no
 *   sort parameter and no page number to ask the node for.
 *
 * @structure
 *   - AgentsList(props) — the find row, the head, the rows, the opened record, the footer
 *   - Chip: one filter chip carrying its count
 *   - trustCell / scopeCell: the two columns whose reading is not the raw value
 *
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Agents page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { trustKind, trustText, isAwake } from './agents-tab.derive.js';
import AgentRecord, { seenWords } from './agents-tab.record.js';

const A = (key, params) => t('dashboard.agentsTab.' + key, params);

/** How many rows a page of the table shows, and how many more the door adds. */
export const PAGE = 40;
/** How many scope words fit the column before the rest become a count. */
const SCOPES_SHOWN = 2;

/** One filter chip: the word and the count it stands for. */
function Chip({ id, label, count, on, coral, onPick }) {
  return html`
    <button type="button"
      class="adm-ag-chip ${on ? 'on' : ''} ${coral ? 'adm-ag-chip--coral' : ''}"
      aria-pressed=${on ? 'true' : 'false'}
      onClick=${() => onPick(id)}>${label}<b>${count}</b></button>`;
}

/**
 * The trust column.
 *
 * 50.0 is what an agent is registered with and it only moves when somebody reads that agent's
 * profile, so the page dims it rather than letting a wall of identical numbers read as a measured
 * ranking. Under 40 is coloured, because that is a score somebody has actually computed.
 */
function trustCell(agent) {
  const kind = trustKind(agent.trust_score);
  if (kind === 'unknown') return html`<span class="adm-ag-tr adm-ag-tr--none">${A('trustUnknown')}</span>`;
  const cls = kind === 'low' ? 'adm-ag-tr--low' : kind === 'registered' ? 'adm-ag-tr--none' : '';
  return html`<span class="adm-ag-tr ${cls}">${trustText(agent.trust_score)}</span>`;
}

/** The scopes column: the first two words, then how many more there are. */
function scopeCell(agent) {
  const scopes = agent.default_scopes;
  if (!scopes?.length) return html`<span>${A('scopesNone')}</span>`;
  const shown = scopes.slice(0, SCOPES_SHOWN);
  const rest = scopes.length - shown.length;
  return html`
    ${shown.map(s => html`<span>${s}</span>`)}
    ${rest > 0 && html`<span class="adm-ag-scp-more">+${rest}</span>`}`;
}

export default function AgentsList({
  rows, total, counts, now, filter, onFilter, query, onQuery, limit, onMore,
  openGaii, onToggle, detail, detailLoading, onOwner, onOrigins,
}) {
  const shown = rows.slice(0, limit);
  const oldestFirst = filter === 'silent';

  return html`
    <section class="og-sec">
      <div class="og-sec-h">
        <h2>${A('listTitle')}<small>02</small></h2>
        <div class="og-doors"><span class="og-door og-door--quiet">${oldestFirst ? A('sortOldest') : A('sortNewest')}</span></div>
      </div>

      <div class="adm-ag-find">
        <div class="og-field">
          <label class="og-label" for="adm-ag-q">${A('findLabel')}</label>
          <input id="adm-ag-q" class="og-input" type="search" value=${query}
            placeholder=${A('findPlaceholder')} onInput=${e => onQuery(e.target.value)} />
        </div>
        <div class="adm-ag-chips">
          <${Chip} id="all" label=${A('chipAll')} count=${counts.total} on=${filter === 'all'} onPick=${onFilter} />
          <${Chip} id="awake" label=${A('chipAwake')} count=${counts.awake} on=${filter === 'awake'} onPick=${onFilter} />
          <${Chip} id="silent" label=${A('chipSilent')} count=${counts.silent} on=${filter === 'silent'} onPick=${onFilter} />
          <${Chip} id="node" label=${A('chipNode')} count=${counts.nodeMade} on=${filter === 'node'} onPick=${onFilter} />
          <${Chip} id="low" label=${A('chipLow')} count=${counts.low} on=${filter === 'low'} coral=${true} onPick=${onFilter} />
        </div>
      </div>

      <div class="adm-ag-row adm-ag-row--head">
        <div class="adm-ag-c-name">${A('colAgent')}</div>
        <div class="adm-ag-c-own">${A('colOwner')}</div>
        <div class="adm-ag-scp adm-ag-c-scp">${A('colMayDo')}</div>
        <div class="adm-ag-c-tr">${A('colTrust')}</div>
        <div class="adm-ag-c-seen">${A('colSeen')}</div>
        <div class="adm-ag-go"></div>
      </div>

      ${shown.length === 0 && html`<p class="adm-ag-note">${A('nothingMatches')}</p>`}

      ${shown.map(a => {
    const open = openGaii === a.gaii;
    return html`
      <div class="adm-ag-row ${open ? 'adm-ag-row--open' : ''}">
        <div class="adm-ag-c-name">
          <button type="button" class="adm-ag-nm ${open ? 'is-open' : ''}" onClick=${() => onToggle(a.gaii)}>
            ${a.display_name || a.gaii.split('#')[0]}
          </button>
          <span class="adm-ag-addr">${a.gaii}</span>
        </div>
        <div class="adm-ag-c-own">
          <button type="button" class="adm-ag-own" onClick=${() => onOwner(a.owner)}>${a.owner}</button>
        </div>
        <div class="adm-ag-scp adm-ag-c-scp">${scopeCell(a)}</div>
        <div class="adm-ag-c-tr">${trustCell(a)}</div>
        <div class="adm-ag-c-seen">
          <span class="adm-ag-seen ${isAwake(a, now) ? 'adm-ag-seen--now' : ''}">${seenWords(a.last_seen, now)}</span>
        </div>
        <div class="adm-ag-go">
          <button type="button" class="og-door og-door--quiet" onClick=${() => onToggle(a.gaii)}>
            ${open ? A('close') : A('open')}
          </button>
        </div>
      </div>
      ${open && html`<${AgentRecord} agent=${a} detail=${detail} loading=${detailLoading} now=${now}
        onClose=${() => onToggle(a.gaii)} onOwner=${() => onOwner(a.owner)} onOrigins=${onOrigins} />`}`;
  })}

      <div class="adm-ag-foot">
        <span>${A('footShown', { shown: Math.min(shown.length, rows.length), total: rows.length })}${
  rows.length !== total ? A('footOf', { total }) : ''}</span>
        ${rows.length > shown.length && html`
          <button type="button" class="og-door og-door--quiet" onClick=${onMore}>
            ${A('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}
          </button>`}
      </div>
      <p class="adm-ag-note">${A('trustLegend')}</p>
    </section>`;
}
