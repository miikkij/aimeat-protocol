/**
 * @file src/services/agent-port-redirect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the public agent profile may send a visitor when the agent they asked for has
 *   moved to another node.
 *
 *   The porting route leaves a `__redirect__` record at the agent's address, and GET /v1/agents/:gaii
 *   answers 301 with the address it names when no agent lives there any more. That answer goes to
 *   anyone who looks the address up, so it may only ever point at a node this node already trusts:
 *   an active federation peer. The Location is built from the PEER RECORD's own URL, never from the
 *   string in the pointer, so a path or a query written into the pointer does not travel either. A
 *   pointer to any other host sends nobody anywhere, and the profile answers as if it were absent.
 * @structure PortRedirect · portRedirectFor(storage, gaii)
 * @usage
 *   const moved = await portRedirectFor(storage, gaii);
 *   if (moved) { res.setHeader('Location', moved.location); res.status(301)… }
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial. The profile route forwarded to target_node_url as stored.
 */
import type { Storage } from '../storage/interface.js';

/** The key the porting route writes. utils/reserved-keys.ts keeps every memory door off it. */
export const PORT_REDIRECT_KEY = '__redirect__';

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

/**
 * The redirect for a ported agent, or null when there is none this node will give.
 *
 * Null when there is no pointer, when it does not name an http(s) address, and when that address is
 * not an active peer of this node. The caller then answers exactly as it does for an address with no
 * agent and no pointer.
 */
export async function portRedirectFor(
    storage: Pick<Storage, 'getMemory' | 'listFederationPeers'>, gaii: string,
): Promise<PortRedirect | null> {
    const record = await storage.getMemory(gaii, PORT_REDIRECT_KEY);
    const value = (record?.value && typeof record.value === 'object')
        ? record.value as { target_node_url?: unknown; ported_at?: unknown }
        : undefined;
    const origin = httpOrigin(value?.target_node_url);
    if (!origin) return null;

    const peers = await storage.listFederationPeers();
    const peer = peers.find(p => p.status === 'active' && httpOrigin(p.url) === origin);
    if (!peer) return null;

    const base = peer.url.replace(/\/+$/, '');
    return {
        location: `${base}/v1/agents/${encodeURIComponent(gaii)}`,
        targetNodeUrl: base,
        targetNodeId: peer.nodeId,
        ...(typeof value?.ported_at === 'string' ? { portedAt: value.ported_at } : {}),
    };
}
