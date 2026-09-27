/**
 * @file public/views/admin/agents-tab.record.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record one row of the Agents list opens into (design canvas "AIMEAT Admin
 *   Agents", board "One agent opened"): whose the agent is, what it may do, where it may be called
 *   from, when it was connected, and the trust score with the breakdown behind it. The fields on
 *   the left come from the list the page already has; the trust panel and the description come from
 *   GET /v1/agents/:gaii, which recomputes the score and writes it back, and the panel says so.
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @structure
 *   - AgentRecord({ agent, detail, loading, onClose, onOwner, onOrigins }) — the whole record, in
 *     the opened row's Panel
 *   - Trust — the score and the breakdown behind it
 *
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the List's Panel with its title and close door,
 *     Marks, Facts (a field's value, its line and its door), Beside, Box, Figure, Readings, Loud.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- Compose ink row boundaries from the shared poster class.
 *   v1.0.0 — 2026-09-12 — Initial, with the Agents page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Panel } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Figure } from '/components/Figure.js';
import { Readings } from '/components/Readings.js';
import { Beside, Split, Stack, Row as Line } from '/components/Layout.js';
import { kindOf, freshness, isAwake, daysSince, trustText } from './agents-tab.derive.js';
import { shortDate } from './shared.js';

const A = (key, params) => t('dashboard.agentsTab.' + key, params);

/** "2 min", "5 h", "3 d", "16 Mar" — the same reading the list column uses. */
export function seenWords(iso, now) {
  const f = freshness(iso, now);
  if (f.kind === 'never') return A('seenNever');
  if (f.kind === 'minutes') return A('seenMinutes', { n: f.n });
  if (f.kind === 'hours') return A('seenHours', { n: f.n });
  if (f.kind === 'days') return A('seenDays', { n: f.n });
  return shortDate(iso);
}

/** The scopes as tags, or the one tag that says the list carries none for this agent. */
function Scopes({ scopes }) {
  if (!scopes?.length) return html`<${Marks}><${Mark}>${A('scopesNone')}<//><//>`;
  return html`<${Marks}>${scopes.map(s => html`<${Mark} key=${s}>${s}<//>`)}<//>`;
}

/**
 * The trust panel. Everything in it is the reading taken the moment the record was opened, which
 * is what the sentence under it says: the route recomputes the score and stores it, so the number
 * the list showed a second ago and the number here can differ, and that difference is the point.
 */
function Trust({ agent, detail, loading }) {
  if (loading || !detail?.trust) {
    return html`<${Box}>
      <${Label} block>${A('trustHead')}<//>
      <${Note} kind="quiet">${A('reading')}<//>
    <//>`;
  }
  const tr = detail.trust;
  const before = agent.trust_score;
  const moved = typeof before === 'number' && before !== tr.score;
  return html`
    <${Box}>
      <${Label} block>${A('trustHead')}<//>
      <${Figure} n=${trustText(tr.score)} sub=${A('trustOf100')} />
      <${Readings} rows=${[
    { key: 'd', name: A('trustDeliveries'), value: tr.total_deliveries ?? 0 },
    { key: 's', name: A('trustSuccess'), value: tr.total_deliveries ? (tr.success_rate * 100).toFixed(0) + '%' : A('trustNoWork') },
    { key: 'r', name: A('trustRatings'), value: `+${tr.positive_ratings ?? 0} / -${tr.negative_ratings ?? 0}` },
    { key: 'a', name: A('trustAge'), value: A('trustDays', { n: tr.age_days ?? 0 }), last: true },
  ]} />
      <${Note} kind="hint">${moved ? A('trustMoved', { before: trustText(before) }) : A('trustSame')} ${A('trustCap')}<//>
    <//>`;
}

/**
 * One agent, opened in place under its row.
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
    <${Panel} title=${agent.display_name || agent.gaii.split('#')[0]}
      mark=${html`<${Action} small soft onClick=${onClose}>${A('close')} ↩<//>`}>
      <${Stack} gap="medium" below="medium">
        <${Note} kind="meta" mono>${agent.gaii}<//>
        <${Marks}>
          <${Mark} tone=${isAwake(agent, now) ? 'fine' : undefined}>${A('chipSeen', { when: seenWords(agent.last_seen, now) })}<//>
          <${Mark}>${A('kind' + kind.charAt(0).toUpperCase() + kind.slice(1))}<//>
          <${Mark} tone=${federates ? undefined : 'dim'}>${federates ? A('fedOn') : A('fedOff')}<//>
        <//>
      <//>

      <${Beside} narrow side=${html`<${Trust} agent=${agent} detail=${detail} loading=${loading} />`}>
        ${detail?.description
    ? html`<${Note} kind="lead">${detail.description}<//>`
    : html`<${Note} kind="quiet">${loading ? A('reading') : A('noDescription')}<//>`}
        <${Facts} rows=${[
    { key: 'whose', k: A('fWhose'), v: agent.owner, sub: A('fWhoseWhy'),
      action: html`<${Action} small soft onClick=${onOwner}>${A('fOpenPerson')}<//>` },
    { key: 'may', k: A('fMayDo'), v: html`<${Scopes} scopes=${agent.default_scopes} />`,
      sub: agent.default_scopes?.length ? A('fMayDoWhy') : A('fMayDoNoneWhy') },
    { key: 'from', k: A('fCalledFrom'), v: origins?.length ? origins.join(', ') : A('fAnywhere'),
      sub: origins?.length ? A('fOriginsWhy') : A('fAnywhereWhy'),
      action: html`<${Action} small soft onClick=${onOrigins}>${A('fToCors')}<//>` },
    { key: 'conn', k: A('fConnected'), v: shortDate(agent.created_at),
      sub: age !== null ? A('fConnectedWhy', { n: Math.max(0, Math.floor(age)) }) : '' },
    { key: 'pub', k: A('fPublished'), v: published ? A('fPublishedN', { n: published }) : A('fPublishedNone'),
      sub: A('fPublishedWhy') },
  ]} />
      <//>

      <${Split} heavy>
        <${Line} wrap gap="large">
          <${Loud} onClick=${onOrigins}>${A('actOrigins')}<//>
          <${Note} kind="hint" inline>${A('actOriginsWhy')}<//>
        <//>
      <//>
    <//>`;
}
