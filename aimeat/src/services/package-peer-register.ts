/**
 * @file services/package-peer-register.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package repository registers a customer node with the grant that sells it a package
 *   (install packages, phase 5). The shop that sells a bundle creates the customer node, learns its
 *   id and key, and grants it the bundle here; until now the node also had to be added as a peer by
 *   the repository's operator in person (POST /v1/federation/peers asks the operator role), so no
 *   automation could finish a sale. Jouni approved this on 2026-09-28.
 *
 *   A PACKAGES-ONLY PEER. The node is added active at the `contact` tier with messaging off too: no
 *   catalogue, no memory, no routing, no messages, no broadcast, no settlement, no federated sign-in,
 *   and absent from the directory. It can do one thing, which is to pull what it holds an
 *   entitlement to (package-node-auth.ts hears a peer that shares no catalogue for that). An operator
 *   who wants more from it raises its tier on the Federation page as with any peer.
 *
 *   AN EXISTING PEER IS NEVER CHANGED. Under another key it is refused (PEER_KEY_MISMATCH); switched
 *   off it is refused (PEER_NOT_ACTIVE), because the operator switched it off and a sale does not
 *   overrule that.
 * @structure PackagePeerInput · checkPackagePeer() · registerPackagePeer()
 * @usage
 *   const check = checkPackagePeer(peers, nodeId, input.node);   // before any write
 *   if (check.ok && check.add) await registerPackagePeer(storage, peers, check.add);
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 5).
 */
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { deriveTierFlags } from './federation-tiers.js';

export interface PackagePeerInput { url: string; publicKey: string }

type Refusal = { ok: false; status: number; code: string; message: string };

/**
 * Whether the node named with a grant can be served: already an active peer under that key (nothing
 * to add), or unknown (the peer to add). Writes nothing.
 */
export function checkPackagePeer(
    peers: Map<string, PeerInfo>, nodeId: string, raw: unknown,
): Refusal | { ok: true; add: (PackagePeerInput & { nodeId: string }) | null } {
    const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : null;
    const url = typeof o?.url === 'string' ? o.url.trim().replace(/\/+$/, '') : '';
    const publicKey = typeof o?.public_key === 'string' ? o.public_key.trim() : '';
    if (!/^https?:\/\/[^\s/]+/.test(url) || url.length > 500 || !publicKey || publicKey.length > 200) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'node is { url, public_key }: the node\'s http(s) address and the public key its /.well-known/aimeat publishes.' };
    }
    const known = peers.get(nodeId);
    if (known) {
        if (known.publicKey !== publicKey) return { ok: false, status: 409, code: 'PEER_KEY_MISMATCH', message: `${nodeId} is a peer of this node under another key. Check which key is right; nothing was granted.` };
        if (known.status !== 'active') return { ok: false, status: 409, code: 'PEER_NOT_ACTIVE', message: `${nodeId} is a peer of this node, but not active. The operator switched it off; nothing was granted.` };
        return { ok: true, add: null };
    }
    return { ok: true, add: { nodeId, url, publicKey } };
}

/** Add the node as a packages-only peer, in memory and in storage. */
export async function registerPackagePeer(
    storage: Storage, peers: Map<string, PeerInfo>, add: PackagePeerInput & { nodeId: string },
): Promise<void> {
    const now = new Date().toISOString();
    const peer: PeerInfo = {
        nodeId: add.nodeId, url: add.url, publicKey: add.publicKey, status: 'active', addedAt: now, lastSeen: now,
        ...deriveTierFlags('contact'), tier: 'contact', allowMessaging: false,
    };
    peers.set(add.nodeId, peer);
    await storage.saveFederationPeer(peer);
}
