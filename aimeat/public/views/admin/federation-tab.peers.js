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
 *   v1.0.0 — 2026-09-12 — Initial (the Federation page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, dt } from './shared.js';
import PeerPolicyCell, { TierLadderLegend } from './federation-peer-policy.js';

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
  return html`
    <span class="adm-fed-may">
      ${may.length ? may.join(' · ') : html`<span class="adm-fed-maynot">${S('peers.mayNothing')}</span>`}
      ${mayNot.length ? html`<br /><span class="adm-fed-maynot">${S('peers.mayNot', { list: mayNot.join(', ') })}</span>` : null}
    </span>`;
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

export function PeerTable({ peers, overview, onActivate, onPromote, onRemove, onEmergency, onPolicy, onAdd, onTest }) {
  const newest = overview.newest_version;

  return html`
    <section class="og-sec" id="adm-fed-03">
      <div class="og-sec-h">
        <h2>${S('peers.title')}<small>03</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onAdd}>${S('peers.add')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${onTest}>${S('peers.test')}</button>
        </div>
      </div>
      <p class="adm-intro">${S('peers.lead')}</p>
      <${TierLadderLegend} />

      ${!peers.length
    ? html`<div class="adm-fed-empty">${S('peers.empty')}</div>`
    : html`<div class="adm-fed-scroll"><table class="adm-fed-tbl">
      <thead><tr>
        <th>${S('peers.colNode')}</th>
        <th>${S('peers.colState')}</th>
        <th>${S('peers.colRung')}</th>
        <th>${S('peers.colVersion')}</th>
        <th>${S('peers.colHeard')}</th>
        <th>${S('peers.colMay')}</th>
        <th>${S('peers.colChange')}</th>
        <th class="acts"></th>
      </tr></thead>
      <tbody>
        ${peers.map(p => {
      const st = stateOf(p);
      const behind = p.versions_behind;
      return html`<tr key=${p.node_id} class=${st.stuck ? 'adm-fed-row--stuck' : ''}>
            <td>
              <b class="mono">${p.node_id}</b>
              <span class="adm-fed-url">${p.url || '—'}</span>
            </td>
            <td>
              <span class="adm-fed-state adm-fed-state--${st.tone}">${st.word}</span>
              ${st.why ? html`<span class="adm-fed-sub">${st.why}</span>` : null}
            </td>
            <td data-col=${S('peers.colRung')}>${t('dashboard.fedTier_' + (p.tier || 'member')) || p.tier || 'member'}</td>
            <td class="mono" data-col=${S('peers.colVersion')}>
              ${p.software_version || '—'}
              ${behind
        ? html`<span class="adm-fed-behind">${S('peers.behind', { n: num(behind), of: newest })}</span>`
        : p.software_version && newest && p.software_version === newest
          ? html`<span class="adm-fed-same">${S('peers.newest')}</span>`
          : null}
            </td>
            <td class="adm-fed-when" data-col=${S('peers.colHeard')}>${dt(p.last_seen)}</td>
            <td><${MayDo} peer=${p} /></td>
            <td><${PeerPolicyCell} peer=${p} onUpdate=${(field, value) => onPolicy(p.node_id, field, value)} /></td>
            <td class="acts">
              ${(p.status === 'pending' || p.status === 'approved') && p.public_key
        ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => onActivate(p.node_id)}>${S('peers.switchOn')}</button>`
        : null}
              ${p.tier === 'visiting'
        ? html`<button type="button" class="og-door og-door--quiet"
            title=${p.promotion_eligible ? S('peers.promoteReady') : S('peers.promoteNotYet', { why: (p.promotion_failing || []).join(', ') })}
            onClick=${() => onPromote(p)}>${S('peers.promote')}</button>`
        : null}
              ${(p.status === 'active' || p.status === 'degraded')
        ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => onRemove(p.node_id)}>${S('peers.depeer')}</button>`
        : null}
              ${(p.status === 'active' || p.status === 'degraded' || p.status === 'offline' || p.status === 'depeering')
        ? html`<button type="button" class="og-door og-door--danger" onClick=${() => onEmergency(p.node_id)}>${S('peers.cutOff')}</button>`
        : null}
            </td>
          </tr>`;
    })}
      </tbody>
    </table></div>`}
      <p class="adm-fed-note">${S('peers.relayNote')}</p>
    </section>`;
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
    <section class="og-sec" id="adm-fed-05">
      <div class="og-sec-h">
        <h2>${S('join.title')}<small>05</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onToggleHistory}>
            ${historyOpen ? S('join.hideHistory') : S('join.showHistory', { n: num(overview.requests.history) })}
          </button>
        </div>
      </div>

      ${!pending.length
    ? html`<div class="adm-fed-empty">${S('join.none')}</div>`
    : html`<div class="og-box">
        <span class="og-box-label">${S('join.label', { n: num(pending.length) })}</span>
        ${pending.map(r => html`
          <div class="adm-fed-req" key=${r.id}>
            <div>
              <b class="mono">${r.from_node_id || r.from_node_url}</b>
              <span class="adm-fed-url">${r.from_node_url || '—'}</span>
              <p>${r.message || S('join.noMessage')}</p>
              <p>${S('join.asked', { when: dt(r.created_at), tier: t('dashboard.fedTier_' + (r.tier || 'member')) || r.tier })}</p>
            </div>
            <div class="adm-fed-reqacts">
              <button type="button" class="og-door og-door--quiet" onClick=${() => onApprove(r.id)}>${S('join.approve')}</button>
              <button type="button" class="og-door og-door--danger" onClick=${() => onReject(r.id)}>${S('join.refuse')}</button>
            </div>
          </div>`)}
      </div>`}

      ${sent.length > 0 && html`
        <div class="adm-fed-sent">
          <div class="adm-fed-lbl">${S('join.sentLabel', { n: num(sent.length) })}</div>
          <p class="adm-fed-note adm-fed-note--top">${S('join.sentWhy')}</p>
          ${sent.map(r => html`
            <div class="adm-fed-req adm-fed-req--sent" key=${r.id}>
              <div>
                <b class="mono">${r.to_node_id || r.target_url || '—'}</b>
                <span class="adm-fed-url">${r.target_url || '—'}</span>
                <p>${S('join.sentAsked', { when: dt(r.created_at) })}</p>
              </div>
              <div class="adm-fed-reqacts">
                <button type="button" class="og-door og-door--danger" onClick=${() => onDelete(r.id)}>${S('join.withdraw')}</button>
              </div>
            </div>`)}
        </div>`}

      <p class="adm-fed-note">${S('join.twoPresses')}</p>

      ${historyOpen && html`
        <div class="adm-fed-scroll adm-fed-after">
          ${!history.length
    ? html`<div class="adm-fed-empty">${S('join.historyEmpty')}</div>`
    : html`<table class="adm-fed-tbl">
        <thead><tr>
          <th>${S('join.colNode')}</th>
          <th>${S('join.colWhere')}</th>
          <th>${S('join.colOutcome')}</th>
          <th>${S('join.colWhen')}</th>
          <th class="acts"></th>
        </tr></thead>
        <tbody>
          ${history.map(r => html`<tr key=${r.id}>
            <td><b class="mono">${r.from_node_id || '—'}</b></td>
            <td class="mono">${r.target_url || r.from_node_url || '—'}</td>
            <td>${S('join.outcome_' + r.status) || r.status}</td>
            <td class="adm-fed-when">${dt(r.created_at)}</td>
            <td class="acts"><button type="button" class="og-door og-door--danger"
              onClick=${() => onDelete(r.id)}>${S('join.forget')}</button></td>
          </tr>`)}
        </tbody>
      </table>`}
        </div>`}
    </section>`;
}
