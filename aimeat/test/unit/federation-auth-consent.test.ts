/**
 * @file test/unit/federation-auth-consent.test.ts
 * @description The sign-in consent check the federated sign-in, the peer memory list and the peer
 *   replicate share (src/services/federation/auth-consent.ts): which consent rows count for a node,
 *   which links may carry a sign-in, and that the moved authConsentEnded is the one the sign-in
 *   route still exports.
 * @version-history
 *   v1.1.0 — 2026-11-24 — Core FED-16: a link carries a sign-in only with the peer's own permission.
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10 wave 3, v70 and v71).
 */
import { describe, it, expect } from 'vitest';
import { isNodeAuthConsent, linkCarriesSignIn, peerMayActFor, authConsentEnded } from '../../src/services/federation/auth-consent.js';
import { authConsentEnded as fromRoute } from '../../src/routes/federation-auth.js';
import type { Storage } from '../../src/storage/interface.js';

const now = new Date('2026-10-22T10:00:00.000Z');
const NODE = 'aimeat-peer-001-a';

describe('isNodeAuthConsent', () => {
    it('an auth consent for node:<peer>, * or domain:* counts while its end time has not passed', () => {
        for (const recipient of [`node:${NODE}`, '*', 'domain:*']) {
            expect(isNodeAuthConsent({ scope: 'auth', recipient, expires: null }, NODE, now)).toBe(true);
            expect(isNodeAuthConsent({ scope: 'auth', recipient, expires: '2026-10-22T10:00:01.000Z' }, NODE, now)).toBe(true);
        }
    });
    it('another node, another scope, or an ended consent does not count', () => {
        expect(isNodeAuthConsent({ scope: 'auth', recipient: 'node:aimeat-peer-001-b', expires: null }, NODE, now)).toBe(false);
        expect(isNodeAuthConsent({ scope: 'federation', recipient: `node:${NODE}`, expires: null }, NODE, now)).toBe(false);
        expect(isNodeAuthConsent({ scope: 'auth', recipient: `node:${NODE}`, expires: '2026-10-22T09:59:59.000Z' }, NODE, now)).toBe(false);
    });
});

describe('linkCarriesSignIn and peerMayActFor', () => {
    const storage = (rows: unknown[]) => ({ listConsents: async () => rows }) as unknown as Storage;
    const consent = { scope: 'auth', recipient: `node:${NODE}`, expires: null, status: 'active' };
    it('a member or genesis link with the operator\'s permission may carry a sign-in; contact and visiting links never', () => {
        expect(linkCarriesSignIn({ tier: 'member', allowFederatedAuth: true })).toBe(true);
        expect(linkCarriesSignIn({ tier: 'genesis', allowFederatedAuth: true })).toBe(true);
        expect(linkCarriesSignIn({ tier: undefined, allowFederatedAuth: true })).toBe(true);
        expect(linkCarriesSignIn({ tier: 'visiting', allowFederatedAuth: true })).toBe(false);
        expect(linkCarriesSignIn({ tier: 'contact', allowFederatedAuth: true })).toBe(false);
    });
    it('Core FED-16: the tier alone does not carry a sign-in; the peer\'s own permission is needed too', () => {
        expect(linkCarriesSignIn({ tier: 'member', allowFederatedAuth: false })).toBe(false);
        expect(linkCarriesSignIn({ tier: 'genesis', allowFederatedAuth: false })).toBe(false);
    });
    it('a peer acts for a person only with the consent and on a link that may carry a sign-in', async () => {
        const allowed = { tier: 'member' as const, nodeId: NODE, allowFederatedAuth: true };
        expect(await peerMayActFor(storage([consent]), allowed, 'alice@here', now)).toBe(true);
        expect(await peerMayActFor(storage([]), allowed, 'alice@here', now)).toBe(false);
        expect(await peerMayActFor(storage([consent]), { ...allowed, tier: 'visiting' }, 'alice@here', now)).toBe(false);
        expect(await peerMayActFor(storage([consent]), { ...allowed, allowFederatedAuth: false }, 'alice@here', now)).toBe(false);
    });
    it('the sign-in route exports the same authConsentEnded', () => {
        expect(fromRoute).toBe(authConsentEnded);
    });
});
