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
 *   v1.2.0 — 2026-10-20 — The de-peering grace converts the peer's replicas by KEY PREFIX across every
 *     owner principal (listAllMemory, paged), not by walking the local agents table. A replica sits
 *     under the SENDING node's principal, which is in no agents table, so the walk converted none of
 *     them and the copies survived de-peering (secaudit 2026-10, replica retention).
 *   v1.1.0 — 2026-10-16 — The emergency notice to the network is a signed peer request
 *     (federation-trust-notice.ts) and each peer's answer is read: the response lists the outcome per
 *     peer (`network_notices`), and `network_notified` is true only when every peer accepted (QA audit
 *     S6-06). A removed peer's stored template listings are deleted with it (QA audit F1-04).
 *   v1.0.0 — 2026-10-01 — Moved out of routes/federation-peer/lifecycle.ts for the MCP tool (follow-up
 *     to the peer-registration incident, item 5). Unchanged but for the network notice, which goes
 *     through safeFetch and logs the error it caught.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { returnEscrow } from './morsel.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';
import { sendTrustNotice } from './federation-trust-notice.js';
import { deleteRemoteTemplates } from './federation-remote-templates.js';
import { peerKeyCache } from './federation-helpers.js';
import { forgetPeer, readPendingPeer, deletePendingPeer } from './peer-origin.js';

/** Replicas read per listing call while de-peering converts them, and the paging loop's stop. */
const REPLICA_PAGE_SIZE = 200;
const REPLICA_MAX_PAGES = 10_000;

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

        // 3. Notify other peers if requested: a signed notice to each, and each answer read. Until
        // 2026-10-16 this was an unsigned POST to a route that requires the receiving operator's own
        // session, its answer was not read, and the response said network_notified: true (QA audit S6-06).
        const notices = notifyNetwork
            ? await sendTrustNotice({ config, storage, peers }, { target_node: nodeId, advisory_type: 'suspend', reason })
            : [];
        for (const n of notices) {
            if (!n.accepted) logger.warn(`A peer did not accept the notice about the emergency de-peering of ${nodeId}`, { peer: n.node, status: n.status, error: n.error });
        }
        const accepted = notices.filter(n => n.accepted).length;

        // The stored template listings of this peer go with it (services/federation-remote-templates.ts).
        await deleteRemoteTemplates(storage, nodeId);

        emitChange('federation');
        return { ok: true, body: {
            deleted: true,
            node_id: nodeId,
            emergency: true,
            reason,
            cancelled_work_items: cancelledCount,
            // True only when the notice was asked for, there was a peer to tell, and every peer accepted it.
            network_notified: notifyNetwork && notices.length > 0 && accepted === notices.length,
            ...(notifyNetwork ? { network_notices: notices, network_notified_peers: accepted } : {}),
            note: notifyNetwork
                ? `Peer immediately de-peered — all in-flight work cancelled, escrow returned. ${accepted} of ${notices.length} peers accepted the notice.`
                : 'Peer immediately de-peered — all in-flight work cancelled, escrow returned',
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

        // C.4: Rename replica entries to expiring for grace period.
        //
        // THE SCAN IS BY KEY PREFIX ACROSS EVERY OWNER. A replica is stored under the SENDING node's
        // principal (`agent#owner@<peer>`), which no code path writes into the agents table, so the
        // listAgents() walk this used until 2026-10-20 visited none of them: de-peering converted
        // nothing and the copies stayed public for ever (secaudit 2026-10, replica retention).
        const replicaPrefix = `replica:${nodeId}:`;
        let expiredReplicas = 0;
        for (let page = 0, offset = 0; page < REPLICA_MAX_PAGES; page++) {
            const rows = (await storage.listAllMemory({ prefix: replicaPrefix, limit: REPLICA_PAGE_SIZE, offset })).items;
            if (rows.length === 0) break;
            // Rows left in place: a converted row is out of the next listing, so the window only has
            // to step over what stayed.
            let kept = 0;
            for (const mem of rows) {
                const expiringKey = `expiring:${nodeId}:${mem.key.slice(replicaPrefix.length)}`;
                try {
                    await storage.setMemory({
                        ...mem,
                        key: expiringKey,
                        tags: [...mem.tags.filter(t => !t.startsWith('replica:')), `expiring:${nodeId}`],
                        updatedAt: new Date().toISOString(),
                    });
                    await storage.deleteMemory(mem.ownerGaii, mem.key);
                    expiredReplicas++;
                } catch (err) {
                    kept++;
                    logger.warn('De-peering: a replica could not be converted, continuing', {
                        peer: nodeId, key: mem.key, owner: mem.ownerGaii, error: String(err),
                    });
                }
            }
            if (rows.length < REPLICA_PAGE_SIZE) break;
            offset += kept;
        }

        // Remove peer keys from cache
        peerKeyCache.delete(nodeId);
        // A peer in its grace is no longer read for listings; its stored ones go now.
        await deleteRemoteTemplates(storage, nodeId);

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
