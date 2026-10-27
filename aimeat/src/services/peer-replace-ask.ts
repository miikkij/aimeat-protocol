/**
 * @file src/services/peer-replace-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's one-press decision when a node presents an invite that names no node
 *   and asks for a node id this node holds for a peer under another key (secaudit2026oct26,
 *   link-invite-not-bound-to-node-id-replaces-held-peer; the coordinator's ruling of 2026-10-27).
 *
 *   WHY. Such an invite replaced the held peer on the spot, so anyone holding an unused invite could
 *   take the id of an established peer that was offline for a moment, with its people's contacts.
 *   A plain invite stays the operator's way to bring back a rebuilt node under a new key, so the
 *   replacement is not refused: it waits as a pending peering request, the invite unused, and the
 *   operators are asked in plain words with Allow and Don't allow (services/approval-standard.ts).
 *
 *   ALLOW uses the invite, removes the held peer and admits the presenting node at the invite's tier,
 *   as an invite admission does at once. DON'T ALLOW leaves the held peer and the invite as they were.
 *   The presenting node reads the answer where every peering request reports it: GET
 *   /v1/federation/peer/introduce/:id/status turns from pending to approved or rejected. An invite that
 *   names its node goes straight through as before (routes/federation-peer/introduce.ts).
 *
 *   One question per invite: presenting it again while its request is pending answers with that request.
 * @structure PEER_REPLACE_ASK_TYPE · askPeerReplacement() · decidePeerReplacement()
 * @usage
 *   const asked = await askPeerReplacement({ storage, config }, { inviteKey, invite, nodeId, nodeUrl, publicKey, held, message });
 *   const decided = await decidePeerReplacement({ storage, config, peers }, requestId, 'approve', decidedBy);
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { notify } from './notify.js';
import { approverGhiis, closeQuestion } from './approval-standard.js';
import { LINK_INVITE_GAII, consumeLinkInviteAtKey, type LinkInviteRecord } from './link-invites.js';
import { deriveTierFlags, coerceTier } from './federation-tiers.js';
import { performKeyExchange } from './federation-helpers.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** The bell notice type of the question, and its locale key under `notiftext.`. */
export const PEER_REPLACE_ASK_TYPE = 'peer_replace_ask';

/** Where a waiting replacement is kept, under the link invites' system identity, by request id. */
const ASK_PREFIX = 'peer-replace-ask.';

interface ReplaceAsk {
    requestId: string;
    /** The stored key of the invite presented (link-invites.ts), so the token itself is never kept. */
    inviteKey: string;
    inviteId: string;
    nodeId: string;
    nodeUrl: string;
    publicKey: string;
    heldKey: string;
    tier: string;
    createdAt: string;
}

const questionRef = (requestId: string) => `peer-replace:${requestId}`;
const FEDERATION_PAGE = '/v1/admin?tab=federation';

async function readAsk(storage: Storage, requestId: string): Promise<ReplaceAsk | null> {
    const row = await storage.getMemory(LINK_INVITE_GAII, `${ASK_PREFIX}${requestId}`);
    const v = row?.value as unknown as ReplaceAsk | undefined;
    return v?.requestId ? v : null;
}

/**
 * File the replacement as a pending peering request and ask the operators. Answers with the request
 * id; `repeated` when the same invite already waits under one.
 */
export async function askPeerReplacement(
    deps: { storage: Storage; config: AimeatConfig },
    a: { inviteKey: string; invite: LinkInviteRecord; nodeId: string; nodeUrl: string; publicKey: string; held: PeerInfo; message: string },
): Promise<{ requestId: string; repeated: boolean }> {
    const { storage, config } = deps;
    for (const row of await storage.listMemory(LINK_INVITE_GAII, { prefix: ASK_PREFIX })) {
        const earlier = row.value as unknown as ReplaceAsk;
        if (earlier?.inviteId !== a.invite.id) continue;
        const req = await storage.getPeeringRequest(earlier.requestId);
        if (req?.status === 'pending') return { requestId: earlier.requestId, repeated: true };
    }

    const now = new Date().toISOString();
    const requestId = `peer-req-${randomBytes(8).toString('hex')}`;
    const tier = coerceTier(a.invite.tier);
    await storage.createPeeringRequest({
        id: requestId, fromNodeUrl: a.nodeUrl, fromNodeId: a.nodeId, toNodeId: config.nodeId, targetUrl: a.nodeUrl,
        publicKey: a.publicKey, message: a.message, status: 'pending', tier, createdAt: now, updatedAt: now,
    });
    const ask: ReplaceAsk = {
        requestId, inviteKey: a.inviteKey, inviteId: a.invite.id, nodeId: a.nodeId, nodeUrl: a.nodeUrl,
        publicKey: a.publicKey, heldKey: a.held.publicKey, tier, createdAt: now,
    };
    await storage.setMemory({
        key: `${ASK_PREFIX}${requestId}`, ownerGaii: LINK_INVITE_GAII, value: ask as unknown as Record<string, unknown>,
        visibility: 'private', tags: ['federation', 'link-invite'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });

    const label = a.invite.label ? ` (${a.invite.label})` : '';
    const vars = { node: a.nodeId, url: a.nodeUrl, label, tier };
    try {
        for (const to of await approverGhiis({ storage, config }, `system@${config.nodeId}`, 'operators')) {
            await notify(storage, to, {
                type: PEER_REPLACE_ASK_TYPE,
                title: `A server with an invite wants to take the place of the peer ${a.nodeId}`,
                body: `A server at ${a.nodeUrl} presented one of your invites${label} and says it is ${a.nodeId}. `
                    + `This server already holds ${a.nodeId} as a peer under a different key. Allow replaces that peer with the new server `
                    + `at the invite's level (${tier}) and uses the invite. Don't allow keeps the peer and the invite as they are. `
                    + 'Allow only if you know the server was rebuilt with a new key.',
                link: FEDERATION_PAGE,
                i18n: { key: PEER_REPLACE_ASK_TYPE, vars },
                ref: questionRef(requestId),
                actions: [{
                    id: 'deny', label: 'Don\'t allow', kind: 'api', method: 'POST',
                    endpoint: `/v1/admin/peering/requests/${requestId}/decision`, body: { decision: 'reject' }, style: 'default',
                    i18n: { key: `${PEER_REPLACE_ASK_TYPE}.deny` },
                }, {
                    id: 'allow', label: 'Allow', kind: 'api', method: 'POST',
                    endpoint: `/v1/admin/peering/requests/${requestId}/decision`, body: { decision: 'approve' }, style: 'primary',
                    i18n: { key: `${PEER_REPLACE_ASK_TYPE}.allow` },
                }],
            });
        }
    } catch (err) {
        logger.warn('peer replacement: the operators could not be told; the request waits on the Federation page', { requestId, node: a.nodeId, error: String(err) });
    }
    emitChange('federation');
    return { requestId, repeated: false };
}

export type ReplaceDecision =
    | { ok: true; status: 'approved' | 'rejected' }
    | { ok: false; status: number; code: string; message: string };

/**
 * Decide a waiting replacement. Null when `requestId` is not one, so the ordinary approval runs.
 */
export async function decidePeerReplacement(
    deps: { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo> },
    requestId: string, decision: 'approve' | 'reject', decidedBy: string | null,
): Promise<ReplaceDecision | null> {
    const { storage, config, peers } = deps;
    const ask = await readAsk(storage, requestId);
    if (!ask) return null;
    const recipients = await approverGhiis({ storage, config }, `system@${config.nodeId}`, 'operators');
    const finish = async (status: 'approved' | 'rejected') => {
        await storage.updatePeeringRequest(requestId, { status, updatedAt: new Date().toISOString() });
        await storage.deleteMemory(LINK_INVITE_GAII, `${ASK_PREFIX}${requestId}`);
        await closeQuestion({ storage }, {
            recipients, ref: questionRef(requestId), outcome: status === 'approved' ? 'allowed' : 'declined', decidedBy,
            change: { link: FEDERATION_PAGE, key: 'approval_change.federation' },
        });
        emitChange('federation');
    };

    if (decision === 'reject') {
        await finish('rejected');
        return { ok: true, status: 'rejected' };
    }

    const used = await consumeLinkInviteAtKey(storage, ask.inviteKey, ask.nodeId);
    if (!used.ok) {
        return { ok: false, status: 409, code: 'INVITE_NOT_OPEN',
            message: `The invite this node presented was used, revoked or has run out, so ${ask.nodeId} was not replaced. Reject this request, or send the node a new invite.` };
    }
    // The same admission an invite makes at once (routes/federation-peer/introduce.ts), now that the
    // operator decided it for this node id.
    peers.delete(ask.nodeId);
    await storage.deleteFederationPeer(ask.nodeId);
    const now = new Date().toISOString();
    const tier = coerceTier(used.tier);
    const admitted: PeerInfo = {
        nodeId: ask.nodeId, url: ask.nodeUrl, publicKey: ask.publicKey, status: 'active',
        addedAt: now, lastSeen: now, ...deriveTierFlags(tier), tier,
    };
    peers.set(ask.nodeId, admitted);
    await storage.saveFederationPeer(admitted);
    await finish('approved');
    void performKeyExchange(ask.nodeUrl, config, storage, ask.nodeId)
        .catch(err => logger.warn('peer replacement: the key exchange after the approval failed; the next one retries', { node: ask.nodeId, error: String(err) }));
    return { ok: true, status: 'approved' };
}
