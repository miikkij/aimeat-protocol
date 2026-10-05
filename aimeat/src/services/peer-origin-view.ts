/**
 * @file services/peer-origin-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the operator's peer listings say about how each peer arrived.
 *
 *   THREE ANSWERS. A peer added since 2026-10-01 by a code path that needs no operator carries its
 *   record (peer-origin.ts): the path, who asked, and the card check it passed. A peer from before
 *   that date has no record, and nothing on the peer row says who made it, so the answer is read
 *   from what else exists: a peer with the packages-only shape (contact tier, messaging, catalogue and
 *   memory all off), which no operator screen produces in one step, is reported as `inferred`, with
 *   the entitlements and seller records that name it and who wrote those. A peer with neither is
 *   `operator_or_federation`: added by the operator or by a federation handshake, which this node did not
 *   record either.
 *
 *   WHAT CANNOT BE CONCLUDED. An inferred peer was registered by a package path or shaped that way by
 *   an operator; nothing says which, and nothing says whether the key it holds is the real node's. Its card
 *   can be read now (the operator's check), and that says only what the url answers today.
 * @structure PeerOriginView · describePeerOrigins()
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (the peer-registration incident, finding F).
 */
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { listPeerOrigins, listPendingPeers, type PendingPeer } from './peer-origin.js';
import { NS_PACKAGE_ENTITLEMENTS } from './packages/sale/package-entitlements.js';

export type PeerOriginView =
    | { kind: 'recorded'; source: string; by: string; group_id?: string; proof: string; requested_at: string; proven_at: string }
    | { kind: 'inferred'; source: 'package'; named_by: Array<{ record: 'entitlement' | 'seller'; group_id?: string; by: string; at: string; note?: string }> }
    | { kind: 'operator_or_federation' };

/** The packages-only shape: what registerPackagePeer writes, and no operator screen writes in one step. */
function packagesOnlyShape(p: PeerInfo): boolean {
    return p.tier === 'contact' && p.allowMessaging === false && p.shareCatalogue === false && p.replicateMemory === false;
}

type Named = { record: 'entitlement' | 'seller'; group_id?: string; by: string; at: string; note?: string };

/** Who names each node in the entitlement and seller records. */
async function namedInPackageRecords(storage: Storage): Promise<Map<string, Named[]>> {
    const out = new Map<string, Named[]>();
    const add = (nodeId: string, n: Named): void => { out.set(nodeId, [...(out.get(nodeId) ?? []), n]); };
    for (const row of await storage.listMemory(NS_PACKAGE_ENTITLEMENTS, { prefix: 'entitlements.' })) {
        const v = row.value as { groupId?: string; nodes?: Record<string, { grantedBy?: string; grantedAt?: string; note?: string }> } | undefined;
        for (const [nodeId, e] of Object.entries(v?.nodes ?? {})) {
            add(nodeId, { record: 'entitlement', group_id: v?.groupId, by: e.grantedBy ?? '', at: e.grantedAt ?? '', ...(e.note ? { note: e.note } : {}) });
        }
    }
    for (const row of await storage.listMemory(NS_PACKAGE_ENTITLEMENTS, { prefix: 'sellers.' })) {
        const v = row.value as { nodes?: Record<string, { addedBy?: string; addedAt?: string; note?: string }> } | undefined;
        for (const [nodeId, s] of Object.entries(v?.nodes ?? {})) {
            add(nodeId, { record: 'seller', by: s.addedBy ?? '', at: s.addedAt ?? '', ...(s.note ? { note: s.note } : {}) });
        }
    }
    return out;
}

/** How every peer arrived, and the registrations still waiting for their node to answer. */
export async function describePeerOrigins(
    storage: Storage, peers: Iterable<PeerInfo>,
): Promise<{ byNode: Map<string, PeerOriginView>; pending: PendingPeer[] }> {
    const recorded = await listPeerOrigins(storage);
    const list = [...peers];
    const named = list.some(p => !recorded.has(p.nodeId) && packagesOnlyShape(p)) ? await namedInPackageRecords(storage) : new Map<string, Named[]>();
    const byNode = new Map<string, PeerOriginView>();
    for (const p of list) {
        const o = recorded.get(p.nodeId);
        // A record names the key the card answered with. A peer re-keyed since is not that peer any more.
        if (o && o.publicKey === p.publicKey) {
            byNode.set(p.nodeId, {
                kind: 'recorded', source: o.source, by: o.by, ...(o.groupId ? { group_id: o.groupId } : {}),
                proof: o.proof, requested_at: o.requestedAt, proven_at: o.provenAt,
            });
        } else if (packagesOnlyShape(p)) {
            byNode.set(p.nodeId, { kind: 'inferred', source: 'package', named_by: named.get(p.nodeId) ?? [] });
        } else {
            byNode.set(p.nodeId, { kind: 'operator_or_federation' });
        }
    }
    return { byNode, pending: await listPendingPeers(storage) };
}
