/**
 * @file src/services/agent-port-redirect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the public agent profile may send a visitor when the agent they asked for has
 *   moved to another node.
 *
 *   The porting route leaves a pointer for the agent's address (putPortRedirect), and
 *   GET /v1/agents/:gaii answers 301 with the address it names when no agent lives there any more.
 *   The pointer lives in a system namespace (NS_AGENT_PORT, keyed by the GAII), not in the agent's own
 *   memory: deleting the agent deletes its memory in the same transaction, so a pointer kept there
 *   was gone at the one moment it was meant for (feature-list audit #35). A pointer an older node
 *   wrote under the agent's own `__redirect__` key is still read while that agent exists.
 *
 *   That answer goes to anyone who looks the address up, so it may only ever point at a node this
 *   node already trusts: an active federation peer. The Location is built from the PEER RECORD's own
 *   URL, never from the string in the pointer, so a path or a query written into the pointer does not
 *   travel either. A pointer to any other host sends nobody anywhere, and the profile answers as if
 *   it were absent.
 * @structure NS_AGENT_PORT · PORT_REDIRECT_TTL_HOURS · putPortRedirect(storage, gaii, target) ·
 *   PortRedirect · portRedirectFor(storage, gaii)
 * @usage
 *   await putPortRedirect(storage, gaii, { targetNodeUrl, targetNodeId });
 *   const moved = await portRedirectFor(storage, gaii);
 *   if (moved) { res.setHeader('Location', moved.location); res.status(301)… }
 * @version-history
 *   2026-10-15 — The pointer moves to the NS_AGENT_PORT system namespace (putPortRedirect), which the
 *     agent's deletion does not touch, so the redirect is served after the agent is gone; its 30-day
 *     lifetime is checked on read (feature-list audit #35).
 *   v1.1.0 — 2026-10-05 — The redirect goes only to a peer that can hold an agent (peerCarriesAgents),
 *     never a packages-only peer (secaudit 2026-10, PKG-8).
 *   v1.0.0 — 2026-09-24 — Initial. The profile route forwarded to target_node_url as stored.
 */
import type { Storage } from '../storage/interface.js';
import { peerCarriesAgents } from './federation.js';

/** The key older nodes wrote under the agent's own GAII. utils/reserved-keys.ts keeps every memory door off it. */
export const PORT_REDIRECT_KEY = '__redirect__';

/**
 * System namespace for port pointers, one record per ported GAII (the record's key). A pseudo-owner
 * with no '@', so no memory route or tool addresses it (each resolves its caller to a GHII, GAII or
 * GEAI), and the agent's deletion, which removes the rows owned by the GAII, leaves it in place.
 */
export const NS_AGENT_PORT = 'agent-port';

/** How long a pointer is served after the port. */
export const PORT_REDIRECT_TTL_HOURS = 30 * 24;

/** Write the pointer for a ported agent. The porting route is the one caller. */
export async function putPortRedirect(
    storage: Pick<Storage, 'setMemory'>, gaii: string,
    target: { targetNodeUrl: string; targetNodeId?: string },
): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({
        key: gaii,
        ownerGaii: NS_AGENT_PORT,
        value: { target_node_url: target.targetNodeUrl, target_node_id: target.targetNodeId ?? 'unknown', ported_at: now },
        visibility: 'private',
        tags: ['system', 'redirect'],
        ttlHours: PORT_REDIRECT_TTL_HOURS,
        version: 1,
        createdAt: now,
        updatedAt: now,
    });
}

export interface PortRedirect {
    /** Where to send the visitor: the peer's own URL and the agent's address on it. */
    location: string;
    /** The peer's URL as its peer record holds it. */
    targetNodeUrl: string;
    /** The peer's node id, from the same record. */
    targetNodeId: string;
    portedAt?: string;
}

/** The origin of an http or https address, or null for anything else. */
function httpOrigin(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw) return null;
    let url: URL;
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    try { url = new URL(raw); } catch { return null; }
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
}

/** True when a record's lifetime (ttlHours from createdAt) has run out. */
function expired(record: { ttlHours?: number | null; createdAt?: string } | null): boolean {
    if (!record?.ttlHours || record.ttlHours <= 0 || !record.createdAt) return false;
    return Date.now() > new Date(record.createdAt).getTime() + record.ttlHours * 3_600_000;
}

/**
 * The redirect for a ported agent, or null when there is none this node will give.
 *
 * Null when there is no pointer, when it has run out, when it does not name an http(s) address, and
 * when that address is not an active peer of this node. The caller then answers exactly as it does
 * for an address with no agent and no pointer.
 */
export async function portRedirectFor(
    storage: Pick<Storage, 'getMemory' | 'listFederationPeers'>, gaii: string,
): Promise<PortRedirect | null> {
    const stored = await storage.getMemory(NS_AGENT_PORT, gaii) ?? await storage.getMemory(gaii, PORT_REDIRECT_KEY);
    const record = expired(stored) ? null : stored;
    const value = (record?.value && typeof record.value === 'object')
        ? record.value as { target_node_url?: unknown; ported_at?: unknown }
        : undefined;
    const origin = httpOrigin(value?.target_node_url);
    if (!origin) return null;

    const peers = await storage.listFederationPeers();
    // A peer that can hold an agent, never a packages-only one (PKG-8).
    const peer = peers.find(p => peerCarriesAgents(p) && httpOrigin(p.url) === origin);
    if (!peer) return null;

    const base = peer.url.replace(/\/+$/, '');
    return {
        location: `${base}/v1/agents/${encodeURIComponent(gaii)}`,
        targetNodeUrl: base,
        targetNodeId: peer.nodeId,
        ...(typeof value?.ported_at === 'string' ? { portedAt: value.ported_at } : {}),
    };
}
