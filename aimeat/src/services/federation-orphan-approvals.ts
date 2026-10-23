/**
 * @file src/services/federation-orphan-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: the approved peering requests that no peer stands behind are shown
 *   to the operator on the Security page, one incident for the node, and none of them is changed.
 *
 *   WHY. POST /v1/federation/key-exchange takes no sign-in and admits a node that has an approved or
 *   auto-approved peering request and no peer row. Until 2026-10-23 removing a peer (an emergency
 *   removal, the end of its de-peering grace, a ban) deleted the peer row and left the request standing,
 *   so the removed node came back with one key exchange (Core FED-15; secaudit2026oct22). Removal now
 *   revokes the request (services/peer-origin.ts revokePeerApprovals). The requests a removal left
 *   standing before that day cannot be told apart from an approval still waiting for its node's first
 *   key exchange (this node's own join writes one), so this step revokes nothing: it names each one,
 *   and the operator deletes the ones whose node they removed (DELETE /v1/admin/peering/requests/:id)
 *   and keeps the rest (Jouni, 2026-10-23; CLAUDE.md, Backend: a migration acts only on positive evidence).
 *
 *   WHICH REQUESTS. Status approved or auto_approved, a node id, no peer row under that id, and last
 *   changed more than a day before the step ran, so a join made a moment ago is not named.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (FEDERATION_ORPHAN_APPROVALS_KEY), on any version.
 * @structure FEDERATION_ORPHAN_APPROVALS_KEY · orphanPeerApprovals(storage, now) · flagOrphanPeerApprovalsOnce(storage, config)
 * @usage await flagOrphanPeerApprovalsOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (secaudit2026oct22).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeeringRequestRecord } from '../storage/types/organisms-federation.js';
import { logger } from '../utils/logger.js';
import { recordSecurityIncident } from './security-incident.js';
import { claimOnceOnlyStep } from './once-only-step.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const FEDERATION_ORPHAN_APPROVALS_KEY = 'migrations.secaudit2026oct22.federation-orphan-approvals';

const DAY_MS = 24 * 3_600_000;

/** The approved requests whose node has no peer row and that last changed more than a day before `now`. */
export async function orphanPeerApprovals(storage: Storage, now: number = Date.now()): Promise<PeeringRequestRecord[]> {
  const peerIds = new Set((await storage.listFederationPeers()).map(p => p.nodeId));
  return (await storage.listPeeringRequests()).filter(r =>
    (r.status === 'approved' || r.status === 'auto_approved')
    && !!r.fromNodeId && !peerIds.has(r.fromNodeId)
    && Date.parse(r.updatedAt || r.createdAt) + DAY_MS < now);
}

/**
 * Name the approved requests no peer stands behind in one Security page incident, and record the run.
 * Writes nothing else. Throws when a write fails, and then leaves no record, so the next start tries again.
 * @returns the requests named, or null on a node that ran the step before
 */
export async function flagOrphanPeerApprovalsOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<PeeringRequestRecord[] | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, FEDERATION_ORPHAN_APPROVALS_KEY);
  if (!claim) return null;
  try {
    const orphans = await orphanPeerApprovals(storage);
    if (orphans.length) {
      const list = orphans.map(r => `${r.fromNodeId} (request ${r.id}, ${r.status}, ${r.fromNodeUrl})`).join('; ');
      await recordSecurityIncident(storage, config, {
        type: 'federation_orphan_approvals',
        code: 'PEER_APPROVAL_WITHOUT_PEER',
        actorGhii: `system@${config.nodeId}`,
        actorName: 'node',
        source: 'boot',
        detail: `${orphans.length} approved peering request(s) have no peer behind them: ${list}. `
          + 'Each of these nodes can become a peer again with one key exchange, with the key and the address of its request. '
          + 'From 2026-10-23 removing a peer revokes its requests; these were left by a removal before that day, or wait for '
          + 'a node this node joined. Delete the request of each node you removed (DELETE /v1/admin/peering/requests/{id}), '
          + 'and keep the request of a node you still want to link with.',
      });
    }
    await claim.finish({ at: new Date().toISOString(), requests: orphans.map(r => r.id) });
    if (orphans.length) logger.warn(`${orphans.length} approved peering request(s) have no peer behind them; see the Security page`);
    return orphans;
  } catch (err) {
    await claim.release();
    throw err;
  }
}
