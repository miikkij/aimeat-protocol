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
 *   THE NODE'S CARD IS READ FIRST (2026-10-01, the peer-registration incident). Until then the url and
 *   key came from the request and nothing checked them, so any owner could register any node id that
 *   was not yet a peer, at a url of their choosing. Now the node's own card (/.well-known/aimeat, read
 *   through node-card.ts) must answer with the same node id and the same key, or nothing is written.
 *   That refuses a key the url does not publish and a url that is another node. It does NOT prove the
 *   id is the caller's to name: whoever names the url decides what card it serves. What keeps such a
 *   peer harmless is that it is packages-only, and that the code paths which trust a peer's url and key for
 *   anything else read its flags (message-delivery.ts, register-login.ts). The operator sees how every
 *   such peer arrived (peer-origin.ts) and removes one with DELETE /v1/federation/peers/:nodeId.
 *
 *   A SALE DOES NOT FAIL ON A NODE THAT IS DOWN. When the card cannot be read at all, a grant still
 *   stands and the registration waits (`pending`); the node's first signed request to this repository
 *   reads the card and finishes it (adoptPendingPeer). A card that answers with another id or key is a
 *   refusal, not a wait: that is the grant naming the wrong node.
 *
 *   AN EXISTING PEER IS NEVER CHANGED. Under another key it is refused (PEER_KEY_MISMATCH); switched
 *   off it is refused (PEER_NOT_ACTIVE), because the operator switched it off and a sale does not
 *   overrule that. A pending registration under another key is refused the same way.
 * @structure PackagePeerInput · checkPackagePeer() · proveNodeCard() · linkPackagePeer() ·
 *   adoptPendingPeer() · registerPackagePeer()
 * @usage
 *   const link = await linkPackagePeer({ storage, peers, timeoutMs }, nodeId, input.node,
 *       { source: 'package-grant', by: owner, groupId }, { pendingWhenUnreachable: true });
 *   if (!link.ok) return link;                          // nothing was written
 *   await adoptPendingPeer({ storage, peers, timeoutMs }, headerNodeId);   // before verifyPackageNode
 * @version-history
 *   v2.2.0 — 2026-10-02 — A new packages-only peer from a grant, a sale or a named seller counts against
 *     the node's cap (`cap`, package-peer-limits.ts): beyond it 409 PACKAGE_PEER_CAP, nothing written.
 *   v2.1.0 — 2026-10-01 — With `thisNodeId` in the deps, a card that answers as another node or key and
 *     a node id held under another key (a peer, or a pending registration) are recorded on the Security
 *     page (peer-incidents.ts), so the operator learns of them.
 *   v2.0.0 — 2026-10-01 — The node's card is read before anything is written, and how the peer arrived
 *     is recorded (peer-origin.ts). A node that does not answer leaves a pending registration that its
 *     first signed request finishes. The peer-registration incident (finding F of
 *     docs/specs/package-sale-design.md).
 *   v1.0.1 — 2026-09-28 — The node's url loses its trailing slashes through stripTrailingSlashes, one
 *     pass, instead of `replace(/\/+$/, '')`, quadratic on a url ending in many slashes and another
 *     character (CodeQL js/polynomial-redos, alert 1678).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 5).
 */
import type { Storage } from '../storage/interface.js';
import { stripTrailingSlashes } from '../utils/url-validator.js';
import type { PeerInfo } from './federation.js';
import { deriveTierFlags } from './federation-tiers.js';
import { readNodeCard } from './node-card.js';
import { capRefusal, PACKAGE_PEER_SOURCES, DEFAULT_PACKAGE_PEER_CAP } from './package-peer-limits.js';
import {
    recordPeerOrigin, readPendingPeer, writePendingPeer, deletePendingPeer, pendingExpired, type PeerOriginSource,
} from './peer-origin.js';
import { emitChange } from './event-bus.js';
import { reportPeerIncident, type PeerIncident } from './peer-incidents.js';
import { logger } from '../utils/logger.js';

export interface PackagePeerInput { url: string; publicKey: string }

type Refusal = { ok: false; status: number; code: string; message: string };

/**
 * Whether the node named with a grant can be served: already an active peer under that key (nothing
 * to add), or unknown (the peer to add). Writes nothing and reads nothing outside the peers.
 */
export function checkPackagePeer(
    peers: Map<string, PeerInfo>, nodeId: string, raw: unknown,
): Refusal | { ok: true; add: (PackagePeerInput & { nodeId: string }) | null } {
    const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : null;
    const url = typeof o?.url === 'string' ? stripTrailingSlashes(o.url.trim()) : '';
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

export type CardProof =
    | { kind: 'proven' }
    /** `card` is what answered, when the refusal is that it answered as another node or key. */
    | { kind: 'refused'; refusal: Refusal; card?: { nodeId: string; publicKey: string } }
    | { kind: 'unreachable'; detail: string };

/**
 * Read the card at `url` and hold it to the id and key given. A card that says another id or key is a
 * refusal; a card that cannot be read at all is `unreachable`, which the caller may wait out.
 */
export async function proveNodeCard(nodeId: string, url: string, publicKey: string, timeoutMs: number): Promise<CardProof> {
    const card = await readNodeCard(url, timeoutMs);
    if (!card.ok) {
        if (card.reason === 'blocked') {
            return { kind: 'refused', refusal: { ok: false, status: 400, code: 'INVALID_URL', message: `${url} is not an address this node may reach: ${card.detail}` } };
        }
        return { kind: 'unreachable', detail: card.detail };
    }
    if (card.nodeId !== nodeId) {
        return { kind: 'refused', card, refusal: { ok: false, status: 409, code: 'PEER_ID_MISMATCH', message: `The node at ${url} says it is ${card.nodeId}, not ${nodeId}. Nothing was written.` } };
    }
    if (card.publicKey !== publicKey) {
        return { kind: 'refused', card, refusal: { ok: false, status: 409, code: 'PEER_KEY_MISMATCH', message: `The node at ${url} publishes another key than the one given for ${nodeId}. Copy the key from its /.well-known/aimeat; nothing was written.` } };
    }
    return { kind: 'proven' };
}

export interface PeerLinkDeps {
    storage: Storage; peers: Map<string, PeerInfo>; timeoutMs: number;
    /** This node's id. With it, a failed card check and a held id are recorded on the Security page. */
    thisNodeId?: string;
    /** The most packages-only peers this node registers (config.packagePeerCap; package-peer-limits.ts). */
    cap?: number;
}

/** Record a refusal on the Security page when the deps name this node. Never throws. */
function report(deps: PeerLinkDeps, e: PeerIncident): Promise<void> {
    return deps.thisNodeId ? reportPeerIncident(deps.storage, deps.thisNodeId, e) : Promise.resolve();
}
export interface PeerLinkWho { source: PeerOriginSource; by: string; groupId?: string }
export type PeerLinkResult = Refusal | { ok: true; registered: boolean; pending: boolean };

/**
 * Register the node named with a grant or a seller as a packages-only peer, after its card answered
 * with the same id and key. A known peer under the same key needs nothing. With
 * `pendingWhenUnreachable`, a node whose card cannot be read leaves a pending registration and the
 * call succeeds; without it, that is a refusal (PEER_UNREACHABLE) the caller can try again.
 */
export async function linkPackagePeer(
    deps: PeerLinkDeps, nodeId: string, raw: unknown, who: PeerLinkWho, opts: { pendingWhenUnreachable: boolean },
): Promise<PeerLinkResult> {
    const check = checkPackagePeer(deps.peers, nodeId, raw);
    if (!check.ok) {
        const held = deps.peers.get(nodeId);
        const asked = checkPackagePeer(new Map(), nodeId, raw);
        if (check.code === 'PEER_KEY_MISMATCH' && held && asked.ok && asked.add) {
            await report(deps, { kind: 'id-held', nodeId, via: who.source, actor: who.by,
                presented: { key: asked.add.publicKey, url: asked.add.url }, other: { key: held.publicKey, url: held.url } });
        }
        return check;
    }
    if (!check.add) return { ok: true, registered: false, pending: false };
    const add = check.add;
    const waiting = await readPendingPeer(deps.storage, nodeId);
    const pending = waiting && !pendingExpired(waiting) ? waiting : null;
    if (pending && pending.publicKey !== add.publicKey) {
        await report(deps, { kind: 'id-held', nodeId, via: who.source, actor: who.by,
            presented: { key: add.publicKey, url: add.url }, other: { key: pending.publicKey, url: pending.url } });
        return { ok: false, status: 409, code: 'PEER_KEY_MISMATCH', message: `${nodeId} was already named under another key, and this node is waiting for it to answer. Check which key is right; nothing was granted.` };
    }
    // A new packages-only peer counts against the node's cap; one already waiting does not.
    if (!pending && PACKAGE_PEER_SOURCES.has(who.source)) {
        const refusal = await capRefusal(deps, deps.cap ?? DEFAULT_PACKAGE_PEER_CAP);
        if (refusal) return refusal;
    }
    const proof = await proveNodeCard(nodeId, add.url, add.publicKey, deps.timeoutMs);
    if (proof.kind === 'refused') {
        if (proof.card) {
            await report(deps, { kind: 'proof-failed', nodeId, via: who.source, actor: who.by,
                presented: { key: add.publicKey, url: add.url }, other: { nodeId: proof.card.nodeId, key: proof.card.publicKey, url: add.url } });
        }
        return proof.refusal;
    }
    const now = new Date().toISOString();
    if (proof.kind === 'unreachable') {
        if (!opts.pendingWhenUnreachable) {
            return { ok: false, status: 503, code: 'PEER_UNREACHABLE', message: `${nodeId} did not answer at ${add.url} (${proof.detail}), so its key could not be checked. Nothing was written; try again when it is up.` };
        }
        await writePendingPeer(deps.storage, {
            nodeId, source: who.source, by: who.by, ...(who.groupId ? { groupId: who.groupId } : {}),
            url: add.url, publicKey: add.publicKey, requestedAt: pending?.requestedAt ?? now, lastTryAt: now, lastProblem: proof.detail,
        });
        return { ok: true, registered: false, pending: true };
    }
    // The card was read over the network: another registration may have landed meanwhile.
    const again = checkPackagePeer(deps.peers, nodeId, raw);
    if (!again.ok) return again;
    if (!again.add) return { ok: true, registered: false, pending: false };
    await registerPackagePeer(deps.storage, deps.peers, again.add);
    await recordPeerOrigin(deps.storage, {
        nodeId, source: who.source, by: who.by, ...(who.groupId ? { groupId: who.groupId } : {}),
        url: add.url, publicKey: add.publicKey, proof: 'node-card', requestedAt: pending?.requestedAt ?? now, provenAt: now,
    });
    if (pending) await deletePendingPeer(deps.storage, nodeId);
    return { ok: true, registered: true, pending: false };
}

/** Node id → when its pending registration was last tried, so a stream of requests is one card read. */
const lastTry = new Map<string, number>();
const RETRY_GAP_MS = 10_000;

/**
 * The node that signs this request has a pending registration here: read its card now and register
 * it when the card answers with the id and key the grant named. Anything else leaves the pending
 * record as it was, with the problem noted. Called before the request's signature is checked, which
 * is safe: the grant that wrote the pending record was the decision, and the card read is the same
 * proof the grant would have made; the signature is then checked against the registered key.
 */
export async function adoptPendingPeer(deps: PeerLinkDeps, nodeId: string | undefined): Promise<void> {
    if (!nodeId || deps.peers.has(nodeId)) return;
    const pending = await readPendingPeer(deps.storage, nodeId);
    if (!pending) return;
    if (pendingExpired(pending)) { await deletePendingPeer(deps.storage, nodeId); return; }
    const now = Date.now();
    if (now - (lastTry.get(nodeId) ?? 0) < RETRY_GAP_MS) return;
    lastTry.set(nodeId, now);
    const proof = await proveNodeCard(nodeId, pending.url, pending.publicKey, deps.timeoutMs);
    const at = new Date().toISOString();
    if (proof.kind !== 'proven') {
        const problem = proof.kind === 'refused' ? proof.refusal.message : proof.detail;
        if (proof.kind === 'refused' && proof.card) {
            await report(deps, { kind: 'proof-failed', nodeId, via: 'pending-registration', actor: pending.by,
                presented: { key: pending.publicKey, url: pending.url }, other: { nodeId: proof.card.nodeId, key: proof.card.publicKey, url: pending.url } });
        }
        await writePendingPeer(deps.storage, { ...pending, lastTryAt: at, lastProblem: problem });
        logger.warn('A pending package peer did not prove its card', { nodeId, problem });
        return;
    }
    if (deps.peers.has(nodeId)) return;
    await registerPackagePeer(deps.storage, deps.peers, { nodeId, url: pending.url, publicKey: pending.publicKey });
    await recordPeerOrigin(deps.storage, {
        nodeId, source: pending.source, by: pending.by, ...(pending.groupId ? { groupId: pending.groupId } : {}),
        url: pending.url, publicKey: pending.publicKey, proof: 'node-card', requestedAt: pending.requestedAt, provenAt: at,
    });
    await deletePendingPeer(deps.storage, nodeId);
    lastTry.delete(nodeId);
    emitChange('federation');
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
