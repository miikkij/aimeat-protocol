/**
 * @file services/package-sellers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which nodes may sell a package author's packages on a package repository: read the
 *   questions a package asks, grant a customer node, end its updates and revoke it, by a request
 *   signed with the seller node's own key (package-sale-auth.ts), with no token.
 *
 *   A DECISION, NOT A SECRET. The author names the seller once ("store.aimeat.io sells my packages"),
 *   from a chat or the API. Nothing is copied between machines: the seller's public key is read from
 *   its /.well-known/aimeat and pinned here. Jouni ruled on 2026-09-29 that the system does this
 *   itself.
 *
 *   PER AUTHOR. A seller sells every package of the author who named it, and nothing of anyone else's:
 *   an install bundle and the packages it lists share their author (package-entitlements.ts), so one
 *   decision covers a whole product. Only the author or an operator changes the list.
 *
 *   WHERE IT LIVES. The system namespace of the entitlements, `package-entitlements`, key
 *   `sellers.<author>`: no principal can address it.
 * @structure SellerRecord · listSellers() · addSeller() · removeSeller() · isSellerFor()
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (install packages, phase 5: seller nodes).
 */
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { NS_PACKAGE_ENTITLEMENTS } from './package-entitlements.js';
import { checkPackagePeer, registerPackagePeer } from './package-peer-register.js';

export interface SellerRecord { nodeId: string; addedAt: string; addedBy: string; note?: string }
type Stored = { author: string; nodes: Record<string, SellerRecord> };
type Refusal = { ok: false; status: number; code: string; message: string };

const key = (author: string): string => `sellers.${author}`;
const NODE_RE = /^[a-z0-9][a-z0-9.-]{2,127}$/i;

async function read(storage: Storage, author: string): Promise<Record<string, SellerRecord>> {
    const rec = await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, key(author));
    return (rec?.value as Stored | undefined)?.nodes ?? {};
}

async function write(storage: Storage, author: string, nodes: Record<string, SellerRecord>): Promise<void> {
    const now = new Date().toISOString();
    const existing = await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, key(author));
    await storage.setMemory({
        key: key(author), ownerGaii: NS_PACKAGE_ENTITLEMENTS, value: { author, nodes } satisfies Stored,
        visibility: 'private', tags: ['package-sellers'], ttlHours: null,
        version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
}

/** The seller nodes of `author`. */
export async function listSellers(storage: Storage, author: string): Promise<SellerRecord[]> {
    return Object.values(await read(storage, author));
}

/** Whether `nodeId` may sell `author`'s packages. */
export async function isSellerFor(storage: Storage, author: string, nodeId: string): Promise<boolean> {
    return !!(await read(storage, author))[nodeId];
}

/**
 * Name `nodeId` a seller of the caller's packages. With `node` ({ url, public_key }) a node this
 * repository does not know yet is registered as a packages-only peer (package-peer-register.ts); a
 * known peer must be active and under the same key.
 */
export async function addSeller(
    storage: Storage, peers: Map<string, PeerInfo>, caller: { owner: string },
    input: { nodeId: string; node?: unknown; note?: unknown },
): Promise<Refusal | { ok: true; seller: SellerRecord; peerRegistered: boolean }> {
    if (!NODE_RE.test(input.nodeId)) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'node_id is a node id such as "aimeat-finland-003-store".' };
    let peerRegistered = false;
    if (input.node !== undefined && input.node !== null) {
        const check = checkPackagePeer(peers, input.nodeId, input.node);
        if (!check.ok) return check;
        if (check.add) { await registerPackagePeer(storage, peers, check.add); peerRegistered = true; }
    } else {
        const known = peers.get(input.nodeId);
        if (!known || known.status !== 'active' || !known.publicKey) {
            return { ok: false, status: 409, code: 'PEER_UNKNOWN', message: `${input.nodeId} is not an active peer of this repository. Give node: { url, public_key } to register it.` };
        }
    }
    const nodes = await read(storage, caller.owner);
    const now = new Date().toISOString();
    const seller: SellerRecord = {
        nodeId: input.nodeId, addedAt: nodes[input.nodeId]?.addedAt ?? now, addedBy: caller.owner,
        ...(typeof input.note === 'string' && input.note ? { note: input.note.slice(0, 500) } : {}),
    };
    await write(storage, caller.owner, { ...nodes, [input.nodeId]: seller });
    return { ok: true, seller, peerRegistered };
}

/** Stop `nodeId` selling the caller's packages. Its grants stay; revoke them separately. */
export async function removeSeller(storage: Storage, caller: { owner: string }, nodeId: string): Promise<Refusal | { ok: true }> {
    const nodes = await read(storage, caller.owner);
    if (!nodes[nodeId]) return { ok: false, status: 404, code: 'NOT_FOUND', message: `${nodeId} is not a seller of your packages.` };
    await write(storage, caller.owner, Object.fromEntries(Object.entries(nodes).filter(([id]) => id !== nodeId)));
    return { ok: true };
}
