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
 *   how a repository operator says which nodes it serves at all, before any entitlement.
 * @structure signedPackageHeaders() · verifyPackageNode()
 * @usage
 *   const headers = await signedPackageHeaders(storage, config, groupId);
 *   const who = await verifyPackageNode(req.headers, peers, groupId);   // null when unsigned
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 3).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign, verify } from '../auth/keypair.js';
import { gatePeer } from './federation-peer-gate.js';

const WINDOW_MS = 5 * 60 * 1000;

function message(sourceNode: string, timestamp: string, groupId: string): string {
    return JSON.stringify({ source_node: sourceNode, timestamp, purpose: 'package', group_id: groupId });
}

/** Headers that prove this node asked for `groupId`, or none when the node has no key yet. */
export async function signedPackageHeaders(storage: Storage, config: AimeatConfig, groupId: string): Promise<Record<string, string>> {
    const key = await storage.getNodeKey();
    if (!key?.privateKey) return {};
    const timestamp = new Date().toISOString();
    return {
        'x-source-node': config.nodeId,
        'x-timestamp': timestamp,
        'x-signature': await sign(key.privateKey, message(config.nodeId, timestamp, groupId)),
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
    now = Date.now(),
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
    if (!gate.ok) return { ok: false, status: gate.status, code: gate.code, message: gate.message };
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > WINDOW_MS) {
        return { ok: false, status: 400, code: 'STALE_TIMESTAMP', message: 'The timestamp is missing, invalid, or outside the 5-minute window.' };
    }
    if (!await verify(gate.peer.publicKey, message(sourceNode, timestamp, groupId), signature)) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'The node signature on this package request does not check out.' };
    }
    return { ok: true, nodeId: sourceNode };
}
