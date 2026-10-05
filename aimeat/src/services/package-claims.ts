/**
 * @file src/services/package-claims.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A sale whose customer node does not exist yet: the seller asks the repository for a
 *   one-time claim code, and the node redeems it later with a request signed by its own key
 *   (docs/specs/package-sale-design.md, section 3, "The person pays first").
 *
 *   WHO ASKS. A seller node of the package's author, by the signed sale request
 *   (routes/package-sales.ts sellerAct). The claim records the seller, the end of updates the sale
 *   paid for, the channel and the author's terms, as a grant would.
 *
 *   WHO REDEEMS. Any node holding the code, by a request signed with the key it names in the body
 *   (package-sale-auth.ts verifyRequestWithKey): that proves the redeemer holds the key it asks to be
 *   served under. The node is then registered as a packages-only peer by the same card check every
 *   package path uses (package-peer-register.ts), and granted by grantEntitlement on the seller's
 *   behalf. The code works once.
 *
 *   WHERE IT LIVES. One record per package group, `claims.<groupId>`, in the system namespace
 *   `package-entitlements`. A code is stored as its sha256, never as itself, and a claim expires after
 *   30 days.
 * @structure CLAIM_DAYS · createClaim() · redeemClaim()
 * @version-history
 *   v1.2.0 — 2026-10-05 — A redeem consumes the code in one compare-and-swap before the grant's network
 *     step and gives it back when the grant is refused; create and redeem never overwrite each other
 *     (record-cas.ts; secaudit 2026-10, PKG-7).
 *   v1.1.0 — 2026-10-02 — A redeemed claim's new node counts against the packages-only peer cap (`peerCap`).
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 3).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { NS_PACKAGE_ENTITLEMENTS, grantEntitlement, type PackageEntitlement, type EntitlementResult } from './package-entitlements.js';
import { updateRecord, UNCHANGED } from './record-cas.js';

export const CLAIM_DAYS = 30;

interface PendingClaim {
    soldBy: string;
    updatesUntil: string | null;
    channel: 'stable' | 'beta';
    note?: string;
    terms?: PackageEntitlement['terms'];
    createdAt: string;
    expiresAt: string;
}
type ClaimsRecord = { groupId: string; pending: Record<string, PendingClaim> };

type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

const key = (groupId: string): string => `claims.${groupId}`;
const hashOf = (code: string): string => createHash('sha256').update(code).digest('hex');

/**
 * Change the group's claims with a compare-and-swap write (record-cas.ts): a concurrent create or
 * redeem is never overwritten by a copy read before it (secaudit 2026-10, PKG-7).
 */
function updateClaims(
    storage: Storage, groupId: string, mutate: (cur: ClaimsRecord) => ClaimsRecord | typeof UNCHANGED,
): Promise<ClaimsRecord> {
    return updateRecord<ClaimsRecord>(storage, NS_PACKAGE_ENTITLEMENTS, key(groupId),
        v => ((v as ClaimsRecord | undefined)?.pending ? v as ClaimsRecord : { groupId, pending: {} }),
        mutate, { tag: 'package-claims' });
}

/** Drop the expired claims, so the record does not grow with sales nobody redeemed. */
function live(pending: Record<string, PendingClaim>, now: number): Record<string, PendingClaim> {
    return Object.fromEntries(Object.entries(pending).filter(([, c]) => Date.parse(c.expiresAt) > now));
}

/** A one-time code for a sale whose node is not known yet. */
export async function createClaim(
    storage: Storage,
    input: { groupId: string; seller: string; updatesUntil?: unknown; channel?: unknown; note?: unknown; terms?: PackageEntitlement['terms'] },
): Promise<{ ok: true; claim_code: string; expires_at: string } | Fail> {
    if (input.channel !== undefined && input.channel !== 'stable' && input.channel !== 'beta') {
        return fail(400, 'INVALID_INPUT', 'channel is "stable" or "beta".');
    }
    let updatesUntil: string | null = null;
    if (input.updatesUntil !== undefined && input.updatesUntil !== null) {
        const t = typeof input.updatesUntil === 'string' ? Date.parse(input.updatesUntil) : NaN;
        if (!Number.isFinite(t)) return fail(400, 'INVALID_INPUT', 'updates_until is an ISO date-time.');
        updatesUntil = new Date(t).toISOString();
    }
    const code = `pkgc_${randomBytes(18).toString('base64url')}`;
    const now = Date.now();
    const claim: PendingClaim = {
        soldBy: input.seller, updatesUntil, channel: (input.channel as 'stable' | 'beta' | undefined) ?? 'stable',
        ...(typeof input.note === 'string' && input.note ? { note: input.note.slice(0, 500) } : {}),
        ...(input.terms ? { terms: input.terms } : {}),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + CLAIM_DAYS * 86_400_000).toISOString(),
    };
    await updateClaims(storage, input.groupId, cur => ({ groupId: input.groupId, pending: { ...live(cur.pending, now), [hashOf(code)]: claim } }));
    return { ok: true, claim_code: code, expires_at: claim.expiresAt };
}

/**
 * Redeem `code` for `nodeId`, whose request was signed by `node.public_key` (checked by the route).
 * The grant runs as the package's author on the seller's behalf, so the seller's limits apply.
 */
export async function redeemClaim(
    deps: { storage: Storage; peers: Map<string, PeerInfo>; timeoutMs?: number; thisNodeId?: string; peerCap?: number; repository?: boolean },
    input: { groupId: string; author: string; code: unknown; nodeId: string; node: { url: string; public_key: string } },
): Promise<EntitlementResult> {
    if (typeof input.code !== 'string' || !input.code.startsWith('pkgc_')) return fail(400, 'INVALID_INPUT', 'code is the claim code the seller gave.');
    const now = Date.now();
    const h = hashOf(input.code);
    // Consumed FIRST, in one compare-and-swap, before the grant's network step: the code was a read, a
    // grant and a delete, so two redeems of one code inside the card read's wait could both win, one
    // code for two nodes (secaudit 2026-10, PKG-7).
    let claim: PendingClaim | undefined;
    await updateClaims(deps.storage, input.groupId, cur => {
        const pending = live(cur.pending, now);
        claim = pending[h];
        if (!claim) return UNCHANGED;
        const rest = { ...pending };
        delete rest[h];
        return { groupId: input.groupId, pending: rest };
    });
    // One answer for a wrong, a used and an expired code: a guesser learns nothing.
    if (!claim) return fail(404, 'CLAIM_NOT_FOUND', 'No claim with that code waits for this package. A code works once and for 30 days.');
    const taken: PendingClaim = claim;
    const out = await grantEntitlement(deps.storage, { owner: input.author, isOperator: false }, {
        groupId: input.groupId, nodeId: input.nodeId, updatesUntil: taken.updatesUntil, channel: taken.channel,
        note: `sold by ${taken.soldBy}${taken.note ? `: ${taken.note}` : ''}`, node: input.node, terms: taken.terms,
    }, deps.peers, { timeoutMs: deps.timeoutMs ?? 10_000, seller: taken.soldBy, thisNodeId: deps.thisNodeId, peerCap: deps.peerCap, repository: deps.repository });
    // A refused grant gives the code back, so the person can redeem it on the right node.
    if (!out.ok) await updateClaims(deps.storage, input.groupId, cur => ({ groupId: input.groupId, pending: { ...cur.pending, [h]: taken } }));
    return out;
}
