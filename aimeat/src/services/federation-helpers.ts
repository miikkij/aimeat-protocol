/**
 * Federation shared helpers — keyword matching functions for cross-catalogue
 * filtering and peer key cache with TTL for signature verification.
 *
 * Used by federation-peer, federation-sync, federation-genesis, and
 * federation-settlements routers.
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

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

export interface PeerKeyEntry {
    publicKey: string;
    agentKeys: Map<string, string>;  // gaii → publicKey
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
): Promise<{ success: boolean; error?: string; peerPublicKey?: string }> {
    try {
        const nodeKey = await storage.getNodeKey();
        if (!nodeKey) {
            return { success: false, error: 'No node key available' };
        }

        const agents = await storage.listAgents();
        const agentKeys = agents
            .filter(a => a.publicKey)
            .map(a => ({ gaii: a.gaii, public_key: a.publicKey }));

        const payload = {
            node_id: config.nodeId,
            node_url: config.baseUrl,
            node_public_key: nodeKey.publicKey,
            agent_keys: agentKeys,
            timestamp: new Date().toISOString(),
        };

        const resp = await fetch(`${peerUrl}/v1/federation/key-exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.federationTimeoutMs),
        });

        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            return { success: false, error: `Peer returned ${resp.status}: ${body}` };
        }

        const data = await resp.json() as {
            data?: {
                node_id?: string;
                node_public_key?: string;
                agent_keys?: Array<{ gaii: string; public_key: string }>;
            };
        };

        const peerData = data.data;
        if (!peerData?.node_id || !peerData?.node_public_key) {
            return { success: false, error: 'Peer returned incomplete key exchange data' };
        }

        // Cache peer keys with TTL
        const ttlMs = config.keyCacheRefreshMinutes * 60_000;
        const agentKeyMap = new Map<string, string>();
        if (peerData.agent_keys) {
            for (const ak of peerData.agent_keys) {
                agentKeyMap.set(ak.gaii, ak.public_key);
            }
        }

        peerKeyCache.set(peerData.node_id, {
            publicKey: peerData.node_public_key,
            agentKeys: agentKeyMap,
            expiresAt: Date.now() + ttlMs,
        });

        logger.info(`Key exchange completed with peer ${peerData.node_id}`, {
            agentKeysReceived: agentKeyMap.size,
            ttlMinutes: config.keyCacheRefreshMinutes,
        });

        return { success: true, peerPublicKey: peerData.node_public_key };
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        logger.warn(`Key exchange failed with ${peerUrl}: ${msg}`);
        return { success: false, error: msg };
    }
}
