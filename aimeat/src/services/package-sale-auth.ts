/**
 * @file services/package-sale-auth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A seller node proving to a package repository that it asks for a sale, with no token.
 *
 *   WHY. The shop that sells install packages runs on its own AIMEAT node (store.aimeat.io). Until now
 *   its automation needed a bearer token of the package author's account on the repository, which a
 *   person had to create there and copy onto the shop's servers. Jouni ruled on 2026-09-29: "nyt ihan
 *   oikeasti tuon järjestelmän on pystyttävä tekemään toi itse". Both sides are AIMEAT nodes with keys
 *   of their own, so the shop's node signs its request and the repository checks the signature against
 *   the key it holds for that node. No secret moves between machines or people.
 *
 *   WHAT IS SIGNED. `{ source_node, timestamp, purpose: 'package-sale', method, path, body_sha256 }`.
 *   The method, the path and the body are all covered, so a signature taken for reading the questions
 *   cannot be replayed as a grant, and a grant for one node cannot be replayed for another. The body is
 *   the canonical JSON of what was sent (JSON.stringify of the parsed object), which the receiver
 *   computes from the parsed body; the timestamp holds a signature to five minutes.
 * @structure SALE_PURPOSE · CLAIM_PURPOSE · bodyDigest() · signedSaleHeaders() · verifySaleRequest() ·
 *   verifyRequestWithKey()
 * @usage
 *   const headers = await signedSaleHeaders(storage, config, 'PUT', path, body);   // the seller
 *   const who = await verifySaleRequest(req.headers, peers, req.method, req.originalUrl, req.body);   // the repository
 * @version-history
 *   v1.1.0 — 2026-10-02 — A purpose other than the sale (a buyer node's claim), and verifyRequestWithKey:
 *     a node that is not a peer yet signs with the key it names (package sale design, phase 3).
 *   v1.0.0 — 2026-09-29 — Initial (install packages, phase 5: seller nodes).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign, verify } from '../auth/keypair.js';

export const SALE_PURPOSE = 'package-sale';
const WINDOW_MS = 5 * 60 * 1000;

/** SHA-256 hex of the canonical JSON of a body; an absent body is `{}`. */
export function bodyDigest(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

/** The purpose a buyer node signs a claim with (package-claims.ts). */
export const CLAIM_PURPOSE = 'package-claim';

function message(sourceNode: string, timestamp: string, method: string, path: string, digest: string, purpose = SALE_PURPOSE): string {
    return JSON.stringify({ source_node: sourceNode, timestamp, purpose, method: method.toUpperCase(), path, body_sha256: digest });
}

/** Headers that prove this node asked for this exact request, or none when the node has no key yet. */
export async function signedSaleHeaders(
    storage: Storage, config: AimeatConfig, method: string, path: string, body: unknown, purpose = SALE_PURPOSE,
): Promise<Record<string, string>> {
    const key = await storage.getNodeKey();
    if (!key?.privateKey) return {};
    const timestamp = new Date().toISOString();
    return {
        'x-source-node': config.nodeId,
        'x-timestamp': timestamp,
        'x-signature': await sign(key.privateKey, message(config.nodeId, timestamp, method, path, bodyDigest(body), purpose)),
    };
}

/**
 * A request signed with the key it names itself: a node that is not a peer yet proves it holds the
 * key it asks to be registered under (a claim, package-claims.ts). The key is the body's own, so the
 * check says only "whoever sent this holds that key"; whether the key belongs to that node id is the
 * card check's to answer (package-peer-register.ts).
 */
export async function verifyRequestWithKey(
    headers: Record<string, string | string[] | undefined>, publicKey: string, purpose: string,
    method: string, path: string, body: unknown, now = Date.now(),
): Promise<SaleNodeCheck> {
    const pick = (h: string): string | undefined => { const v = headers[h]; return Array.isArray(v) ? v[0] : v; };
    const sourceNode = pick('x-source-node');
    const signature = pick('x-signature');
    const timestamp = pick('x-timestamp');
    if (!sourceNode || !signature || !timestamp || !publicKey) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'The request is signed by the node it names: x-source-node, x-timestamp and x-signature, with the key in the body.' };
    }
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > WINDOW_MS) {
        return { ok: false, status: 400, code: 'STALE_TIMESTAMP', message: 'The timestamp is missing, invalid, or outside the 5-minute window.' };
    }
    if (!await verify(publicKey, message(sourceNode, timestamp, method, path, bodyDigest(body), purpose), signature)) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'The signature does not check out with the key this request names.' };
    }
    return { ok: true, nodeId: sourceNode };
}

export type SaleNodeCheck =
    | { ok: true; nodeId: string }
    | { ok: false; status: number; code: string; message: string };

/**
 * Which node signed this exact request. The node must be an active peer with a key; what it may do is
 * decided by the caller (package-sellers.ts), not here. `path` is the request's path as it arrived,
 * with its query string.
 */
export async function verifySaleRequest(
    headers: Record<string, string | string[] | undefined>,
    peers: Map<string, PeerInfo>,
    method: string, path: string, body: unknown,
    now = Date.now(),
): Promise<SaleNodeCheck> {
    const pick = (h: string): string | undefined => {
        const v = headers[h];
        return Array.isArray(v) ? v[0] : v;
    };
    const sourceNode = pick('x-source-node');
    const signature = pick('x-signature');
    const timestamp = pick('x-timestamp');
    if (!sourceNode || !signature || !timestamp) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'A sale request is signed by the selling node: x-source-node, x-timestamp and x-signature.' };
    }
    const peer = peers.get(sourceNode);
    if (!peer || peer.status !== 'active' || !peer.publicKey) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: `${sourceNode} is not an active peer of this repository. Its author names it a seller first (aimeat_package_sellers).` };
    }
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > WINDOW_MS) {
        return { ok: false, status: 400, code: 'STALE_TIMESTAMP', message: 'The timestamp is missing, invalid, or outside the 5-minute window.' };
    }
    if (!await verify(peer.publicKey, message(sourceNode, timestamp, method, path, bodyDigest(body)), signature)) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'The node signature on this sale request does not check out for this method, path and body.' };
    }
    return { ok: true, nodeId: sourceNode };
}
