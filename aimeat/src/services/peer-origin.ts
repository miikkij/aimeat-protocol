/**
 * @file services/peer-origin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a federation peer arrived when no operator added it, and the registrations still
 *   waiting for their node to answer.
 *
 *   WHY. A peer record says nothing about who made it. Four code paths add a peer without an
 *   operator: a package grant, a package seller, a sale that links its repository, and an
 *   install set that links its repository. An operator who finds a peer they never added could not
 *   tell which of them it was, or who asked for it (the peer-registration incident, 2026-10-01). Each
 *   of those paths now writes one record here, and the operator's peer listing reads it.
 *
 *   PENDING. A package grant names a node that did not answer when the grant was made. The grant
 *   stands, because a sale must not fail on a customer node that is down for a moment; the peer is
 *   not added until its card is read. The pending record holds what the grant said (url, key, who),
 *   and the node's first signed request to this repository reads the card and finishes the
 *   registration (package-peer-register.ts adoptPendingPeer).
 *
 *   WHERE IT LIVES. A system namespace, `federation-peer-origin`, which no principal can address
 *   (no identity resolves to a name without an `@`), the pattern package-entitlements.ts follows.
 *   Keys `origin.<nodeId>` and `pending.<nodeId>`.
 * @structure PeerOrigin · PendingPeer · pendingExpired() · recordPeerOrigin() · listPeerOrigins() · readPendingPeer() ·
 *   writePendingPeer() · deletePendingPeer() · listPendingPeers() · pendingRegistrationView() · forgetPeer()
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (the peer-registration incident, finding F).
 */
import type { Storage } from '../storage/interface.js';

export const NS_PEER_ORIGIN = 'federation-peer-origin';

/** The code path that added the peer. */
export type PeerOriginSource =
    | 'package-grant'           // a package author or an operator granted the node a package
    | 'package-sale'            // a seller node granted the node a package, signed with its own key
    | 'package-seller'          // a package author named the node a seller
    | 'sale-repository'         // this node's operator linked a repository to sell from
    | 'install-set-repository'; // an install set linked the repository it installs from

export interface PeerOrigin {
    nodeId: string;
    source: PeerOriginSource;
    /** Who asked: the local account, or the seller node for a signed sale. */
    by: string;
    /** The package group, when a grant made it. */
    groupId?: string;
    url: string;
    publicKey: string;
    /** What was checked: the node's own card answered with this id and key. */
    proof: 'node-card';
    /** When the request was made, and when the card answered (later than `requestedAt` for a pending one). */
    requestedAt: string;
    provenAt: string;
}

export type PendingPeer = Omit<PeerOrigin, 'proof' | 'provenAt'> & { lastTryAt: string; lastProblem: string };

/**
 * How long a pending registration waits for its node. A customer node that is down for a moment
 * answers within days; one that never answers should not hold its node id against a later grant
 * under the right key for ever.
 */
const PENDING_DAYS = 30;

export function pendingExpired(p: PendingPeer, now = Date.now()): boolean {
    return now - Date.parse(p.requestedAt) > PENDING_DAYS * 86_400_000;
}

const originKey = (nodeId: string): string => `origin.${nodeId}`;
const pendingKey = (nodeId: string): string => `pending.${nodeId}`;

async function put(storage: Storage, key: string, value: unknown, tag: string): Promise<void> {
    const now = new Date().toISOString();
    const existing = await storage.getMemory(NS_PEER_ORIGIN, key);
    await storage.setMemory({
        key, ownerGaii: NS_PEER_ORIGIN, value, visibility: 'private', tags: [tag], ttlHours: null,
        version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
}

/** The records under `prefix`, each read only from its own key (`<prefix><nodeId>`). */
async function list<T extends { nodeId: string }>(storage: Storage, prefix: string): Promise<T[]> {
    return (await storage.listMemory(NS_PEER_ORIGIN, { prefix }))
        .map(r => ({ key: r.key, value: r.value as T | undefined }))
        .filter(r => r.value && r.key === `${prefix}${r.value.nodeId}`)
        .map(r => r.value as T);
}

export async function recordPeerOrigin(storage: Storage, origin: PeerOrigin): Promise<void> {
    await put(storage, originKey(origin.nodeId), origin, 'peer-origin');
}

/** Every recorded origin, by node id. */
export async function listPeerOrigins(storage: Storage): Promise<Map<string, PeerOrigin>> {
    return new Map((await list<PeerOrigin>(storage, 'origin.')).map(o => [o.nodeId, o]));
}

export async function readPendingPeer(storage: Storage, nodeId: string): Promise<PendingPeer | null> {
    return ((await storage.getMemory(NS_PEER_ORIGIN, pendingKey(nodeId)))?.value as PendingPeer | undefined) ?? null;
}

export async function writePendingPeer(storage: Storage, pending: PendingPeer): Promise<void> {
    await put(storage, pendingKey(pending.nodeId), pending, 'peer-pending');
}

export async function deletePendingPeer(storage: Storage, nodeId: string): Promise<void> {
    await storage.deleteMemory(NS_PEER_ORIGIN, pendingKey(nodeId));
}

export async function listPendingPeers(storage: Storage): Promise<PendingPeer[]> {
    return list<PendingPeer>(storage, 'pending.');
}

/** A pending registration as the operator's listings show it. */
export function pendingRegistrationView(p: PendingPeer): Record<string, unknown> {
    return {
        node_id: p.nodeId, source: p.source, by: p.by, ...(p.groupId ? { group_id: p.groupId } : {}),
        url: p.url, public_key: p.publicKey, requested_at: p.requestedAt,
        last_try_at: p.lastTryAt, last_problem: p.lastProblem, expired: pendingExpired(p),
    };
}

/** An operator removed the peer: its origin and any pending registration go with it, so the name is free. */
export async function forgetPeer(storage: Storage, nodeId: string): Promise<void> {
    await storage.deleteMemory(NS_PEER_ORIGIN, originKey(nodeId));
    await storage.deleteMemory(NS_PEER_ORIGIN, pendingKey(nodeId));
}
