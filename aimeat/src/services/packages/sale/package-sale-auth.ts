/**
 * @file services/packages/sale/package-sale-auth.ts
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
 *   computes from the parsed body; the timestamp holds a signature to five minutes. The signing and
 *   the checks are services/signed-node-request.ts, shared with the package requests.
 * @structure SALE_PURPOSE · CLAIM_PURPOSE · bodyDigest() · signedSaleHeaders() · verifySaleRequest() ·
 *   verifyRequestWithKey()
 * @usage
 *   const headers = await signedSaleHeaders(storage, config, 'PUT', path, body);   // the seller
 *   const who = await verifySaleRequest(req.headers, peers, req.method, req.originalUrl, req.body);   // the repository
 * @version-history
 *   v1.3.0 — 2026-10-05 — Signing and checking are services/signed-node-request.ts, which the package
 *     requests use too; the signed string is the same (secaudit 2026-10, C6).
 *   v1.2.0 — 2026-10-05 — The signed message names the node it is for (x-audience) and a one-time
 *     x-nonce; both verifiers require them and accept a nonce once (request-nonce.ts). A request
 *     carrying neither comes from an older node and is refused (secaudit 2026-10, PKG-10).
 *   v1.1.0 — 2026-10-02 — A purpose other than the sale (a buyer node's claim), and verifyRequestWithKey:
 *     a node that is not a peer yet signs with the key it names (package sale design, phase 3).
 *   v1.0.0 — 2026-09-29 — Initial (install packages, phase 5: seller nodes).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import type { PeerInfo } from '../../federation.js';
import { signNodeRequest, checkNodeRequest, type NodeRequestCheck } from '../../signed-node-request.js';

export const SALE_PURPOSE = 'package-sale';

/** SHA-256 hex of the canonical JSON of a body; an absent body is `{}`. */
export function bodyDigest(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

/** The purpose a buyer node signs a claim with (package-claims.ts). */
export const CLAIM_PURPOSE = 'package-claim';

/** What a sale request signs besides the common fields: the exact request. */
function fieldsOf(method: string, path: string, body: unknown, purpose = SALE_PURPOSE): Record<string, string> {
    return { purpose, method: method.toUpperCase(), path, body_sha256: bodyDigest(body) };
}

/** Headers that prove this node asked `audience` for this exact request, or none when the node has no key yet. */
export async function signedSaleHeaders(
    storage: Storage, config: AimeatConfig, audience: string, method: string, path: string, body: unknown, purpose = SALE_PURPOSE,
): Promise<Record<string, string>> {
    return signNodeRequest(storage, config, audience, fieldsOf(method, path, body, purpose));
}

export type SaleNodeCheck = NodeRequestCheck;

/**
 * A request signed with the key it names itself: a node that is not a peer yet proves it holds the
 * key it asks to be registered under (a claim, package-claims.ts). The key is the body's own, so the
 * check says only "whoever sent this holds that key"; whether the key belongs to that node id is the
 * card check's to answer (package-peer-register.ts).
 */
export async function verifyRequestWithKey(
    headers: Record<string, string | string[] | undefined>, publicKey: string, purpose: string, thisNodeId: string,
    method: string, path: string, body: unknown, now = Date.now(),
): Promise<SaleNodeCheck> {
    const missingMessage = 'The request is signed by the node it names: x-source-node, x-timestamp and x-signature, with the key in the body.';
    return checkNodeRequest(headers, {
        thisNodeId, now, fields: fieldsOf(method, path, body, purpose), missingMessage,
        badSignatureMessage: 'The signature does not check out with the key this request names.',
        keyOf: () => (publicKey ? { publicKey } : { ok: false, status: 401, code: 'UNAUTHORIZED', message: missingMessage }),
    });
}

/**
 * Which node signed this exact request. The node must be an active peer with a key; what it may do is
 * decided by the caller (package-sellers.ts), not here. `path` is the request's path as it arrived,
 * with its query string.
 */
export async function verifySaleRequest(
    headers: Record<string, string | string[] | undefined>,
    peers: Map<string, PeerInfo>,
    thisNodeId: string,
    method: string, path: string, body: unknown,
    now = Date.now(),
): Promise<SaleNodeCheck> {
    return checkNodeRequest(headers, {
        thisNodeId, now, fields: fieldsOf(method, path, body),
        missingMessage: 'A sale request is signed by the selling node: x-source-node, x-timestamp and x-signature.',
        badSignatureMessage: 'The node signature on this sale request does not check out for this method, path and body.',
        keyOf: (sourceNode) => {
            const peer = peers.get(sourceNode);
            if (!peer || peer.status !== 'active' || !peer.publicKey) {
                return { ok: false, status: 403, code: 'FORBIDDEN', message: `${sourceNode} is not an active peer of this repository. Its author names it a seller first (aimeat_package_sellers).` };
            }
            return { publicKey: peer.publicKey };
        },
    });
}
