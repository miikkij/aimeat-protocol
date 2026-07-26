/**
 * @file src/routes/federation-peer/peers.ts
 * @description Peering-request admin decisions + peer lifecycle routes (approve/reject/delete requests,
 *   activate, heartbeat, presence, peer list/add/update, visiting→member promotion). Extracted from federation-peer.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from federation-peer.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { PeeringDecisionSchema, validateBody } from '../../models/schemas.js';
import type { PeerInfo } from '../../services/federation.js';
import { verify } from '../../auth/keypair.js';
import { emitChange } from '../../services/event-bus.js';
import { performKeyExchange } from '../../services/federation-helpers.js';
import { presence, presenceSignString, type PresenceUpdate } from '../../services/presence.js';
import { deriveTierFlags, coerceTier } from '../../services/federation-tiers.js';
import { getActivePolicy, evaluatePromotion } from '../../services/network-policy.js';
import { promotionMetrics } from './promotion.js';

export function registerPeersRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
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
                ...deriveTierFlags('member'),
                tier: 'member',
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
        const { from_node_id, timestamp, signature } = req.body ?? {};

        if (from_node_id && peers.has(from_node_id)) {
            const peer = peers.get(from_node_id)!;

            // SECURITY: Verify heartbeat signature if peer has a public key
            if (peer.publicKey && signature) {
                const messageToVerify = `${from_node_id}${timestamp}`;
                let valid: boolean;
                try {
                    valid = await verify(peer.publicKey, messageToVerify, signature);
                } catch (err) {
                  logger.warn('peers: suppressed failure, continuing', { error: String(err) });
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

    // POST /v1/federation/presence — receive a peer's presence push (snapshot or delta)
    // SECURITY: must come from a known active peer with a valid Ed25519 signature.
    router.post('/v1/federation/presence', async (req, res) => {
        const { from_node_id, timestamp, updates, signature } = req.body ?? {};

        if (!from_node_id || !timestamp || !Array.isArray(updates)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'from_node_id, timestamp, and updates[] are required'));
            return;
        }

        const peer = peers.get(from_node_id) ?? [...peers.values()].find(p => p.nodeId === from_node_id);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }

        // Timestamp freshness (5-minute window)
        const ts = new Date(timestamp).getTime();
        if (isNaN(ts) || Math.abs(Date.now() - ts) > 300_000) {
            res.status(400).json(error(config.nodeId, 'STALE_TIMESTAMP', 'Timestamp is missing, invalid, or outside the 5-minute window'));
            return;
        }

        // Verify signature over the canonical (from_node_id|timestamp|updates) string.
        if (peer.publicKey) {
            let valid: boolean;
            try {
                valid = await verify(peer.publicKey, presenceSignString(from_node_id, timestamp, updates as PresenceUpdate[]), signature);
            } catch (err) {
              logger.warn('peers: suppressed failure, continuing', { error: String(err) });
                valid = false;
            }
            if (!valid) {
                res.status(401).json(error(config.nodeId, 'INVALID_SIGNATURE', 'Presence signature verification failed'));
                return;
            }
        }

        presence.applyRemoteUpdates(from_node_id, updates as PresenceUpdate[]);
        res.json(success(config.nodeId, { accepted: true, count: updates.length }));
    });

    // GET /v1/federation/peers — list active peers (operator auth)
    router.get('/v1/federation/peers', requireAuth(), requireRole('operator'), async (_req, res) => {
        // Compute promotion eligibility for visiting peers (one work scan + policy fetch reused).
        const policy = await getActivePolicy(storage);
        const allWork = await storage.listAllWork().catch(err => { logger.warn('GET /v1/federation/peers: continuing after a suppressed failure', { error: String(err) }); return []; }) as unknown as { status: string; providerGaii: string; requesterGaii: string }[];
        const peerList = await Promise.all([...peers.values()].map(async p => {
            let promotion_eligible: boolean | undefined;
            let promotion_failing: string[] | undefined;
            if ((p.tier ?? 'member') === 'visiting') {
                const verdict = evaluatePromotion(await promotionMetrics(storage, p, allWork), policy);
                promotion_eligible = verdict.eligible;
                promotion_failing = verdict.failing;
            }
            return {
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
                tier: p.tier ?? 'member',
                availability: p.availability ?? null,
                availability_pct: p.availabilityPct ?? null,
                heartbeat_ok: p.heartbeatOk ?? 0,
                heartbeat_total: p.heartbeatTotal ?? 0,
                software_version: p.softwareVersion ?? null,
                expires_at: p.expiresAt ?? null,
                ...(promotion_eligible !== undefined ? { promotion_eligible, promotion_failing } : {}),
                ...((p as PeerInfo & { depeerGraceEnd?: string }).depeerGraceEnd
                    ? { depeer_grace_end: (p as PeerInfo & { depeerGraceEnd?: string }).depeerGraceEnd } : {}),
            };
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
            ...deriveTierFlags('member'),
            tier: 'member',
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

        const { url, public_key, status, share_catalogue, replicate_memory, allow_routing, peer_mode, allow_federated_auth, federation_auth_scopes, tier } = req.body ?? {};
        if (url) peer.url = url;
        if (public_key) peer.publicKey = public_key;
        if (status) peer.status = status;

        // Tier change (e.g. promote visiting → member) re-derives the canonical flags first,
        // so a promotion grants the full member capability set in one step. Explicit flag
        // fields below may still override afterwards.
        const currentTier = coerceTier(peer.tier);
        if (tier === 'genesis' || tier === 'member' || tier === 'visiting') {
            peer.tier = tier;
            Object.assign(peer, deriveTierFlags(tier));
        }
        const effectiveTier = coerceTier(peer.tier);

        // Guard: a 'visiting' peer must not be silently granted provider/relay/replication/auth
        // via flag fields — those caps require an actual tier change (promotion). Catalogue read
        // and peerMode remain freely editable.
        const blockElevation = effectiveTier === 'visiting';
        if (typeof share_catalogue === 'boolean') peer.shareCatalogue = share_catalogue;
        if (typeof replicate_memory === 'boolean' && !(blockElevation && replicate_memory)) peer.replicateMemory = replicate_memory;
        if (typeof allow_routing === 'boolean' && !(blockElevation && allow_routing)) peer.allowRouting = allow_routing;
        if (peer_mode === 'federation' || peer_mode === 'private') peer.peerMode = peer_mode;
        if (typeof allow_federated_auth === 'boolean' && !(blockElevation && allow_federated_auth)) peer.allowFederatedAuth = allow_federated_auth;
        if (Array.isArray(federation_auth_scopes) && !blockElevation) peer.federationAuthScopes = federation_auth_scopes;
        await storage.saveFederationPeer(peer);

        res.json(success(config.nodeId, {
            node_id: nodeId,
            url: peer.url,
            status: peer.status,
            tier: peer.tier ?? currentTier,
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

    // POST /v1/federation/peers/:nodeId/promote — promote a visiting peer to full member.
    // This is the local operator's deliberate "vouch" (100% trust in the person who brought the
    // node). Eligibility is measured against the active network policy; an operator may override a
    // not-yet-eligible peer with { force: true } (audited) — the human vouch is itself the trust source.
    router.post('/v1/federation/peers/:nodeId/promote', requireAuth(), requireRole('operator'), async (req, res) => {
        const nodeId = req.params.nodeId as string;
        const peer = peers.get(nodeId) ?? [...peers.values()].find(p => p.nodeId === nodeId);
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Peer not found: ${nodeId}`));
            return;
        }
        const force = req.body?.force === true;
        const policy = await getActivePolicy(storage);
        const verdict = evaluatePromotion(await promotionMetrics(storage, peer), policy);
        if (!verdict.eligible && !force) {
            res.status(409).json(error(config.nodeId, 'NOT_ELIGIBLE', `Peer does not meet promotion criteria: ${verdict.failing.join(', ')}`, undefined, { failing: verdict.failing }));
            return;
        }

        peer.tier = 'member';
        Object.assign(peer, deriveTierFlags('member'));
        await storage.saveFederationPeer(peer);
        logger.info(`Peer ${nodeId} promoted to member`, { forced: !force ? false : !verdict.eligible, by: req.auth?.owner, failing: verdict.failing });

        res.json(success(config.nodeId, {
            node_id: nodeId,
            tier: peer.tier,
            promoted: true,
            forced: force && !verdict.eligible,
            was_eligible: verdict.eligible,
        }));
        emitChange('federation');
    });
}
