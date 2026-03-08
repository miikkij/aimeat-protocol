import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { executeHooks } from '../services/hooks.js';
import { returnEscrow } from '../services/morsel.js';
import { logger } from '../utils/logger.js';
import { PeeringRequestSchema, PeeringDecisionSchema, validateBody } from '../models/schemas.js';
import type { PeerInfo } from '../services/federation.js';
import { createGenesisPeeringService } from '../services/genesis-peering.js';
import { createOrganismReputationService } from '../services/organism-reputation.js';
import { sign, verify } from '../auth/keypair.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import type { RouteHop, RouteManifest } from '../types/route-manifest.js';
import { buildHopSigningMessage, computeRelayFeeDistribution } from '../types/route-manifest.js';
import type { RelayFeeDistribution } from '../types/route-manifest.js';

// ── E.4: Keyword matching helpers for cross-catalogue filtering ──

function matchesKeyword(csm: { name: string; serviceType?: string }, keyword: string): boolean {
    const lk = keyword.toLowerCase();
    return csm.name.toLowerCase().includes(lk) ||
        (csm.serviceType?.toLowerCase().includes(lk) ?? false);
}

function matchesActionKeyword(action: { displayName: string; description: string; category?: string; tags: string[] }, keyword: string): boolean {
    const lk = keyword.toLowerCase();
    return action.displayName.toLowerCase().includes(lk) ||
        action.description.toLowerCase().includes(lk) ||
        (action.category?.toLowerCase().includes(lk) ?? false) ||
        action.tags.some(t => t.toLowerCase().includes(lk));
}

function matchesGenesisKeyword(val: Record<string, unknown>, keyword: string): boolean {
    const lk = keyword.toLowerCase();
    const searchFields = ['name', 'display_name', 'displayName', 'description', 'category', 'service_type', 'serviceType'];
    return searchFields.some(f => {
        const v = val[f];
        return typeof v === 'string' && v.toLowerCase().includes(lk);
    });
}

function matchesLocation(val: Record<string, unknown>, location: string): boolean {
    const ll = location.toLowerCase();
    const locationFields = ['location', 'city', 'region', 'country'];
    return locationFields.some(f => {
        const v = val[f];
        return typeof v === 'string' && v.toLowerCase().includes(ll);
    });
}

// ── A.3: Peer Key Cache ──
// Caches peer node + agent public keys with TTL for signature verification
export interface PeerKeyEntry {
    publicKey: string;
    agentKeys: Map<string, string>;  // gaii → publicKey
    expiresAt: number;
}

export const peerKeyCache = new Map<string, PeerKeyEntry>();

/**
 * Perform outbound key exchange with a peer node.
 * Sends this node's public key + agent keys, receives and caches the peer's keys.
 * Reusable from peering activation (A.3) and recovery callback (A.4).
 */
export async function performKeyExchange(
    peerUrl: string,
    config: AimeatConfig,
    storage: Storage,
): Promise<{ success: boolean; error?: string }> {
    try {
        const nodeKey = await storage.getNodeKey();
        if (!nodeKey) {
            return { success: false, error: 'No node key available' };
        }

        const agents = await storage.listAgents();
        const agentKeys = agents
            .filter(a => a.publicKey)
            .map(a => ({ gaii: a.gaii, public_key: a.publicKey }));

        const payload = {
            node_id: config.nodeId,
            node_public_key: nodeKey.publicKey,
            agent_keys: agentKeys,
            timestamp: new Date().toISOString(),
        };

        const resp = await fetch(`${peerUrl}/v1/federation/key-exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.federationTimeoutMs),
        });

        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            return { success: false, error: `Peer returned ${resp.status}: ${body}` };
        }

        const data = await resp.json() as {
            data?: {
                node_id?: string;
                node_public_key?: string;
                agent_keys?: Array<{ gaii: string; public_key: string }>;
            };
        };

        const peerData = data.data;
        if (!peerData?.node_id || !peerData?.node_public_key) {
            return { success: false, error: 'Peer returned incomplete key exchange data' };
        }

        // Cache peer keys with TTL
        const ttlMs = config.keyCacheRefreshMinutes * 60_000;
        const agentKeyMap = new Map<string, string>();
        if (peerData.agent_keys) {
            for (const ak of peerData.agent_keys) {
                agentKeyMap.set(ak.gaii, ak.public_key);
            }
        }

        peerKeyCache.set(peerData.node_id, {
            publicKey: peerData.node_public_key,
            agentKeys: agentKeyMap,
            expiresAt: Date.now() + ttlMs,
        });

        logger.info(`Key exchange completed with peer ${peerData.node_id}`, {
            agentKeysReceived: agentKeyMap.size,
            ttlMinutes: config.keyCacheRefreshMinutes,
        });

        return { success: true };
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        logger.warn(`Key exchange failed with ${peerUrl}: ${msg}`);
        return { success: false, error: msg };
    }
}

export function federationRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();
    const genesisPeeringService = createGenesisPeeringService(config, storage);

    // GET /v1/federation/directory — public peer directory (Tier 0)
    router.get('/v1/federation/directory', async (_req, res) => {
        const peerList = [...peers.values()].map(p => ({
            node_id: p.nodeId,
            url: p.url,
            status: p.status,
            last_seen: p.lastSeen,
        }));

        // Include personal nodes in the directory
        let personalNodesList: {
            node_id: string;
            type: string;
            anchor_operator: string;
            status: string;
            last_seen: string;
            agent_count: number;
            note: string;
        }[] = [];

        if (config.personalNodesEnabled) {
            const personalNodes = await storage.listPersonalNodes();
            const publicNodes = personalNodes.filter(pn => pn.visibility === 'public');
            personalNodesList = publicNodes.map(pn => ({
                node_id: pn.nodeId,
                type: 'personal',
                anchor_operator: pn.anchorNodeId,
                status: pn.status,
                last_seen: pn.lastSeen,
                agent_count: pn.agentGaiis.length,
                note: 'Personal node. Availability not guaranteed. Use async patterns.',
            }));
        }

        res.json(success(config.nodeId, {
            self: {
                node_id: config.nodeId,
                capabilities: ['memory', 'micro_memory', 'actions', 'work', 'wallet', 'boards'],
            },
            peers: peerList,
            total: peerList.length,
            ...(personalNodesList.length > 0 ? { personal_nodes: personalNodesList } : {}),
        }, [
            { description: 'Request peering', method: 'POST', url: '/v1/federation/peer/request' },
        ]));
    });

    // POST /v1/federation/peer/introduce — unauthenticated "knock on the door" for joining nodes
    // SECURITY: Requires cryptographic signature + operator approval (never auto-approve)
    router.post('/v1/federation/peer/introduce', async (req, res) => {
        const { node_id, node_url, node_type, public_key, role, message, signature, timestamp } = req.body ?? {};

        if (!node_id || !node_url || !public_key || !role) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'node_id, node_url, public_key, and role are required'));
            return;
        }

        if (role !== 'contributor' && role !== 'operator') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'role must be "contributor" or "operator"'));
            return;
        }

        // SECURITY: Require signature and timestamp
        if (!signature || !timestamp) {
            res.status(400).json(error(config.nodeId, 'MISSING_SIGNATURE',
                'Peer introduction must include signature and timestamp'));
            return;
        }

        // SECURITY: Verify timestamp freshness (5 minute window)
        const ts = new Date(timestamp).getTime();
        if (isNaN(ts) || Math.abs(Date.now() - ts) > 300_000) {
            res.status(400).json(error(config.nodeId, 'STALE_TIMESTAMP',
                'Timestamp is missing, invalid, or outside the 5-minute freshness window'));
            return;
        }

        // SECURITY: Verify signature with provided public key
        const messageToVerify = `${node_id}${node_url}${timestamp}`;
        let valid = false;
        try {
            valid = await verify(public_key, messageToVerify, signature);
        } catch {
            valid = false;
        }
        if (!valid) {
            res.status(401).json(error(config.nodeId, 'INVALID_SIGNATURE',
                'Signature verification failed'));
            return;
        }

        // Check if already a peer
        if (peers.has(node_id)) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', `Node "${node_id}" is already a peer`));
            return;
        }

        // Extension hook: pre_federation_peer
        const hookResult = await executeHooks(config, storage, 'pre_federation_peer', { target_url: node_url, target_node_id: node_id });
        if (!hookResult.allowed) {
            res.status(403).json(error(config.nodeId, 'HOOK_REJECTED', hookResult.reason ?? 'Introduction denied by extension hook'));
            return;
        }

        const id = `peer-req-${randomBytes(8).toString('hex')}`;
        const now = new Date().toISOString();

        // SECURITY: Never auto-approve — always create pending request for operator review
        await storage.createPeeringRequest({
            id,
            fromNodeUrl: node_url,
            fromNodeId: node_id,
            toNodeId: config.nodeId,
            targetUrl: node_url,
            publicKey: public_key,
            message: message ?? '',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
        });

        res.status(202).json(success(config.nodeId, {
            request_id: id,
            status: 'pending',
            message: 'Peer introduction received. Awaiting operator approval.',
        }, [
            { description: 'Check introduction status', method: 'GET', url: `/v1/federation/peer/introduce/${id}/status` },
        ]));
    });

    // GET /v1/federation/peer/introduce/:id/status — check introduction status (no auth, request_id acts as bearer)
    router.get('/v1/federation/peer/introduce/:id/status', async (req, res) => {
        const id = req.params.id as string;
        const request = await storage.getPeeringRequest(id);
        if (!request) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Introduction request not found: ${id}`));
            return;
        }

        res.json(success(config.nodeId, {
            request_id: request.id,
            status: request.status,
        }));
    });

    // POST /v1/federation/peer/request — request peering (operator auth)
    router.post('/v1/federation/peer/request', requireAuth(), requireRole('operator'), validateBody(PeeringRequestSchema, config.nodeId), async (req, res) => {
        const { target_url, target_node_id, public_key, message } = req.body ?? {};

        // Extension hook: pre_federation_peer
        const hookResult = await executeHooks(config, storage, 'pre_federation_peer', { target_url, target_node_id });
        if (!hookResult.allowed) {
            res.status(403).json(error(config.nodeId, 'HOOK_REJECTED', hookResult.reason ?? 'Peering denied by extension hook'));
            return;
        }

        const id = `peer-req-${randomBytes(8).toString('hex')}`;
        const now = new Date().toISOString();

        await storage.createPeeringRequest({
            id,
            fromNodeUrl: target_url,
            fromNodeId: config.nodeId,
            toNodeId: target_node_id ?? 'unknown',
            targetUrl: target_url,
            publicKey: public_key ?? '',
            message: message ?? '',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
        });

        res.status(201).json(success(config.nodeId, {
            request_id: id,
            target_url,
            status: 'pending',
            created_at: now,
        }, [
            { description: 'Check request status', method: 'GET', url: `/v1/federation/peer/request/${id}/status` },
        ]));
    });

    // GET /v1/federation/peer/request/:id/status — check peering request status
    router.get('/v1/federation/peer/request/:id/status', requireAuth(), async (req, res) => {
        const id = req.params.id as string;
        const request = await storage.getPeeringRequest(id);
        if (!request) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Peering request not found: ${id}`));
            return;
        }

        res.json(success(config.nodeId, {
            id: request.id,
            from_node_id: request.fromNodeId,
            to_node_id: request.toNodeId,
            target_url: request.targetUrl,
            status: request.status,
            created_at: request.createdAt,
            updated_at: request.updatedAt,
        }));
    });

    // POST /v1/federation/test — test federation readiness of a target node
    router.post('/v1/federation/test', requireAuth(), requireRole('operator'), async (req, res) => {
        const { target_url } = req.body ?? {};
        if (!target_url) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_url is required'));
            return;
        }

        // SSRF validation: block requests to private/reserved IPs
        const urlCheck = await validateOutboundUrl(target_url);
        if (!urlCheck.valid) {
            res.status(400).json(error(config.nodeId, 'INVALID_URL', urlCheck.reason ?? 'URL validation failed'));
            return;
        }

        // Test connectivity by checking well-known endpoint
        const checks: Record<string, { passed: boolean; detail: string }> = {};

        try {
            const response = await fetch(`${target_url}/.well-known/aimeat`, {
                signal: AbortSignal.timeout(5000),
            });
            checks['well_known'] = {
                passed: response.ok,
                detail: response.ok ? 'Node responds to discovery' : `HTTP ${response.status}`,
            };

            if (response.ok) {
                const data = await response.json() as { data?: { protocol?: string } };
                checks['protocol'] = {
                    passed: data?.data?.protocol === 'aimeat',
                    detail: data?.data?.protocol === 'aimeat' ? 'AIMEAT protocol confirmed' : 'Not an AIMEAT node',
                };
            }
        } catch (e) {
            checks['well_known'] = {
                passed: false,
                detail: `Connection failed: ${(e as Error).message}`,
            };
        }

        const allPassed = Object.values(checks).every(c => c.passed);

        res.json(success(config.nodeId, {
            target_url,
            ready: allPassed,
            checks,
            tested_at: new Date().toISOString(),
        }));
    });

    // GET /v1/admin/peering/requests — list pending peering requests (operator)
    router.get('/v1/admin/peering/requests', requireAuth(), requireRole('operator'), async (_req, res) => {
        const requests = await storage.listPeeringRequests();

        res.json(success(config.nodeId, {
            requests: requests.map(r => ({
                id: r.id,
                from_node_id: r.fromNodeId,
                to_node_id: r.toNodeId,
                target_url: r.targetUrl,
                status: r.status,
                message: r.message,
                created_at: r.createdAt,
            })),
            total: requests.length,
        }));
    });

    // PUT /v1/admin/peering/requests/:id — approve/reject peering request (operator)
    router.put('/v1/admin/peering/requests/:id', requireAuth(), requireRole('operator'), validateBody(PeeringDecisionSchema, config.nodeId), async (req, res) => {
        const id = req.params.id as string;
        const { decision, reason } = req.body ?? {};

        const request = await storage.getPeeringRequest(id);
        if (!request) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Peering request not found: ${id}`));
            return;
        }

        const newStatus = decision === 'approve' ? 'approved' : 'rejected';
        await storage.updatePeeringRequest(id, {
            status: newStatus,
            updatedAt: new Date().toISOString(),
        });

        // If approved, add to peers list
        if (decision === 'approve') {
            const now = new Date().toISOString();
            peers.set(request.fromNodeId ?? request.id, {
                nodeId: request.fromNodeId ?? request.id,
                url: request.targetUrl ?? request.fromNodeUrl,
                publicKey: request.publicKey ?? '',
                status: 'approved',
                addedAt: now,
                lastSeen: now,
            });
        }

        res.json(success(config.nodeId, {
            id,
            decision,
            reason,
            status: newStatus,
        }));
    });

    // POST /v1/federation/peer/activate — activate approved peering
    router.post('/v1/federation/peer/activate', requireAuth(), requireRole('operator'), async (req, res) => {
        const { peer_node_id } = req.body ?? {};
        if (!peer_node_id) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'peer_node_id is required'));
            return;
        }

        const peer = peers.get(peer_node_id);
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Peer not found: ${peer_node_id}`));
            return;
        }

        peer.status = 'active';
        peer.lastSeen = new Date().toISOString();

        // A.3: Trigger key exchange on peering activation
        const keyExchangeResult = await performKeyExchange(peer.url, config, storage);
        if (!keyExchangeResult.success) {
            logger.warn(`Key exchange failed during activation of peer ${peer_node_id}: ${keyExchangeResult.error}`);
        }

        res.json(success(config.nodeId, {
            peer_node_id,
            status: 'active',
            activated_at: peer.lastSeen,
            key_exchange: keyExchangeResult.success ? 'completed' : 'failed',
        }));
    });

    // POST /v1/federation/heartbeat — peer health heartbeat
    // SECURITY: Verify signature from known peers
    router.post('/v1/federation/heartbeat', async (req, res) => {
        const { from_node_id, timestamp, status: peerStatus, stats, signature } = req.body ?? {};

        if (from_node_id && peers.has(from_node_id)) {
            const peer = peers.get(from_node_id)!;

            // SECURITY: Verify heartbeat signature if peer has a public key
            if (peer.publicKey && signature) {
                const messageToVerify = `${from_node_id}${timestamp}`;
                let valid = false;
                try {
                    valid = await verify(peer.publicKey, messageToVerify, signature);
                } catch {
                    valid = false;
                }
                if (!valid) {
                    res.status(401).json(error(config.nodeId, 'INVALID_SIGNATURE',
                        'Heartbeat signature verification failed'));
                    return;
                }
            }

            peer.lastSeen = new Date().toISOString();
            peer.status = 'active';
        }

        res.json(success(config.nodeId, {
            node_id: config.nodeId,
            timestamp: new Date().toISOString(),
            status: 'healthy',
            stats: {
                uptime_seconds: Math.floor(process.uptime()),
            },
        }));
    });

    // GET /v1/federation/peers — list active peers (operator auth)
    router.get('/v1/federation/peers', requireAuth(), requireRole('operator'), (_req, res) => {
        const peerList = [...peers.values()].map(p => ({
            node_id: p.nodeId,
            url: p.url,
            public_key: p.publicKey,
            status: p.status,
            added_at: p.addedAt,
            last_seen: p.lastSeen,
        }));

        res.json(success(config.nodeId, {
            peers: peerList,
            total: peerList.length,
        }));
    });

    // POST /v1/federation/peers — add a peer directly (operator only)
    router.post('/v1/federation/peers', requireAuth(), requireRole('operator'), async (req, res) => {
        const { node_id, url, public_key } = req.body ?? {};

        if (!node_id || !url) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'node_id and url are required'));
            return;
        }

        if (peers.has(node_id)) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', `Peer "${node_id}" already registered`));
            return;
        }

        const now = new Date().toISOString();
        peers.set(node_id, {
            nodeId: node_id,
            url,
            publicKey: public_key ?? '',
            status: 'pending',
            addedAt: now,
            lastSeen: now,
        });

        res.status(201).json(success(config.nodeId, {
            peer: {
                node_id,
                url,
                status: 'pending',
                added_at: now,
            },
        }, [
            { description: 'View peer directory', method: 'GET', url: '/v1/federation/directory' },
        ]));
    });

    // PUT /v1/federation/peers/:nodeId — update peer config (operator only)
    router.put('/v1/federation/peers/:nodeId', requireAuth(), requireRole('operator'), (req, res) => {
        const nodeId = req.params.nodeId as string;
        const peer = peers.get(nodeId);
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Peer not found: ${nodeId}`));
            return;
        }

        const { url, public_key, status } = req.body ?? {};
        if (url) peer.url = url;
        if (public_key) peer.publicKey = public_key;
        if (status) peer.status = status;

        res.json(success(config.nodeId, {
            node_id: nodeId,
            url: peer.url,
            status: peer.status,
            updated: true,
        }));
    });

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
        } else {
            // ── Normal de-peering: grace period ──
            const graceHours = config.depeeringGracePeriodHours;
            const gracePeriodEnd = new Date(Date.now() + graceHours * 3600_000).toISOString();

            peer.status = 'depeering';
            (peer as PeerInfo & { depeerGraceEnd?: string }).depeerGraceEnd = gracePeriodEnd;

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
        }
    });

    // POST /v1/federation/ping — federation health check (used by peers)
    router.post('/v1/federation/ping', (req, res) => {
        const { from_node } = req.body ?? {};

        if (from_node && peers.has(from_node)) {
            const peer = peers.get(from_node)!;
            peer.lastSeen = new Date().toISOString();
            peer.status = 'active';
        }

        res.json(success(config.nodeId, {
            pong: true,
            node_id: config.nodeId,
            timestamp: new Date().toISOString(),
        }));
    });

    // ── A.3: Key Exchange Endpoint ──

    // POST /v1/federation/key-exchange — Exchange public keys with a peer node
    router.post('/v1/federation/key-exchange', async (req, res) => {
        const { node_id, node_public_key, agent_keys, timestamp } = req.body ?? {};

        if (!node_id || !node_public_key) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'node_id and node_public_key are required'));
            return;
        }

        // Validate the sender is a known active peer
        const peer = [...peers.values()].find(p => p.nodeId === node_id);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                `Node ${node_id} is not an active peer`));
            return;
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
            agent_keys: ourAgentKeys,
            timestamp: new Date().toISOString(),
        }));
    });

    // POST /v1/federation/replicate — Receive replicated memory from a peer node
    router.post('/v1/federation/replicate', async (req, res) => {
        const { source_node, gaii, key, value, visibility, version, timestamp, signature } = req.body ?? {};

        if (!source_node || !gaii || !key || value === undefined || !version) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node, gaii, key, value, and version are required'));
            return;
        }

        // Verify the source node is a known peer
        const peer = [...peers.values()].find(p => p.nodeId === source_node);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }

        // P1-11: Require signed replication — verify peer signature
        if (!signature) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature on replication request'));
            return;
        }
        if (!peer.publicKey) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Peer has no public key on file for signature verification'));
            return;
        }
        const replicatePayload = JSON.stringify({ source_node, gaii, key, value, visibility, version, timestamp });
        const replicateValid = await verify(peer.publicKey, replicatePayload, signature);
        if (!replicateValid) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on replication request'));
            return;
        }

        // Store replicated memory with cross-node prefix
        const replicaKey = `replica:${source_node}:${key}`;
        const incomingUpdatedAt = timestamp ?? new Date().toISOString();

        // C.2: LWW (Last-Writer-Wins) conflict resolution
        const existing = await storage.getMemory(gaii, replicaKey);
        if (existing) {
            const existingTime = new Date(existing.updatedAt).getTime();
            const incomingTime = new Date(incomingUpdatedAt).getTime();

            if (incomingTime <= existingTime) {
                // Incoming is older or equal — reject silently
                res.json(success(config.nodeId, {
                    replicated: true,
                    key: replicaKey,
                    source_node,
                    version,
                    conflict: true,
                    conflict_resolution: 'incoming_older',
                }));
                return;
            }

            // Incoming is newer — preserve losing version as conflict backup
            const conflictKey = `${key}._conflict_${Date.now()}`;
            await storage.setMemory({
                ...existing,
                key: conflictKey,
                visibility: 'private',
                tags: [...existing.tags, `conflict:${source_node}`],
                ttlHours: 168, // 7 days
                updatedAt: new Date().toISOString(),
            });

            // Send mailbox notification about the conflict
            await storage.createMailboxItem({
                id: `conflict-${randomBytes(8).toString('hex')}`,
                personalNodeId: '',
                type: 'federation_sync',
                fromGaii: `system@${config.nodeId}`,
                toGaii: gaii,
                payload: JSON.stringify({ type: 'conflict_resolved', key, winner: 'incoming', loser_key: conflictKey }),
                sizeBytes: 0,
                retentionDays: 7,
                expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
                createdAt: new Date().toISOString(),
            });
        }

        await storage.setMemory({
            key: replicaKey,
            ownerGaii: gaii,
            value,
            visibility: visibility ?? 'public',
            tags: [`replica:${source_node}`],
            ttlHours: null,
            version,
            createdAt: timestamp ?? new Date().toISOString(),
            updatedAt: incomingUpdatedAt,
        });

        res.json(success(config.nodeId, {
            replicated: true,
            key: replicaKey,
            source_node,
            version,
            conflict: !!existing,
        }));
    });

    // POST /v1/federation/catalogue-sync — Receive catalogue updates from peer
    // POST /v1/federation/catalogue-sync — Receive catalogue updates from peer
    // Supports incremental sync: if `since_timestamp` is provided, only actions
    // newer than that timestamp are expected. Existing actions are updated rather
    // than duplicated (upsert by federated ID).
    router.post('/v1/federation/catalogue-sync', async (req, res) => {
        const { source_node, actions: actionList, since_timestamp, catalogue_hash, signature } = req.body ?? {};

        if (!source_node || !Array.isArray(actionList)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node and actions array required'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === source_node);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }

        // P1-11: Require signed catalogue sync — verify peer signature
        if (!signature) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature on catalogue-sync request'));
            return;
        }
        if (!peer.publicKey) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Peer has no public key on file for signature verification'));
            return;
        }
        const catalogueSyncPayload = JSON.stringify({ source_node, actions: actionList, since_timestamp, catalogue_hash });
        const catalogueSyncValid = await verify(peer.publicKey, catalogueSyncPayload, signature);
        if (!catalogueSyncValid) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on catalogue-sync request'));
            return;
        }

        let synced = 0;
        let updated = 0;
        const now = new Date().toISOString();

        for (const action of actionList) {
            if (!action.id || !action.provider_gaii || !action.display_name) continue;

            const federatedId = `${source_node}:${action.id}`;
            const actionData = {
                id: federatedId,
                providerGaii: action.provider_gaii,
                displayName: `[${source_node}] ${action.display_name}`,
                description: action.description ?? '',
                category: action.category,
                inputSchema: action.input_schema ?? {},
                outputSchema: action.output_schema ?? {},
                pricing: {
                    baseMorsels: action.pricing?.base_morsels ?? 0,
                    perUnit: action.pricing?.per_unit,
                },
                tags: [...(action.tags ?? []), `federated:${source_node}`],
                semantic: action.semantic,
                createdAt: action.created_at ?? now,
                updatedAt: now,
            };

            // Try to update existing federated action; create if not found
            const existing = await storage.getAction(federatedId, action.provider_gaii);
            if (existing) {
                await storage.updateAction(federatedId, action.provider_gaii, {
                    displayName: actionData.displayName,
                    description: actionData.description,
                    category: actionData.category,
                    inputSchema: actionData.inputSchema,
                    outputSchema: actionData.outputSchema,
                    pricing: actionData.pricing,
                    tags: actionData.tags,
                    updatedAt: now,
                });
                updated++;
            } else {
                try {
                    await storage.createAction(actionData);
                    synced++;
                } catch { /* skip if race condition */ }
            }
        }

        res.json(success(config.nodeId, {
            synced,
            updated,
            source_node,
            total_received: actionList.length,
            incremental: !!since_timestamp,
            catalogue_hash: catalogue_hash ?? null,
        }));
    });

    // POST /v1/federation/trust-advisory — Receive trust advisory about a node
    router.post('/v1/federation/trust-advisory', requireAuth(), requireRole('operator'), async (req, res) => {
        const { target_node, advisory_type, reason, evidence_hash, issued_by } = req.body ?? {};

        if (!target_node || !advisory_type || !reason) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_node, advisory_type, and reason are required'));
            return;
        }

        const validTypes = ['warning', 'suspend', 'ban'];
        if (!validTypes.includes(advisory_type)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `advisory_type must be one of: ${validTypes.join(', ')}`));
            return;
        }

        // Store advisory and optionally de-peer
        const advisoryId = `adv-${randomBytes(8).toString('hex')}`;
        const advisory = {
            id: advisoryId,
            target_node,
            advisory_type,
            reason,
            evidence_hash,
            issued_by: issued_by ?? config.nodeId,
            created_at: new Date().toISOString(),
        };

        // If ban advisory, auto-de-peer the target
        if (advisory_type === 'ban') {
            const targetPeer = [...peers.entries()].find(([, p]) => p.nodeId === target_node);
            if (targetPeer) {
                peers.delete(targetPeer[0]);
            }
        }

        res.status(201).json(success(config.nodeId, {
            '@type': 'aimeat:TrustAdvisory',
            ...advisory,
        }));
    });

    // ── Cross-Node Query Routing ──

    // POST /v1/federation/route — Forward a request to a peer node (multi-hop relay)
    router.post('/v1/federation/route', requireAuth(), async (req, res) => {
        const { target_node, method, path, body: reqBody, max_hops } = req.body ?? {};

        if (!target_node || !path) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_node and path are required'));
            return;
        }

        // Honour inbound X-Relay-Hops header from upstream relay, otherwise use body or config default
        const inboundHops = req.headers['x-relay-hops'] ? parseInt(req.headers['x-relay-hops'] as string, 10) : null;
        const hops = inboundHops ?? max_hops ?? config.maxRelayHops;
        if (hops <= 0) {
            res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Max relay hops exceeded'));
            return;
        }

        // Build relay path from inbound header
        const inboundPath = req.headers['x-relay-path'] as string | undefined;
        const relayPath = inboundPath ? `${inboundPath},${config.nodeId}` : config.nodeId;

        // Prevent routing loops — reject if we already appear in the path
        const pathNodes = relayPath.split(',');
        if (pathNodes.filter(n => n === config.nodeId).length > 1) {
            res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Routing loop detected'));
            return;
        }

        const requesterGaii = req.auth!.sub;

        // Helper: charge 1 morsel routing fee per hop (atomic debit)
        async function chargeRoutingFee(): Promise<void> {
            const debited = await storage.debitBalance(requesterGaii, 1);
            if (debited) {
                await storage.addTransaction({
                    id: `txn-${randomBytes(8).toString('hex')}`,
                    gaii: requesterGaii,
                    type: 'federation_routing',
                    amount: -1,
                    trackingCode: `relay:${relayPath}`,
                    timestamp: new Date().toISOString(),
                });
            }
        }

        // F.2: Build route hop for this relay node
        async function buildLocalHop(forwardedTo: string | null, prevSignature: string): Promise<RouteHop> {
            const receivedAt = new Date().toISOString();
            const signingMessage = buildHopSigningMessage(config.nodeId, receivedAt, forwardedTo, prevSignature);
            const nodeKey = await storage.getNodeKey();
            const hopSignature = nodeKey?.privateKey
                ? await sign(nodeKey.privateKey, signingMessage)
                : '';
            return {
                node_id: config.nodeId,
                received_at: receivedAt,
                forwarded_to: forwardedTo,
                signature: hopSignature,
            };
        }

        // Parse incoming route manifest from headers or body
        const inboundManifest: RouteManifest = req.body?.route_manifest ?? {
            origin: req.headers['x-forwarded-from'] as string ?? config.nodeId,
            hops: [],
        };

        // 1. Check if target is a direct peer
        const targetPeer = [...peers.values()].find(p => p.nodeId === target_node && p.status === 'active');

        if (targetPeer) {
            try {
                const targetUrl = `${targetPeer.url}${path}`;
                // SSRF validation: block requests to private/reserved IPs
                const targetUrlCheck = await validateOutboundUrl(targetUrl);
                if (!targetUrlCheck.valid) {
                    res.status(400).json(error(config.nodeId, 'INVALID_URL', targetUrlCheck.reason ?? 'URL validation failed'));
                    return;
                }
                const response = await fetch(targetUrl, {
                    method: method ?? 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Forwarded-From': config.nodeId,
                        'X-Relay-Hops': String(hops - 1),
                        'X-Relay-Path': relayPath,
                    },
                    ...(reqBody && ['POST', 'PUT', 'PATCH'].includes((method ?? 'GET').toUpperCase())
                        ? { body: JSON.stringify(reqBody) }
                        : {}),
                    signal: AbortSignal.timeout(30_000),
                });

                const data = await response.json().catch(() => null);
                await chargeRoutingFee();

                // F.2: Add hop signing for direct peer routing
                const hop = await buildLocalHop(target_node, inboundManifest.hops.length > 0 ? inboundManifest.hops[inboundManifest.hops.length - 1].signature : '');
                inboundManifest.hops.push(hop);

                res.status(response.status).json(success(config.nodeId, {
                    routed_to: target_node,
                    routed_via: config.nodeId,
                    relay_path: relayPath.split(','),
                    hops_remaining: hops - 1,
                    response_status: response.status,
                    response_data: data,
                    route_manifest: inboundManifest,
                }));
            } catch (err) {
                res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                    `Failed to reach peer ${target_node}: ${err instanceof Error ? err.message : 'unknown error'}`));
            }
            return;
        }

        // 2. Not a direct peer — try multi-hop relay through active peers
        const activePeers = [...peers.values()].filter(p =>
            p.status === 'active' && !pathNodes.includes(p.nodeId));
        if (activePeers.length === 0) {
            res.status(404).json(error(config.nodeId, 'FEDERATION_ERROR', `No route to node ${target_node}`));
            return;
        }

        for (const relay of activePeers) {
            try {
                const relayUrl = `${relay.url}/v1/federation/route`;
                // SSRF validation: block requests to private/reserved IPs
                const relayUrlCheck = await validateOutboundUrl(relayUrl);
                if (!relayUrlCheck.valid) {
                    logger.warn(`Blocked outbound relay to peer ${relay.nodeId}: ${relayUrlCheck.reason}`);
                    continue;
                }
                const response = await fetch(relayUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Forwarded-From': config.nodeId,
                        'X-Relay-Hops': String(hops - 1),
                        'X-Relay-Path': relayPath,
                    },
                    body: JSON.stringify({
                        target_node,
                        method: method ?? 'GET',
                        path,
                        body: reqBody,
                        max_hops: hops - 1,
                    }),
                    signal: AbortSignal.timeout(30_000),
                });

                if (response.ok) {
                    const data = await response.json().catch(() => null);
                    await chargeRoutingFee();

                    // F.2: Add hop signing for multi-hop relay routing
                    const relayHop = await buildLocalHop(relay.nodeId, inboundManifest.hops.length > 0 ? inboundManifest.hops[inboundManifest.hops.length - 1].signature : '');
                    inboundManifest.hops.push(relayHop);

                    res.json(success(config.nodeId, {
                        routed_to: target_node,
                        routed_via: relay.nodeId,
                        relay_path: relayPath.split(',').concat(relay.nodeId),
                        hops_remaining: hops - 1,
                        response_data: data,
                        route_manifest: inboundManifest,
                    }));
                    return;
                }
            } catch {
                // Try next relay
            }
        }

        res.status(404).json(error(config.nodeId, 'FEDERATION_ERROR',
            `No route to node ${target_node} via any active peer`));
    });

    // GET /v1/federation/resolve/:gaii — Resolve which node hosts a GAII
    router.get('/v1/federation/resolve/:gaii', async (req, res) => {
        const gaii = req.params.gaii as string;

        // Check if agent is local
        const localAgent = await storage.getAgent(gaii);
        if (localAgent) {
            res.json(success(config.nodeId, {
                gaii,
                node_id: config.nodeId,
                local: true,
            }));
            return;
        }

        // Parse GAII to extract node hint (agent#owner@node)
        const atIdx = gaii.lastIndexOf('@');
        if (atIdx !== -1) {
            const nodeHint = gaii.substring(atIdx + 1);
            const peer = [...peers.values()].find(p => p.nodeId === nodeHint && p.status === 'active');
            if (peer) {
                res.json(success(config.nodeId, {
                    gaii,
                    node_id: nodeHint,
                    node_url: peer.url,
                    local: false,
                }));
                return;
            }
        }

        // Ask peers (broadcast resolve)
        const activePeers = [...peers.values()].filter(p => p.status === 'active');
        for (const peer of activePeers) {
            try {
                // SSRF validation: block requests to private/reserved IPs
                const peerResolveCheck = await validateOutboundUrl(peer.url);
                if (!peerResolveCheck.valid) {
                    logger.warn(`Blocked outbound resolve to peer ${peer.nodeId}: ${peerResolveCheck.reason}`);
                    continue;
                }
                const resp = await fetch(`${peer.url}/v1/agents/${encodeURIComponent(gaii)}`, {
                    signal: AbortSignal.timeout(5_000),
                });
                if (resp.ok) {
                    res.json(success(config.nodeId, {
                        gaii,
                        node_id: peer.nodeId,
                        node_url: peer.url,
                        local: false,
                    }));
                    return;
                }
            } catch {
                // Continue to next peer
            }
        }

        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
            `Agent ${gaii} not found on this node or any active peer`));
    });

    // POST /v1/federation/cross-node/work — Submit cross-node work request
    router.post('/v1/federation/cross-node/work', requireAuth(), requireRole('agent'), async (req, res) => {
        const { target_node, action_id, provider_gaii, input, ttl_hours } = req.body ?? {};

        if (!target_node || !action_id || !provider_gaii || input === undefined) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'target_node, action_id, provider_gaii, and input are required'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === target_node && p.status === 'active');
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'FEDERATION_ERROR',
                `No active peer for node ${target_node}`));
            return;
        }

        try {
            // SSRF validation: block requests to private/reserved IPs
            const crossNodeUrlCheck = await validateOutboundUrl(peer.url);
            if (!crossNodeUrlCheck.valid) {
                res.status(400).json(error(config.nodeId, 'INVALID_URL', crossNodeUrlCheck.reason ?? 'URL validation failed'));
                return;
            }

            // P1-11: Sign outbound cross-node work request
            const workPayload = {
                action_id,
                provider_gaii,
                input,
                ttl_hours: ttl_hours ?? 24,
                cross_node_requester: req.auth!.sub,
                origin_node: config.nodeId,
                timestamp: new Date().toISOString(),
            };
            const nodeKey = await storage.getNodeKey();
            let workSignature: string | undefined;
            if (nodeKey?.privateKey) {
                workSignature = await sign(nodeKey.privateKey, JSON.stringify(workPayload));
            }

            const response = await fetch(`${peer.url}/v1/work/request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-From': config.nodeId,
                    'X-Requester-Node': config.nodeId,
                },
                body: JSON.stringify({
                    ...workPayload,
                    signature: workSignature,
                }),
                signal: AbortSignal.timeout(30_000),
            });

            const data = await response.json().catch(() => null);

            // Charge 1 morsel routing fee
            const requesterGaii = req.auth!.sub;
            // Atomic routing fee debit
            const debited = await storage.debitBalance(requesterGaii, 1);
            if (debited) {
                await storage.addTransaction({
                    id: `txn-${randomBytes(8).toString('hex')}`,
                    gaii: requesterGaii,
                    type: 'federation_routing',
                    amount: -1,
                    timestamp: new Date().toISOString(),
                });
            }

            res.status(response.status).json(success(config.nodeId, {
                routed_to: target_node,
                response_data: data,
            }));
        } catch (err) {
            res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                `Failed to submit cross-node work: ${err instanceof Error ? err.message : 'unknown error'}`));
        }
    });

    // ── P1-11: Signed Federation Settlements ──

    // POST /v1/federation/settle — Receive a signed settlement from a peer node
    // Used for cross-node morsel transfers (e.g., work completed on a remote node
    // that needs to credit/debit morsels on this node). The request must be
    // cryptographically signed by the sending node's Ed25519 private key.
    router.post('/v1/federation/settle', async (req, res) => {
        const {
            from_node,
            to_node,
            gaii,
            amount,
            tracking_code,
            reason,
            timestamp: settlementTimestamp,
            signature,
        } = req.body ?? {};

        // Validate required fields
        if (!from_node || !to_node || !gaii || amount === undefined || !tracking_code || !signature) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'from_node, to_node, gaii, amount, tracking_code, and signature are required'));
            return;
        }

        // Verify this settlement is addressed to us
        if (to_node !== config.nodeId) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                `Settlement addressed to ${to_node}, but this node is ${config.nodeId}`));
            return;
        }

        // Validate amount is a positive number
        if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'amount must be a positive finite number'));
            return;
        }

        // Verify the sending node is a known active peer
        const peer = [...peers.values()].find(p => p.nodeId === from_node);
        if (!peer || (peer.status !== 'active' && peer.status !== 'depeering')) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                `Node ${from_node} is not a known active peer`));
            return;
        }

        // Verify peer has a public key for signature verification
        if (!peer.publicKey) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                'Peer has no public key on file for signature verification'));
            return;
        }

        // Verify the cryptographic signature
        const settlementPayload = JSON.stringify({
            from_node,
            to_node,
            gaii,
            amount,
            tracking_code,
            reason,
            timestamp: settlementTimestamp,
        });
        const signatureValid = await verify(peer.publicKey, settlementPayload, signature);
        if (!signatureValid) {
            logger.warn(`Invalid settlement signature from node ${from_node} for tracking code ${tracking_code}`);
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED',
                'Invalid signature on settlement request'));
            return;
        }

        // Prevent replay attacks: check if tracking code was already settled
        const existingTxns = await storage.getTransactions(gaii);
        const duplicate = existingTxns.find((t: { trackingCode?: string; type: string }) =>
            t.trackingCode === `settle:${tracking_code}` && t.type === 'federation_settlement',
        );
        if (duplicate) {
            res.status(409).json(error(config.nodeId, 'CONFLICT',
                `Settlement already processed for tracking code ${tracking_code}`));
            return;
        }

        // F.3: Route manifest verification and relay fee distribution
        const routeManifest = req.body.route_manifest as RouteManifest | undefined;
        let relayDistribution: RelayFeeDistribution | null = null;

        if (routeManifest && routeManifest.hops.length > 0) {
            // Verify signature chain contiguity
            let chainValid = true;
            for (let i = 0; i < routeManifest.hops.length; i++) {
                const hop = routeManifest.hops[i];
                const prevSig = i > 0 ? routeManifest.hops[i - 1].signature : '';
                const expectedMessage = buildHopSigningMessage(hop.node_id, hop.received_at, hop.forwarded_to, prevSig);

                // Look up peer key for this hop node
                const hopPeer = [...peers.values()].find(p => p.nodeId === hop.node_id);
                if (hopPeer?.publicKey) {
                    const hopValid = await verify(hopPeer.publicKey, expectedMessage, hop.signature);
                    if (!hopValid) {
                        chainValid = false;
                        logger.warn(`Route manifest hop ${i} signature invalid for node ${hop.node_id}`);
                        break;
                    }
                }

                // Verify contiguity
                if (i < routeManifest.hops.length - 1) {
                    if (hop.forwarded_to !== routeManifest.hops[i + 1].node_id) {
                        chainValid = false;
                        logger.warn(`Route manifest contiguity broken at hop ${i}`);
                        break;
                    }
                }
            }

            if (chainValid) {
                // Compute relay fee distribution
                const networkFee = Math.floor(amount * 0.1); // 10% network fee
                relayDistribution = computeRelayFeeDistribution(networkFee, routeManifest.hops);

                // Credit relay nodes their shares
                for (const share of relayDistribution.relay_shares) {
                    const relayAgent = await storage.getAgent(share.node_id).catch(() => null);
                    if (relayAgent) {
                        await storage.creditBalance(relayAgent.gaii, share.amount);
                        await storage.addTransaction({
                            id: `txn-${randomBytes(8).toString('hex')}`,
                            gaii: relayAgent.gaii,
                            type: 'relay_fee',
                            amount: share.amount,
                            trackingCode: `relay:${tracking_code}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                }
            } else {
                logger.warn(`Route manifest verification failed for settlement ${tracking_code}`);
            }
        }

        // Apply the settlement: credit morsels to the target agent
        const credited = await storage.creditBalance(gaii, Math.floor(amount));
        if (!credited) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                `Agent ${gaii} not found on this node`));
            return;
        }

        // Record the settlement transaction
        await storage.addTransaction({
            id: `txn-${randomBytes(8).toString('hex')}`,
            gaii,
            type: 'federation_settlement',
            amount: Math.floor(amount),
            counterpartyGaii: from_node,
            trackingCode: `settle:${tracking_code}`,
            timestamp: new Date().toISOString(),
        });

        logger.info(`Federation settlement applied: ${amount} morsels to ${gaii} from node ${from_node} (tc: ${tracking_code})`);

        res.json(success(config.nodeId, {
            settled: true,
            from_node,
            to_node,
            gaii,
            amount: Math.floor(amount),
            tracking_code,
            relay_distribution: relayDistribution,
        }));
    });

    // POST /v1/federation/settle/outbound — Send a signed settlement to a peer node (operator only)
    // This endpoint allows operators to initiate a settlement to credit morsels on a remote node.
    router.post('/v1/federation/settle/outbound', requireAuth(), requireRole('operator'), async (req, res) => {
        const { target_node, gaii, amount, tracking_code, reason } = req.body ?? {};

        if (!target_node || !gaii || amount === undefined || !tracking_code) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'target_node, gaii, amount, and tracking_code are required'));
            return;
        }

        if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'amount must be a positive finite number'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === target_node && p.status === 'active');
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'FEDERATION_ERROR',
                `No active peer for node ${target_node}`));
            return;
        }

        const nodeKey = await storage.getNodeKey();
        if (!nodeKey?.privateKey) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR',
                'Node private key not available for signing'));
            return;
        }

        const settlementTimestamp = new Date().toISOString();
        const settlementPayload = JSON.stringify({
            from_node: config.nodeId,
            to_node: target_node,
            gaii,
            amount,
            tracking_code,
            reason: reason ?? 'operator_settlement',
            timestamp: settlementTimestamp,
        });
        const settlementSignature = await sign(nodeKey.privateKey, settlementPayload);

        try {
            // SSRF validation
            const settleUrlCheck = await validateOutboundUrl(peer.url);
            if (!settleUrlCheck.valid) {
                res.status(400).json(error(config.nodeId, 'INVALID_URL', settleUrlCheck.reason ?? 'URL validation failed'));
                return;
            }

            const response = await fetch(`${peer.url}/v1/federation/settle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from_node: config.nodeId,
                    to_node: target_node,
                    gaii,
                    amount,
                    tracking_code,
                    reason: reason ?? 'operator_settlement',
                    timestamp: settlementTimestamp,
                    signature: settlementSignature,
                }),
                signal: AbortSignal.timeout(30_000),
            });

            const data = await response.json().catch(() => null);

            if (response.ok) {
                logger.info(`Outbound settlement sent: ${amount} morsels for ${gaii} to node ${target_node} (tc: ${tracking_code})`);
                res.json(success(config.nodeId, {
                    sent: true,
                    target_node,
                    gaii,
                    amount,
                    tracking_code,
                    response_data: data,
                }));
            } else {
                res.status(response.status).json(error(config.nodeId, 'FEDERATION_ERROR',
                    `Settlement rejected by peer: ${JSON.stringify(data)}`));
            }
        } catch (err) {
            res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                `Failed to send settlement to ${target_node}: ${err instanceof Error ? err.message : 'unknown error'}`));
        }
    });

    // ── Phase 3.4: Genesis Peering ──

    // POST /v1/federation/genesis-peer — Request genesis peering (operator only)
    router.post('/v1/federation/genesis-peer', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const { genesisNodeId, genesisUrl, publicKey } = req.body;
            if (!genesisNodeId || !genesisUrl || !publicKey) {
                res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing: genesisNodeId, genesisUrl, publicKey'));
                return;
            }
            const peer = await genesisPeeringService.requestPeering(genesisNodeId, genesisUrl, publicKey);
            res.status(201).json(success(config.nodeId, {
                peer,
                semantic: {
                    '@context': { schema: 'https://schema.org/' },
                    '@type': 'schema:Organization',
                    'schema:memberOf': 'aimeat:CrossFederation',
                },
            }));
        } catch (err) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', String(err)));
        }
    });

    // GET /v1/federation/genesis-peers — List genesis peers (operator only)
    router.get('/v1/federation/genesis-peers', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const status = req.query.status as string | undefined;
            const peers = await storage.listGenesisPeers(status ? { status } : undefined);
            res.json(success(config.nodeId, {
                peers,
                total: peers.length,
                semantic: {
                    '@context': { schema: 'https://schema.org/' },
                    '@type': 'schema:ItemList',
                    'schema:itemListElement': 'schema:Organization',
                },
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // PUT /v1/federation/genesis-peer/:id/approve — Approve genesis peering
    router.put('/v1/federation/genesis-peer/:id/approve', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const peer = await genesisPeeringService.approvePeering(id);
            if (!peer) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }
            res.json(success(config.nodeId, { peer }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // DELETE /v1/federation/genesis-peer/:id — Remove genesis peering
    router.delete('/v1/federation/genesis-peer/:id', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const removed = await genesisPeeringService.removePeering(id);
            if (!removed) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }
            res.json(success(config.nodeId, { removed: true }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // GET /v1/federation/cross-catalogue — E.4: Enhanced cross-federation catalogue
    // Aggregates local CSMs + federated actions + genesis entries with filtering
    router.get('/v1/federation/cross-catalogue', async (req, res) => {
        try {
            const serviceType = req.query.service_type as string | undefined;
            const location = req.query.location as string | undefined;
            const keyword = req.query.keyword as string | undefined;
            const sourceFilter = req.query.source as string | undefined; // 'local' | 'federated' | 'genesis' | undefined (all)

            const entries: Array<Record<string, unknown>> = [];

            // 1. Local federable CSMs (unless filtering to genesis/federated only)
            if (!sourceFilter || sourceFilter === 'local') {
                const localCsms = await storage.listCsms(
                    serviceType ? { serviceType } : undefined,
                );
                for (const csm of localCsms) {
                    if (!csm.federate) continue;
                    if (keyword && !matchesKeyword(csm, keyword)) continue;
                    entries.push({
                        type: 'csm',
                        id: csm.name,
                        name: csm.name,
                        service_type: csm.serviceType,
                        source_node: config.nodeId,
                        source_type: 'local',
                        federated: true,
                    });
                }
            }

            // 2. Federated actions from same-genesis peers (tagged federated:*)
            if (!sourceFilter || sourceFilter === 'federated') {
                const allActions = await storage.listActions(
                    serviceType ? { category: serviceType } : undefined,
                );
                for (const action of allActions) {
                    const federatedTag = action.tags.find(t => t.startsWith('federated:'));
                    if (!federatedTag) continue;
                    if (keyword && !matchesActionKeyword(action, keyword)) continue;

                    entries.push({
                        type: 'action',
                        id: action.id,
                        display_name: action.displayName,
                        description: action.description,
                        category: action.category,
                        source_node: federatedTag.replace('federated:', ''),
                        source_type: 'federated',
                        pricing: {
                            base_morsels: action.pricing.baseMorsels,
                            per_unit: action.pricing.perUnit,
                        },
                        tags: action.tags,
                        semantic: action.semantic,
                    });
                }
            }

            // 3. Genesis entries (stored as memory with genesis:* prefix)
            if (!sourceFilter || sourceFilter === 'genesis') {
                try {
                    const genesisMemories = await storage.listMemory('__genesis__', { prefix: 'genesis:' });
                    for (const mem of genesisMemories) {
                        // Skip subscription metadata entries
                        if (mem.key.endsWith(':subscriptions')) continue;

                        const val = mem.value as Record<string, unknown>;
                        if (serviceType && val.service_type !== serviceType && val.category !== serviceType) continue;
                        if (keyword && !matchesGenesisKeyword(val, keyword)) continue;
                        if (location && !matchesLocation(val, location)) continue;

                        entries.push({
                            type: val.type ?? 'genesis_entry',
                            id: mem.key,
                            source_type: 'genesis',
                            source_genesis: val.source_genesis,
                            source_node: val.sourceNode ?? val.source_node,
                            fetched_at: val.fetched_at,
                            ...val,
                        });
                    }
                } catch {
                    // No genesis entries yet — that's fine
                }
            }

            // 4. Add active genesis peer metadata
            const activePeers = await storage.listGenesisPeers({ status: 'active' });
            const peerSummary = activePeers.map(p => ({
                node_id: p.genesisNodeId,
                url: p.genesisUrl,
                status: p.status,
                last_sync_at: p.lastSyncAt,
                catalogue_hash: p.catalogueHash,
            }));

            res.json(success(config.nodeId, {
                entries,
                total: entries.length,
                genesis_peers: peerSummary,
                catalogue_hash: await (async () => {
                    const { computeCatalogueHash: computeHash } = await import('../utils/catalogue-hash.js');
                    return computeHash(storage);
                })(),
                filters: {
                    service_type: serviceType ?? null,
                    location: location ?? null,
                    keyword: keyword ?? null,
                    source: sourceFilter ?? null,
                },
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // POST /v1/federation/genesis-catalogue-ingest — Receive catalogue push from genesis peer
    router.post('/v1/federation/genesis-catalogue-ingest', async (req, res) => {
        try {
            const { source_node, entries: ingestEntries, csms: ingestCsms, catalogue_hash, signature } = req.body ?? {};

            if (!source_node) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node required'));
                return;
            }

            // Verify the source is an active genesis peer
            const genesisPeer = await storage.getGenesisPeerByNodeId(source_node);
            if (!genesisPeer || genesisPeer.status !== 'active') {
                res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source is not an active genesis peer'));
                return;
            }

            // Verify signature if peer has a public key
            if (signature && genesisPeer.publicKey) {
                const payload = JSON.stringify({ source_node, entries: ingestEntries, csms: ingestCsms, catalogue_hash });
                const isValid = await verify(genesisPeer.publicKey, payload, signature);
                if (!isValid) {
                    res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on genesis catalogue ingest'));
                    return;
                }
            }

            const now = new Date().toISOString();
            let stored = 0;

            // Ensure __genesis__ system agent exists
            const agents = await storage.listAgents();
            if (!agents.find(a => a.gaii === '__genesis__')) {
                try {
                    await storage.createAgent({
                        name: '__genesis__',
                        owner: '__system__',
                        gaii: '__genesis__',
                        publicKey: '',
                        displayName: 'Genesis Sync System',
                        capabilities: ['genesis-sync'],
                        createdAt: now,
                        lastSeen: now,
                        trustScore: 100,
                        morselBalance: 0,
                    });
                } catch { /* may already exist */ }
            }

            // Store received entries as genesis memory
            const allEntries = [...(ingestEntries ?? []), ...(ingestCsms ?? [])];
            for (const entry of allEntries) {
                const entryId = (entry.id ?? entry.name ?? `ingest-${stored}`) as string;
                const key = `genesis:${source_node}:${entryId}`;

                await storage.setMemory({
                    key,
                    ownerGaii: '__genesis__',
                    value: {
                        ...entry,
                        source_genesis: source_node,
                        ingested_at: now,
                    },
                    visibility: 'public',
                    tags: ['genesis', `genesis:${source_node}`],
                    ttlHours: config.genesisMemoryCacheTtlHours || null,
                    version: 1,
                    createdAt: now,
                    updatedAt: now,
                });
                stored++;
            }

            // Update peer sync metadata
            await storage.updateGenesisPeer(genesisPeer.id, {
                lastSyncAt: now,
                catalogueHash: catalogue_hash ?? '',
                updatedAt: now,
            });

            res.json(success(config.nodeId, {
                stored,
                catalogue_hash: catalogue_hash ?? null,
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // POST /v1/federation/genesis-memory-read — E.2: Cross-genesis memory routing
    // Forwards memory read requests to genesis peers, aggregates responses
    router.post('/v1/federation/genesis-memory-read', requireAuth(), async (req, res) => {
        try {
            const { target_gaii, key, prefix, target_scope } = req.body ?? {};

            if (!target_gaii && !key && !prefix) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_gaii, key, or prefix required'));
                return;
            }

            // Only process genesis-scoped requests
            if (target_scope !== 'genesis') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_scope must be "genesis"'));
                return;
            }

            const activePeers = await storage.listGenesisPeers({ status: 'active' });
            if (activePeers.length === 0) {
                res.json(success(config.nodeId, { results: [], total: 0, peers_queried: 0 }));
                return;
            }

            // Check local genesis cache first (if enabled)
            if (config.genesisMemoryCache && key) {
                try {
                    const cachePrefix = 'genesis:';
                    const cachedEntries = await storage.listMemory('__genesis__', { prefix: cachePrefix });
                    const cached = cachedEntries.find(m => {
                        const val = m.value as Record<string, unknown>;
                        return val.key === key && (!target_gaii || val.gaii === target_gaii);
                    });
                    if (cached) {
                        const val = cached.value as Record<string, unknown>;
                        res.json(success(config.nodeId, {
                            results: [{
                                key: val.key,
                                value: val.value,
                                source_genesis: val.source_genesis,
                                source_node: val.source_node,
                                cached: true,
                            }],
                            total: 1,
                            peers_queried: 0,
                            from_cache: true,
                        }));
                        return;
                    }
                } catch {
                    // Cache miss — proceed to query peers
                }
            }

            // Forward to genesis peers
            const results: Array<Record<string, unknown>> = [];
            let peersQueried = 0;

            const peerPromises = activePeers.map(async (peer) => {
                try {
                    const urlCheck = await validateOutboundUrl(peer.genesisUrl);
                    if (!urlCheck.valid) return;

                    const queryParams = new URLSearchParams();
                    if (target_gaii) queryParams.set('gaii', target_gaii);
                    if (key) queryParams.set('key', key);
                    if (prefix) queryParams.set('prefix', prefix);

                    const resp = await fetch(
                        `${peer.genesisUrl}/v1/federation/genesis-memory-read?${queryParams}`,
                        {
                            method: 'GET',
                            headers: { 'Accept': 'application/json' },
                            signal: AbortSignal.timeout(config.federationTimeoutMs),
                        },
                    );

                    peersQueried++;

                    if (!resp.ok) return;

                    const body = await resp.json() as {
                        data?: { results?: Array<Record<string, unknown>> };
                    };

                    if (body.data?.results) {
                        for (const result of body.data.results) {
                            results.push({
                                ...result,
                                source_genesis: peer.genesisNodeId,
                            });
                        }
                    }
                } catch {
                    // Skip failed peer
                }
            });

            await Promise.allSettled(peerPromises);

            // Optionally cache results
            if (config.genesisMemoryCache && results.length > 0) {
                const now = new Date().toISOString();
                for (const result of results) {
                    try {
                        const cacheKey = `genesis-cache:${result.source_genesis}:${result.key ?? 'unknown'}`;
                        await storage.setMemory({
                            key: cacheKey,
                            ownerGaii: '__genesis__',
                            value: result,
                            visibility: 'public',
                            tags: ['genesis-cache'],
                            ttlHours: config.genesisMemoryCacheTtlHours,
                            version: 1,
                            createdAt: now,
                            updatedAt: now,
                        });
                    } catch {
                        // Cache write failure is non-critical
                    }
                }
            }

            res.json(success(config.nodeId, {
                results,
                total: results.length,
                peers_queried: peersQueried,
                from_cache: false,
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // GET /v1/federation/genesis-memory-read — E.2: Local memory read handler for genesis peer queries
    // Responds to incoming genesis peer memory read requests
    router.get('/v1/federation/genesis-memory-read', async (req, res) => {
        try {
            const gaii = req.query.gaii as string | undefined;
            const key = req.query.key as string | undefined;
            const prefix = req.query.prefix as string | undefined;

            if (!gaii && !key && !prefix) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'gaii, key, or prefix required'));
                return;
            }

            const results: Array<Record<string, unknown>> = [];

            if (gaii && key) {
                // Direct lookup
                const memory = await storage.getMemory(gaii, key);
                if (memory && memory.visibility === 'public') {
                    // Check for federation consent
                    const consents = await storage.listConsents(gaii);
                    const hasConsent = consents.some(c =>
                        c.status === 'active' && c.scope === 'federation',
                    );
                    if (hasConsent) {
                        results.push({
                            key: memory.key,
                            gaii: memory.ownerGaii,
                            value: memory.value,
                            visibility: memory.visibility,
                            version: memory.version,
                            source_node: config.nodeId,
                            updated_at: memory.updatedAt,
                        });
                    }
                }
            } else if (gaii && prefix) {
                // Prefix search for a specific agent
                const memories = await storage.listMemory(gaii, { prefix, visibility: 'public' });
                const consents = await storage.listConsents(gaii);
                const hasConsent = consents.some(c =>
                    c.status === 'active' && c.scope === 'federation',
                );

                if (hasConsent) {
                    for (const memory of memories) {
                        if (memory.key.startsWith('replica:') || memory.key.startsWith('genesis:') ||
                            memory.key.startsWith('expiring:')) continue;

                        results.push({
                            key: memory.key,
                            gaii: memory.ownerGaii,
                            value: memory.value,
                            visibility: memory.visibility,
                            version: memory.version,
                            source_node: config.nodeId,
                            updated_at: memory.updatedAt,
                        });
                    }
                }
            } else if (prefix) {
                // Prefix search across all agents
                const agents = await storage.listAgents();
                for (const agent of agents) {
                    if (agent.gaii === '__genesis__') continue;
                    try {
                        const consents = await storage.listConsents(agent.gaii);
                        const hasConsent = consents.some(c =>
                            c.status === 'active' && c.scope === 'federation',
                        );
                        if (!hasConsent) continue;

                        const memories = await storage.listMemory(agent.gaii, { prefix, visibility: 'public' });
                        for (const memory of memories) {
                            if (memory.key.startsWith('replica:') || memory.key.startsWith('genesis:') ||
                                memory.key.startsWith('expiring:')) continue;

                            results.push({
                                key: memory.key,
                                gaii: memory.ownerGaii,
                                value: memory.value,
                                visibility: memory.visibility,
                                version: memory.version,
                                source_node: config.nodeId,
                                updated_at: memory.updatedAt,
                            });
                        }
                    } catch { /* skip agent */ }
                }
            }

            res.json(success(config.nodeId, {
                results,
                total: results.length,
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // PUT /v1/federation/genesis-peer/:id/subscriptions — E.3: Set memory prefix subscriptions
    router.put('/v1/federation/genesis-peer/:id/subscriptions', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const { prefixes } = req.body ?? {};

            if (!Array.isArray(prefixes)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'prefixes array required'));
                return;
            }

            const peer = await storage.getGenesisPeer(id);
            if (!peer) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }

            // Store subscription preferences as memory
            const now = new Date().toISOString();
            const subscriptionKey = `genesis:${peer.genesisNodeId}:subscriptions`;

            // Ensure __genesis__ system agent exists
            const agents = await storage.listAgents();
            if (!agents.find(a => a.gaii === '__genesis__')) {
                try {
                    await storage.createAgent({
                        name: '__genesis__',
                        owner: '__system__',
                        gaii: '__genesis__',
                        publicKey: '',
                        displayName: 'Genesis Sync System',
                        capabilities: ['genesis-sync'],
                        createdAt: now,
                        lastSeen: now,
                        trustScore: 100,
                        morselBalance: 0,
                    });
                } catch { /* may already exist */ }
            }

            await storage.setMemory({
                key: subscriptionKey,
                ownerGaii: '__genesis__',
                value: { prefixes, updated_at: now },
                visibility: 'public',
                tags: ['genesis-subscriptions'],
                ttlHours: null,
                version: 1,
                createdAt: now,
                updatedAt: now,
            });

            res.json(success(config.nodeId, {
                peer_id: id,
                peer_node_id: peer.genesisNodeId,
                subscribed_prefixes: prefixes,
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // GET /v1/federation/genesis-peer/:id/subscriptions — E.3: Get memory prefix subscriptions
    router.get('/v1/federation/genesis-peer/:id/subscriptions', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const peer = await storage.getGenesisPeer(id);
            if (!peer) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }

            const subscriptionKey = `genesis:${peer.genesisNodeId}:subscriptions`;
            const record = await storage.getMemory('__genesis__', subscriptionKey);

            const subscriptions = record
                ? (record.value as { prefixes?: string[] }).prefixes ?? []
                : [];

            res.json(success(config.nodeId, {
                peer_id: id,
                peer_node_id: peer.genesisNodeId,
                subscribed_prefixes: subscriptions,
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // GET /v1/federation/network-stats — Network statistics
    router.get('/v1/federation/network-stats', async (_req, res) => {
        try {
            const stats = await genesisPeeringService.getNetworkStats();
            res.json(success(config.nodeId, { stats }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // PUT /v1/federation/genesis-peer/:id/suspend — Suspend genesis peering
    router.put('/v1/federation/genesis-peer/:id/suspend', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const peer = await genesisPeeringService.suspendPeering(id);
            if (!peer) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }
            res.json(success(config.nodeId, { peer }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // ── Phase 3.4: Organism Reputation ──

    const organismReputationService = createOrganismReputationService(config, storage);

    // GET /v1/organisms/:id/reputation — Get organism reputation score
    router.get('/v1/organisms/:id/reputation', async (req, res) => {
        try {
            const id = req.params.id as string;
            const reputation = await organismReputationService.calculateReputation(id);
            if (!reputation) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Organism not found: ${id}`));
                return;
            }
            res.json(success(config.nodeId, {
                reputation,
                semantic: {
                    '@context': { schema: 'https://schema.org/' },
                    '@type': 'schema:Rating',
                    'schema:ratingValue': reputation.score,
                    'schema:bestRating': 100,
                    'schema:worstRating': 0,
                },
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    return router;
}
