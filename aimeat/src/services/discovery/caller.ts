/**
 * @file caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a discovery call runs as: the caller part of DiscoveryContext, built from the one
 *   CallerContext (services/caller-context.ts). GET /v1/discover and aimeat_discover both build it
 *   here, so a source decides with the same facts on both surfaces.
 *
 *   THE PERMISSIONS ARE THE SESSION'S. `scopes` is the caller's current list: the token's, already
 *   narrowed to what the agent's record allows now (auth/effective-scopes.ts). An agent record can
 *   hold more than the token it signed in with (a narrowed consent, or words added after the
 *   sign-in), and until 2026-11-13 aimeat_discover read the record's list, so a session found its
 *   owner's private records with words its own token did not carry, which GET /v1/discover refused
 *   (structure programme 2026-11, unit 7).
 * @structure discoveryCaller(caller) → DiscoveryContext['caller']
 * @usage const ctx = { caller: discoveryCaller(callerOf(req, config.nodeId, storage)), … };
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 7).
 */
import type { CallerContext } from '../caller-context.js';
import type { DiscoveryContext } from './types.js';

/** The discovery caller of one CallerContext: its account, identity, kind and current permissions. */
export function discoveryCaller(caller: CallerContext): DiscoveryContext['caller'] {
  return {
    ownerName: caller.owner,
    sub: caller.auth.sub,
    gaii: caller.principal,
    isOwnerSession: caller.inPerson,
    isApp: caller.roles.includes('app'),
    isEcosystem: caller.roles.includes('ecosystem'),
    scopes: [...caller.scopes],
  };
}
