/**
 * @file federation-tab.peers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 03 and 05 of the Federation page: the peers, and the nodes asking to join.
 *   The sections draw library components and pass them data; they write no class.
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
 *
 *   A STUCK ROW IS MARKED WITH A RULE, NOT A FILL (main's admin-federation.css): a peer that cannot
 *   carry anything yet wears the List's warn rail at its start, on the same ground as every other row.
 * @structure
 *   - PeerTable (03) — one row per peer, with the policy cell kept as it was
 *   - AskingToJoin (05) — the pending requests, and the door to the history
 * @usage Imported by views/admin/federation-tab.js.
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components, no class: the peers, the requests and the history
 *     are Lists (each cell says its column on a narrow screen; the peers turn into one block each at
 *     1100px, as before), the state and the version keep their status colours as Tinted words, the
 *     empty lines are quiet notes, the requests stand in the settings box.
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
import { Section } from '/components/Section.js';
import { List, Row as ListRow, Name, Desc, Cell, When, Doors } from '/components/List.js';
import { Tinted } from '/components/Figure.js';
import { Action } from '/components/Action.js';
import { SettingBox } from '/components/Box.js';
import { Split, Space } from '/components/Layout.js';
import { Note } from '/components/Note.js';
import { Label } from '/components/Mark.js';

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

/** The state words' tones: fine, needs a look, or bad. */
const TONE = { good: 'fine', wait: 'warn', bad: 'danger' };

/**
 * What this peer may do here, and what it may not, in one cell.
 *
 * Reading the SAME flags the policy panel writes: this is the summary, that is the control. A row
 * that only listed what was allowed could not be told apart from a row with nothing allowed.
 */
function MayDo({ peer }) {
  const may = MAY.filter(([f]) => peer[f] === true).map(([, w]) => S('peers.may_' + w));
  const mayNot = MAY.filter(([f]) => peer[f] !== true).map(([, w]) => S('peers.may_' + w));
  return html`
    <${Desc} sub=${mayNot.length ? S('peers.mayNot', { list: mayNot.join(', ') }) : undefined}>
      ${may.length ? may.join(' · ') : html`<${Tinted} tone="dim">${S('peers.mayNothing')}<//>`}
    <//>`;
}

/** The state word, chosen by what the operator would do about it rather than by the schema. */
function stateOf(p) {
  if (!p.public_key) return { word: S('peers.state_nokey'), why: S('peers.stateWhy_nokey'), tone: 'bad', stuck: true };
  if (p.status === 'pending' || p.status === 'approved') {
    return { word: S('peers.state_awaiting'), why: S('peers.stateWhy_awaiting'), tone: 'wait', stuck: true };
  }
  if (p.status === 'active') return { word: S('peers.state_active'), why: S('peers.stateWhy_active', { at: dt(p.added_at) }), tone: 'good' };
  if (p.status === 'degraded') return { word: S('peers.state_degraded'), why: S('peers.stateWhy_degraded'), tone: 'wait' };
  if (p.status === 'offline') return { word: S('peers.state_offline'), why: S('peers.stateWhy_offline'), tone: 'bad' };
  if (p.status === 'depeering') return { word: S('peers.state_leaving'), why: S('peers.stateWhy_leaving', { at: dt(p.depeer_grace_end) }), tone: 'bad' };
  return { word: p.status || '—', why: null, tone: '' };
}

/** A version, how far behind the newest it is (in the warn colour), or that it is the newest. */
function Version({ version, behind, newest }) {
  const same = !behind && version && newest && version === newest;
  return html`
    <${Cell} meta sub=${same ? S('peers.newest') : undefined}>
      ${version || '—'}
      ${behind ? html` <${Tinted} strong tone="warn">${S('peers.behind', { n: num(behind), of: newest })}<//>` : null}
    <//>`;
}

export function PeerTable({ peers, overview, onActivate, onPromote, onRemove, onEmergency, onPolicy, onAdd, onTest }) {
  const newest = overview.newest_version;

  return html`
    <${Section} id="adm-fed-03" num="03" title=${S('peers.title')}
      doors=${html`
        <${Action} small soft onClick=${onAdd}>${S('peers.add')}<//>
        <${Action} small soft onClick=${onTest}>${S('peers.test')}<//>`}>
      <${Note} kind="lead">${S('peers.lead')}<//>
      <${TierLadderLegend} />

      <${List} cols="name-state-kind-code-when-desc-edit-doors" labels empty=${S('peers.empty')}
        head=${[S('peers.colNode'), S('peers.colState'), S('peers.colRung'), S('peers.colVersion'),
          S('peers.colHeard'), S('peers.colMay'), S('peers.colChange'), '']}>
        ${peers.map(p => {
    const st = stateOf(p);
    return html`
          <${ListRow} key=${p.node_id} rail=${st.stuck ? 'warn' : undefined}>
            <${Name} asKey meta=${p.url || '—'}>${p.node_id}<//>
            <${Desc} sub=${st.why || undefined}>
              <${Tinted} strong tone=${TONE[st.tone]}>${st.word}<//>
            <//>
            <${Desc}>${t('dashboard.fedTier_' + (p.tier || 'member')) || p.tier || 'member'}<//>
            <${Version} version=${p.software_version} behind=${p.versions_behind} newest=${newest} />
            <${When}>${dt(p.last_seen)}<//>
            <${MayDo} peer=${p} />
            <${Cell}><${PeerPolicyCell} peer=${p} onUpdate=${(field, value) => onPolicy(p.node_id, field, value)} /><//>
            <${Doors}>
              ${(p.status === 'pending' || p.status === 'approved') && p.public_key
      ? html`<${Action} small soft onClick=${() => onActivate(p.node_id)}>${S('peers.switchOn')}<//>`
      : null}
              ${p.tier === 'visiting'
      ? html`<${Action} small soft
                  title=${p.promotion_eligible ? S('peers.promoteReady') : S('peers.promoteNotYet', { why: (p.promotion_failing || []).join(', ') })}
                  onClick=${() => onPromote(p)}>${S('peers.promote')}<//>`
      : null}
              ${(p.status === 'active' || p.status === 'degraded')
      ? html`<${Action} small soft onClick=${() => onRemove(p.node_id)}>${S('peers.depeer')}<//>`
      : null}
              ${(p.status === 'active' || p.status === 'degraded' || p.status === 'offline' || p.status === 'depeering')
      ? html`<${Action} small tone="danger" onClick=${() => onEmergency(p.node_id)}>${S('peers.cutOff')}<//>`
      : null}
            <//>
          <//>`;
  })}
      <//>
      <${Note}>${S('peers.relayNote')}<//>
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

  return html`
    <${Section} id="adm-fed-05" num="05" title=${S('join.title')}
      doors=${html`<${Action} small soft expanded=${!!historyOpen} onClick=${onToggleHistory}>
        ${historyOpen ? S('join.hideHistory') : S('join.showHistory', { n: num(overview.requests.history) })}
      <//>`}>

      ${!pending.length
    ? html`<${Note} kind="quiet">${S('join.none')}<//>`
    : html`<${SettingBox} label=${S('join.label', { n: num(pending.length) })}>
        <${List} cols="name-doors">
          ${pending.map(r => html`
            <${ListRow} key=${r.id}>
              <${Name} asKey meta=${r.from_node_url || '—'}
                desc=${[r.message || S('join.noMessage'), S('join.asked', { when: dt(r.created_at), tier: t('dashboard.fedTier_' + (r.tier || 'member')) || r.tier })]}>
                ${r.from_node_id || r.from_node_url}
              <//>
              <${Doors}>
                <${Action} small soft onClick=${() => onApprove(r.id)}>${S('join.approve')}<//>
                <${Action} small tone="danger" onClick=${() => onReject(r.id)}>${S('join.refuse')}<//>
              <//>
            <//>`)}
        <//>
      <//>`}

      ${sent.length > 0 && html`
        <${Split} above="large">
          <${Label} block>${S('join.sentLabel', { n: num(sent.length) })}<//>
          <${Note}>${S('join.sentWhy')}<//>
          <${List} cols="name-doors">
            ${sent.map(r => html`
              <${ListRow} key=${r.id} faded>
                <${Name} asKey meta=${r.target_url || '—'} desc=${S('join.sentAsked', { when: dt(r.created_at) })}>
                  ${r.to_node_id || r.target_url || '—'}
                <//>
                <${Doors}>
                  <${Action} small tone="danger" onClick=${() => onDelete(r.id)}>${S('join.withdraw')}<//>
                <//>
              <//>`)}
          <//>
        <//>`}

      <${Note}>${S('join.twoPresses')}<//>

      ${historyOpen && html`
        <${Space} above="large">
          <${List} cols="name-code-state-when-doors" labels empty=${S('join.historyEmpty')}
            head=${[S('join.colNode'), S('join.colWhere'), S('join.colOutcome'), S('join.colWhen'), '']}>
            ${history.map(r => html`
              <${ListRow} key=${r.id}>
                <${Name} asKey>${r.from_node_id || '—'}<//>
                <${Cell} meta>${r.target_url || r.from_node_url || '—'}<//>
                <${Desc}>${S('join.outcome_' + r.status) || r.status}<//>
                <${When}>${dt(r.created_at)}<//>
                <${Doors}><${Action} small tone="danger" onClick=${() => onDelete(r.id)}>${S('join.forget')}<//><//>
              <//>`)}
          <//>
        <//>`}
    <//>`;
}
