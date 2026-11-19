/**
 * @file test/unit/aml-cash.test.ts
 * @description cashOverLimit (services/aml/cash.ts), the cash payment limit of AMLR 2024/1624 art. 80:
 *   one cash payment of more than EUR 10 000 (exactly 10 000 is allowed), linked cash payments to the same
 *   counterparty within 30 days that sum to more, the same spread over 31 days that does not link, a
 *   cash voucher in another currency that is not summed, a card payment that is not cash, a transfer that
 *   is no payment, a withdrawn booking (a voucher and its reversal), and one item per business.
 * @usage cd aimeat && pnpm exec vitest run test/unit/aml-cash.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { describe, it, expect } from 'vitest';
import { CASH_LIMIT_MINOR, cashOverLimit } from '../../src/services/aml/cash.js';
import type { VoucherRecord } from '../../src/models/finance-schemas.js';

let seq = 0;
const v = (over: Partial<VoucherRecord> = {}): VoucherRecord => {
    seq += 1;
    return {
        id: `v${String(seq).padStart(3, '0')}`, ownerGhii: 'alice@node-test', organismId: null, fiscalYearId: 'fy', voucherNumber: seq,
        date: '2026-03-01', description: 'Sale', direction: 'income', source: 'manual', amountMinor: 100_000, currency: 'EUR',
        vatBreakdown: [], counterparty: 'Bob Oy', invoiceId: null, trackingCode: null, externalRef: null, attachments: [],
        reversesVoucherId: null, paymentMethod: 'cash', createdAt: '', updatedAt: '', ...over,
    };
};

describe('cashOverLimit', () => {
    it('reports one cash payment of more than EUR 10 000, and not one of exactly EUR 10 000', () => {
        const over = v({ amountMinor: CASH_LIMIT_MINOR + 1, counterparty: 'Carol' });
        const exact = v({ amountMinor: CASH_LIMIT_MINOR, counterparty: 'Dave' });
        const out = cashOverLimit([over, exact]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ owner: 'alice', direction: 'income', counterparty: 'Carol', total: 1_000_001, currency: 'EUR', count: 1, from: '2026-03-01', to: '2026-03-01', voucherIds: [over.id] });
    });

    it('links cash payments to the same counterparty within 30 days that sum to more than the limit', () => {
        const a = v({ amountMinor: 600_000, date: '2026-03-01', counterparty: 'Bob Oy' });
        const b = v({ amountMinor: 400_001, date: '2026-03-31', counterparty: '  bob oy ' });
        const out = cashOverLimit([b, a]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ total: 1_000_001, count: 2, from: '2026-03-01', to: '2026-03-31', voucherIds: [a.id, b.id], counterparty: 'Bob Oy' });
        // Linked to exactly the limit is allowed.
        expect(cashOverLimit([v({ amountMinor: 600_000 }), v({ amountMinor: 400_000, date: '2026-03-20' })])).toEqual([]);
    });

    it('does not link payments spread over 31 days', () => {
        const out = cashOverLimit([
            v({ amountMinor: 600_000, date: '2026-03-01' }),
            v({ amountMinor: 600_000, date: '2026-04-01' }),
        ]);
        expect(out).toEqual([]);
    });

    it('does not link payments to different counterparties, nor through a blank counterparty', () => {
        expect(cashOverLimit([v({ amountMinor: 600_000, counterparty: 'Bob Oy' }), v({ amountMinor: 600_000, counterparty: 'Carol Oy' })])).toEqual([]);
        expect(cashOverLimit([v({ amountMinor: 600_000, counterparty: null }), v({ amountMinor: 600_000, counterparty: null })])).toEqual([]);
        const alone = cashOverLimit([v({ amountMinor: 2_000_000, counterparty: null })]);
        expect(alone).toHaveLength(1);
        expect(alone[0]!.counterparty).toBeNull();
    });

    it('counts only EUR: a cash voucher in another currency is not summed', () => {
        expect(cashOverLimit([v({ amountMinor: 5_000_000, currency: 'SEK' })])).toEqual([]);
        expect(cashOverLimit([v({ amountMinor: 600_000 }), v({ amountMinor: 600_000, currency: 'USD' })])).toEqual([]);
    });

    it('counts only cash: a card, transfer-method or unrecorded voucher is not a cash payment', () => {
        expect(cashOverLimit([
            v({ amountMinor: 2_000_000, paymentMethod: 'card' }),
            v({ amountMinor: 2_000_000, paymentMethod: 'transfer' }),
            v({ amountMinor: 2_000_000, paymentMethod: null }),
        ])).toEqual([]);
    });

    it('leaves out a transfer voucher and a withdrawn booking (the voucher and its reversal)', () => {
        expect(cashOverLimit([v({ amountMinor: 2_000_000, direction: 'transfer' })])).toEqual([]);
        const booked = v({ amountMinor: 2_000_000 });
        const reversal = v({ amountMinor: 2_000_000, direction: 'expense', reversesVoucherId: booked.id, date: '2026-03-02' });
        expect(cashOverLimit([booked, reversal])).toEqual([]);
    });

    it('keeps businesses and directions apart: an organism\'s payments do not link to its member\'s own, nor income to expense', () => {
        const out = cashOverLimit([
            v({ amountMinor: 600_000 }),
            v({ amountMinor: 600_000, organismId: 'org-1' }),
            v({ amountMinor: 600_000, direction: 'expense' }),
        ]);
        expect(out).toEqual([]);
        const org = cashOverLimit([v({ amountMinor: 600_000, organismId: 'org-1' }), v({ amountMinor: 600_000, organismId: 'org-1', ownerGhii: 'bob@node-test' })]);
        expect(org).toHaveLength(1);
        expect(org[0]).toMatchObject({ organism_id: 'org-1', count: 2 });
        expect(org[0]!.owner).toBeUndefined();
    });
});
