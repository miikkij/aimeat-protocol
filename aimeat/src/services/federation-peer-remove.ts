/**
 * @file services/federation-peer-remove.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Remove a federation peer: the operator's way to end a link, and to free a node id that
 *   somebody else holds. One implementation for DELETE /v1/federation/peers/:nodeId and the MCP tool
 *   aimeat_admin_federation_peer_remove, so a chat and the Federation page cannot drift apart.
 *
 *   EMERGENCY removes the peer at once with its recorded origin and event markers (peer-origin.ts
 *   forgetPeer), cancels in-flight work with the peer and returns its escrow, and can tell the other
 *   peers. Without it the peer enters its de-peering grace and is purged when the grace ends
 *   (federation.ts). A node id that is only a waiting package registration is deleted as that.
 * @structure PeerRemoveResult · removePeer()
 * @version-history
 *   v1.0.0 — 2026-10-01 — Moved out of routes/federation-peer/lifecycle.ts for the MCP tool (follow-up
 *     to the peer-registration incident, item 5). Unchanged but for the network notice, which goes
 *     through safeFetch and logs the error it caught.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { returnEscrow } from './morsel.js';
import { logger } from '../utils/logger.js';
import { validateOutboundUrl, safeFetch } from '../utils/url-validator.js';
import { emitChange } from './event-bus.js';
import { peerKeyCache } from './federation-helpers.js';
import { forgetPeer, readPendingPeer, deletePendingPeer } from './peer-origin.js';

export type PeerRemoveResult =
    | { ok: false; status: number; code: string; message: string }
    | { ok: true; body: Record<string, unknown> };

export async function removePeer(
    deps: { config: AimeatConfig; storage: Storage; peers: Map<string, PeerInfo> },
    nodeId: string,
    opts: { emergency: boolean; notifyNetwork?: boolean; reason?: string },
): Promise<PeerRemoveResult> {
    const { config, storage, peers } = deps;
    const emergency = opts.emergency;
    const notifyNetwork = opts.notifyNetwork === true;
    const reason = opts.reason ?? (emergency ? 'emergency_depeer' : 'operator_decision');

    const peer = peers.get(nodeId);
    if (!peer) {
        // Not a peer, but a package grant may still be waiting for a node by this id. Deleting it
        // frees the id for a grant under another key.
        if (await readPendingPeer(storage, nodeId)) {
            await deletePendingPeer(storage, nodeId);
            emitChange('federation');
            return { ok: true, body: { deleted: true, node_id: nodeId, pending_deleted: true } };
        }
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Peer not found: ${nodeId}` };
    }

    if (emergency) {
        // ── Emergency de-peering: immediate disconnect ──
        // 1. Remove peer immediately, with its recorded origin, so the name is free
        peers.delete(nodeId);
        await storage.deleteFederationPeer(nodeId);
        await forgetPeer(storage, nodeId);

        // 2. Cancel all in-flight cross-node work from/to this peer and return escrow
        const allWork = await storage.listAllWork();
        let cancelledCount = 0;
        for (const work of allWork) {
            if (work.status !== 'pending' && work.status !== 'accepted') continue;
            // Check if the work involves an agent from the de-peered node
            const isFromPeer = work.providerGaii.endsWith(`@${nodeId}`) || work.requesterGaii.endsWith(`@${nodeId}`);
            if (!isFromPeer) continue;

            await returnEscrow(storage, work);
            await storage.updateWork(work.trackingCode, { status: 'cancelled', updatedAt: new Date().toISOString() });
            cancelledCount++;
        }

        // 3. Notify other peers if requested
        if (notifyNetwork) {
            const activePeers = [...peers.values()].filter(p => p.status === 'active');
            for (const otherPeer of activePeers) {
                try {
                    // SSRF validation: block requests to private/reserved IPs
                    const peerUrlCheck = await validateOutboundUrl(otherPeer.url);
                    if (!peerUrlCheck.valid) {
                        logger.warn(`Blocked outbound request to peer ${otherPeer.nodeId}: ${peerUrlCheck.reason}`);
                        continue;
                    }
                    await safeFetch(`${otherPeer.url}/v1/federation/trust-advisory`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            target_node: nodeId,
                            advisory_type: 'suspend',
                            reason,
                            issued_by: config.nodeId,
                        }),
                        signal: AbortSignal.timeout(5_000),
                    });
                } catch (err) {
                    logger.warn(`Failed to notify peer ${otherPeer.nodeId} about emergency de-peering of ${nodeId}`, { error: String(err) });
                }
            }
        }

        emitChange('federation');
        return { ok: true, body: {
            deleted: true,
            node_id: nodeId,
            emergency: true,
            reason,
            cancelled_work_items: cancelledCount,
            network_notified: notifyNetwork,
            note: 'Peer immediately de-peered — all in-flight work cancelled, escrow returned',
        } };
    } else {
        // ── Normal de-peering: grace period ──
        const graceHours = config.depeeringGracePeriodHours;
        const gracePeriodEnd = new Date(Date.now() + graceHours * 3600_000).toISOString();

        peer.status = 'depeering';
        (peer as PeerInfo & { depeerGraceEnd?: string }).depeerGraceEnd = gracePeriodEnd;
        await storage.saveFederationPeer(peer);

        // Remove federated catalogue entries from this peer (mark expiring)
        const allActions = await storage.listActions();
        let expiredActions = 0;
        for (const action of allActions) {
            if (action.tags.includes(`federated:${nodeId}`)) {
                await storage.updateAction(action.id, action.providerGaii, {
                    tags: [...action.tags.filter(t => t !== `federated:${nodeId}`), `expiring:${nodeId}`],
                });
                expiredActions++;
            }
        }

        // C.4: Rename replica entries to expiring for grace period
        const allAgents = await storage.listAgents();
        let expiredReplicas = 0;
        for (const agent of allAgents) {
            const memories = await storage.listMemory(agent.gaii, { prefix: `replica:${nodeId}:` });
            for (const mem of memories) {
                const expiringKey = mem.key.replace(`replica:${nodeId}:`, `expiring:${nodeId}:`);
                await storage.setMemory({
                    ...mem,
                    key: expiringKey,
                    tags: [...mem.tags.filter(t => !t.startsWith('replica:')), `expiring:${nodeId}`],
                    updatedAt: new Date().toISOString(),
                });
                await storage.deleteMemory(agent.gaii, mem.key);
                expiredReplicas++;
            }
        }

        // Remove peer keys from cache
        peerKeyCache.delete(nodeId);

        logger.info(`De-peering grace period started for peer ${nodeId}`, {
            expiredActions,
            expiredReplicas,
            graceHours,
            gracePeriodEnd: gracePeriodEnd,
        });

        emitChange('federation');
        return { ok: true, body: {
            deleted: false,
            node_id: nodeId,
            emergency: false,
            status: 'depeering',
            reason,
            grace_period_hours: graceHours,
            grace_period_ends: gracePeriodEnd,
            expiring_actions: expiredActions,
            expiring_replicas: expiredReplicas,
            note: `Peer set to depeering status. In-flight work may complete. Peer will be purged after ${graceHours}h grace period.`,
        } };
    }
}
