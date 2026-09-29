/**
 * @file src/config-federation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's federation settings read from the environment: how many hops a relay may
 *   take, whether a relayed request must carry a signed relay claim, how long a de-peered node keeps
 *   its grace, and how often the peer key cache is refreshed.
 *
 *   Its own file for the same reason config-decide.ts is one: config.ts is at the line ceiling, and
 *   these four answer one question, how this node deals with its peers.
 *
 *   `federation.relay_claim` is `required` unless the environment says `optional` (any other value
 *   reads as `required`). An explicit `optional` is still taken until 4.0.0, and one peer can keep
 *   its own answer (services/relay-claim-policy.ts).
 * @structure FederationConfig · federationDefaults()
 * @usage
 *   import { federationDefaults } from './config-federation.js';
 *   const config = { ...federationDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-09-29 — Moved out of config.ts unchanged, except that the relay-claim default is
 *     `required` from 3.20.0 (RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN).
 */

/**
 * Named here rather than picked from AimeatConfig, for the reason config-decide.ts gives: a type
 * import from config-types.ts would close a cycle. The spread in loadConfig is where the compiler
 * checks the two agree.
 */
export interface FederationConfig {
  maxRelayHops: number;
  federationRelayClaim: 'optional' | 'required';
  depeeringGracePeriodHours: number;
  keyCacheRefreshMinutes: number;
}

export function federationDefaults(): FederationConfig {
  return {
    maxRelayHops: parseInt(process.env.AIMEAT_MAX_RELAY_HOPS ?? '3', 10),
    federationRelayClaim: process.env.AIMEAT_FEDERATION_RELAY_CLAIM === 'optional' ? 'optional' : 'required',
    depeeringGracePeriodHours: parseInt(process.env.AIMEAT_DEPEERING_GRACE_HOURS ?? '72', 10),
    keyCacheRefreshMinutes: parseInt(process.env.AIMEAT_KEY_CACHE_REFRESH_MINUTES ?? '5', 10),
  };
}
