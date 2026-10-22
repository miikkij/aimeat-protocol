/**
 * @file test/unit/federation-auth-consent.test.ts
 * @description The sign-in consent check the federated sign-in, the peer memory list and the peer
 *   replicate share (src/services/federation-auth-consent.ts): which consent rows count for a node,
 *   which links may carry a sign-in, and that the moved authConsentEnded is the one the sign-in
 *   route still exports.
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10 wave 3, v70 and v71).
 */
import { describe, it, expect } from 'vitest';
import { isNodeAuthConsent, linkCarriesSignIn, peerMayActFor, authConsentEnded } from '../../src/services/federation-auth-consent.js';
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
    it('member and genesis links may carry a sign-in, contact and visiting links may not', () => {
        expect(linkCarriesSignIn({ tier: 'member' })).toBe(true);
        expect(linkCarriesSignIn({ tier: 'genesis' })).toBe(true);
        expect(linkCarriesSignIn({ tier: undefined })).toBe(true);
        expect(linkCarriesSignIn({ tier: 'visiting' })).toBe(false);
        expect(linkCarriesSignIn({ tier: 'contact' })).toBe(false);
    });
    it('a peer acts for a person only with the consent and on a link that may carry a sign-in', async () => {
        expect(await peerMayActFor(storage([consent]), { tier: 'member', nodeId: NODE }, 'alice@here', now)).toBe(true);
        expect(await peerMayActFor(storage([]), { tier: 'member', nodeId: NODE }, 'alice@here', now)).toBe(false);
        expect(await peerMayActFor(storage([consent]), { tier: 'visiting', nodeId: NODE }, 'alice@here', now)).toBe(false);
    });
    it('the sign-in route exports the same authConsentEnded', () => {
        expect(fromRoute).toBe(authConsentEnded);
    });
});
