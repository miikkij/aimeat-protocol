/**
 * @file test/helpers/genesis-read-headers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The headers a genesis peer signs a genesis memory read with, the way signNodeRequest
 *   signs it (src/services/signed-node-request.ts) with the fields genesisMemoryReadFields names
 *   (src/routes/federation-genesis-memory-read.ts). GET /v1/federation/genesis-memory-read answers
 *   only such a request from an approved genesis peer (feature-list audit 166).
 * @usage const headers = await genesisReadHeaders(peerPrivateKey, peerNodeId, NODE_ID, { prefix: 'note.' });
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 166).
 */
import { createHash, randomBytes } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

export async function genesisReadHeaders(
    privateKeyBase64: string,
    sourceNode: string,
    audience: string,
    query: { gaii?: string; key?: string; prefix?: string },
): Promise<Record<string, string>> {
    const timestamp = new Date().toISOString();
    // 16 random bytes as hex: the only nonce shape the node accepts (services/request-nonce.ts).
    const nonce = randomBytes(16).toString('hex');
    // The key order is the wire format: source_node, timestamp, the request's fields, audience, nonce.
    const message = JSON.stringify({
        source_node: sourceNode, timestamp, purpose: 'genesis-memory-read',
        gaii: query.gaii ?? '', key: query.key ?? '', prefix: query.prefix ?? '', audience, nonce,
    });
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyBase64, 'base64'));
    return {
        'x-source-node': sourceNode, 'x-timestamp': timestamp, 'x-audience': audience,
        'x-nonce': nonce, 'x-signature': Buffer.from(sig).toString('base64'),
    };
}
