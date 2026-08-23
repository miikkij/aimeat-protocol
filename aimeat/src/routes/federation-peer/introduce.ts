/**
 * @file src/routes/federation-peer/introduce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federation peer directory + node-to-node introduction/handshake routes (directory,
 *   service-summary, signed introduce, peering-request CRUD, readiness test). Extracted from federation-peer.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from federation-peer.ts (max-file-lines)
 */

import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { executeHooks } from '../../services/hooks.js';
import { PeeringRequestSchema, validateBody } from '../../models/schemas.js';
import type { PeerInfo } from '../../services/federation.js';
import { verify } from '../../auth/keypair.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { emitChange } from '../../services/event-bus.js';
import { performKeyExchange } from '../../services/federation-helpers.js';
import { computeServiceSummary } from '../../utils/service-summary.js';
import { deriveTierFlags, type PeerTier } from '../../services/federation-tiers.js';
import { consumeLinkInvite } from '../../services/link-invites.js';
import { getActivePolicy, evaluateAutoAdmit } from '../../services/network-policy.js';
import { logger } from '../../utils/logger.js';

export function registerIntroduceRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // GET /v1/federation/directory — public peer directory (Tier 0)
    router.get('/v1/federation/directory', async (_req, res) => {
        const peerList = [...peers.values()]
            .filter(p => p.peerMode !== 'private')
            .map(p => ({
                node_id: p.nodeId,
                url: p.url,
                status: p.status,
                last_seen: p.lastSeen,
                tier: p.tier ?? 'member',
                availability: p.availability ?? null,
                software_version: p.softwareVersion ?? null,
                expires_at: p.expiresAt ?? null,
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
        const { node_id, node_url, public_key, role, message, signature, timestamp, invite_token } = req.body ?? {};

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
        } catch (err) {
          logger.warn('introduce: suppressed failure, continuing', { error: String(err) });
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

        // ── Open federation join (opt-in) ──
        // When the operator has enabled open join, a verified introduction self-admits
        // as a LOW-TRUST 'visiting' peer immediately — no manual approval. Visiting
        // peers can browse/discover + request paid work, but get NO provider/relay/
        // memory-replication/federated-auth rights (deriveTierFlags('visiting')).
        // Reaching 'member' still requires a deliberate local-operator promotion.
        // Network policy may further gate (or disable) auto-admit by domain/protocol.
        // An INVITE this node minted earlier. Its tier is this node's own decision quoted back, which
        // is why the tier is read from the stored invite and never from the request body — a door that
        // believes a caller's claim about its own trust level is not a door (the F1 finding in
        // lifecycle.ts). An unknown, expired or already-used token is not an error: it falls through
        // to the ordinary pending path below, so a leaked token is worth one link, at one tier, once.
        const invited = await consumeLinkInvite(storage, invite_token, node_id);

        const policy = await getActivePolicy(storage);
        const policyAdmit = evaluateAutoAdmit({ node_url }, policy);
        if (invited.ok || (config.federationOpenJoin && policyAdmit.allowed)) {
            const admitTier: PeerTier = invited.ok ? invited.tier : 'visiting';
            // SSRF: node_url drives the outbound key-exchange below.
            const urlCheck = await validateOutboundUrl(node_url);
            if (!urlCheck.valid) {
                res.status(400).json(error(config.nodeId, 'INVALID_URL', urlCheck.reason ?? 'node_url failed validation'));
                return;
            }

            const admittedPeer: PeerInfo = {
                nodeId: node_id,
                url: node_url,
                publicKey: public_key,
                status: 'active',
                addedAt: now,
                lastSeen: now,
                ...deriveTierFlags(admitTier),
                tier: admitTier,
            };
            peers.set(node_id, admittedPeer);
            await storage.saveFederationPeer(admittedPeer);

            // Record the (auto-approved) request for audit + reciprocal auto-add on key exchange.
            await storage.createPeeringRequest({
                id,
                fromNodeUrl: node_url,
                fromNodeId: node_id,
                toNodeId: config.nodeId,
                targetUrl: node_url,
                publicKey: public_key,
                message: message ?? '',
                status: 'auto_approved',
                // The tier this admission was for. The key-exchange auto-add reads it, so a de-peered
                // link cannot come back one rung higher than it was let in at.
                tier: admitTier,
                createdAt: now,
                updatedAt: now,
            });

            const keyExchange = await performKeyExchange(node_url, config, storage)
                .catch(() => ({ success: false }));

            res.status(200).json(success(config.nodeId, {
                request_id: id,
                status: 'active',
                tier: admitTier,
                key_exchange: keyExchange.success ? 'completed' : 'failed',
                message: admitTier === 'contact'
                    ? 'Linked for messages. Direct messages cross this link and nothing else does: no catalogue, no memory, no routing, and neither node is listed in the public directory of the other.'
                    : 'Joined as a visiting node. Browse the catalogue and request work; ask the operator to promote you to a full member.',
            }, [
                { description: 'Browse the federation directory', method: 'GET', url: '/v1/federation/directory' },
            ]));
            emitChange('federation');
            return;
        }

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
}
