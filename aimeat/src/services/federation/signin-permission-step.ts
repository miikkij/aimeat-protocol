/**
 * @file src/services/federation/signin-permission-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-per-node step that names, on the Security page, the peers whose sign-in
 *   checks stopped when Core FED-16 came in. This node is the people's HOME here: a peer asks it to
 *   check one of its people's sign-in, so those people sign in on the peer with their account here.
 *
 *   WHY. Until 2026-11-24 this node answered a federated sign-in check, a memory list and a replicate
 *   for every peer whose tier may carry a sign-in (member, genesis), whatever the operator had set
 *   for that peer. Since then the peer's own permission (allowFederatedAuth) is asked as well
 *   (./auth-consent.ts linkCarriesSignIn). Nothing is granted on upgrade, because the same word
 *   decides which peers' visitors a `specific_peers` node lets in (auth/visitor-peer.ts): granting it
 *   to every member peer would have widened that. So the change only closes, and the operator is
 *   told which peers it closed: one security incident lists them, and the Federation page gives the
 *   permission back per peer (PUT /v1/federation/peers/:nodeId allow_federated_auth, the same as
 *   aimeat_admin_federation). A node with no such peer records the step and opens nothing.
 * @structure FED16_SIGNIN_STEP_KEY · nameClosedSignInPeersOnce(storage, config)
 * @usage await nameClosedSignInPeersOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-11-24 — Initial (decision of 2026-11-24 in Lifecycle Central, Core FED-16).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { LIVENESS_RECOVERABLE } from '../federation.js';
import { coerceTier, tierCeiling } from './tiers.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { recordSecurityIncident, securityOwner } from '../security-incident.js';
import { logger } from '../../utils/logger.js';

/** The record under `system@<nodeId>` that says the step has run. */
export const FED16_SIGNIN_STEP_KEY = 'migrations.core-fed-16-signin-permission';

/** How many peers the incident names one by one. */
const INCIDENT_ROWS = 50;

/**
 * Name the live peers whose tier carries a sign-in but whose own permission is off, once per node.
 * Throws when a read or write fails, and then leaves no record, so the next start tries again.
 */
export async function nameClosedSignInPeersOnce(
  storage: Storage, config: AimeatConfig,
): Promise<{ ran: false } | { ran: true; peers: string[] }> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, FED16_SIGNIN_STEP_KEY);
  if (!claim) return { ran: false };
  try {
    const at = new Date().toISOString();
    const peers = (await storage.listFederationPeers())
      .filter(p => p.nodeId !== config.nodeId && LIVENESS_RECOVERABLE.has(p.status))
      .filter(p => tierCeiling(coerceTier(p.tier ?? 'member')).allowFederatedAuth && p.allowFederatedAuth !== true)
      .map(p => p.nodeId)
      .sort();
    if (peers.length) {
      const shown = peers.slice(0, INCIDENT_ROWS).join(', ') + (peers.length > INCIDENT_ROWS ? ` and ${peers.length - INCIDENT_ROWS} more` : '');
      await recordSecurityIncident(storage, config, {
        type: 'federated_signin_closed',
        code: 'FEDERATED_SIGNIN_NEEDS_PERMISSION',
        actorGhii: securityOwner(config.nodeId),
        actorName: 'node',
        source: 'boot',
        detail: `Your people can no longer sign in on ${peers.length} peer server(s) with their account here, because this server now `
          + `answers such a sign-in only for a peer you allowed it for, not for every peer whose tier permits it: ${shown}. `
          + 'If you want one of them back, turn on "Allow Federated Login" for it on the Federation page.',
        params: { count: String(peers.length), nodes: shown },
      });
      logger.warn('Federation: peers whose sign-in checks stopped under Core FED-16 are named on the Security page', { peers: peers.length });
    }
    await claim.finish({ at, peers: peers.length });
    return { ran: true, peers };
  } catch (err) {
    await claim.release();
    throw err;
  }
}
