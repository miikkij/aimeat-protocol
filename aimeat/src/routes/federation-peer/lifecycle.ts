/**
 * @file src/routes/federation-peer/lifecycle.ts
 * @description Peer de-peering (grace + emergency), federation ping (cached service-summary hash), and
 *   Ed25519 key-exchange with key-continuity rotation guard. Extracted from federation-peer.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from federation-peer.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { returnEscrow } from '../../services/morsel.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { verify } from '../../auth/keypair.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { emitChange } from '../../services/event-bus.js';
import { peerKeyCache } from '../../services/federation-helpers.js';
import { computeServiceSummary } from '../../utils/service-summary.js';
import { deriveTierFlags, type PeerTier } from '../../services/federation-tiers.js';

/** Cached service summary hash to avoid recomputing on every ping (60s TTL). */
let cachedSummaryHash = '';
let summaryHashExpiry = 0;

export function registerLifecycleRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // DELETE /v1/federation/peers/:nodeId — de-peer (operator only)
    // Normal: grace period (configurable, default 72h) — in-flight work completes, new requests blocked
    // Emergency (?emergency=true): immediate disconnect, cancel in-flight work, return escrow
    router.delete('/v1/federation/peers/:nodeId', requireAuth(), requireRole('operator'), async (req, res) => {
        const nodeId = req.params.nodeId as string;
        const emergency = req.query.emergency === 'true';
        const notifyNetwork = req.body?.notify_network === true;
        const reason = (req.body?.reason as string) ?? (emergency ? 'emergency_depeer' : 'operator_decision');

        const peer = peers.get(nodeId);
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Peer not found: ${nodeId}`));
            return;
        }

        if (emergency) {
            // ── Emergency de-peering: immediate disconnect ──
            // 1. Remove peer immediately
            peers.delete(nodeId);
            await storage.deleteFederationPeer(nodeId);

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
                        await fetch(`${otherPeer.url}/v1/federation/trust-advisory`, {
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
                    } catch {
                        logger.warn(`Failed to notify peer ${otherPeer.nodeId} about emergency de-peering of ${nodeId}`);
                    }
                }
            }

            res.json(success(config.nodeId, {
                deleted: true,
                node_id: nodeId,
                emergency: true,
                reason,
                cancelled_work_items: cancelledCount,
                network_notified: notifyNetwork,
                note: 'Peer immediately de-peered — all in-flight work cancelled, escrow returned',
            }));
            emitChange('federation');
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

            res.json(success(config.nodeId, {
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
            }));
            emitChange('federation');
        }
    });

    // POST /v1/federation/ping — federation health check (used by peers)
    router.post('/v1/federation/ping', async (req, res) => {
        const { from_node, node_id, software_version } = req.body ?? {};
        const fromId = (from_node || node_id) as string | undefined;

        if (fromId && peers.has(fromId)) {
            const peer = peers.get(fromId)!;
            peer.lastSeen = new Date().toISOString();
            peer.status = 'active';
            // Federation version visibility: record the peer's advertised AIMEAT version.
            if (typeof software_version === 'string') peer.softwareVersion = software_version;
            storage.saveFederationPeer(peer).catch(() => {});
        }

        // Compute service summary hash with 60s cache
        if (!cachedSummaryHash || Date.now() > summaryHashExpiry) {
            try {
                const summary = await computeServiceSummary(config, storage);
                cachedSummaryHash = summary.summary_hash;
                summaryHashExpiry = Date.now() + 60_000;
            } catch {
                // Keep stale hash on error
            }
        }

        res.json(success(config.nodeId, {
            pong: true,
            node_id: config.nodeId,
            timestamp: new Date().toISOString(),
            service_summary_hash: cachedSummaryHash,
        }));
        emitChange('federation');
    });

    // ── A.3: Key Exchange Endpoint ──

    // POST /v1/federation/key-exchange — Exchange public keys with a peer node
    router.post('/v1/federation/key-exchange', async (req, res) => {
        const { node_id, node_url, node_public_key, agent_keys, timestamp } = req.body ?? {};

        if (!node_id || !node_public_key) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'node_id and node_public_key are required'));
            return;
        }

        // Find or auto-add the sender as a peer (bidirectional peering)
        let peer = [...peers.values()].find(p => p.nodeId === node_id);
        if (!peer || (peer.status !== 'active' && peer.status !== 'approved')) {
            // Auto-add ONLY when there is an operator-approved peering request from this node.
            // SECURITY (F1): never derive admission/trust from the request BODY (e.g. node_url ===
            // config.genesisUrl) — an unauthenticated caller could otherwise self-admit as an active
            // peer with an attacker-controlled key and then mint via /settle. A genesis/peer is
            // established through the signed introduce → operator-approval flow like any other peer.
            const senderUrl = node_url as string | undefined;
            const requests = await storage.listPeeringRequests();
            const hasApprovedRequest = requests.some(r => r.fromNodeId === node_id && (r.status === 'approved' || r.status === 'auto_approved'));

            if (hasApprovedRequest && senderUrl) {
                const now = new Date().toISOString();
                const tier: PeerTier = 'member';
                const newPeer: PeerInfo = {
                    nodeId: node_id,
                    url: senderUrl,
                    publicKey: node_public_key,
                    status: 'active',
                    addedAt: now,
                    lastSeen: now,
                    ...deriveTierFlags(tier),
                    tier,
                };
                peers.set(node_id, newPeer);
                await storage.saveFederationPeer(newPeer);
                peer = newPeer;
                logger.info(`Auto-added peer ${node_id} during key exchange (operator-approved request)`);
            } else {
                res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                    `Node ${node_id} is not a recognized peer`));
                return;
            }
        }

        // Key continuity (SECURITY F1): once a peer's signing key is established, a CHANGE to it is a
        // rotation that MUST be authorized by a signature from the CURRENT key (proof of possession).
        // Without this, an unauthenticated caller could replace a trusted peer's key and then have
        // attacker-signed settlements/replication verify against it. Newly auto-added peers set their
        // key just above (no change), so this only bites an EXISTING peer presenting a different key.
        // A legitimate key rotation is re-established via the operator introduce/approval flow.
        if (peer.publicKey && node_public_key !== peer.publicKey) {
            const sig = (req.body?.signature as string | undefined) ?? '';
            const rotationPayload = `${node_id}:${node_public_key}:${timestamp ?? ''}`;
            const rotationOk = sig.length > 0 && await verify(peer.publicKey, rotationPayload, sig);
            if (!rotationOk) {
                res.status(409).json(error(config.nodeId, 'KEY_ROTATION_DENIED',
                    'Changing an established peer key requires a signature from the current key. Re-establish the peer via the operator introduce/approval flow to rotate.'));
                return;
            }
        }

        // Store the peer's keys with TTL
        const ttlMs = config.keyCacheRefreshMinutes * 60_000;
        const peerAgentKeys = new Map<string, string>();
        if (Array.isArray(agent_keys)) {
            for (const ak of agent_keys) {
                if (ak.gaii && ak.public_key) {
                    peerAgentKeys.set(ak.gaii, ak.public_key);
                }
            }
        }

        peerKeyCache.set(node_id, {
            publicKey: node_public_key,
            agentKeys: peerAgentKeys,
            expiresAt: Date.now() + ttlMs,
        });

        // Also update the peer's public key in the peers map if it changed
        if (node_public_key !== peer.publicKey) {
            peer.publicKey = node_public_key;
            await storage.saveFederationPeer(peer);
        }

        logger.info(`Received key exchange from peer ${node_id}`, {
            agentKeysReceived: peerAgentKeys.size,
            timestamp,
        });

        // Return our own keys
        const nodeKey = await storage.getNodeKey();
        const agents = await storage.listAgents();
        const ourAgentKeys = agents
            .filter(a => a.publicKey)
            .map(a => ({ gaii: a.gaii, public_key: a.publicKey }));

        res.json(success(config.nodeId, {
            node_id: config.nodeId,
            node_public_key: nodeKey?.publicKey ?? '',
            accepted: true,
            capabilities: req.body?.capabilities ?? [],
            agent_keys: ourAgentKeys,
            timestamp: new Date().toISOString(),
        }));
        emitChange('federation');
    });
}
