/**
 * @file src/routes/federation-sync/retract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/federation/retract — a peer says that a record it replicated here is gone or
 *   no longer eligible, and this node removes its copy.
 *
 *   WHY IT EXISTS. Replication had no way back. A record whose owner deleted it, made it private,
 *   withdrew the federation consent or erased the account stayed publicly readable on every peer that
 *   had received it, because the sending side sent nothing and the receiving side was never told
 *   (secaudit 2026-10, replica retention). The receiving node's TTL now expires such a copy within
 *   168 h (services/cache-cleanup.ts); this route is how it goes at once.
 *
 *   THE SIGNATURE DECIDES WHICH COPIES ARE REACHABLE. The replica key is built from the node id whose
 *   key verified the message, never from a body field, and a row is removed only when it carries a
 *   tag naming that same node. So a peer can take back what it sent and nothing else, and an inbound
 *   federation endpoint verifies unconditionally (security DNA invariant 5).
 * @structure registerRetractRoute(router, config, storage, peers)
 * @version-history
 *   2026-11-05 — The peer and its signature are verified by the 'federation-peer' credential strategy, in the same order with the same refusals (codebase analysis 2026-11-03, decision 2 of 2026-11-05).
 *   2026-11-04 — The single use of a signed retraction is spent in the node's storage (signedMessageRefusalOnNode), so another process refuses a replay too (codebase analysis 2026-11-03, HA stage 2).
 *   2026-10-20 — Initial (secaudit 2026-10, replica retention).
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { acceptCredential, credentialOf } from '../../auth/credential-strategies.js';
import { badInput, bodyOf, signedJson } from '../../auth/credential-strategies-node.js';
import {
    signedMessageRefusalOnNode, audienceRefusal, pinnedRefusal, federationPeerProofPin,
} from '../../services/signed-node-request.js';
import { emitChange } from '../../services/event-bus.js';

/** How many conflict copies of one key are removed in a single retraction. */
const CONFLICT_SCAN_LIMIT = 200;

export function registerRetractRoute(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // Active peer, entitled to the replication door, key on file. The same door the copy came in
    // through, so a peer that may no longer replicate may still take its copies back. Verified by the
    // 'federation-peer' credential strategy (src/auth/credential-strategies-node.ts).
    router.post('/v1/federation/retract', acceptCredential('federation-peer', {
        config, peers, capability: 'replicateMemory', node: (req) => bodyOf(req).source_node,
        before: (req) => {
            const { source_node, gaii, key } = bodyOf(req);
            return !source_node || !gaii || !key ? badInput('source_node, gaii and key are required') : null;
        },
        unsigned: { when: 'absent', message: 'Missing signature on retraction request' },
        signed: signedJson('source_node', 'gaii', 'key', 'reason', 'timestamp'),
        forged: 'Invalid signature on retraction request',
    }), async (req, res) => {
        const { source_node, gaii, key, reason, timestamp } = req.body ?? {};
        const { peer, signed: retractPayload, signature } = credentialOf(req, 'federation-peer');

        // A retraction signs its own send time, so the five-minute window and the single use apply to
        // it directly; the audience proof names this node, and a peer that has once sent one is held
        // to it. Checked after the signature, so a forged message cannot use up a real one.
        const refusal = await pinnedRefusal(await federationPeerProofPin(storage, peer), req.body ?? {}, provenSince => audienceRefusal({
            signed: retractPayload, audience: req.body?.audience, audienceSignature: req.body?.audience_signature,
            publicKey: peer.publicKey, thisNodeId: config.nodeId, required: config.federationAudienceRequired, provenSince,
        })) ?? await signedMessageRefusalOnNode(String(source_node), timestamp, String(signature));
        if (refusal) {
            res.status(refusal.status).json(error(config.nodeId, refusal.code, refusal.message));
            return;
        }

        // The addresses the signing node's own copies sit at: the replica, the copy a de-peering grace
        // renamed, and the conflict copies kept beside either.
        const owner = String(gaii);
        const replicaKey = `replica:${source_node}:${key}`;
        const expiringKey = `expiring:${source_node}:${key}`;
        const conflictCopies: string[] = [];
        for (const base of [replicaKey, expiringKey]) {
            const rows = await storage.listMemory(owner, { prefix: `${base}._conflict_` });
            for (const row of rows.slice(0, CONFLICT_SCAN_LIMIT)) conflictCopies.push(row.key);
        }

        // A row is removed only when it carries a tag naming the node that signed this message, so a
        // record of this node's own that happens to sit at one of these keys is left alone.
        const ofThisPeer = [`replica:${source_node}`, `expiring:${source_node}`, `conflict:${source_node}`];
        const removed: string[] = [];
        for (const candidate of [replicaKey, expiringKey, ...conflictCopies]) {
            const row = await storage.getMemory(owner, candidate);
            if (!row) continue;
            if (!row.tags?.some(t => ofThisPeer.includes(t))) {
                logger.warn('A retraction named a record that is not this peer\'s copy; it stays', {
                    peer: String(source_node), owner, key: candidate,
                });
                continue;
            }
            if (await storage.deleteMemory(owner, candidate)) removed.push(candidate);
        }

        if (removed.length > 0) {
            logger.info('A peer took back a record it had replicated', {
                peer: String(source_node), owner, key: String(key), reason: String(reason ?? 'unstated'), removed: removed.length,
            });
            emitChange('federation');
        }

        // 200 whether or not anything was here: a retraction is a statement about the source, and a
        // sender that has to tell the difference between "removed" and "never had it" reads `removed`.
        res.json(success(config.nodeId, {
            retracted: true,
            source_node,
            key: replicaKey,
            removed: removed.length,
            removed_keys: removed,
        }));
    });
}
