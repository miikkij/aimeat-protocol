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
 *   Extracted from federation-tab.js, which was 701 lines and would not have held this. It draws
 *   library components (Check, Select, Note, ExpandableHelp, Facts) and writes no class; the
 *   column's fixed width is the peers list's own cut (listing.css), not a rule of this file.
 * @structure
 *   - CEILING — which capabilities each tier permits (mirrors services/federation-tiers.ts)
 *   - TierLadderLegend — the four rungs and what each means, rendered ONCE above the table
 *   - PeerPolicyCell — the per-peer control group
 * @usage <${PeerPolicyCell} peer=${p} onUpdate=${(field, value) => doUpdatePolicy(p.node_id, field, value)} />
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components, no class: each capability is a Check line (a
 *     tier-locked one dimmed and disabled, its ✗ keeping the tooltip that says why), the routing
 *     switch's direction is the Check's own grey line, the mode is a Select, the ladder is the
 *     ExpandableHelp fold with the rungs as Facts. admin.css's .adm-peer-policy* and .adm-tier-ladder*
 *     rules lose their last user.
 *   v1.2.0 — 2026-09-05 — A tier-locked switch is marked ✗ with its title, not a padlock emoji: no emoji anywhere in the interface.
 *   v1.1.0 — 2026-09-03 — The routing switch carries a sentence saying which way it points, and is
 *     labelled "Relay to this peer". Every other switch here answers "may this peer do X on my
 *     node"; that one alone points outward, and nothing said so.
 *   v1.0.0 — 2026-08-23 — Initial, with the contact tier.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Stack, Split } from '/components/Layout.js';
import { ExpandableHelp } from './shared.js';

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
  // The only one that needs its direction spelled out. Every other switch here answers "may this
  // peer do X on my node"; this one says whether MY node forwards to them. An operator who turns it
  // off expecting to shut that peer out has changed nothing about what arrives — measured on two
  // local nodes 2026-09-02.
  { field: 'allow_routing', label: 'fedAllowRouting', hint: 'fedAllowRoutingHint' },
  { field: 'allow_federated_auth', label: 'fedAllowAuth' },
];

/**
 * The ladder, stated once above the table.
 *
 * It was a sentence inside every row first. That repeated the same prose per peer AND widened the
 * policy column until the table ran past its scroll container and cut the sentence mid-word — the
 * page reported no overflow the whole time, because the table scrolls inside its own box. What a
 * tier MEANS is a property of the system; which rung a peer is on is the property of the row.
 * Folded by default: an operator who knows the tiers does not need to re-read them.
 */
export function TierLadderLegend() {
  return html`
    <${ExpandableHelp} title=${t('dashboard.fedTierLadderTitle')}>
      <${Facts} rows=${['contact', 'visiting', 'member', 'genesis'].map(tier => ({
        key: tier, k: t(`dashboard.fedTier_${tier}`), v: t(`dashboard.fedTierMeaning_${tier}`),
      }))} />
    <//>`;
}

export default function PeerPolicyCell({ peer, onUpdate }) {
  const tier = peer.tier || 'member';
  const ceiling = CEILING[tier] || CEILING.member;

  return html`
    <${Stack} gap="none">
      ${CAPABILITIES.map(cap => {
    // Absent means true for everything a peer written before these words existed could already do.
    const on = cap.field === 'allow_federated_auth' ? !!peer[cap.field] : peer[cap.field] !== false;
    const allowed = ceiling[cap.field];
    return html`
          <${Check} key=${cap.field} checked=${on && allowed} disabled=${!allowed}
            hint=${cap.hint ? t(`dashboard.${cap.hint}`) : undefined}
            onChange=${(checked) => onUpdate(cap.field, checked)}>
            ${t(`dashboard.${cap.label}`)}
            ${!allowed && html` <${Note} kind="meta" inline title=${t('dashboard.fedTierLocked')}>✗<//>`}
          <//>`;
  })}

      <${Select} fit value=${peer.peer_mode || 'federation'} disabled=${!!ceiling.peer_mode}
        onChange=${(v) => onUpdate('peer_mode', v)}
        options=${[['federation', t('dashboard.fedPeerModeFederation')], ['private', t('dashboard.fedPeerModePrivate')]]} />

      ${/* Support routing is not a capability, it is a decision about where people's help requests
            go: the hairline above it keeps it from reading as a seventh permission. */''}
      <${Split} above="small" pad="small">
        <${Check} checked=${!!peer.support_upstream} disabled=${peer.allow_messaging === false}
          onChange=${(checked) => onUpdate('support_upstream', checked)}>
          ${t('dashboard.fedSupportUpstream')}
        <//>
        ${peer.support_upstream && html`<${Note} kind="meta">${t('dashboard.fedSupportUpstreamOn')}<//>`}
      <//>
    <//>`;
}
