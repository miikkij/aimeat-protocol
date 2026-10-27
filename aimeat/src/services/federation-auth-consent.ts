/**
 * @file src/services/federation-auth-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Has a person of this node let a peer node act for them? One answer for every route
 *   that asks it, so the routes cannot drift apart.
 *
 *   The answer is the person's sign-in consent: an active 'auth' consent whose recipient is
 *   node:<peer>, '*' or 'domain:*' and whose end time has not passed, on a link whose tier may carry
 *   a sign-in. POST /v1/federation/auth/verify (routes/federation-auth.ts) asks it before it vouches
 *   for the person on the peer. The two peer routes that serve that signed-in visitor afterwards ask
 *   the same thing: POST /v1/federation/memory/list (list-home lists the visitor's records at home)
 *   and POST /v1/federation/replicate (push-home saves the visitor's record at home). Until
 *   2026-10-22 those two read no consent of the person they named, so a linked peer listed or wrote
 *   any local person's records without the person's leave (secaudit 2026-10 wave 3, v70 and v71).
 * @structure authConsentEnded · isNodeAuthConsent · linkCarriesSignIn · hasNodeAuthConsent ·
 *   peerMayActFor · accountDisabledRefusal · signInConsentRefusal
 * @usage if (!await peerMayActFor(storage, peer, ghii)) refuse(signInConsentRefusal(ghii, peer.nodeId, config.nodeId));
 * @version-history
 *   v1.1.0 — 2026-10-27 — accountDisabledRefusal: the memory list and the replicate refuse a person
 *     whose account is deactivated (403 ACCOUNT_DISABLED), as the sign-in verify does; the consent
 *     stays, so reactivation brings both back (secaudit2026oct26).
 *   v1.0.0 — 2026-10-22 — Initial: the predicate moved here from routes/federation-auth.ts (v1.4.2),
 *     unchanged, so the sign-in, the memory list and the replicate read one consent check
 *     (secaudit 2026-10 wave 3, v70 and v71).
 */

import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { coerceTier, tierCeiling } from './federation-tiers.js';
import { deactivatedAccountSkip } from './account-deactivated.js';

/**
 * Has this auth consent's end time passed? Only a time that parses and lies at or before `now` ends
 * the consent. No end time, or one that does not parse, keeps the consent as it was before the
 * end time was checked (routes/federation-auth.ts v1.4.1): the record that asked for the check
 * (secaudit 2026-10, auth-consent-expiry-unchecked) is about a consent that ended, and an end time
 * nobody can read names no moment at which it ended.
 */
export function authConsentEnded(expires: string | Date | null | undefined, now: Date): boolean {
    if (!expires) return false;
    const end = new Date(expires).getTime();
    return Number.isFinite(end) && end <= now.getTime();
}

/** Is this consent row a sign-in consent for `nodeId` that still holds at `now`? */
export function isNodeAuthConsent(
    c: { scope?: string | null; recipient?: string | null; expires?: string | Date | null },
    nodeId: string, now: Date,
): boolean {
    if (c.scope !== 'auth') return false;
    if (authConsentEnded(c.expires, now)) return false;
    return c.recipient === `node:${nodeId}` || c.recipient === '*' || c.recipient === 'domain:*';
}

/** May the link to this peer carry a sign-in at all? The tier's ceiling decides (federation-tiers.ts). */
export function linkCarriesSignIn(peer: Pick<PeerInfo, 'tier'>): boolean {
    return tierCeiling(coerceTier(peer.tier)).allowFederatedAuth;
}

/**
 * Does the person `ghii` (a GHII of this node, `name@this-node`) hold an active sign-in consent for
 * `nodeId`? listConsents filters by status only, and a row stays 'active' until the consent-expiry
 * job runs, so the end time is compared here.
 */
export async function hasNodeAuthConsent(storage: Storage, ghii: string, nodeId: string, now: Date = new Date()): Promise<boolean> {
    const consents = await storage.listConsents(ghii, { status: 'active' });
    return consents.some(c => isNodeAuthConsent(c, nodeId, now));
}

/**
 * May `peer` act for the person `ghii` of this node: the link may carry a sign-in, and the person
 * holds a sign-in consent for the peer. Every visitor the peer could sign in already meets this.
 */
export async function peerMayActFor(storage: Storage, peer: Pick<PeerInfo, 'tier' | 'nodeId'>, ghii: string, now: Date = new Date()): Promise<boolean> {
    return linkCarriesSignIn(peer) && hasNodeAuthConsent(storage, ghii, peer.nodeId, now);
}

/**
 * The refusal for a person of this node whose account is deactivated, or null when it is active.
 * Deactivation (BR-04) stops everything acting in the account's name, and POST
 * /v1/federation/auth/verify refuses such an owner. The memory list and the replicate the same sign-in
 * consent opens ask this after the consent, because deactivation leaves the consent in place so that
 * reactivation brings everything back (secaudit2026oct26, peer-acts-for-deactivated-account).
 */
export async function accountDisabledRefusal(
    storage: Pick<Storage, 'getOwner'>, ghii: string, thisNodeId: string,
): Promise<{ code: 'ACCOUNT_DISABLED'; message: string } | null> {
    if (!await deactivatedAccountSkip(storage, ghii)) return null;
    return {
        code: 'ACCOUNT_DISABLED',
        message: `This account has been deactivated. ${ghii} is switched off on ${thisNodeId}, so no other server reads or saves their records here until the operator reactivates the account. Nothing was changed.`,
    };
}

/** The refusal a peer gets, in words it can pass on to the person, naming the control that answers it. */
export function signInConsentRefusal(ghii: string, peerNodeId: string, thisNodeId: string): string {
    return `${ghii} has not let ${peerNodeId} sign them in, so ${peerNodeId} cannot read or save their records on ${thisNodeId}. `
        + `To allow it, the person adds ${peerNodeId} under "Sign-in from other AIMEAT servers" on the Access tab of their profile on ${thisNodeId}.`;
}
