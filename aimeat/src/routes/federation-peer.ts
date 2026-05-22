/**
 * Federation peer routes — peer directory, introduction, key exchange,
 * heartbeat, peering request CRUD, peer management, and connectivity test.
 */

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
import { sign, verify } from '../auth/keypair.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { emitChange } from '../services/event-bus.js';
import { peerKeyCache, performKeyExchange } from '../services/federation-helpers.js';
import { computeServiceSummary, computeSummaryHash } from '../utils/service-summary.js';

/** Cached service summary hash to avoid recomputing on every ping (60s TTL). */
let cachedSummaryHash = '';
let summaryHashExpiry = 0;

export function federationPeerRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    // GET /v1/federation/directory — public peer directory (Tier 0)
    router.get('/v1/federation/directory', async (_req, res) => {
        const peerList = [...peers.values()]
            .filter(p => p.peerMode !== 'private')
            .map(p => ({
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

    // GET /v1/federation/service-summary — return compact summary of all federated items
    // Used by hub nodes to aggregate service listings from peers.
    router.get('/v1/federation/service-summary', async (req, res) => {
        const sourceNode = req.headers['x-source-node'] as string | undefined;
        if (!sourceNode) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'x-source-node header is required'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === sourceNode);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }

        if (!peer.shareCatalogue) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'Catalogue sharing is disabled for this peer'));
            return;
        }

        const summary = await computeServiceSummary(config, storage);
        res.json(success(config.nodeId, summary));
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
        let valid: boolean;
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

        // Check if already a peer (allow re-introduction if depeering/offline)
        const existingPeer = peers.get(node_id);
        if (existingPeer && existingPeer.status !== 'depeering' && existingPeer.status !== 'offline') {
            res.status(409).json(error(config.nodeId, 'CONFLICT', `Node "${node_id}" is already a peer`));
            return;
        }
        if (existingPeer) {
            peers.delete(node_id);
            await storage.deleteFederationPeer(node_id);
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
        emitChange('federation');
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
        emitChange('federation');
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
        emitChange('federation');
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

        // If approved, add to peers list and persist
        if (decision === 'approve') {
            const now = new Date().toISOString();
            const peerInfo: PeerInfo = {
                nodeId: request.fromNodeId ?? request.id,
                url: request.targetUrl ?? request.fromNodeUrl,
                publicKey: request.publicKey ?? '',
                status: 'approved',
                addedAt: now,
                lastSeen: now,
                shareCatalogue: true,
                replicateMemory: true,
                allowRouting: true,
                peerMode: 'federation',
                allowFederatedAuth: false,
                federationAuthScopes: [],
            };
            peers.set(peerInfo.nodeId, peerInfo);
            await storage.saveFederationPeer(peerInfo);
        }

        res.json(success(config.nodeId, {
            id,
            decision,
            reason,
            status: newStatus,
        }));
        emitChange('federation');
    });

    // DELETE /v1/admin/peering/requests/:id — delete a peering request (operator)
    router.delete('/v1/admin/peering/requests/:id', requireAuth(), requireRole('operator'), async (req, res) => {
        const id = req.params.id as string;
        const deleted = await storage.deletePeeringRequest(id);
        if (!deleted) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Peering request not found: ${id}`));
            return;
        }
        res.json(success(config.nodeId, { id, deleted: true }));
        emitChange('federation');
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
        await storage.saveFederationPeer(peer);

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
        emitChange('federation');
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
                let valid: boolean;
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
        emitChange('federation');
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
            share_catalogue: p.shareCatalogue ?? true,
            replicate_memory: p.replicateMemory ?? true,
            allow_routing: p.allowRouting ?? true,
            peer_mode: p.peerMode ?? 'federation',
            allow_federated_auth: p.allowFederatedAuth ?? false,
            federation_auth_scopes: p.federationAuthScopes ?? [],
            ...((p as PeerInfo & { depeerGraceEnd?: string }).depeerGraceEnd
                ? { depeer_grace_end: (p as PeerInfo & { depeerGraceEnd?: string }).depeerGraceEnd } : {}),
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
        const peerInfo: PeerInfo = {
            nodeId: node_id,
            url,
            publicKey: public_key ?? '',
            status: 'pending',
            addedAt: now,
            lastSeen: now,
            shareCatalogue: true,
            replicateMemory: true,
            allowRouting: true,
            peerMode: 'federation',
            allowFederatedAuth: false,
            federationAuthScopes: [],
        };
        peers.set(node_id, peerInfo);
        await storage.saveFederationPeer(peerInfo);

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
        emitChange('federation');
    });

    // PUT /v1/federation/peers/:nodeId — update peer config (operator only)
    router.put('/v1/federation/peers/:nodeId', requireAuth(), requireRole('operator'), async (req, res) => {
        const nodeId = req.params.nodeId as string;
        const peer = peers.get(nodeId);
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Peer not found: ${nodeId}`));
            return;
        }

        const { url, public_key, status, share_catalogue, replicate_memory, allow_routing, peer_mode, allow_federated_auth, federation_auth_scopes } = req.body ?? {};
        if (url) peer.url = url;
        if (public_key) peer.publicKey = public_key;
        if (status) peer.status = status;
        if (typeof share_catalogue === 'boolean') peer.shareCatalogue = share_catalogue;
        if (typeof replicate_memory === 'boolean') peer.replicateMemory = replicate_memory;
        if (typeof allow_routing === 'boolean') peer.allowRouting = allow_routing;
        if (peer_mode === 'federation' || peer_mode === 'private') peer.peerMode = peer_mode;
        if (typeof allow_federated_auth === 'boolean') peer.allowFederatedAuth = allow_federated_auth;
        if (Array.isArray(federation_auth_scopes)) peer.federationAuthScopes = federation_auth_scopes;
        await storage.saveFederationPeer(peer);

        res.json(success(config.nodeId, {
            node_id: nodeId,
            url: peer.url,
            status: peer.status,
            share_catalogue: peer.shareCatalogue,
            replicate_memory: peer.replicateMemory,
            allow_routing: peer.allowRouting,
            peer_mode: peer.peerMode,
            allow_federated_auth: peer.allowFederatedAuth,
            federation_auth_scopes: peer.federationAuthScopes,
            updated: true,
        }));
        emitChange('federation');
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
        const { from_node } = req.body ?? {};

        if (from_node && peers.has(from_node)) {
            const peer = peers.get(from_node)!;
            peer.lastSeen = new Date().toISOString();
            peer.status = 'active';
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
            // Auto-add if sender is our genesis node, or we have an approved peering request from them
            const senderUrl = node_url as string | undefined;
            const isGenesis = config.genesisUrl && senderUrl && config.genesisUrl.replace(/\/+$/, '') === senderUrl.replace(/\/+$/, '');
            const requests = await storage.listPeeringRequests();
            const hasApprovedRequest = requests.some(r => r.fromNodeId === node_id && (r.status === 'approved' || r.status === 'auto_approved'));

            if ((isGenesis || hasApprovedRequest) && senderUrl) {
                const now = new Date().toISOString();
                const newPeer: PeerInfo = {
                    nodeId: node_id,
                    url: senderUrl,
                    publicKey: node_public_key,
                    status: 'active',
                    addedAt: now,
                    lastSeen: now,
                    shareCatalogue: true,
                    replicateMemory: true,
                    allowRouting: true,
                    peerMode: 'federation',
                    allowFederatedAuth: false,
                    federationAuthScopes: [],
                };
                peers.set(node_id, newPeer);
                await storage.saveFederationPeer(newPeer);
                peer = newPeer;
                logger.info(`Auto-added peer ${node_id} during key exchange (reciprocal peering)`);
            } else {
                res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                    `Node ${node_id} is not a recognized peer`));
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

    return router;
}
