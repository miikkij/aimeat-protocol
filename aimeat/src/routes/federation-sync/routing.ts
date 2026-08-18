/**
 * @file src/routes/federation-sync/routing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cross-node query routing — multi-hop relay with signed route manifest + routing-fee debit,
 *   GAII→node resolution, and cross-node work submission. Extracted from federation-sync.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from federation-sync.ts (max-file-lines)
 */

import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireOwnerPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { sign } from '../../auth/keypair.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import type { RouteHop, RouteManifest } from '../../types/route-manifest.js';
import { buildHopSigningMessage } from '../../types/route-manifest.js';
import { emitChange } from '../../services/event-bus.js';

export function registerRoutingRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // ── Cross-Node Query Routing ──

    // POST /v1/federation/route — Forward a request to a peer node (multi-hop relay).
    //
    // A23 (E2E test-quality audit). This is an OUTBOUND call made in this node's name, charged to
    // this node's relationship with its peers, and it carried requireAuth() alone — so any principal
    // that could authenticate at all could drive the relay, including a scope-limited app grant.
    // requireOwnerPrincipal is the narrow answer and it costs nothing measurable: greps across
    // public/ (the SPA), src/mcp/ (no tool reaches it), src/static/sdk-libs/ and python/aimeat-crewai
    // find ZERO callers, and federation-multinode drives it with an owner token. The wider answer —
    // a `federation:relay` word an agent could hold — is available the day someone wants an agent to
    // relay; it is not invented here for a caller that does not exist.
    router.post('/v1/federation/route', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
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

                const data = await response.json().catch(err => { logger.warn('buildLocalHop: continuing after a suppressed failure', { error: String(err) }); return null; });
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
                    const data = await response.json().catch(err => { logger.warn('buildLocalHop: continuing after a suppressed failure', { error: String(err) }); return null; });
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
            } catch (err) {
                // Try next relay
              logger.warn('buildLocalHop: continuing after a suppressed failure', { error: String(err) });
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
            } catch (err) {
                // Continue to next peer
              logger.warn('GET /v1/federation/resolve/:gaii: continuing after a suppressed failure', { error: String(err) });
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

            const data = await response.json().catch(err => { logger.warn('POST /v1/federation/cross-node/work: continuing after a suppressed failure', { error: String(err) }); return null; });

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
}
