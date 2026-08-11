/**
 * @file test/unit/reserved-keys.test.ts
 * @description The reserved-key write gate, asserted from both ends: the prefixes that must be on
 *   the list, and the principals the list must and must not refuse.
 *
 *   The list is easy to grow and easy to break, and both mistakes are invisible in a screenshot. Two
 *   keys became server-trusted after the list was written and stayed off it for weeks:
 *   `finance.accountants` decides whether one owner may read another owner's invoices, vouchers, VAT
 *   report, P&L and exports, and `commerce.psp` holds the payout address and Stripe secret that
 *   settlement believes. An app the owner granted `memory:write` writes into the owner's own
 *   namespace by design, so appending itself to either record was the whole attack.
 *
 *   The other end matters as much. Every prefix here costs a granted app a capability, and the gate
 *   has already been broken once in the opposite direction by treating an owner session as a
 *   delegated write, which locked the account holder out of their own record. So the owner, the
 *   agent writing in its own namespace, and the one agent the owner handed
 *   `memory:write-reserved` are asserted to still get through.
 * @structure
 *   - the list itself: the five prefixes, and no accidental removal
 *   - isReservedServerKey: prefix matching, including the near-misses that must NOT match
 *   - appMayWriteKey: owner passes, app refused, delegated agent refused, reserved grant passes
 * @usage cd aimeat && pnpm exec vitest run test/unit/reserved-keys.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial, with the August 2026 audit fix (H-6 finance., H-23 commerce.).
 */
import { describe, it, expect } from 'vitest';
import {
    RESERVED_OWNER_KEY_PREFIXES, isReservedServerKey, appMayWriteKey,
} from '../../src/utils/reserved-keys.js';

/** The two records the August 2026 audit found unprotected, by their real production key names. */
const ACCOUNTANTS_KEY = 'finance.accountants';
const PSP_KEY = 'commerce.psp';

describe('the list holds every prefix the server reads and acts on', () => {
    it('carries all five, and a removal is a test failure rather than a silent regression', () => {
        expect([...RESERVED_OWNER_KEY_PREFIXES].sort()).toEqual(
            ['ai-usage.', 'commerce.', 'finance.', 'openrouter.', 'profile.'],
        );
    });

    it('every entry ends in a dot, so a prefix can never swallow a neighbouring namespace', () => {
        // Without the dot, 'profile' would also reserve 'profiles.*' and 'profile-notes.*', which
        // are ordinary user data and would start refusing an app that had always written them.
        for (const prefix of RESERVED_OWNER_KEY_PREFIXES) expect(prefix.endsWith('.')).toBe(true);
    });
});

describe('isReservedServerKey covers the keys the audit found and nothing beside them', () => {
    it.each([
        [ACCOUNTANTS_KEY, 'the cross-owner grant list for the whole finance area'],
        ['finance.clients', 'the accountant-side mirror of the same relationship'],
        [PSP_KEY, 'the payout address, the Stripe secret and the webhook secret'],
        ['commerce.order.abc123', 'a settled order the books read back as fact'],
        ['commerce.payable.xyz', 'what the provider owes a beneficiary'],
        ['openrouter.settings', 'the URL a decrypted AI key is posted to'],
        ['ai-usage.2026-08-11', 'the daily spend cap'],
        ['profile.alice.interests', 'the public directory entry'],
    ])('%s is reserved (%s)', (key) => {
        expect(isReservedServerKey(key)).toBe(true);
    });

    it.each([
        'financenotes.q3',
        'commerceideas.draft',
        'my.finance.notes',
        'notes.about.commerce.psp',
        'apps.invoicer.tools',
    ])('%s is ordinary user data and stays writable', (key) => {
        expect(isReservedServerKey(key)).toBe(false);
    });
});

describe('appMayWriteKey refuses the principals that write into the owner namespace', () => {
    it('an app grant may not append itself to the accountant list', () => {
        // H-6. An app-grant token resolves to the owner GHII, so this write would have landed in the
        // record resolveFinanceOwner() consults before handing over another owner's books.
        expect(appMayWriteKey(['app'], ACCOUNTANTS_KEY)).toBe(false);
    });

    it('an app grant may not repoint the seller payout address', () => {
        // H-23. commerce/x402.ts and commerce/sellable-resolvers.ts read this as trusted fact.
        expect(appMayWriteKey(['app'], PSP_KEY)).toBe(false);
    });

    it('an app grant keeps writing everything else it always could', () => {
        expect(appMayWriteKey(['app'], 'notes.groceries')).toBe(true);
        expect(appMayWriteKey(['app'], 'apps.invoicer.state')).toBe(true);
    });

    it('an agent asking to write AS THE OWNER meets the same refusal', () => {
        // memory:write-as-owner reaches the identical namespace, which is why the guard cannot key
        // off the role alone.
        expect(appMayWriteKey(['agent'], PSP_KEY, true)).toBe(false);
        expect(appMayWriteKey(['agent'], ACCOUNTANTS_KEY, true)).toBe(false);
    });
});

describe('and lets through the principals whose keys these are', () => {
    it('the account holder writes their own finance and commerce records', () => {
        // The guard broke this once already: passing delegatedOwnerWrite for an owner session locked
        // the owner out of their own record. /v1/commerce/payout/* and /v1/finance/accountants are
        // owner routes, and this is the branch they depend on.
        expect(appMayWriteKey(['owner'], PSP_KEY)).toBe(true);
        expect(appMayWriteKey(['owner'], ACCOUNTANTS_KEY)).toBe(true);
    });

    it('an agent writing in its OWN namespace is untouched', () => {
        // No 'app' role and no delegation: the record lands under the agent GAII, which is not a
        // namespace the server reads for any of this.
        expect(appMayWriteKey(['agent'], PSP_KEY)).toBe(true);
    });

    it('the one agent granted memory:write-reserved may still administer the account', () => {
        expect(appMayWriteKey(['agent'], PSP_KEY, true, true)).toBe(true);
        expect(appMayWriteKey(['agent'], ACCOUNTANTS_KEY, true, true)).toBe(true);
    });

    it('an ecosystem session is not an owner session, whatever else its roles say', () => {
        // resolveIdentity keeps a GEAI in its own eco: namespace, and the owner branch must not be
        // the way back out of it.
        expect(appMayWriteKey(['owner', 'ecosystem'], PSP_KEY, true)).toBe(false);
        expect(appMayWriteKey(['owner', 'agent'], ACCOUNTANTS_KEY, true)).toBe(false);
    });
});
