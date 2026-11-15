/**
 * @file test/unit/internal-pass.test.ts
 * @description The in-process pass that lets an already-settled call through the extension paywall
 *   (services/extension-access/internal-pass.ts) is single use and unguessable: a second consume of
 *   the same token answers null, and two passes minted for one coordinate are different tokens. The
 *   E2E twin (e2e-ext-paywall.ts) proves a forged header from outside is charged normally.
 * @version-history
 *   2026-11-15 — Initial (August audit L050).
 */
import { describe, expect, it } from 'vitest';
import { mintInternalPass, consumeInternalPass } from '../../src/services/extension-access/internal-pass.js';

describe('internal pass', () => {
    it('is consumed once: the second consume of the same token is null', () => {
        const token = mintInternalPass('ext:shop', 'paidcall');
        expect(consumeInternalPass(token)).toEqual({ kind: 'settled', coordExt: 'ext:shop', coordAction: 'paidcall' });
        expect(consumeInternalPass(token)).toBeNull();
    });

    it('is not derived from its coordinate: two mints for one call are different tokens', () => {
        const a = mintInternalPass('ext:shop', 'paidcall');
        const b = mintInternalPass('ext:shop', 'paidcall');
        expect(a).not.toBe(b);
        expect(a.length).toBeGreaterThanOrEqual(32);
        consumeInternalPass(a); consumeInternalPass(b);
    });

    it('answers null for a token it never minted, and for none at all', () => {
        expect(consumeInternalPass('not-a-minted-pass')).toBeNull();
        expect(consumeInternalPass(undefined)).toBeNull();
    });
});
