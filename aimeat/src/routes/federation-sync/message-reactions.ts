/**
 * @file src/routes/federation-sync/message-reactions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/federation/message/reaction: an acknowledgement mark on a direct message, given
 *   by a person or agent of another node, arrives here signed. The sending node signs the seven fields
 *   of reactionPayload (services/message-reactions.ts) and adds the audience proof a message carries;
 *   this node refuses a peer without the messaging right, a bad signature, a stale or replayed send,
 *   a reactor that is not the signing node's own, and a message this node holds no copy of with the
 *   reactor as a party. The mark is then stored and announced here, and never sent on.
 * @structure registerMessageReactionFederationRoute(router, config, storage, peers)
 * @usage registerMessageReactionFederationRoute(router, config, storage, peers); (routes/federation-sync.ts)
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-kuittausreaktiot-yksitt-isiin-viesteihin-viestit-ketjuissa).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { PeerInfo } from '../../services/federation.js';
import { success, error } from '../../middleware/envelope.js';
import { gatePeer } from '../../services/federation-peer-gate.js';
import { verify } from '../../auth/keypair.js';
import { signedMessageRefusal, audienceRefusal, pinnedRefusal, federationPeerProofPin } from '../../services/signed-node-request.js';
import { applyRemoteReaction, reactionPayload } from '../../services/message-reactions.js';

export function registerMessageReactionFederationRoute(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    router.post('/v1/federation/message/reaction', async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const { source_node, message_id, reaction, reactor, by_agent, op, timestamp, signature } = body;
        if (typeof source_node !== 'string' || !source_node || typeof signature !== 'string' || !signature) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node and signature are required'));
            return;
        }
        // A mark is part of the message conversation, so it rides the same word as a message.
        const gate = gatePeer(peers, source_node, 'allowMessaging');
        if (!gate.ok) {
            res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
            return;
        }
        const peer = gate.peer;
        const signed = JSON.stringify(reactionPayload(source_node, String(message_id ?? ''), {
            reaction: String(reaction ?? ''), reactorGhii: String(reactor ?? ''),
            byAgent: typeof by_agent === 'string' && by_agent ? by_agent : undefined, removed: op === 'remove',
        }, String(timestamp ?? '')));
        // The receiver rebuilds the signed text from the fields, so a field the signature does not cover
        // cannot ride along. `op` other than add/remove is refused below, after the signature.
        if (!await verify(peer.publicKey, signed, signature)) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on reaction'));
            return;
        }
        // Names this node, inside five minutes of its signed time, and once (signed-node-request.ts).
        const refusal = await pinnedRefusal(await federationPeerProofPin(storage, peer), body, provenSince => audienceRefusal({
            signed, audience: body.audience, audienceSignature: body.audience_signature,
            publicKey: peer.publicKey, thisNodeId: config.nodeId, required: config.federationAudienceRequired, provenSince,
        })) ?? signedMessageRefusal(source_node, timestamp, signature);
        if (refusal) {
            res.status(refusal.status).json(error(config.nodeId, refusal.code, refusal.message));
            return;
        }
        const out = await applyRemoteReaction({ config, storage, peers }, source_node, { message_id, reaction, reactor, by_agent, op });
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        res.json(success(config.nodeId, { ok: true, changed: out.changed }));
    });
}
