/**
 * @file src/routes/federation-peer/peers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Peering-request admin decisions + peer lifecycle routes (approve/reject/delete requests,
 *   activate, heartbeat, presence, peer list/add/update, visiting→member promotion). Extracted from federation-peer.ts to satisfy max-file-lines.
 * @version-history
 *   v1.4.0 — 2026-09-01 — The THIRD door closed: `PUT /peers/:nodeId` refuses `status: 'active'`
 *     when the resulting peer would still have no key. v1.3.0 left it on the argument that closing
 *     creation left none to activate, which is true only of peers created after that change — a row
 *     written before it is still here. Evaluated against the STAGED peer, so setting a key and
 *     activating in one call still works, and placed with the other refusals, before the commit.
 *   v1.3.0 — 2026-09-01 — A KEYLESS PEER IS NO LONGER WRITABLE OR ACTIVATABLE. Both write paths
 *     defaulted the key to `''` (POST /peers, and approving a request), and activate wrote
 *     `status = 'active'` BEFORE running key exchange, then warned and answered 200 when it failed
 *     — so an unreachable node became an active peer with no key. Now: `public_key` is required at
 *     the direct door, approving a keyless request is refused before the request itself is marked,
 *     the exchange runs first and a failure refuses the activation with the peer unchanged, and a
 *     successful exchange's key is actually STORED (it used to be discarded, so a "completed"
 *     activation left a keyless peer keyless). A different key on an established peer is refused as
 *     a rotation, the same rule the key-exchange door applies.
 *   v1.2.0 — 2026-08-23 — SECURITY (audit AI-triage, invariant 14): PUT /peers/:nodeId stages every
 *     change on a copy and touches the live peers-Map object only after the last refusal has passed.
 *     A support_upstream 409 used to leave a half-applied peer in memory, diverging from storage.
 *   v1.1.0 — 2026-08-10 — Security audit H-14: heartbeat refuses a missing signature instead of skipping
 *     verification, and recovers status only from a liveness state.
 *   v1.0.0 — 2026-07-13 — Extracted from federation-peer.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { PeeringDecisionSchema, validateBody } from '../../models/schemas.js';
import { LIVENESS_RECOVERABLE, type PeerInfo } from '../../services/federation.js';
import { verify } from '../../auth/keypair.js';
import { emitChange } from '../../services/event-bus.js';
import { performKeyExchange } from '../../services/federation-helpers.js';
import { presence, presenceSignString, type PresenceUpdate } from '../../services/presence.js';
import { deriveTierFlags, coerceTier, clampFlagsToTier } from '../../services/federation-tiers.js';
import { gatePeer } from '../../services/federation-peer-gate.js';
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

        // REFUSE BEFORE YOU WRITE (invariant 14), and that means before the REQUEST is marked too.
        // The same rule as the direct door: no key, no peer record. An inbound introduce always
        // carries one (introduce.ts refuses without it), so this bites only a request written by the
        // OUTBOUND `POST /v1/federation/peer/request` path, which stores `publicKey: ''` because at
        // that moment this node has not been told the other one's key. Approving such a request used
        // to mint a keyless peer. Marking the request approved and then refusing would leave the
        // operator an approved request with no peer behind it and no way to tell why.
        const requestKey = (request.publicKey ?? '').trim();
        if (decision === 'approve' && requestKey === '') {
            res.status(409).json(error(config.nodeId, 'PEER_KEY_REQUIRED',
                'This request carries no verification key for that node, so approving it would create a peer nothing can be checked against. Wait for that node to introduce itself, which is what brings its key.'));
            return;
        }

        await storage.updatePeeringRequest(id, {
            status: newStatus,
            updatedAt: new Date().toISOString(),
        });

        // If approved, add to peers list and persist
        if (decision === 'approve') {
            const now = new Date().toISOString();
            // The tier the REQUEST carries, not a hardcoded 'member'. A request minted by a contact
            // invite says so, and an ordinary request has no tier and coerces to 'member' exactly as
            // before. The request is also what the key-exchange auto-add reads later, so the two
            // paths agree instead of one of them re-admitting the peer a rung higher.
            const approvedTier = coerceTier(request.tier);
            const peerInfo: PeerInfo = {
                nodeId: request.fromNodeId ?? request.id,
                url: request.targetUrl ?? request.fromNodeUrl,
                publicKey: requestKey,
                status: 'approved',
                addedAt: now,
                lastSeen: now,
                ...deriveTierFlags(approvedTier),
                tier: approvedTier,
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

        // ── Key exchange FIRST, and a failure refuses the activation ──
        //
        // This used to write `status = 'active'` and save, then run the exchange, then log a warning
        // and answer 200 whichever way it went. So an unreachable peer — or one that answered
        // nothing usable — became an ACTIVE peer with whatever key it already had, which for a peer
        // added before this round could be none at all. Active is the state every other gate reads
        // as "this link works"; earning it has to mean something happened.
        //
        // Refuse before you write (invariant 14): nothing about the peer changes until the exchange
        // has succeeded, so a failed activation leaves the record exactly as it was and the operator
        // can press again once the far end is up.
        const keyExchangeResult = await performKeyExchange(peer.url, config, storage);
        if (!keyExchangeResult.success) {
            logger.warn('Peer activation refused: key exchange failed', {
                peer: peer_node_id, peerUrl: peer.url, reason: keyExchangeResult.error,
            });
            res.status(502).json(error(config.nodeId, 'KEY_EXCHANGE_FAILED',
                `Could not exchange keys with that node, so it stays as it was: ${keyExchangeResult.error ?? 'no reason given'}. Check it is running and reachable, then try again.`));
            return;
        }

        // WHAT THE EXCHANGE RETURNED IS WORTH KEEPING, and the old code threw it away — a successful
        // exchange left `peer.publicKey` untouched, so a keyless peer stayed keyless through a
        // "completed" activation. A peer with no key adopts the one it just proved it serves.
        const exchangedKey = keyExchangeResult.peerPublicKey ?? '';
        if (!peer.publicKey && !exchangedKey) {
            res.status(502).json(error(config.nodeId, 'PEER_KEY_REQUIRED',
                'That node did not return a verification key, so there is still nothing to check its messages against. It stays as it was.'));
            return;
        }
        if (peer.publicKey && exchangedKey && exchangedKey !== peer.publicKey) {
            // Key continuity, the same rule the key-exchange door applies (lifecycle.ts): once a
            // peer's key is established, a CHANGE to it is a rotation and needs proof of possession
            // of the current one. Adopting it here because an operator pressed activate would be the
            // rotation gate with a button in front of it.
            logger.warn('Peer activation refused: the node presented a different key', {
                peer: peer_node_id, peerUrl: peer.url,
            });
            res.status(409).json(error(config.nodeId, 'KEY_ROTATION_DENIED',
                'That node is presenting a different verification key than the one on file. A new key is a new party until it is re-established through the introduce and approval flow.'));
            return;
        }

        const now = new Date().toISOString();
        peer.publicKey = peer.publicKey || exchangedKey;
        peer.status = 'active';
        peer.lastSeen = now;
        await storage.saveFederationPeer(peer);

        res.json(success(config.nodeId, {
            peer_node_id,
            status: 'active',
            activated_at: now,
            key_exchange: 'completed',
        }));
        emitChange('federation');
    });

    // POST /v1/federation/heartbeat — peer health heartbeat
    // SECURITY: Verify signature from known peers
    router.post('/v1/federation/heartbeat', async (req, res) => {
        const { from_node_id, timestamp, signature } = req.body ?? {};

        if (from_node_id && peers.has(from_node_id)) {
            const peer = peers.get(from_node_id)!;

            // SECURITY (audit H-14): the check used to read `if (peer.publicKey && signature)`, so
            // omitting the signature skipped it entirely — the one thing an attacker controls was
            // also the switch that turned verification off. A missing signature is a refusal now.
            if (!signature || !peer.publicKey) {
                res.status(401).json(error(config.nodeId, 'UNAUTHORIZED',
                    'Heartbeat requires a signature from a peer with a known public key'));
                return;
            }
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

            peer.lastSeen = new Date().toISOString();
            // Liveness recovers a peer from a liveness state, never from an operator decision
            // (depeering, suspended) or an admission state (pending, approved). Same rule as ping.
            if (LIVENESS_RECOVERABLE.has(peer.status)) peer.status = 'active';
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

        // Presence is discovery, so it rides the catalogue word: a contact peer neither sees nor
        // publishes who is online here. gatePeer also refuses a peer with NO public key, which used
        // to skip the signature check below entirely rather than fail it.
        const gate = gatePeer(peers, from_node_id, 'shareCatalogue');
        if (!gate.ok) {
            res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
            return;
        }
        const peer = gate.peer;

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
                allow_messaging: p.allowMessaging ?? true,
                allow_broadcast: p.allowBroadcast ?? true,
                allow_settlement: p.allowSettlement ?? true,
                support_upstream: p.supportUpstream ?? false,
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

        // A PEER RECORD WITH NO KEY MUST BE IMPOSSIBLE TO WRITE. `public_key ?? ''` used to let this
        // door create one in a single call, and an empty key is not a peer that is merely unusual —
        // it is a row whose only remaining purpose is to be trusted by the next thing that reads it.
        // Every gate that checks a peer signature has to special-case the empty string or fail open,
        // and one of them did: federated login skipped verification entirely when the key was
        // missing. Closing that gate made these rows useless; this stops them being written.
        if (typeof public_key !== 'string' || public_key.trim() === '') {
            res.status(400).json(error(config.nodeId, 'PEER_KEY_REQUIRED',
                'A peer needs its verification key. Without one this node cannot check that anything claiming to come from that node really did.'));
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
            publicKey: public_key,
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

        const { url, public_key, status, share_catalogue, replicate_memory, allow_routing, allow_messaging, allow_broadcast, allow_settlement, support_upstream, peer_mode, allow_federated_auth, federation_auth_scopes, tier } = req.body ?? {};

        // Every change is staged on a COPY and the live peers-Map object is only touched after the
        // last refusal has passed (invariant 14 — refuse before you write; audit AI-triage
        // 2026-08-23). The old shape mutated `peer` field by field and 409'd in the middle, so a
        // rejected request had already changed what every gate reads from the live Map, and the
        // in-memory state diverged from the stored one until restart.
        const next: PeerInfo = { ...peer };
        if (url) next.url = url;
        if (public_key) next.publicKey = public_key;
        if (status) next.status = status;

        // Tier change (e.g. promote visiting → member) re-derives the canonical flags first,
        // so a promotion grants the full member capability set in one step. Explicit flag
        // fields below may still override afterwards.
        const currentTier = coerceTier(peer.tier);
        if (tier === 'genesis' || tier === 'member' || tier === 'visiting' || tier === 'contact') {
            next.tier = tier;
            Object.assign(next, deriveTierFlags(tier));
        }
        const effectiveTier = coerceTier(next.tier);

        // Apply what was asked, then hold the whole set to what the tier permits. The rules used to
        // be five inline conditions here, which is why three of them were missing the moment a flag
        // was added; clampFlagsToTier owns them now and is tested on its own.
        if (typeof share_catalogue === 'boolean') next.shareCatalogue = share_catalogue;
        if (typeof replicate_memory === 'boolean') next.replicateMemory = replicate_memory;
        if (typeof allow_routing === 'boolean') next.allowRouting = allow_routing;
        if (typeof allow_messaging === 'boolean') next.allowMessaging = allow_messaging;
        if (typeof allow_broadcast === 'boolean') next.allowBroadcast = allow_broadcast;
        if (typeof allow_settlement === 'boolean') next.allowSettlement = allow_settlement;
        if (peer_mode === 'federation' || peer_mode === 'private') next.peerMode = peer_mode;
        if (typeof allow_federated_auth === 'boolean') next.allowFederatedAuth = allow_federated_auth;
        if (Array.isArray(federation_auth_scopes)) next.federationAuthScopes = federation_auth_scopes;
        Object.assign(next, clampFlagsToTier(effectiveTier, next));

        // Where this node's `support@operators` is answered. Refused when another active peer already
        // holds it, so "who answers support here" cannot become two answers: a support request going
        // to two vendors at once serves neither of them, and the invalid state is better made
        // unrepresentable than resolved later by whichever peer the iterator reached first.
        if (typeof support_upstream === 'boolean') {
            if (support_upstream) {
                const held = [...peers.values()].find(p => p.nodeId !== nodeId && p.status === 'active' && p.supportUpstream);
                if (held) {
                    res.status(409).json(error(config.nodeId, 'ONE_UPSTREAM_ONLY',
                        `Support on this node is already answered by ${held.nodeId}. Turn that off before pointing it here.`));
                    return;
                }
                // Routing to a peer that cannot carry a message is a black hole with a green light.
                if (next.allowMessaging === false) {
                    res.status(409).json(error(config.nodeId, 'MESSAGING_DISABLED',
                        'This peer may not deliver messages here, so it cannot answer support. Enable allow_messaging first.'));
                    return;
                }
            }
            next.supportUpstream = support_upstream;
        }

        // THE THIRD DOOR TO `active`, and the one that survived the last round on a bad argument:
        // "with creation closed there is no keyless peer left to set active" is true only of peers
        // created AFTER that change. A row written before it is still here, still keyless, and this
        // route would still flip it on. `active` is what federated login, replication and settlement
        // read as "this link works", and none of them can check a signature against nothing.
        //
        // Evaluated against `next`, not `peer`, so setting a key and activating in ONE call still
        // works — the operator who has the key in hand is not made to do it twice.
        if (next.status === 'active' && !(next.publicKey ?? '').trim()) {
            res.status(409).json(error(config.nodeId, 'PEER_KEY_REQUIRED',
                'This peer has no verification key, so nothing it sends could be checked. Activate it instead — that exchanges keys with the node first.'));
            return;
        }

        // All refusals are behind us: commit to the live object and persist the same state.
        Object.assign(peer, next);
        await storage.saveFederationPeer(peer);

        res.json(success(config.nodeId, {
            node_id: nodeId,
            url: peer.url,
            status: peer.status,
            tier: peer.tier ?? currentTier,
            share_catalogue: peer.shareCatalogue,
            replicate_memory: peer.replicateMemory,
            allow_routing: peer.allowRouting,
            allow_messaging: peer.allowMessaging,
            allow_broadcast: peer.allowBroadcast,
            allow_settlement: peer.allowSettlement,
            support_upstream: peer.supportUpstream ?? false,
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
        // A contact link is not a visiting peer that has yet to earn a vouch: it is a deliberate
        // "messages and nothing else", usually with a customer on the other end who agreed to
        // exactly that. Promoting it in one click, on availability metrics it was never measured
        // against, would widen what crosses the link without anyone on that side being asked.
        // Raising it is a de-peer and a re-link, which is a decision rather than a button.
        if (coerceTier(peer.tier) === 'contact') {
            res.status(409).json(error(config.nodeId, 'TIER_NOT_PROMOTABLE',
                'This is a contact link (messages only). Widening it is a re-peering decision, not a promotion.'));
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
