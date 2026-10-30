/**
 * @file test/unit/beneficiary-payout-arrived.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A held possible payout (a settle that did not answer) is marked arrived by the
 *   operator with a reference: the covered entries read paid with that reference, the record closes as
 *   'arrived', the next quote owes nothing, the beneficiary and the provider are told, and a second
 *   press changes nothing. A record whose amount the beneficiary's book does not show is refused. The
 *   x402 test facilitator double stands in for the real one; nothing leaves the process.
 * @usage cd aimeat && pnpm exec vitest run test/unit/beneficiary-payout-arrived.test.ts
 * @version-history
 *   2026-10-29 -- Initial (secaudit2026oct26 round 8c, commerce/beneficiary-payout:settle-error-unrecorded-possible-payment).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { quoteBeneficiaryPayout, settleBeneficiaryPayout } from '../../src/commerce/beneficiary-payout.js';
import { listBeneficiaryEntries } from '../../src/commerce/beneficiary-book.js';
import { listOpenPayoutHoldsOnNode, markPayoutHoldArrived, PAYOUT_HOLD_PREFIX } from '../../src/commerce/beneficiary-payout-hold.js';
import { X402_TEST_UNANSWERED_NONCE_PREFIX, type X402PaymentPayload, type X402PaymentRequirements } from '../../src/commerce/x402-facilitator.js';
import { putRecord } from '../../src/commerce/platform-fee.js';

const NODE = 'arrived-node';
const PROVIDER = `prov@${NODE}`;
const BENEFICIARY = `bene@${NODE}`;
const OPERATOR = `op@${NODE}`;
const ADDR = '0x1111111111111111111111111111111111111111';
const config = { nodeId: NODE, baseUrl: 'https://node.test', x402TestFacilitator: true, x402Network: 'base-sepolia' } as unknown as AimeatConfig;
const NONCE = `${X402_TEST_UNANSWERED_NONCE_PREFIX}${'7'.repeat(54)}`;

function signed(reqs: X402PaymentRequirements, nonce: string): X402PaymentPayload {
  return {
    x402Version: 1, scheme: 'exact', network: reqs.network,
    payload: {
      signature: `0x${'ab'.repeat(65)}`,
      authorization: { from: '0x2222222222222222222222222222222222222222', to: reqs.payTo, value: reqs.maxAmountRequired, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600), nonce },
    },
  } as unknown as X402PaymentPayload;
}

async function notices(storage: SqliteStorage, ghii: string): Promise<string[]> {
  const rows = await storage.listMemory(ghii, { prefix: 'notif.' });
  return rows.map(r => String((r.value as { type?: string }).type ?? ''));
}

describe('a held possible payout the operator marks as arrived', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await putRecord(storage, BENEFICIARY, 'commerce.psp', { x402: { address: ADDR } });
    await putRecord(storage, BENEFICIARY, 'commerce.benefit.tc-one', {
      items: [{ amount: 3_000_000, currency: 'EUR', fromGhii: PROVIDER, weight: 1, kind: 'static', status: 'released', releasedAt: new Date().toISOString(), at: new Date().toISOString() }],
    });
    const q = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    const r = await settleBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY, payload: signed(q.requirements!, NONCE) });
    expect(r).toMatchObject({ ok: false, reason: 'X402_SETTLE_UNKNOWN' });
  });

  it('is listed for the operator, then marked paid with the reference, closed, and both parties told', async () => {
    const open = await listOpenPayoutHoldsOnNode(storage);
    expect(open.map(h => h.nonce)).toEqual([NONCE]);

    const r = await markPayoutHoldArrived(storage, { providerGhii: PROVIDER, nonce: NONCE, reference: '0xabc123', by: OPERATOR });
    expect(r).toMatchObject({ ok: true, entries: 1 });

    const entry = (await listBeneficiaryEntries(storage, BENEFICIARY))[0]!;
    expect(entry.status).toBe('paid');
    expect(entry.payoutReference).toBe('0xabc123');
    expect(entry.payoutRail).toBe('x402:base-sepolia');
    const kept = (await storage.getMemory(PROVIDER, `${PAYOUT_HOLD_PREFIX}${NONCE}`))?.value as { status: string; arrivedReference: string; closedBy: string };
    expect(kept).toMatchObject({ status: 'arrived', arrivedReference: '0xabc123', closedBy: OPERATOR });
    expect(await listOpenPayoutHoldsOnNode(storage)).toEqual([]);
    expect((await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY })).reason).toBe('NOTHING_OWED');
    expect(await notices(storage, BENEFICIARY)).toContain('payout_arrived');
    expect(await notices(storage, PROVIDER)).toContain('payout_arrived_provider');

    const again = await markPayoutHoldArrived(storage, { providerGhii: PROVIDER, nonce: NONCE, reference: '0xother', by: OPERATOR });
    expect(again).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect((await listBeneficiaryEntries(storage, BENEFICIARY))[0]!.payoutReference).toBe('0xabc123');
  });

  it('refuses without a reference, for an unknown nonce, and for a record the book does not support', async () => {
    expect(await markPayoutHoldArrived(storage, { providerGhii: PROVIDER, nonce: NONCE, reference: '  ', by: OPERATOR })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(await markPayoutHoldArrived(storage, { providerGhii: PROVIDER, nonce: '0xnope', reference: 'r', by: OPERATOR })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    // The record is the provider's own: an amount the book does not show is not paid from it.
    const key = `${PAYOUT_HOLD_PREFIX}${NONCE}`;
    const stored = (await storage.getMemory(PROVIDER, key))!.value as Record<string, unknown>;
    await putRecord(storage, PROVIDER, key, { ...stored, amount: 9_000_000 });
    expect(await markPayoutHoldArrived(storage, { providerGhii: PROVIDER, nonce: NONCE, reference: 'r', by: OPERATOR })).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect((await listBeneficiaryEntries(storage, BENEFICIARY))[0]!.status).toBe('released');
  });

  it('designed use: the provider still closes it as not arrived, and the entries are quoted again', async () => {
    const closed = await settleBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY, notArrivedNonce: NONCE });
    expect(closed).toMatchObject({ ok: true, closed: true });
    expect((await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY })).amount).toBe(3_000_000);
    expect(await markPayoutHoldArrived(storage, { providerGhii: PROVIDER, nonce: NONCE, reference: 'r', by: OPERATOR })).toMatchObject({ ok: false, code: 'CONFLICT' });
  });
});
