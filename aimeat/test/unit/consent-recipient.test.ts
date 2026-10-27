/**
 * @file test/unit/consent-recipient.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The consent recipient matcher (src/storage/consent-recipient.ts): a 'domain:' glob
 *   matches signed-in principals whose home node matches it, and never the anonymous reader, which
 *   names no node. Only the recipient '*' means everyone.
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22, domain-recipient-matches-anonymous-reader).
 */
import { describe, it, expect } from 'vitest';
import { matchesRecipient } from '../../src/storage/consent-recipient.js';
import { parseGaiiLoose } from '../../src/utils/gaii.js';

/** The matcher as both storage providers call it: the accessor parsed with parseGaiiLoose. */
function matches(recipient: string, accessorGaii: string): boolean {
    const a = parseGaiiLoose(accessorGaii);
    return matchesRecipient(recipient, accessorGaii, a.owner, a.node);
}

describe('matchesRecipient, domain recipients', () => {
    it('a domain glob never matches the anonymous reader', () => {
        for (const recipient of ['domain:*', 'domain:**', 'domain:***']) {
            expect(matches(recipient, 'anonymous')).toBe(false);
        }
    });

    it('a domain glob matches a signed-in principal of a matching node, local or federated', () => {
        expect(matches('domain:*', 'bot#bob@aimeat-peer-1')).toBe(true);
        expect(matches('domain:*', 'alice@aimeat-local-001-dev')).toBe(true);
        expect(matches('domain:aimeat-*', 'claude#alice@aimeat-local-001-dev')).toBe(true);
        expect(matches('domain:*.health-network.fi', 'bot#bob@a.health-network.fi')).toBe(true);
    });

    it('a domain glob does not match a principal of another node', () => {
        expect(matches('domain:*.health-network.fi', 'bot#bob@aimeat-peer-1')).toBe(false);
    });

    it('the recipient "*" still means everyone, the anonymous reader included', () => {
        expect(matches('*', 'anonymous')).toBe(true);
        expect(matches('*', 'bot#bob@aimeat-peer-1')).toBe(true);
    });
});

// secaudit2026oct26, node-domain-recipient-matches-shared-anonymous-principal.
describe('matchesRecipient, the shared anonymous agent', () => {
    const SHARED = 'shared#anonymous@aimeat-local-001-dev';
    it('a node or domain recipient does not match the shared anonymous agent of the node', () => {
        expect(matches('node:aimeat-local-001-dev', SHARED)).toBe(false);
        expect(matches('domain:*', SHARED)).toBe(false);
        expect(matches('domain:aimeat-*', SHARED)).toBe(false);
    });

    it('accounts and agents of the node still match, and "*" still admits the shared agent', () => {
        expect(matches('node:aimeat-local-001-dev', 'claude#alice@aimeat-local-001-dev')).toBe(true);
        expect(matches('node:aimeat-local-001-dev', 'alice@aimeat-local-001-dev')).toBe(true);
        expect(matches('*', SHARED)).toBe(true);
    });
});
