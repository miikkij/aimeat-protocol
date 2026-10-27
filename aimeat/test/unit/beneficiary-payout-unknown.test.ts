/**
 * @file test/unit/beneficiary-payout-unknown.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A beneficiary payout whose x402 settle did not answer is kept as a possible payout:
 *   the provider is told not to sign again, the entries it covered leave the quote until the provider
 *   says the transfer did not arrive, and the beneficiary is notified. The usage cases (a payout that
 *   settles marks the entries paid; a signature that does not verify leaves them payable) pass before
 *   and after. The x402 test facilitator double stands in for the real one; nothing leaves the process.
 * @usage cd aimeat && pnpm exec vitest run test/unit/beneficiary-payout-unknown.test.ts
 * @version-history
 *   2026-10-27 -- Initial (secaudit2026oct26, commerce/beneficiary-payout:settle-error-unrecorded-possible-payment).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { quoteBeneficiaryPayout, settleBeneficiaryPayout } from '../../src/commerce/beneficiary-payout.js';
import { listBeneficiaryEntries } from '../../src/commerce/beneficiary-book.js';
import { X402_TEST_UNANSWERED_NONCE_PREFIX, type X402PaymentPayload, type X402PaymentRequirements } from '../../src/commerce/x402-facilitator.js';
import { putRecord } from '../../src/commerce/platform-fee.js';

const NODE = 'payout-node';
const PROVIDER = `prov@${NODE}`;
const BENEFICIARY = `bene@${NODE}`;
const ADDR = '0x1111111111111111111111111111111111111111';
const config = { nodeId: NODE, baseUrl: 'https://node.test', x402TestFacilitator: true, x402Network: 'base-sepolia' } as unknown as AimeatConfig;

function signed(reqs: X402PaymentRequirements, nonce: string, value = reqs.maxAmountRequired): X402PaymentPayload {
  return {
    x402Version: 1, scheme: 'exact', network: reqs.network,
    payload: {
      signature: `0x${'ab'.repeat(65)}`,
      authorization: { from: '0x2222222222222222222222222222222222222222', to: reqs.payTo, value, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600), nonce },
    },
  } as unknown as X402PaymentPayload;
}

async function release(storage: SqliteStorage, tc: string, amount: number): Promise<void> {
  await putRecord(storage, BENEFICIARY, `commerce.benefit.${tc}`, {
    items: [{ amount, currency: 'EUR', fromGhii: PROVIDER, weight: 1, kind: 'static', status: 'released', releasedAt: new Date().toISOString(), at: new Date().toISOString() }],
  });
}

describe('a beneficiary payout whose settlement did not answer', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await putRecord(storage, BENEFICIARY, 'commerce.psp', { x402: { address: ADDR } });
    await release(storage, 'tc-one', 2_000_000);
  });

  it('is kept: 502-class answer, the entries leave the quote until the provider says it did not arrive', async () => {
    const q = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    expect(q.ok).toBe(true);
    const nonce = `${X402_TEST_UNANSWERED_NONCE_PREFIX}${'0'.repeat(54)}`;
    const r = await settleBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY, payload: signed(q.requirements!, nonce) });
    expect(r).toMatchObject({ ok: false, reason: 'X402_SETTLE_UNKNOWN' });

    const again = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('POSSIBLE_PAYMENT_OPEN');
    expect(again.possiblePayments?.map(p => p.nonce)).toEqual([nonce]);
    const kept = await storage.getMemory(PROVIDER, `commerce.possible.payout.${nonce}`);
    expect((kept?.value as { status?: string }).status).toBe('unconfirmed');

    // Entries released later are quoted as before.
    await release(storage, 'tc-two', 500_000);
    const later = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    expect(later.ok).toBe(true);
    expect(later.amount).toBe(500_000);

    const closed = await settleBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY, notArrivedNonce: nonce });
    expect(closed).toMatchObject({ ok: true, closed: true });
    const back = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    expect(back.ok).toBe(true);
    expect(back.amount).toBe(2_500_000);
  });

  it('designed use: a payout that settles marks the entries paid', async () => {
    const q = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    const r = await settleBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY, payload: signed(q.requirements!, `0x${'1'.repeat(64)}`) });
    expect(r).toMatchObject({ ok: true, amount: 2_000_000, entries: 1 });
    expect((await listBeneficiaryEntries(storage, BENEFICIARY))[0]?.status).toBe('paid');
    const after = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    expect(after.reason).toBe('NOTHING_OWED');
  });

  it('designed use: a signature that does not verify leaves the entries payable', async () => {
    const q = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    const r = await settleBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY, payload: signed(q.requirements!, `0x${'2'.repeat(64)}`, '1') });
    expect(r).toMatchObject({ ok: false, reason: 'X402_VERIFY_FAILED' });
    const after = await quoteBeneficiaryPayout(storage, config, { providerGhii: PROVIDER, beneficiaryGhii: BENEFICIARY });
    expect(after.ok).toBe(true);
    expect(after.amount).toBe(2_000_000);
  });
});
