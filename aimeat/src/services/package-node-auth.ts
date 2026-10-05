/**
 * @file services/package-node-auth.ts
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
 * @structure signedPackageHeaders() · verifyPackageNode()
 * @usage
 *   const headers = await signedPackageHeaders(storage, config, groupId, repositoryNodeId);
 *   const who = await verifyPackageNode(req.headers, peers, groupId, config.nodeId);   // null when unsigned
 * @version-history
 *   v1.2.0 — 2026-10-05 — The signed message names the node it is for (x-audience) and a one-time
 *     x-nonce, and the repository accepts a nonce once (request-nonce.ts). A request carrying neither
 *     comes from an older node and is refused (secaudit 2026-10, PKG-10).
 *   v1.1.0 — 2026-09-28 — `entitled`: a packages-only peer (catalogue not shared) is heard for what it
 *     holds an entitlement to. Jouni approved the packages-only peer on 2026-09-28 (install packages,
 *     phase 5: the shop's automation registers the customer node with its grant).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 3).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign, verify } from '../auth/keypair.js';
import { gatePeer } from './federation-peer-gate.js';
import { newNonce, nonceAccepted, NONCE_WINDOW_MS } from './request-nonce.js';

const WINDOW_MS = NONCE_WINDOW_MS;

/** What is signed: the group, and since 2026-10-05 the node it is for and a one-time nonce (PKG-10). */
function message(sourceNode: string, timestamp: string, groupId: string, audience: string, nonce: string): string {
    return JSON.stringify({ source_node: sourceNode, timestamp, purpose: 'package', group_id: groupId, audience, nonce });
}

/** Headers that prove this node asked `audience` for `groupId`, or none when the node has no key yet. */
export async function signedPackageHeaders(storage: Storage, config: AimeatConfig, groupId: string, audience: string): Promise<Record<string, string>> {
    const key = await storage.getNodeKey();
    if (!key?.privateKey) return {};
    const timestamp = new Date().toISOString();
    const nonce = newNonce();
    return {
        'x-source-node': config.nodeId,
        'x-timestamp': timestamp,
        'x-audience': audience,
        'x-nonce': nonce,
        'x-signature': await sign(key.privateKey, message(config.nodeId, timestamp, groupId, audience, nonce)),
    };
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
    const sourceNode = pick('x-source-node');
    const signature = pick('x-signature');
    const timestamp = pick('x-timestamp');
    if (!sourceNode && !signature) return null;
    if (!sourceNode || !signature || !timestamp) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'A node request needs x-source-node, x-timestamp and x-signature.' };
    }
    const gate = gatePeer(peers, sourceNode, 'shareCatalogue');
    let peer: PeerInfo;
    if (gate.ok) peer = gate.peer;
    else {
        // Only the catalogue flag may be answered by an entitlement: an unknown node, an inactive
        // peer or one without a key is refused as before.
        const known = peers.get(sourceNode);
        const onlyCatalogue = gate.code === 'POLICY_DENIED' && known?.status === 'active' && !!known.publicKey;
        if (!onlyCatalogue || !entitled ||!(await entitled(sourceNode))) {
            return { ok: false, status: gate.status, code: gate.code, message: gate.message };
        }
        peer = known!;
    }
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > WINDOW_MS) {
        return { ok: false, status: 400, code: 'STALE_TIMESTAMP', message: 'The timestamp is missing, invalid, or outside the 5-minute window.' };
    }
    const audience = pick('x-audience');
    const nonce = pick('x-nonce');
    if (audience !== thisNodeId || !nonce) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: `A package request names the node it is for (x-audience: ${thisNodeId}) and a one-time x-nonce. A node that sends neither runs an older version.` };
    }
    if (!await verify(peer.publicKey, message(sourceNode, timestamp, groupId, audience, nonce), signature)) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'The node signature on this package request does not check out.' };
    }
    // After the signature, so a forged request cannot use up a real node's nonce.
    if (!nonceAccepted(sourceNode, nonce, now)) {
        return { ok: false, status: 401, code: 'REPLAYED', message: 'This signed request was already received. A node signs every request anew.' };
    }
    return { ok: true, nodeId: sourceNode };
}
