/**
 * @file public/views/admin/agents-tab.record.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record one row of the Agents list opens into (design canvas "AIMEAT Admin
 *   Agents", board "One agent opened"): whose the agent is, what it may do, where it may be called
 *   from, when it was connected, and the trust score with the breakdown behind it. The fields on
 *   the left come from the list the page already has; the trust panel and the description come from
 *   GET /v1/agents/:gaii, which recomputes the score and writes it back, and the panel says so.
 *
 * @structure
 *   - AgentRecord({ agent, detail, loading, onClose, onOwner, onOrigins }) — the whole record
 *   - Line: one label-and-value row, with an optional door at its end
 *
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Surface record, KeyValue, Chip, Columns,
 *     Text): no class of its own, so a theme change reaches it.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- Compose ink row boundaries from the shared poster class.
 *   v1.0.0 — 2026-09-12 — Initial, with the Agents page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Surface, Columns, Stack, KeyValue, Chip, Action, Text } from '/components/poster-parts.js';
import { kindOf, freshness, isAwake, daysSince, trustText } from './agents-tab.derive.js';
import { shortDate } from './shared.js';

const A = (key, params) => t('dashboard.agentsTab.' + key, params);

/** The opened record's element id, so the list can bring it into view when a name is pressed. */
export const RECORD_ID = 'adm-ag-open';

/** "2 min", "5 h", "3 d", "16 Mar" — the same reading the list column uses. */
export function seenWords(iso, now) {
  const f = freshness(iso, now);
  if (f.kind === 'never') return A('seenNever');
  if (f.kind === 'minutes') return A('seenMinutes', { n: f.n });
  if (f.kind === 'hours') return A('seenHours', { n: f.n });
  if (f.kind === 'days') return A('seenDays', { n: f.n });
  return shortDate(iso);
}

/** One row of the record: what it is called, what it says, and sometimes a way on. */
function Line({ label, value, why, door }) {
  return html`<${KeyValue} label=${label}>
    <${Stack} direction="wrap" align="between">
      <${Stack} density="compact">
        <span>${value}</span>
        ${why && html`<${Text} kind="caption" tone="muted">${why}<//>`}
      <//>
      ${door}
    <//>
  <//>`;
}

/** The scopes as chips, or the one chip that says the list carries none for this agent. */
function Scopes({ scopes }) {
  if (!scopes?.length) return html`<${Chip} tone="muted">${A('scopesNone')}<//>`;
  return html`<${Stack} direction="wrap" density="compact">${scopes.map(s => html`<${Chip} key=${s}>${s}<//>`)}<//>`;
}

/**
 * The trust panel. Everything in it is the reading taken the moment the record was opened, which
 * is what the sentence under it says: the route recomputes the score and stores it, so the number
 * the list showed a second ago and the number here can differ, and that difference is the point.
 */
function Trust({ agent, detail, loading }) {
  if (loading || !detail?.trust) {
    return html`<${Surface} kind="box" density="compact"><${Stack} density="compact">
      <${Text} kind="label">${A('trustHead')}<//>
      <${Text} tone="muted">${A('reading')}<//>
    <//><//>`;
  }
  const tr = detail.trust;
  const before = agent.trust_score;
  const moved = typeof before === 'number' && before !== tr.score;
  return html`
    <${Surface} kind="box" density="compact"><${Stack} density="compact">
      <${Text} kind="label">${A('trustHead')}<//>
      <${Stack} direction="horizontal" align="end" density="compact">
        <${Text} kind="number">${trustText(tr.score)}<//><${Text} kind="caption" tone="muted">${A('trustOf100')}<//>
      <//>
      <div>
        <${KeyValue} mono label=${A('trustDeliveries')} value=${String(tr.total_deliveries ?? 0)} />
        <${KeyValue} mono label=${A('trustSuccess')} value=${tr.total_deliveries
    ? (tr.success_rate * 100).toFixed(0) + '%'
    : A('trustNoWork')} />
        <${KeyValue} mono label=${A('trustRatings')} value=${`+${tr.positive_ratings ?? 0} / -${tr.negative_ratings ?? 0}`} />
        <${KeyValue} mono label=${A('trustAge')} value=${A('trustDays', { n: tr.age_days ?? 0 })} />
      </div>
      <${Text} kind="caption" tone="muted">${moved ? A('trustMoved', { before: trustText(before) }) : A('trustSame')} ${A('trustCap')}<//>
    <//><//>`;
}

/**
 * One agent, opened above the list's table.
 * @param {{ agent: any, detail: any, loading: boolean, now: number,
 *           onClose: () => void, onOwner: () => void, onOrigins: () => void }} props
 */
export default function AgentRecord({ agent, detail, loading, now, onClose, onOwner, onOrigins }) {
  const kind = kindOf(agent.gaii);
  const origins = agent.allowed_origins;
  const federates = agent.federate === true;
  const age = daysSince(agent.created_at, now);
  const published = detail?.actions_published ?? 0;

  return html`
    <${Surface} kind="record" id=${RECORD_ID}><${Stack}>
      <${Stack} direction="horizontal" align="between">
        <${Stack} density="compact">
          <${Text} kind="heading" size="small">${agent.display_name || agent.gaii.split('#')[0]}<//>
          <${Text} kind="mono" tone="muted">${agent.gaii}<//>
          <${Stack} direction="wrap" density="compact">
            <${Chip} tone=${isAwake(agent, now) ? 'success' : 'plain'}>${A('chipSeen', { when: seenWords(agent.last_seen, now) })}<//>
            <${Chip}>${A('kind' + kind.charAt(0).toUpperCase() + kind.slice(1))}<//>
            <${Chip} tone=${federates ? 'plain' : 'muted'}>${federates ? A('fedOn') : A('fedOff')}<//>
          <//>
        <//>
        <${Action} onClick=${onClose}>${A('close')} ↩<//>
      <//>

      <${Columns} layout="leading" collapse=${640}>
        <${Stack} density="compact">
          ${detail?.description
    ? html`<${Text}>${detail.description}<//>`
    : html`<${Text} tone="muted">${loading ? A('reading') : A('noDescription')}<//>`}
          <div>
            <${Line} label=${A('fWhose')} value=${agent.owner} why=${A('fWhoseWhy')}
              door=${html`<${Action} onClick=${onOwner}>${A('fOpenPerson')}<//>`} />

            <${Line} label=${A('fMayDo')} value=${html`<${Scopes} scopes=${agent.default_scopes} />`}
              why=${agent.default_scopes?.length ? A('fMayDoWhy') : A('fMayDoNoneWhy')} />

            <${Line} label=${A('fCalledFrom')}
              value=${origins?.length ? origins.join(', ') : A('fAnywhere')}
              why=${origins?.length ? A('fOriginsWhy') : A('fAnywhereWhy')}
              door=${html`<${Action} onClick=${onOrigins}>${A('fToCors')}<//>`} />

            <${Line} label=${A('fConnected')} value=${shortDate(agent.created_at)}
              why=${age !== null ? A('fConnectedWhy', { n: Math.max(0, Math.floor(age)) }) : ''} />

            <${Line} label=${A('fPublished')}
              value=${published ? A('fPublishedN', { n: published }) : A('fPublishedNone')}
              why=${A('fPublishedWhy')} />
          </div>
        <//>

        <${Trust} agent=${agent} detail=${detail} loading=${loading} />
      <//>

      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${onOrigins}>${A('actOrigins')}<//>
        <${Text} kind="caption" tone="muted">${A('actOriginsWhy')}<//>
      <//>
    <//><//>`;
}
