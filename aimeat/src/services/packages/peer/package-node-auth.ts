/**
 * @file services/packages/peer/package-node-auth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A node proving to a package repository which node it is.
 *
 *   WHY. A package repository (install packages, phase 3; wish-asennuspaketit-uusille-nodeille-ja-
 *   keskitetty-pakettireposit) serves a private package to the customer nodes entitled to it, and so
 *   has to know which node is asking. The export and attestation endpoints did not: they answered on
 *   the visibility of the package and the session of the caller, and a pull carried neither. The
 *   pulling node now signs, and the repository checks the signature against the key in its peer
 *   record, the pattern the template listing already follows (routes/federation-sync/templates.ts).
 *
 *   WHAT IS SIGNED. `{ source_node, timestamp, purpose: 'package', group_id }`, so a signature taken
 *   for one package cannot be replayed for another, and the timestamp holds it to five minutes.
 *   The customer node must be an active peer of the repository with the catalogue shared: that is
 *   how a repository operator says which nodes it serves at all, before any entitlement. A peer that
 *   shares no catalogue is heard when it holds an entitlement here (the `entitled` callback), which is
 *   the packages-only peer a grant registers.
 * @structure fieldsOf() · signedPackageHeaders() · verifyPackageNode()
 * @usage
 *   const headers = await signedPackageHeaders(storage, config, groupId, repositoryNodeId);
 *   const who = await verifyPackageNode(req.headers, peers, groupId, config.nodeId);   // null when unsigned
 * @version-history
 *   v1.3.1 — 2026-10-10 — fieldsOf is exported, so the pending-peer check verifies the same fields
 *     (secaudit 2026-10-10 I7).
 *   v1.3.0 — 2026-10-05 — Signing and checking are services/signed-node-request.ts, which the sale
 *     requests use too; the signed string is the same (secaudit 2026-10, C6).
 *   v1.2.0 — 2026-10-05 — The signed message names the node it is for (x-audience) and a one-time
 *     x-nonce, and the repository accepts a nonce once (request-nonce.ts). A request carrying neither
 *     comes from an older node and is refused (secaudit 2026-10, PKG-10).
 *   v1.1.0 — 2026-09-28 — `entitled`: a packages-only peer (catalogue not shared) is heard for what it
 *     holds an entitlement to. Jouni approved the packages-only peer on 2026-09-28 (install packages,
 *     phase 5: the shop's automation registers the customer node with its grant).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 3).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import type { PeerInfo } from '../../federation.js';
import { gatePeer } from '../../federation-peer-gate.js';
import { signNodeRequest, checkNodeRequest } from '../../signed-node-request.js';

/** What a package request signs besides the common fields (services/signed-node-request.ts). Exported
 *  for the pending-peer check that runs before verifyPackageNode (sale/package-entitlements.ts). */
export const fieldsOf =(groupId: string): Record<string, string> => ({ purpose: 'package', group_id: groupId });

/** Headers that prove this node asked `audience` for `groupId`, or none when the node has no key yet. */
export async function signedPackageHeaders(storage: Storage, config: AimeatConfig, groupId: string, audience: string): Promise<Record<string, string>> {
    return signNodeRequest(storage, config, audience, fieldsOf(groupId));
}

export type PackageNodeCheck =
    | { ok: true; nodeId: string }
    | { ok: false; status: number; code: string; message: string };

/**
 * Which node signed this request for `groupId`. Null when the request carries no node headers at
 * all (an ordinary read, decided on visibility as before); a refusal when it carries them and they
 * do not prove a peer.
 */
export async function verifyPackageNode(
    headers: Record<string, string | string[] | undefined>,
    peers: Map<string, PeerInfo>,
    groupId: string,
    /** This node's id: the request must name it as its audience. */
    thisNodeId: string,
    now = Date.now(),
    /**
     * Whether the node holds an entitlement here. An entitlement is itself the permission to read
     * what it names, so a peer that shares no catalogue (a packages-only peer registered with its
     * grant, package-entitlements.ts) is still heard when this answers yes. The peer must still be
     * active and its key must still verify the signature.
     */
    entitled?: (nodeId: string) => Promise<boolean>,
): Promise<PackageNodeCheck | null> {
    const pick = (h: string): string | undefined => {
        const v = headers[h];
        return Array.isArray(v) ? v[0] : v;
    };
    if (!pick('x-source-node') && !pick('x-signature')) return null;
    return checkNodeRequest(headers, {
        thisNodeId, now, fields: fieldsOf(groupId),
        missingMessage: 'A node request needs x-source-node, x-timestamp and x-signature.',
        badSignatureMessage: 'The node signature on this package request does not check out.',
        keyOf: async (sourceNode) => {
            const gate = gatePeer(peers, sourceNode, 'shareCatalogue');
            if (gate.ok) return { publicKey: gate.peer.publicKey };
            // Only the catalogue flag may be answered by an entitlement: an unknown node, an inactive
            // peer or one without a key is refused as before.
            const known = peers.get(sourceNode);
            const onlyCatalogue = gate.code === 'POLICY_DENIED' && known?.status === 'active' && !!known.publicKey;
            if (!onlyCatalogue || !entitled || !(await entitled(sourceNode))) {
                return { ok: false, status: gate.status, code: gate.code, message: gate.message };
            }
            return { publicKey: known!.publicKey };
        },
    });
}
