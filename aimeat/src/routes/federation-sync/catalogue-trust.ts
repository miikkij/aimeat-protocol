/**
 * @file src/routes/federation-sync/catalogue-trust.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federation catalogue sync (signed upsert of peer actions) + trust-advisory routes
 *   (warning/suspend/ban with tier demotion and peer purge). Extracted from federation-sync.ts to satisfy max-file-lines.
 * @version-history
 *   v1.5.1 — 2026-10-18 — A peer's trust notice is stored on the version read (setMemoryIfVersion), and
 *     a new one is claimed with createMemoryIfAbsent and MAX_RECEIVED_PER_PEER counted after the claim.
 *   v1.5.0 — 2026-10-16 — POST /v1/federation/trust-advisory takes a signed notice from a peer (gatePeer,
 *     the peer's signature, the audience proof, once) and stores it for the operator without acting on
 *     it; the operator's own advisory is stored too (a warning answered 201 and stored nothing), and its
 *     ban and suspend writes are awaited instead of fire-and-forget (QA audit S6-06).
 *   v1.4.0 — 2026-10-11 — A synced action's pricing is its pacing amount: toll_morsels from a 4.x peer, base_morsels from a 3.x peer (actionPricingFromPeer). A morsel is pacing, not a price.
 *   v1.3.0 — 2026-10-10 — A peer that has once sent a verified delivery proof is held to it: a catalogue-sync without one is refused from it whatever AIMEAT_FEDERATION_AUDIENCE_REQUIRED says (pinnedRefusal; secaudit 2026-10-10 I21).
 *   v1.2.0 — 2026-10-06 — catalogue-sync checks a delivery proof: this node named, sent inside five minutes, heard once (deliveryRefusal; secaudit 2026-10 last items, D3).
 *   v1.1.0 — 2026-10-05 — The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2).
 *   v1.0.0 — 2026-07-13 — Extracted from federation-sync.ts (max-file-lines)
 */

import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOperator } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { verify } from '../../auth/keypair.js';
import {
    deliveryRefusal, pinnedRefusal, federationPeerProofPin, audienceRefusal, signedMessageRefusal,
} from '../../services/signed-node-request.js';
import { TRUST_ADVISORY_TYPES, trustNoticeSignString } from '../../services/federation-trust-notice.js';

/** A node id as nodes write them: letters, digits, dot, dash and underscore. */
const NODE_ID_SHAPE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_REASON_CHARS = 1000;
/** How many trust notices one peer may have stored here at a time. */
const MAX_RECEIVED_PER_PEER = 50;
import { deriveTierFlags, tierRank, coerceTier } from '../../services/federation-tiers.js';
import { gatePeer } from '../../services/federation-peer-gate.js';
import { emitChange } from '../../services/event-bus.js';
import { actionPricingFromPeer } from '../../services/action-pacing.js';
import { CAS_ATTEMPTS } from '../../services/record-cas.js';

export function registerCatalogueTrustRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
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

        const gate = gatePeer(peers, source_node, 'shareCatalogue');
        if (!gate.ok) {
            res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
            return;
        }
        const peer = gate.peer;

        // P1-11: Require signed catalogue sync — verify peer signature
        if (!signature) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature on catalogue-sync request'));
            return;
        }
        const catalogueSyncPayload = JSON.stringify({ source_node, actions: actionList, since_timestamp, catalogue_hash });
        const catalogueSyncValid = await verify(peer.publicKey, catalogueSyncPayload, signature);
        if (!catalogueSyncValid) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on catalogue-sync request'));
            return;
        }
        // No send time is signed above (since_timestamp is the previous sync), so the delivery proof
        // carries it: this node named, inside five minutes, once (secaudit 2026-10 last items, D3). A
        // peer that has once sent it is held to it (secaudit 2026-10-10 I21).
        const undelivered = await pinnedRefusal(await federationPeerProofPin(storage, peer), req.body, provenSince => deliveryRefusal({
            sourceNode: source_node, signed: catalogueSyncPayload, body: req.body, publicKey: peer.publicKey,
            thisNodeId: config.nodeId, required: config.federationAudienceRequired, provenSince,
        }));
        if (undelivered) {
            res.status(undelivered.status).json(error(config.nodeId, undelivered.code, undelivered.message));
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
                // The pacing amount per use: toll_morsels from a 4.x peer, base_morsels from a 3.x
                // peer. A morsel is pacing, not a price.
                pricing: actionPricingFromPeer(action.pricing),
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
                } catch (err) { logger.warn('POST /v1/federation/catalogue-sync: skip if race condition', { error: String(err) }); }
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

    // POST /v1/federation/trust-advisory, first handler: a signed trust notice from a PEER (the
    // emergency removal of a peer with notify_network, or the other operator's advisory; sender in
    // services/federation-trust-notice.ts). It is taken when the body carries a signature; any other
    // request goes on to the operator's handler below (next('route')).
    //
    // A peer's notice is STORED for this node's operator to read (GET /v1/admin/federation/trust-
    // advisories) and acts on nothing: a peer's word does not ban or demote a third node here. Until
    // 2026-10-16 the sender posted unsigned to the operator-only handler, which refused it (QA audit S6-06).
    router.post('/v1/federation/trust-advisory', async (req, res, next) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        if (typeof body.signature !== 'string') { next('route'); return; }
        const { source_node, target_node, advisory_type, reason, evidence_hash, timestamp, signature } = body;

        if (typeof source_node !== 'string' || typeof target_node !== 'string' || typeof advisory_type !== 'string'
            || typeof reason !== 'string' || !reason || typeof timestamp !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A signed trust notice needs source_node, target_node, advisory_type, reason and timestamp as text.'));
            return;
        }
        if (!(TRUST_ADVISORY_TYPES as readonly string[]).includes(advisory_type)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `advisory_type must be one of: ${TRUST_ADVISORY_TYPES.join(', ')}`));
            return;
        }
        if (!NODE_ID_SHAPE.test(target_node) || reason.length > MAX_REASON_CHARS
            || (evidence_hash !== undefined && evidence_hash !== null && (typeof evidence_hash !== 'string' || evidence_hash.length > 200))) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `target_node must be a node id, the reason at most ${MAX_REASON_CHARS} characters and evidence_hash at most 200.`));
            return;
        }

        const gate = gatePeer(peers, source_node, null);
        if (!gate.ok) {
            res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
            return;
        }
        const signed = trustNoticeSignString({
            source_node, target_node, advisory_type, reason, evidence_hash: (evidence_hash as string | null | undefined) ?? '', timestamp,
        });
        if (!await verify(gate.peer.publicKey, signed, signature)) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'The signature on this trust notice does not verify against the sending peer\'s key.'));
            return;
        }
        // A new message kind, so no peer sends it in an older format: the audience is always required.
        const refusal = await audienceRefusal({
            signed, audience: body.audience, audienceSignature: body.audience_signature,
            publicKey: gate.peer.publicKey, thisNodeId: config.nodeId, required: true,
        }) ?? signedMessageRefusal(source_node, timestamp, signature);
        if (refusal) { res.status(refusal.status).json(error(config.nodeId, refusal.code, refusal.message)); return; }

        // One stored notice per sending peer, target and kind: a repeat replaces it, and one peer holds at
        // most MAX_RECEIVED_PER_PEER, so a peer cannot fill this node's system namespace.
        //
        // Written on the version that was read: a repeat replaces the stored notice only if it is
        // still the one read, and a new notice is claimed (createMemoryIfAbsent) and the peer's
        // notices counted after the claim, so the bound holds on what is stored when several arrive
        // at once; a claim past it is removed again and refused.
        const systemGaii = `system@${config.nodeId}`;
        const key = `trust_advisory:recv:${source_node}:${target_node}:${advisory_type}`;
        const tooMany = () => res.status(429).json(error(config.nodeId, 'RATE_LIMITED', `This node already holds ${MAX_RECEIVED_PER_PEER} trust notices from your node. Its operator reads them before more are stored.`));
        let record: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < CAS_ATTEMPTS && !record; attempt++) {
            const existing = await storage.getMemory(systemGaii, key);
            const now = new Date().toISOString();
            const value = {
                id: (existing?.value as { id?: string } | undefined)?.id ?? `adv-${randomBytes(8).toString('hex')}`,
                target_node, advisory_type, reason, evidence_hash: evidence_hash ?? null,
                issued_by: source_node, received_from: source_node, direction: 'received', status: 'received',
                acted: false, created_at: now,
            };
            const next = {
                key, ownerGaii: systemGaii, value, visibility: 'private' as const,
                tags: ['trust_advisory', 'received', `target:${target_node}`, `type:${advisory_type}`, `from:${source_node}`],
                ttlHours: null, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
            };
            if (existing) {
                if (!storage.setMemoryIfVersion) { await storage.setMemory(next); record = value; }
                else if (await storage.setMemoryIfVersion(next, existing.version)) record = value;
                continue;
            }
            if (!storage.createMemoryIfAbsent) { await storage.setMemory(next); record = value; continue; }
            if (!await storage.createMemoryIfAbsent(next)) continue;
            const held = await storage.listMemory(systemGaii, { prefix: `trust_advisory:recv:${source_node}:` });
            if (held.length > MAX_RECEIVED_PER_PEER) {
                await storage.deleteMemory(systemGaii, key);
                tooMany();
                return;
            }
            record = value;
        }
        if (!record) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', 'This trust notice changed under every attempt to store it. Send it again.'));
            return;
        }
        logger.warn('Trust notice received from a peer and stored for the operator', { from: source_node, target: target_node, type: advisory_type });

        res.status(201).json(success(config.nodeId, { '@type': 'aimeat:TrustAdvisory', ...record, stored: true }));
        emitChange('federation');
    });

    // POST /v1/federation/trust-advisory, second handler: this node's operator acts on a node here
    // (ban removes the peer, suspend demotes it, warning records it). Every advisory is stored; a
    // warning answered 201 with an id and stored nothing until 2026-10-16 (QA audit S6-06).
    router.post('/v1/federation/trust-advisory', requireAuth(), requireOperator(storage), async (req, res) => {
        const { target_node, advisory_type, reason, evidence_hash } = req.body ?? {};

        if (!target_node || !advisory_type || !reason) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_node, advisory_type, and reason are required'));
            return;
        }

        if (!(TRUST_ADVISORY_TYPES as readonly string[]).includes(advisory_type)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `advisory_type must be one of: ${TRUST_ADVISORY_TYPES.join(', ')}`));
            return;
        }

        // Store advisory and optionally de-peer
        const advisoryId = `adv-${randomBytes(8).toString('hex')}`;
        let acted: 'removed' | 'demoted' | false = false;

        // If ban advisory, auto-de-peer the target (and purge from storage).
        if (advisory_type === 'ban') {
            const targetPeer = [...peers.entries()].find(([, p]) => p.nodeId === target_node);
            if (targetPeer) {
                peers.delete(targetPeer[0]);
                await storage.deleteFederationPeer(targetPeer[1].nodeId);
                acted = 'removed';
            }
        }

        // If suspend advisory, demote a full member back to the low-trust visiting tier and strip
        // its elevated permission flags (provider/relay/replication/auth). This is the trust-revocation
        // lever for the visiting/member model — a suspended node can never be a provider until re-vouched.
        //
        // A demotion has to check it IS one. The test used to be "not already visiting", which for a
        // `contact` peer is true, so suspending the least-trusted kind of peer we have would have
        // handed it catalogue read and taken it out of privacy — a punishment that promotes.
        if (advisory_type === 'suspend') {
            const entry = [...peers.entries()].find(([, p]) => p.nodeId === target_node);
            if (entry) {
                const peer = entry[1];
                if (tierRank(coerceTier(peer.tier)) > tierRank('visiting')) {
                    peer.tier = 'visiting';
                    Object.assign(peer, deriveTierFlags('visiting'));
                    await storage.saveFederationPeer(peer);
                    acted = 'demoted';
                    logger.warn(`Peer ${target_node} demoted to visiting after suspend advisory`, { reason });
                }
            }
        }

        const advisory = {
            id: advisoryId,
            target_node,
            advisory_type,
            reason,
            evidence_hash: evidence_hash ?? null,
            issued_by: config.nodeId,
            direction: 'local',
            status: 'applied',
            acted,
            created_at: new Date().toISOString(),
        };
        await storage.setMemory({
            key: `trust_advisory:${advisoryId}`, ownerGaii: `system@${config.nodeId}`, value: advisory, visibility: 'private',
            tags: ['trust_advisory', 'local', `target:${target_node}`, `type:${advisory_type}`],
            ttlHours: null, version: 1, createdAt: advisory.created_at, updatedAt: advisory.created_at,
        });

        res.status(201).json(success(config.nodeId, {
            '@type': 'aimeat:TrustAdvisory',
            ...advisory,
            stored: true,
        }));
        emitChange('federation');
    });
}
