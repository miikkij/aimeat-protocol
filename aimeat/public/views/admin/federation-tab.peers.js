/**
 * @file federation-tab.peers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 03 and 05 of the Federation page: the peers, and the nodes asking to join.
 *
 *   THE STATE COLUMN SAYS WHAT TO DO, not what the database calls it. `pending` and `approved` are
 *   two doors' words for the same thing — added, not switched on — and a peer with no verification
 *   key cannot be switched on at all, because nothing it sends could be checked. Both used to read
 *   as a status badge with a word from the schema in it.
 *
 *   BEHIND WHAT, AND BY HOW MUCH. The baseline is the newest version anywhere in the federation,
 *   this node included, so a peer can be behind the operator's own build. The page used to compare
 *   against the highest version among live peers alone.
 *
 *   THE TIER LADDER AND THE PER-PEER SWITCHES ARE NOT REBUILT. That control was written on
 *   2026-08-23 and corrected on 2026-09-03, it explains its own clamp, and the row's summary reads
 *   out of the same flags rather than replacing it: the summary is what a peer may do, the panel is
 *   where it is changed. → federation-peer-policy.js
 * @structure
 *   - PeerTable (03) — one row per peer, with the policy cell kept as it was
 *   - AskingToJoin (05) — the pending requests, and the door to the history
 * @usage Imported by views/admin/federation-tab.js.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the peers and the history as shared
 *     tables (stacking on a phone), the state as a toned chip, requests as list rows in the aside.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v1.0.0 — 2026-09-12 — Initial (the Federation page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, dt } from './shared.js';
import PeerPolicyCell, { TierLadderLegend } from './federation-peer-policy.js';
import { Section, Stack, ListRow, Table, Chip, Action, Surface, Text } from '/components/poster-parts.js';

const S = (key, params) => t('admin.fed.' + key, params);

/** The capabilities a row summarises, in the order the ladder escalates them. */
const MAY = [
  ['allow_messaging', 'messaging'],
  ['share_catalogue', 'catalogue'],
  ['allow_broadcast', 'broadcast'],
  ['allow_settlement', 'settle'],
  ['replicate_memory', 'replicate'],
  ['allow_routing', 'relay'],
  ['allow_federated_auth', 'signin'],
];

/**
 * What this peer may do here, and what it may not, in one cell.
 *
 * Reading the SAME flags the policy panel writes: this is the summary, that is the control. A row
 * that only listed what was allowed could not be told apart from a row with nothing allowed.
 */
function MayDo({ peer }) {
  const may = MAY.filter(([f]) => peer[f] === true).map(([, w]) => S('peers.may_' + w));
  const mayNot = MAY.filter(([f]) => peer[f] !== true).map(([, w]) => S('peers.may_' + w));
  return html`<${Stack} density="compact">
    ${may.length ? html`<span>${may.join(' · ')}</span>` : html`<${Text} kind="caption" tone="muted">${S('peers.mayNothing')}<//>`}
    ${mayNot.length ? html`<${Text} kind="caption" tone="muted">${S('peers.mayNot', { list: mayNot.join(', ') })}<//>` : null}
  <//>`;
}

/** The state word, chosen by what the operator would do about it rather than by the schema. */
function stateOf(p) {
  if (!p.public_key) return { word: S('peers.state_nokey'), why: S('peers.stateWhy_nokey'), tone: 'danger', stuck: true };
  if (p.status === 'pending' || p.status === 'approved') {
    return { word: S('peers.state_awaiting'), why: S('peers.stateWhy_awaiting'), tone: 'coral', stuck: true };
  }
  if (p.status === 'active') return { word: S('peers.state_active'), why: S('peers.stateWhy_active', { at: dt(p.added_at) }), tone: 'success' };
  if (p.status === 'degraded') return { word: S('peers.state_degraded'), why: S('peers.stateWhy_degraded'), tone: 'coral' };
  if (p.status === 'offline') return { word: S('peers.state_offline'), why: S('peers.stateWhy_offline'), tone: 'danger' };
  if (p.status === 'depeering') return { word: S('peers.state_leaving'), why: S('peers.stateWhy_leaving', { at: dt(p.depeer_grace_end) }), tone: 'danger' };
  return { word: p.status || '—', why: null, tone: 'plain' };
}

export function PeerTable({ peers, overview, onActivate, onPromote, onRemove, onEmergency, onPolicy, onAdd, onTest }) {
  const newest = overview.newest_version;

  return html`<${Section} id="adm-fed-03" title=${S('peers.title')} count="03" description=${S('peers.lead')}
    actions=${html`<${Action} onClick=${onAdd}>${S('peers.add')}<//><${Action} onClick=${onTest}>${S('peers.test')}<//>`}>
    <${Stack}>
      <${TierLadderLegend} />

      ${!peers.length
        ? html`<${Text} tone="muted">${S('peers.empty')}<//>`
        : html`<${Table} collapse=${900} label=${S('peers.title')}
          headers=${[S('peers.colNode'), S('peers.colState'), S('peers.colRung'), S('peers.colVersion'), S('peers.colHeard'), S('peers.colMay'), S('peers.colChange'), '']}
          rows=${peers.map(p => {
            const st = stateOf(p);
            const behind = p.versions_behind;
            return [
              html`<${Stack} density="compact"><${Text} kind="mono">${p.node_id}<//><${Text} kind="caption" tone="muted">${p.url || '—'}<//><//>`,
              html`<${Stack} density="compact"><span><${Chip} tone=${st.tone}>${st.word}<//></span>
                ${st.why ? html`<${Text} kind="caption" tone="muted">${st.why}<//>` : null}<//>`,
              t('dashboard.fedTier_' + (p.tier || 'member')) || p.tier || 'member',
              html`<${Stack} density="compact"><${Text} kind="mono">${p.software_version || '—'}<//>
                ${behind
                  ? html`<${Text} kind="caption" tone="coral">${S('peers.behind', { n: num(behind), of: newest })}<//>`
                  : p.software_version && newest && p.software_version === newest
                    ? html`<${Text} kind="caption" tone="success">${S('peers.newest')}<//>`
                    : null}<//>`,
              { text: dt(p.last_seen), mono: true },
              html`<${MayDo} peer=${p} />`,
              html`<${PeerPolicyCell} peer=${p} onUpdate=${(field, value) => onPolicy(p.node_id, field, value)} />`,
              html`<${Stack} density="compact">
                ${(p.status === 'pending' || p.status === 'approved') && p.public_key
                  ? html`<${Action} onClick=${() => onActivate(p.node_id)}>${S('peers.switchOn')}<//>`
                  : null}
                ${p.tier === 'visiting'
                  ? html`<${Action} title=${p.promotion_eligible ? S('peers.promoteReady') : S('peers.promoteNotYet', { why: (p.promotion_failing || []).join(', ') })}
                      onClick=${() => onPromote(p)}>${S('peers.promote')}<//>`
                  : null}
                ${(p.status === 'active' || p.status === 'degraded')
                  ? html`<${Action} onClick=${() => onRemove(p.node_id)}>${S('peers.depeer')}<//>`
                  : null}
                ${(p.status === 'active' || p.status === 'degraded' || p.status === 'offline' || p.status === 'depeering')
                  ? html`<${Action} tone="danger" onClick=${() => onEmergency(p.node_id)}>${S('peers.cutOff')}<//>`
                  : null}
              <//>`,
            ];
          })} />`}
      <${Text} kind="caption" tone="muted">${S('peers.relayNote')}<//>
    <//>
  <//>`;
}

/**
 * Section 05: who is asking to join, and what approving actually does.
 *
 * A REQUEST HAS A DIRECTION and one table holds both. A row this node SENT — we asked somebody
 * else — was rendered here as an arrival with Approve and Refuse beside it, naming this node as
 * the asker. Nothing about it is waiting on the operator: it is waiting on them.
 */
export function AskingToJoin({ overview, historyOpen, onToggleHistory, history, onApprove, onReject, onDelete }) {
  const pending = overview.requests.pending;
  const sent = overview.requests.sent || [];

  return html`<${Section} id="adm-fed-05" title=${S('join.title')} count="05"
    actions=${html`<${Action} expanded=${historyOpen} onClick=${onToggleHistory}>
      ${historyOpen ? S('join.hideHistory') : S('join.showHistory', { n: num(overview.requests.history) })}<//>`}>
    <${Stack}>
      ${!pending.length
        ? html`<${Text} tone="muted">${S('join.none')}<//>`
        : html`<${Surface} kind="aside"><${Stack} density="compact">
          <${Text} kind="label">${S('join.label', { n: num(pending.length) })}<//>
          <div>${pending.map(r => html`<${ListRow} key=${r.id} name=${r.from_node_id || r.from_node_url} detail=${r.from_node_url || '—'}
            actions=${html`<${Action} tone="success" onClick=${() => onApprove(r.id)}>${S('join.approve')}<//>
              <${Action} tone="danger" onClick=${() => onReject(r.id)}>${S('join.refuse')}<//>`}>
            <${Stack} density="compact">
              <${Text}>${r.message || S('join.noMessage')}<//>
              <${Text} kind="caption" tone="muted">${S('join.asked', { when: dt(r.created_at), tier: t('dashboard.fedTier_' + (r.tier || 'member')) || r.tier })}<//>
            <//>
          <//>`)}</div>
        <//><//>`}

      ${sent.length > 0 && html`<${Stack} density="compact">
        <${Text} kind="label">${S('join.sentLabel', { n: num(sent.length) })}<//>
        <${Text} kind="caption" tone="muted">${S('join.sentWhy')}<//>
        <div>${sent.map(r => html`<${ListRow} key=${r.id} muted=${true} name=${r.to_node_id || r.target_url || '—'} detail=${r.target_url || '—'}
          actions=${html`<${Action} tone="danger" onClick=${() => onDelete(r.id)}>${S('join.withdraw')}<//>`}>
          <${Text} kind="caption" tone="muted">${S('join.sentAsked', { when: dt(r.created_at) })}<//>
        <//>`)}</div>
      <//>`}

      <${Text} kind="caption" tone="muted">${S('join.twoPresses')}<//>

      ${historyOpen && (!history.length
        ? html`<${Text} tone="muted">${S('join.historyEmpty')}<//>`
        : html`<${Table} collapse=${640} label=${S('join.title')}
          headers=${[S('join.colNode'), S('join.colWhere'), S('join.colOutcome'), S('join.colWhen'), '']}
          rows=${history.map(r => [
            { text: r.from_node_id || '—', mono: true },
            { text: r.target_url || r.from_node_url || '—', mono: true },
            S('join.outcome_' + r.status) || r.status,
            { text: dt(r.created_at), mono: true },
            html`<${Action} tone="danger" onClick=${() => onDelete(r.id)}>${S('join.forget')}<//>`,
          ])} />`)}
    <//>
  <//>`;
}
