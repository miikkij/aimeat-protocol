/**
 * @file federation-sync.ts
 * @description Federation sync routes — memory replication, catalogue sync,
 *   trust advisories, cross-node query routing, GAII resolution,
 *   cross-node work submission, and cross-node template sharing.
 * @version-history
 *   v1.0.0 — 2026-03-15 — Initial federation sync routes
 *   v1.1.0 — 2026-03-20 — Add federation template endpoints (GET /v1/federation/templates, POST /v1/federation/templates/sync)
 */

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { logger } from '../utils/logger.js';
import type { PeerInfo } from '../services/federation.js';
import { sign, verify } from '../auth/keypair.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import type { RouteHop, RouteManifest } from '../types/route-manifest.js';
import { buildHopSigningMessage } from '../types/route-manifest.js';
import { emitChange } from '../services/event-bus.js';

export function federationSyncRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

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

        if (!peer.replicateMemory) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'This peer has memory replication disabled'));
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
                emitChange('federation');
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
        emitChange('federation');
    });

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

        if (!peer.shareCatalogue) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'This peer has catalogue sharing disabled'));
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
        emitChange('federation');
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
        emitChange('federation');
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

        if (targetPeer && !targetPeer.allowRouting) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'Routing is disabled for this peer'));
            return;
        }

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
                emitChange('federation');
            } catch (err) {
                res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                    `Failed to reach peer ${target_node}: ${err instanceof Error ? err.message : 'unknown error'}`));
            }
            return;
        }

        // 2. Not a direct peer — try multi-hop relay through active peers
        const activePeers = [...peers.values()].filter(p =>
            p.status === 'active' && p.allowRouting && !pathNodes.includes(p.nodeId));
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
                        'Authorization': req.headers.authorization ?? '',
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
                    emitChange('federation');
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
            emitChange('federation');
        } catch (err) {
            res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                `Failed to submit cross-node work: ${err instanceof Error ? err.message : 'unknown error'}`));
        }
    });

    // ── Federation Template Sharing ──

    // GET /v1/federation/templates — Serve template listings to peer nodes
    router.get('/v1/federation/templates', async (req, res) => {
        if (!config.packageFederationEnabled) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Package federation is not enabled on this node'));
            return;
        }

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

        const category = req.query.category as string | undefined;
        const tagsRaw = req.query.tags as string | undefined;
        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined;
        const search = req.query.search as string | undefined;
        const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);
        const offset = parseInt(req.query.offset as string || '0', 10);

        const { listings } = await storage.listTemplateListings({
            status: 'listed',
            category,
            tags,
            search,
            limit,
            offset,
        });

        // Enrich with package data
        const templates = [];
        for (const l of listings) {
            const pkg = await storage.getLatestPublished(l.packageGroupId);
            const componentTypes = pkg ? [...new Set(pkg.components.map(c => c.type))] : [];
            const componentCount = pkg ? pkg.components.length : 0;
            const sizeMb = pkg
                ? pkg.components.reduce((sum, c) => sum + Buffer.byteLength(c.content, 'utf8'), 0) / (1024 * 1024)
                : 0;

            templates.push({
                name: l.packageName,
                author: l.packageAuthor,
                sourceNode: config.nodeId,
                packageGroupId: l.packageGroupId,
                title: l.title,
                description: l.description,
                category: l.category,
                tags: l.tags,
                rating: l.rating,
                installCount: l.installCount,
                reviewCount: l.reviewCount,
                componentTypes,
                componentCount,
                sizeMb: Math.round(sizeMb * 100) / 100,
            });
        }

        res.json(success(config.nodeId, { templates }));
    });

    // POST /v1/federation/templates/sync — Pull templates from all active peers
    router.post('/v1/federation/templates/sync', requireAuth(), requireRole('operator'), async (req, res) => {
        if (!config.packageFederationEnabled) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Package federation is not enabled on this node'));
            return;
        }

        const activePeers = [...peers.values()].filter(p => p.status === 'active');
        const results: { node: string; templates: number; error?: string }[] = [];

        for (const peer of activePeers) {
            try {
                const peerUrl = `${peer.url}/v1/federation/templates?limit=100`;
                const urlCheck = await validateOutboundUrl(peerUrl);
                if (!urlCheck.valid) {
                    results.push({ node: peer.nodeId, templates: 0, error: urlCheck.reason ?? 'URL validation failed' });
                    continue;
                }

                const response = await fetch(peerUrl, {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-source-node': config.nodeId,
                    },
                    signal: AbortSignal.timeout(30_000),
                });

                if (response.ok) {
                    const data = await response.json() as { data?: { templates?: unknown[] } };
                    const templateCount = Array.isArray(data?.data?.templates) ? data.data.templates.length : 0;
                    results.push({ node: peer.nodeId, templates: templateCount });
                } else {
                    results.push({ node: peer.nodeId, templates: 0, error: `HTTP ${response.status}` });
                }
            } catch (err) {
                results.push({
                    node: peer.nodeId,
                    templates: 0,
                    error: err instanceof Error ? err.message : 'unknown error',
                });
            }
        }

        emitChange('templates');
        res.json(success(config.nodeId, { syncResults: results }));
    });

    return router;
}
