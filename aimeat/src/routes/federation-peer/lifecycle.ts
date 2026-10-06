/**
 * @file src/routes/federation-peer/lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Peer de-peering (grace + emergency), federation ping (cached service-summary hash), and
 *   Ed25519 key-exchange with key-continuity rotation guard. Extracted from federation-peer.ts to satisfy max-file-lines.
 * @version-history
 *   v1.7.0 — 2026-10-06 — The ping names this node as its audience (audienceRefusal; secaudit 2026-10
 *     follow-up, A7).
 *   v1.6.0 — 2026-10-06 — The ping passes only inside the five-minute window and once
 *     (signedMessageRefusal; secaudit 2026-10 follow-up, A7). It checked no time.
 *   v1.5.0 — 2026-10-05 — The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2).
 *   v1.4.0 — 2026-10-01 — key-exchange takes a key it cannot check against an established one only from
 *     the card at the address the operator approved: for an approval this node's own join wrote (it
 *     carries no key) and for a peer with no key. Until then the first unauthenticated caller set the
 *     key (incident federation-join-the-target-s-card-names-the-peer-id-an-exist-muptit8h). A refused
 *     rotation is recorded on the Security page as an id held under another key (peer-incidents.ts).
 *   v1.3.0 — 2026-10-01 — DELETE /peers/:nodeId frees the name completely: an emergency delete takes the
 *     peer's recorded origin and any pending package registration with it, and a node id that is only a
 *     pending registration (no peer yet) is deleted as that (`pending_deleted`). The operator's way to
 *     release a node id taken under a wrong key (the peer-registration incident, finding F).
 *   v1.2.0 — 2026-09-17 — key-exchange re-admits a peer at the address of its approved request, not the
 *     address in the unauthenticated body, and checks that address as outbound traffic. Anyone who knew
 *     a purged peer's id and public key could point it at a server of their own.
 *   v1.1.0 — 2026-08-10 — Security audit H-13/H-14: ping verifies the signature the heartbeat client has
 *     always sent and only lifts a peer out of a LIVENESS state; key-exchange refuses to re-admit a peer
 *     an operator parked, and admits with the key from the approved peering request rather than the body.
 *   v1.0.0 — 2026-07-13 — Extracted from federation-peer.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOperator } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { LIVENESS_RECOVERABLE, OPERATOR_PARKED, type PeerInfo } from '../../services/federation.js';
import { verify } from '../../auth/keypair.js';
import { signedMessageRefusal, audienceRefusal } from '../../services/signed-node-request.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { emitChange } from '../../services/event-bus.js';
import { peerKeyCache } from '../../services/federation-helpers.js';
import { computeServiceSummary } from '../../utils/service-summary.js';
import { deriveTierFlags, coerceTier, type PeerTier } from '../../services/federation-tiers.js';
import { proveNodeCard } from '../../services/packages/peer/package-peer-register.js';
import { reportPeerIncident } from '../../services/peer-incidents.js';
import { removePeer } from '../../services/federation-peer-remove.js';

/** Cached service summary hash to avoid recomputing on every ping (60s TTL). */
let cachedSummaryHash = '';
let summaryHashExpiry = 0;

export function registerLifecycleRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    /** Whether the card at `url`, an address the operator chose, publishes `key` for `nodeId`. */
    const keyFromApprovedCard = async (nodeId: string, url: string, key: string): Promise<boolean> =>
        !!url && !!key && (await proveNodeCard(nodeId, url, key, config.federationTimeoutMs)).kind === 'proven';

    // DELETE /v1/federation/peers/:nodeId — de-peer (operator only)
    // Normal: grace period (configurable, default 72h) — in-flight work completes, new requests blocked
    // Emergency (?emergency=true): immediate disconnect, cancel in-flight work, return escrow
    router.delete('/v1/federation/peers/:nodeId', requireAuth(), requireOperator(storage), async (req, res) => {
        const out = await removePeer({ config, storage, peers }, req.params.nodeId as string, {
            emergency: req.query.emergency === 'true',
            notifyNetwork: req.body?.notify_network === true,
            // The reason from the body (the page) or the query (the MCP tool's connector and CLI twins,
            // whose DELETE carries no body).
            ...(typeof req.body?.reason === 'string' ? { reason: req.body.reason as string }
                : typeof req.query.reason === 'string' ? { reason: req.query.reason } : {}),
        });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, out.body));
    });

    // POST /v1/federation/ping — federation health check (used by peers)
    router.post('/v1/federation/ping', async (req, res) => {
        const { from_node, node_id, software_version, signature, timestamp, version, stats } = req.body ?? {};
        const fromId = (from_node || node_id) as string | undefined;

        if (fromId && peers.has(fromId)) {
            const peer = peers.get(fromId)!;
            // SECURITY (audit H-14): a liveness signal used to be taken on the body's word alone, and
            // it wrote `status = 'active'`. So one unauthenticated request from anywhere on the
            // internet cancelled a de-peering the operator had started. The heartbeat client has
            // always signed this payload (services/federation.ts) — the receiving end simply never
            // looked. It looks now, over exactly the fields the client signs.
            const pingPayload = JSON.stringify({ node_id: fromId, timestamp, version, software_version, stats });
            let pingValid = false;
            if (typeof signature === 'string' && peer.publicKey) {
                try {
                    pingValid = await verify(peer.publicKey, pingPayload, signature);
                } catch (err) {
                    logger.warn('Federation ping: signature verification threw, treating as invalid', { peer: fromId, error: String(err) });
                    pingValid = false;
                }
            }
            if (!pingValid) {
                res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing or invalid signature on federation ping'));
                return;
            }
            // A captured ping kept a peer that had gone down `active` for ever, and could set its
            // version back: it passes inside the five-minute window and once (secaudit 2026-10 follow-up, A7).
            // And it names this node as its audience, so a ping meant for another node does not pass here (A7).
            const stale = await audienceRefusal({
                signed: pingPayload, audience: req.body?.audience, audienceSignature: req.body?.audience_signature,
                publicKey: peer.publicKey, thisNodeId: config.nodeId, required: config.federationAudienceRequired,
            }) ?? signedMessageRefusal(fromId, timestamp, signature as string);
            if (stale) { res.status(stale.status).json(error(config.nodeId, stale.code, stale.message)); return; }
            peer.lastSeen = new Date().toISOString();
            // A liveness signal proves the peer is up. It does not undo a decision about whether we
            // want to talk to it: `depeering`, `suspended`, `pending` and `approved` are states an
            // operator or an admission flow put the peer in, and only that flow may leave them.
            if (LIVENESS_RECOVERABLE.has(peer.status)) peer.status = 'active';
            // Federation version visibility: record the peer's advertised AIMEAT version.
            if (typeof software_version === 'string') peer.softwareVersion = software_version;
            storage.saveFederationPeer(peer).catch(err => { logger.warn('fromId: continuing after a suppressed failure', { error: String(err) }); });
        }

        // Compute service summary hash with 60s cache
        if (!cachedSummaryHash || Date.now() > summaryHashExpiry) {
            try {
                const summary = await computeServiceSummary(config, storage);
                cachedSummaryHash = summary.summary_hash;
                summaryHashExpiry = Date.now() + 60_000;
            } catch (err) {
                // Keep stale hash on error
              logger.warn('fromId: continuing after a suppressed failure', { error: String(err) });
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

        // SECURITY (audit H-13): a peer the operator parked does not walk back in through a key
        // exchange. De-peering never deletes the peering request, so the old approval sat there as a
        // permanent re-admission ticket: the branch below fired for any status that was not
        // active/approved, re-created the peer at tier `member`, and took the public key from the
        // REQUEST BODY. Whoever knew the node id (the federation directory publishes it) could come
        // back with a key of their own choosing and then sign settlements this node would verify.
        if (peer && OPERATOR_PARKED.has(peer.status)) {
            res.status(403).json(error(config.nodeId, 'PEER_PARKED',
                `Node ${node_id} is ${peer.status} on this node. An operator must re-admit it; a key exchange cannot.`));
            return;
        }

        if (!peer || (peer.status !== 'active' && peer.status !== 'approved')) {
            // Auto-add ONLY when there is an operator-approved peering request from this node.
            // SECURITY (F1): never derive admission/trust from the request BODY (e.g. node_url ===
            // config.genesisUrl) — an unauthenticated caller could otherwise self-admit as an active
            // peer with an attacker-controlled key and then mint via /settle. A genesis/peer is
            // established through the signed introduce → operator-approval flow like any other peer.
            const senderUrl = node_url as string | undefined;
            const requests = await storage.listPeeringRequests();
            const approvedRequest = requests.find(r => r.fromNodeId === node_id && (r.status === 'approved' || r.status === 'auto_approved'));
            const hasApprovedRequest = !!approvedRequest;

            // The approval is for the node whose key the operator saw at introduce time. When that
            // key is on file it is the one that is trusted, not the one this request carries: an
            // approval must not become a blank cheque for whatever key turns up later. A caller
            // presenting a different key gets admitted with the ESTABLISHED one, which they cannot
            // sign for, so the re-admission is worthless to anyone but the real node.
            const admittedKey = approvedRequest?.publicKey || (node_public_key as string);
            // An approval written by this node's own join (admin-monitoring.ts) carries no key. Then the
            // key in this unauthenticated body is taken only when the card at the address the operator
            // approved publishes it under this node id: that address is the operator's choice, so its
            // card is the operator's word, which a body sent from anywhere is not.
            if (hasApprovedRequest && !approvedRequest?.publicKey) {
                const proven = await keyFromApprovedCard(node_id as string, approvedRequest?.fromNodeUrl || '', node_public_key as string);
                if (!proven) {
                    res.status(403).json(error(config.nodeId, 'KEY_NOT_PROVEN',
                        `The node at the approved address does not publish this key for ${node_id}. Nothing was admitted.`));
                    return;
                }
            }
            // The same holds for the ADDRESS. This door is unauthenticated, and the address it
            // re-admits a peer at is where this node then sends that peer's traffic: attached MCP
            // credentials, relayed messages, a federated sign-in's password. It took the address from
            // the body, so anyone who knew the node id and its published key could move the peer to a
            // server of their own. The approved request's address is the one the operator saw; a node
            // that really moved is re-introduced and approved again.
            const admittedUrl = approvedRequest?.fromNodeUrl || senderUrl;
            if (admittedUrl) {
                const urlCheck = await validateOutboundUrl(admittedUrl);
                if (!urlCheck.valid) {
                    res.status(400).json(error(config.nodeId, 'INVALID_URL', urlCheck.reason ?? 'The peer address is not allowed'));
                    return;
                }
            }

            if (hasApprovedRequest && admittedUrl) {
                const now = new Date().toISOString();
                // The tier the operator APPROVED, not a hardcoded 'member'. Same reasoning as the key
                // just above: de-peering leaves the approved request standing, so this branch is a
                // re-admission ticket, and a ticket that upgrades the holder is worse than one that
                // does not expire. A contact link comes back as a contact link, or not at all.
                const tier: PeerTier = coerceTier(approvedRequest?.tier);
                const newPeer: PeerInfo = {
                    nodeId: node_id,
                    url: admittedUrl,
                    publicKey: admittedKey,
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
        // A peer with no key at all took the first key any caller sent here: the rotation check below
        // has nothing to check against. Its key is taken only from the card at the peer's own address.
        if (!peer.publicKey && !(await keyFromApprovedCard(node_id as string, peer.url, node_public_key as string))) {
            res.status(403).json(error(config.nodeId, 'KEY_NOT_PROVEN',
                `${node_id} is a peer of this node with no key, and the node at its address does not publish this one. Nothing was changed.`));
            return;
        }
        if (peer.publicKey && node_public_key !== peer.publicKey) {
            const sig = (req.body?.signature as string | undefined) ?? '';
            const rotationPayload = `${node_id}:${node_public_key}:${timestamp ?? ''}`;
            const rotationOk = sig.length > 0 && await verify(peer.publicKey, rotationPayload, sig);
            if (!rotationOk) {
                void reportPeerIncident(storage, config.nodeId, {
                    kind: 'id-held', nodeId: node_id as string, via: 'key-exchange', actor: node_id as string,
                    presented: { key: node_public_key as string, ...(typeof node_url === 'string' ? { url: node_url } : {}) },
                    other: { key: peer.publicKey, url: peer.url },
                });
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

        // Return our own keys.
        //
        // The AGENT keys are a roster: every agent's GAII and public key on this node, which names
        // every person here and how many AIs each of them runs. Cross-node delivery signs with the
        // NODE key alone (services/message-delivery.ts), so a link that only carries messages needs
        // none of it. Sent only where routing or replication makes it useful.
        const nodeKey = await storage.getNodeKey();
        const sharesAgentKeys = peer.allowRouting || peer.replicateMemory;
        const ourAgentKeys = sharesAgentKeys
            ? (await storage.listAgents()).filter(a => a.publicKey).map(a => ({ gaii: a.gaii, public_key: a.publicKey }))
            : [];

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
