/**
 * @file federation-peer-policy.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one peer may do here, as a rung on a ladder rather than a row of checkboxes.
 *
 *   Federation is not one decision, and presenting it as a grid of independent switches was making
 *   it look like one. A peer sits on a tier — contact < visiting < member < genesis — and the tier
 *   decides which capabilities are even available; an operator may always turn one OFF, and may only
 *   turn one ON where the tier already allows it.
 *
 *   THE CLAMP HAS TO BE VISIBLE. The server holds every edit to the tier's ceiling, so a checkbox
 *   that offers catalogue sharing on a `contact` peer would tick, save, and come back unticked on the
 *   next load. That reads as a broken screen rather than as a rule. A capability the tier forbids is
 *   disabled and says why.
 *
 *   Extracted from federation-tab.js, which was 701 lines and would not have held this.
 * @structure
 *   - CEILING — which capabilities each tier permits (mirrors services/federation-tiers.ts)
 *   - TierLadderLegend — the four rungs and what each means, rendered ONCE above the table
 *   - PeerPolicyCell — the per-peer control group
 * @usage <${PeerPolicyCell} peer=${p} onUpdate=${(field, value) => doUpdatePolicy(p.node_id, field, value)} />
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, with the contact tier.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/**
 * What each tier may be raised to. The mirror of tierCeiling() in services/federation-tiers.ts —
 * the server is the authority and clamps regardless, so a drift here costs a misleading control
 * rather than a permission.
 */
const CEILING = {
  contact: { share_catalogue: false, replicate_memory: false, allow_routing: false, allow_messaging: true, allow_broadcast: false, allow_settlement: false, allow_federated_auth: false, peer_mode: 'private' },
  visiting: { share_catalogue: true, replicate_memory: false, allow_routing: false, allow_messaging: true, allow_broadcast: true, allow_settlement: true, allow_federated_auth: false, peer_mode: null },
  member: { share_catalogue: true, replicate_memory: true, allow_routing: true, allow_messaging: true, allow_broadcast: true, allow_settlement: true, allow_federated_auth: true, peer_mode: null },
  genesis: { share_catalogue: true, replicate_memory: true, allow_routing: true, allow_messaging: true, allow_broadcast: true, allow_settlement: true, allow_federated_auth: true, peer_mode: null },
};

/** The capabilities, in the order they escalate. */
const CAPABILITIES = [
  { field: 'allow_messaging', label: 'fedAllowMessaging' },
  { field: 'share_catalogue', label: 'fedShareCatalogue' },
  { field: 'allow_broadcast', label: 'fedAllowBroadcast' },
  { field: 'allow_settlement', label: 'fedAllowSettlement' },
  { field: 'replicate_memory', label: 'fedReplicateMemory' },
  { field: 'allow_routing', label: 'fedAllowRouting' },
  { field: 'allow_federated_auth', label: 'fedAllowAuth' },
];

/**
 * The ladder, stated once above the table.
 *
 * It was a sentence inside every row first. That repeated the same prose per peer AND widened the
 * policy column until the table ran past its scroll container and cut the sentence mid-word — the
 * page reported no overflow the whole time, because the table scrolls inside its own box. What a
 * tier MEANS is a property of the system; which rung a peer is on is the property of the row.
 */
export function TierLadderLegend() {
  return html`
    <details class="adm-tier-ladder">
      <summary>${t('dashboard.fedTierLadderTitle')}</summary>
      <dl class="adm-tier-ladder-list">
        ${['contact', 'visiting', 'member', 'genesis'].map(tier => html`
          <div class="adm-tier-ladder-row" key=${tier}>
            <dt>${t(`dashboard.fedTier_${tier}`)}</dt>
            <dd>${t(`dashboard.fedTierMeaning_${tier}`)}</dd>
          </div>`)}
      </dl>
    </details>`;
}

export default function PeerPolicyCell({ peer, onUpdate }) {
  const tier = peer.tier || 'member';
  const ceiling = CEILING[tier] || CEILING.member;

  return html`
    <div class="adm-peer-policy">

      ${CAPABILITIES.map(cap => {
    // Absent means true for everything a peer written before these words existed could already do.
    const on = cap.field === 'allow_federated_auth' ? !!peer[cap.field] : peer[cap.field] !== false;
    const allowed = ceiling[cap.field];
    return html`
          <label class="adm-text-sm adm-peer-policy-row" key=${cap.field}>
            <input
              type="checkbox"
              checked=${on && allowed}
              disabled=${!allowed}
              onChange=${(e) => onUpdate(cap.field, e.target.checked)}
            />
            <span class=${allowed ? '' : 'adm-text-dim'}>${t(`dashboard.${cap.label}`)}</span>
            ${!allowed && html`<span class="adm-peer-policy-locked" title=${t('dashboard.fedTierLocked')}>\u{1F512}</span>`}
          </label>`;
  })}

      <select
        class="adm-input adm-peer-policy-mode"
        value=${peer.peer_mode || 'federation'}
        disabled=${!!ceiling.peer_mode}
        onChange=${(e) => onUpdate('peer_mode', e.target.value)}
      >
        <option value="federation">${t('dashboard.fedPeerModeFederation')}</option>
        <option value="private">${t('dashboard.fedPeerModePrivate')}</option>
      </select>

      <label class="adm-text-sm adm-peer-policy-row adm-peer-policy-support">
        <input
          type="checkbox"
          checked=${!!peer.support_upstream}
          disabled=${peer.allow_messaging === false}
          onChange=${(e) => onUpdate('support_upstream', e.target.checked)}
        />
        <span>${t('dashboard.fedSupportUpstream')}</span>
      </label>
      ${peer.support_upstream && html`
        <p class="adm-peer-policy-note">${t('dashboard.fedSupportUpstreamOn')}</p>
      `}
    </div>`;
}
