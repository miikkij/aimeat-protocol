/**
 * @file src/config-federation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's federation settings read from the environment: how many hops a relay may
 *   take, whether a relayed request must carry a signed relay claim, whether a message from another
 *   node must name this node as its audience, how long a de-peered node keeps its grace, and how
 *   often the peer key cache is refreshed.
 *
 *   Its own file for the same reason config-decide.ts is one: config.ts is at the line ceiling, and
 *   these five answer one question, how this node deals with its peers.
 *
 *   `federation.relay_claim` is `required` unless the environment says `optional` (any other value
 *   reads as `required`). An explicit `optional` is taken until RELAY_CLAIM_OPTIONAL_REMOVED_IN and
 *   has no effect from it; until then one peer can keep its own answer (services/relay-claim-policy.ts).
 *
 *   `federation.audience_required` follows the running version when the environment does not set it:
 *   off before AUDIENCE_REQUIRED_BY_DEFAULT_IN, on from it. `true` or `false` in the environment wins
 *   until UNPROVEN_FORMAT_REMOVED_IN, when a message without the proof stops being a format at all
 *   and the setting is on whatever the environment says (services/signed-node-request.ts asks the
 *   version again). A peer that has once sent the proof is held to it whatever this says
 *   (deliveryProofAt on the peer).
 * @structure FederationConfig · AUDIENCE_REQUIRED_BY_DEFAULT_IN · UNPROVEN_FORMAT_REMOVED_IN ·
 *   RELAY_CLAIM_OPTIONAL_REMOVED_IN · audienceRequiredByDefault(version?) · unprovenFormatLive(version?) ·
 *   relayClaimOptionalLive(version?) · federationDefaults()
 * @usage
 *   import { federationDefaults } from './config-federation.js';
 *   const config = { ...federationDefaults(), ... };
 * @version-history
 *   v1.2.0 — 2026-10-12 — The two 4.0.0 removals are version gates (Core 2026-11 FED-09, FED-10,
 *     HTTP-08): from UNPROVEN_FORMAT_REMOVED_IN the audience is required whatever the environment
 *     says, and from RELAY_CLAIM_OPTIONAL_REMOVED_IN (moved here from services/relay-claim-policy.ts,
 *     which re-exports it) `optional` reads as `required`. versionAtLeast comes from utils/version.ts.
 *   v1.1.0 — 2026-10-10 — federationAudienceRequired moved here from config.ts, with its default
 *     following the version (AUDIENCE_REQUIRED_BY_DEFAULT_IN 3.27.0) and the end of the unproven
 *     format named (UNPROVEN_FORMAT_REMOVED_IN 4.0.0); the 3.27.0 flip had been a comment only
 *     (secaudit 2026-10-10 I22).
 *   v1.0.0 — 2026-09-29 — Moved out of config.ts unchanged, except that the relay-claim default is
 *     `required` from 3.20.0 (RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN).
 */
import { getSoftwareVersion, versionAtLeast } from './utils/version.js';

/**
 * The release from which `federation.audience_required` is on unless the environment turns it off:
 * a message from another node that names no audience (and, for replicate, catalogue sync, genesis
 * catalogue ingest and the read receipt, no send time) is refused.
 */
export const AUDIENCE_REQUIRED_BY_DEFAULT_IN = '3.27.0';
/** The release in which a message without the audience and delivery proof stops being accepted at all. */
export const UNPROVEN_FORMAT_REMOVED_IN = '4.0.0';
/**
 * The release in which `optional` stops being a relay-claim setting, the node's and every peer's.
 * Declared here so config can read it without importing a service; services/relay-claim-policy.ts
 * re-exports it under the same name.
 */
export const RELAY_CLAIM_OPTIONAL_REMOVED_IN = '4.0.0';

/**
 * Named here rather than picked from AimeatConfig, for the reason config-decide.ts gives: a type
 * import from config-types.ts would close a cycle. The spread in loadConfig is where the compiler
 * checks the two agree.
 */
export interface FederationConfig {
  maxRelayHops: number;
  federationRelayClaim: 'optional' | 'required';
  federationAudienceRequired: boolean;
  depeeringGracePeriodHours: number;
  keyCacheRefreshMinutes: number;
}

/** Whether a node on `version` requires the audience when the environment does not say. */
export function audienceRequiredByDefault(version: string = getSoftwareVersion()): boolean {
  return versionAtLeast(version, AUDIENCE_REQUIRED_BY_DEFAULT_IN);
}

/** Whether a node on `version` may still take a message without the audience and delivery proof at all. */
export function unprovenFormatLive(version: string = getSoftwareVersion()): boolean {
  return !versionAtLeast(version, UNPROVEN_FORMAT_REMOVED_IN);
}

/** Whether a node on `version` may still take `optional` as a relay-claim setting, the node's or a peer's. */
export function relayClaimOptionalLive(version: string = getSoftwareVersion()): boolean {
  return !versionAtLeast(version, RELAY_CLAIM_OPTIONAL_REMOVED_IN);
}

export function federationDefaults(): FederationConfig {
  const audience = process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED;
  // From UNPROVEN_FORMAT_REMOVED_IN and RELAY_CLAIM_OPTIONAL_REMOVED_IN the environment cannot turn
  // either back on (Core 2026-11 HTTP-08): the value it sets has no effect from that release.
  const optionalTaken = process.env.AIMEAT_FEDERATION_RELAY_CLAIM === 'optional' && relayClaimOptionalLive();
  return {
    maxRelayHops: parseInt(process.env.AIMEAT_MAX_RELAY_HOPS ?? '3', 10),
    federationRelayClaim: optionalTaken ? 'optional' : 'required',
    federationAudienceRequired: !unprovenFormatLive() ? true
      : audience === 'true' ? true : audience === 'false' ? false : audienceRequiredByDefault(),
    depeeringGracePeriodHours: parseInt(process.env.AIMEAT_DEPEERING_GRACE_HOURS ?? '72', 10),
    keyCacheRefreshMinutes: parseInt(process.env.AIMEAT_KEY_CACHE_REFRESH_MINUTES ?? '5', 10),
  };
}
