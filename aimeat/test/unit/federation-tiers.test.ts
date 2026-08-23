/**
 * @file federation-tiers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tier ladder and its two different questions.
 *
 *   `deriveTierFlags` says what a tier STARTS with; `tierCeiling` says what it may REACH. They
 *   coincide below member and diverge at it, because federated auth defaults off and may be raised.
 *   Conflating them would either strip a member's federated auth on every edit or let a visiting peer
 *   grant itself one, so the whole table is asserted rather than sampled.
 *
 *   The `contact` row is the one that carries a promise to a customer: messages and nothing else. If
 *   any flag on that row is ever true, the promise is broken wherever that flag is read, so this file
 *   asserts it exhaustively rather than trusting the four literals to stay put.
 * @structure One describe per function; the contact row gets its own.
 * @usage pnpm exec vitest run test/unit/federation-tiers.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, with the contact tier.
 */
import { describe, it, expect } from 'vitest';
import {
    deriveTierFlags, tierCeiling, clampFlagsToTier, coerceTier, tierRank,
    type PeerTier, type TierFlags,
} from '../../src/services/federation-tiers.js';

const ALL_TIERS: PeerTier[] = ['contact', 'visiting', 'member', 'genesis'];

/** Every boolean flag on, so a clamp result shows exactly what the tier permits. */
const ALL_ON: TierFlags = {
    shareCatalogue: true, replicateMemory: true, allowRouting: true,
    allowMessaging: true, allowBroadcast: true, allowSettlement: true,
    peerMode: 'federation', allowFederatedAuth: true, federationAuthScopes: ['memory:read'],
};

describe('the contact tier is messages and nothing else', () => {
    it('grants exactly one capability', () => {
        expect(deriveTierFlags('contact')).toEqual({
            shareCatalogue: false,
            replicateMemory: false,
            allowRouting: false,
            allowMessaging: true,
            allowBroadcast: false,
            allowSettlement: false,
            peerMode: 'private',
            allowFederatedAuth: false,
            federationAuthScopes: [],
        });
    });

    it('cannot be raised by a flag edit, however the edit is written', () => {
        const clamped = clampFlagsToTier('contact', ALL_ON);
        expect(clamped).toEqual(deriveTierFlags('contact'));
    });

    it('stays out of the public directory even when the edit asks to be listed', () => {
        expect(clampFlagsToTier('contact', { ...ALL_ON, peerMode: 'federation' }).peerMode).toBe('private');
    });

    it('keeps no federated-auth scopes, because it can never use them', () => {
        expect(clampFlagsToTier('contact', ALL_ON).federationAuthScopes).toEqual([]);
    });
});

describe('the ladder', () => {
    it('orders the tiers low to high', () => {
        expect(tierRank('contact')).toBeLessThan(tierRank('visiting'));
        expect(tierRank('visiting')).toBeLessThan(tierRank('member'));
        expect(tierRank('member')).toBeLessThan(tierRank('genesis'));
    });

    it('says demoting a contact peer to visiting would be a PROMOTION', () => {
        // The trust-advisory path demotes to 'visiting' unconditionally. For a contact peer that
        // hands over catalogue read, so the demotion has to check it is one.
        expect(tierRank('contact')).toBeLessThan(tierRank('visiting'));
        expect(deriveTierFlags('visiting').shareCatalogue).toBe(true);
        expect(deriveTierFlags('contact').shareCatalogue).toBe(false);
    });
});

describe('coerceTier', () => {
    it('accepts every real tier unchanged', () => {
        for (const t of ALL_TIERS) expect(coerceTier(t)).toBe(t);
    });

    it('reads a missing or unknown tier as member, as legacy rows require', () => {
        for (const raw of [undefined, null, '', 'nonsense', 42, {}]) expect(coerceTier(raw)).toBe('member');
    });

    it('never coerces INTO contact, so nobody lands on the floor by accident', () => {
        for (const raw of [undefined, null, '', 'nonsense', 'Contact', 'CONTACT']) {
            expect(coerceTier(raw)).not.toBe('contact');
        }
    });
});

describe('ceilings versus defaults', () => {
    it('are the same question below member', () => {
        expect(tierCeiling('contact')).toEqual(deriveTierFlags('contact'));
        expect(tierCeiling('visiting')).toEqual(deriveTierFlags('visiting'));
    });

    it('differ at member and genesis, where federated auth is off by default and may be raised', () => {
        for (const t of ['member', 'genesis'] as PeerTier[]) {
            expect(deriveTierFlags(t).allowFederatedAuth).toBe(false);
            expect(tierCeiling(t).allowFederatedAuth).toBe(true);
        }
    });
});

describe('clampFlagsToTier', () => {
    it('leaves a member edit alone — existing peers are edited exactly as before', () => {
        expect(clampFlagsToTier('member', ALL_ON)).toEqual(ALL_ON);
    });

    it('holds a visiting peer below provider, relay, replication and auth', () => {
        const clamped = clampFlagsToTier('visiting', ALL_ON);
        expect(clamped.replicateMemory).toBe(false);
        expect(clamped.allowRouting).toBe(false);
        expect(clamped.allowFederatedAuth).toBe(false);
        expect(clamped.federationAuthScopes).toEqual([]);
        // Catalogue read and peerMode stayed freely editable, which is the behaviour the hand-written
        // guard had and this replaced.
        expect(clamped.shareCatalogue).toBe(true);
        expect(clamped.peerMode).toBe('federation');
    });

    it('always lets a capability be turned OFF, at every tier', () => {
        const allOff: TierFlags = {
            shareCatalogue: false, replicateMemory: false, allowRouting: false,
            allowMessaging: false, allowBroadcast: false, allowSettlement: false,
            peerMode: 'private', allowFederatedAuth: false, federationAuthScopes: [],
        };
        for (const t of ALL_TIERS) {
            const clamped = clampFlagsToTier(t, allOff);
            for (const [k, v] of Object.entries(clamped)) {
                if (typeof v === 'boolean') expect(v, `${t}.${k}`).toBe(false);
            }
        }
    });

    it('is idempotent: clamping an already-clamped set changes nothing', () => {
        for (const t of ALL_TIERS) {
            const once = clampFlagsToTier(t, ALL_ON);
            expect(clampFlagsToTier(t, once)).toEqual(once);
        }
    });
});

describe('the three new permission words exist on every tier that had them before', () => {
    it('leaves visiting, member and genesis able to message, broadcast and settle', () => {
        for (const t of ['visiting', 'member', 'genesis'] as PeerTier[]) {
            const f = deriveTierFlags(t);
            expect(f.allowMessaging, `${t}.allowMessaging`).toBe(true);
            expect(f.allowBroadcast, `${t}.allowBroadcast`).toBe(true);
            expect(f.allowSettlement, `${t}.allowSettlement`).toBe(true);
        }
    });
});
