/**
 * @file src/services/core-discovery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What discovery says about the protocol this node conforms to (Core 2026-11 §11.6,
 *   DISC-01, DISC-02, DISC-05, PACE-21; ruling decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l
 *   Q2). GET /.well-known/aimeat and the bootstrap document's `this_node` read the same function, so
 *   the two cannot disagree.
 *
 *   THE EDITION FOLLOWS THE RELEASE. Core 2026-11 becomes normative with node 4.0.0
 *   (CORE_PROTOCOL_FROM). From that release discovery states `protocol_version: "2026-11"` and the
 *   profiles the node claims. Before it the two fields are left out: a 3.x node meets most of the
 *   edition but not its removals (they are what 4.0.0 turns on), so stating `2026-11` would be a
 *   claim the node does not keep, and there is no earlier dated edition for it to name. A reader
 *   that finds no `protocol_version` reads the node as one that states none, which is what every
 *   node before this field was.
 *
 *   NO `protocol_versions_accepted`. DISC-02 asks for it only from a node that accepts messages from
 *   peers on an earlier edition. No earlier edition has a dated name, and a 3.x peer states no protocol
 *   version, so there is nothing to list; the field stays out until there is.
 *
 *   The payment bindings (PACE-21) and the MCP endpoint (DISC-01) are stated in every release: they
 *   describe what this node serves now.
 *   A CLAIM CARRIES ITS OPEN REQUIREMENTS. Core §0.3 lets a node claim a profile while one of its
 *   MUSTs is open only when the node lists that requirement in discovery (`profile_gaps`) and in its
 *   evidence file; a client reads a listed requirement as not met. CORE_OPEN_REQUIREMENTS is that
 *   list, and test/unit/core-open-requirements.test.ts holds it to the open rows of
 *   docs/AIMEAT-Core-2026-11-evidence.md, so the claim and the evidence cannot say two things.
 * @structure CORE_PROTOCOL_FROM · CORE_PROFILES · CORE_OPEN_REQUIREMENTS · claimedProfiles(config) ·
 *   profileGaps(profiles) · paymentBindings(config) · coreDiscoveryFields(config, version?)
 * @usage
 *   res.json(success(config.nodeId, { node_id, ..., ...coreDiscoveryFields(config) }));
 * @version-history
 *   v1.1.0 — 2026-10-16 — `profile_gaps`: the open requirements of each claimed profile, from CORE_OPEN_REQUIREMENTS (QA audit D3-06).
 *   v1.0.0 — 2026-10-12 — Initial (wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery).
 */
import type { AimeatConfig } from '../config.js';
import { getSoftwareVersion, versionAtLeast } from '../utils/version.js';
import { CORE_PROTOCOL_VERSION } from '../utils/protocol-version.js';

/** The release from which this node states Core 2026-11 in discovery. */
export const CORE_PROTOCOL_FROM = '4.0.0';

/** The profiles of Core 2026-11 §0.3, by the names the edition gives them. */
export const CORE_PROFILES = [
  'Base', 'MCP', 'Collaboration', 'Pacing', 'Transparency', 'Federation', 'Agent Keys', 'Personal Node', 'Classification',
] as const;
export type CoreProfile = typeof CORE_PROFILES[number];

/**
 * The Core 2026-11 requirements this node does not meet yet, by the profile whose sections hold them.
 * The same ids are the open rows of the list at the end of docs/AIMEAT-Core-2026-11-evidence.md,
 * each with the wish that carries its fix. Closing one means deleting it here and marking its row
 * closed there, in the same change (test/unit/core-open-requirements.test.ts).
 */
export const CORE_OPEN_REQUIREMENTS: Readonly<Partial<Record<CoreProfile, readonly string[]>>> = {
  Base: ['ID-11', 'AUTH-06', 'DATA-06', 'HTTP-01', 'HTTP-02', 'DISC-03'],
  Pacing: ['PACE-05', 'PACE-11'],
  Federation: ['FED-06', 'FED-16'],
};

/** The open requirements of each of `profiles` that has any, for discovery's `profile_gaps`. */
export function profileGaps(profiles: readonly CoreProfile[]): Partial<Record<CoreProfile, string[]>> {
  const out: Partial<Record<CoreProfile, string[]>> = {};
  for (const p of profiles) {
    const open = CORE_OPEN_REQUIREMENTS[p];
    if (open && open.length > 0) out[p] = [...open];
  }
  return out;
}

/**
 * The profiles this node claims. The reference node claims every profile (Full Node, Agent Keys,
 * Personal Node and Classification, §0.3). Personal Node is claimed by a personal node and by a
 * node that serves personal nodes; another node does neither.
 */
export function claimedProfiles(config: Pick<AimeatConfig, 'nodeType' | 'personalNodesEnabled'>): CoreProfile[] {
  const personal = config.nodeType === 'personal' || config.personalNodesEnabled;
  return CORE_PROFILES.filter(p => p !== 'Personal Node' || personal);
}

/**
 * The payment bindings of §8.6 this node accepts, by their binding names. None while commerce is off.
 * Stripe (on the seller's own account) and invoice are registered on every node; the UCP and ACP
 * checkouts are served with commerce; x402 only when the operator turned it on.
 */
export function paymentBindings(config: Pick<AimeatConfig, 'commerceEnabled' | 'x402Enabled'>): string[] {
  if (!config.commerceEnabled) return [];
  return ['stripe', 'invoice', 'ucp', 'acp', ...(config.x402Enabled ? ['x402'] : [])];
}

/** The fields discovery and the bootstrap document's `this_node` carry about the protocol. */
export function coreDiscoveryFields(
  config: Pick<AimeatConfig, 'nodeType' | 'personalNodesEnabled' | 'commerceEnabled' | 'x402Enabled'>,
  version: string = getSoftwareVersion(),
): { protocol_version?: string; profiles?: CoreProfile[]; profile_gaps?: Partial<Record<CoreProfile, string[]>>; payment_bindings: string[] } {
  const states = versionAtLeast(version, CORE_PROTOCOL_FROM);
  const profiles = claimedProfiles(config);
  return {
    ...(states ? { protocol_version: CORE_PROTOCOL_VERSION, profiles, profile_gaps: profileGaps(profiles) } : {}),
    payment_bindings: paymentBindings(config),
  };
}
