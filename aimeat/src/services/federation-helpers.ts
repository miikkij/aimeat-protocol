/**
 * @file src/services/federation-helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federation shared helpers used across the federation routers
 *   (peer, sync, genesis, settlements): keyword/location matching for cross-catalogue
 *   filtering, a TTL peer-key cache for signature verification, and outbound key exchange.
 *
 * @structure
 *   - matchesKeyword/matchesActionKeyword/matchesGenesisKeyword/matchesLocation: search filters
 *   - PeerKeyEntry / peerKeyCache: TTL cache of peer node public keys
 *   - performKeyExchange(peerUrl, config, storage, expectNodeId): exchange and cache peer public keys
 *
 * @version-history
 *   2026-10-16 — performKeyExchange sends no agent roster (agent_keys is an empty list) and keeps none
 *     it receives; PeerKeyEntry holds the node key only (QA audit S6-04).
 *   v1.2.0 — 2026-10-12 — performKeyExchange asks peerUrlRefusal first: a public node exchanges keys
 *     only over https:// from 4.0.0 (Core 2026-11 FED-13).
 *   v1.1.0 — 2026-10-01 — performKeyExchange names the node it asks (`expectNodeId`). An answer that
 *     says it is another node is a failed exchange, and the key is cached under the node asked, never
 *     under the id the answer names: whatever answered at an address could place a key for any node id,
 *     and the policy and federation books fall back to this cache for an issuer that is not a peer
 *     (incident key-exchange-caches-the-key-under-the-node-id-the-answer-nam-muptiona).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { safeFetch } from '../utils/url-validator.js';
import { peerUrlRefusal } from './peer-url-policy.js';

// ── E.4: Keyword matching helpers for cross-catalogue filtering ──

export function matchesKeyword(csm: { name: string; serviceType?: string }, keyword: string): boolean {
    const lk = keyword.toLowerCase();
    return csm.name.toLowerCase().includes(lk) ||
        (csm.serviceType?.toLowerCase().includes(lk) ?? false);
}

export function matchesActionKeyword(action: { displayName: string; description: string; category?: string; tags: string[] }, keyword: string): boolean {
    const lk = keyword.toLowerCase();
    return action.displayName.toLowerCase().includes(lk) ||
        action.description.toLowerCase().includes(lk) ||
        (action.category?.toLowerCase().includes(lk) ?? false) ||
        action.tags.some(t => t.toLowerCase().includes(lk));
}

export function matchesGenesisKeyword(val: Record<string, unknown>, keyword: string): boolean {
    const lk = keyword.toLowerCase();
    const searchFields = ['name', 'display_name', 'displayName', 'description', 'category', 'service_type', 'serviceType'];
    return searchFields.some(f => {
        const v = val[f];
        return typeof v === 'string' && v.toLowerCase().includes(lk);
    });
}

export function matchesLocation(val: Record<string, unknown>, location: string): boolean {
    const ll = location.toLowerCase();
    const locationFields = ['location', 'city', 'region', 'country'];
    return locationFields.some(f => {
        const v = val[f];
        return typeof v === 'string' && v.toLowerCase().includes(ll);
    });
}

// ── A.3: Peer Key Cache ──
// Caches peer node + agent public keys with TTL for signature verification

/**
 * A peer's NODE key with its time to live. The exchange used to carry every agent's GAII and public
 * key as well, which named every person on the node and how many agents each runs; nothing read the
 * agent keys a node received, and cross-node messages are signed with the node key alone, so neither
 * side sends or keeps them any more (QA audit S6-04).
 */
export interface PeerKeyEntry {
    publicKey: string;
    expiresAt: number;
}

export const peerKeyCache = new Map<string, PeerKeyEntry>();

/**
 * Perform outbound key exchange with a peer node.
 * Sends this node's public key + agent keys, receives and caches the peer's keys.
 * Reusable from peering activation (A.3) and recovery callback (A.4).
 */
export async function performKeyExchange(
    peerUrl: string,
    config: AimeatConfig,
    storage: Storage,
    /** The node this exchange is with. An answer naming another node fails the exchange. */
    expectNodeId: string,
): Promise<{ success: boolean; error?: string; peerPublicKey?: string }> {
    try {
        // Every peering runs this exchange, so it is where a stored plain-http address on a public
        // node stops being used (Core 2026-11 FED-13, peer-url-policy.ts).
        const schemeRefusal = peerUrlRefusal(config, peerUrl);
        if (schemeRefusal) return { success: false, error: `${schemeRefusal.code}: ${schemeRefusal.message}` };
        const nodeKey = await storage.getNodeKey();
        if (!nodeKey) {
            return { success: false, error: 'No node key available' };
        }

        // agent_keys stays in the payload as an empty list, so a peer on an older version that reads
        // the field still parses the request. The roster is not sent to any tier (QA audit S6-04).
        const payload = {
            node_id: config.nodeId,
            node_url: config.baseUrl,
            node_public_key: nodeKey.publicKey,
            agent_keys: [] as Array<{ gaii: string; public_key: string }>,
            timestamp: new Date().toISOString(),
        };

        // safeFetch, not fetch: peerUrl is a remote-supplied address (it arrives on the introduce
        // flow), and a plain fetch follows a 3xx into an internal host without re-validating. safeFetch
        // re-checks every redirect hop (CodeQL js/request-forgery, AI-triage 2026-08-23).
        const resp = await safeFetch(`${peerUrl}/v1/federation/key-exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.federationTimeoutMs),
        });

        if (!resp.ok) {
            // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
            const body = await resp.text().catch(() => '');
            return { success: false, error: `Peer returned ${resp.status}: ${body}` };
        }

        const data = await resp.json() as {
            data?: {
                node_id?: string;
                node_public_key?: string;
            };
        };

        const peerData = data.data;
        if (!peerData?.node_id || !peerData?.node_public_key) {
            return { success: false, error: 'Peer returned incomplete key exchange data' };
        }
        if (peerData.node_id !== expectNodeId) {
            logger.warn('Key exchange answered as another node', { asked: expectNodeId, answered: peerData.node_id, peerUrl });
            return { success: false, error: `The node at ${peerUrl} answered as ${peerData.node_id}, not ${expectNodeId}` };
        }

        // Cache the peer's node key with TTL. Agent keys an older peer still sends are not kept.
        const ttlMs = config.keyCacheRefreshMinutes * 60_000;
        peerKeyCache.set(expectNodeId, {
            publicKey: peerData.node_public_key,
            expiresAt: Date.now() + ttlMs,
        });

        logger.info(`Key exchange completed with peer ${peerData.node_id}`, {
            ttlMinutes: config.keyCacheRefreshMinutes,
        });

        return { success: true, peerPublicKey: peerData.node_public_key };
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        logger.warn(`Key exchange failed with ${peerUrl}: ${msg}`);
        return { success: false, error: msg };
    }
}
