/**
 * @file test/unit/exchange-ext-action-pricing.test.ts
 * @description What a contract on an extension action costs, read from the action the way the node
 *   stores it (services/extension-manifest.ts): the 4.0.0 form keeps the pacing amount on the action
 *   (`tollMorsels`) and refuses `commercial.payMorsels`; a 3.x record may still carry payMorsels.
 *
 *   WHY. resolveActionPricing read only the `commercial` block, so an action in the 4.0.0 form answered
 *   NOT_PRICED on accept, bid accept and listing, while the projection listed it on the morsel rail
 *   (listingTerms). Found by the 4.0.0 sweep (e2e-exchange). The toll-only case must also not charge
 *   twice: the toll is the per-call pacing amount, and the contract carries no second toll beside it.
 * @usage cd aimeat && pnpm vitest run test/unit/exchange-ext-action-pricing.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (the 4.0.0 sweep).
 */
import { describe, it, expect } from 'vitest';
import { resolveOfferingPricing, type Offering } from '../../src/services/exchange-market.js';
import type { Storage } from '../../src/storage/interface.js';

function storageWith(action: Record<string, unknown>): Storage {
  return {
    getExtension: async (name: string) => (name === 'ext1'
      ? { name: 'ext1', installedBy: 'alice', actions: [{ id: 'act', ...action }] }
      : null),
  } as unknown as Storage;
}

const offering = { kind: 'ext-action', ext: 'ext1', action: 'act', providerGhii: 'alice@n', surface: null } as unknown as Offering;

async function terms(action: Record<string, unknown>) {
  return resolveOfferingPricing(storageWith(action), offering, null);
}

describe('a contract on an extension action', () => {
  it('in the 4.0.0 form (its own tollMorsels) is on the morsel rail at the toll, with no second toll', async () => {
    const r = await terms({ tollMorsels: 10, commercial: { payMorsels: 0 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe('morsels');
    expect(r.pricePerCall).toBe(10);
    expect(r.tollMorsels).toBe(0);
  });

  it('with tollMorsels and no commercial block at all is priced the same way', async () => {
    const r = await terms({ tollMorsels: 7 });
    expect(r.ok && r.pricePerCall === 7 && r.tollMorsels === 0).toBe(true);
  });

  it('a 3.x record (payMorsels and a separate toll) keeps both, as before', async () => {
    const r = await terms({ tollMorsels: 2, commercial: { payMorsels: 10 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pricePerCall).toBe(10);
    expect(r.tollMorsels).toBe(2);
  });

  it('a money price wins, and the toll stays beside it', async () => {
    const r = await terms({ tollMorsels: 3, commercial: { payMoney: { amount: 50000, currency: 'EUR' } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe('money');
    expect(r.pricePerCall).toBe(50000);
    expect(r.tollMorsels).toBe(3);
  });

  it('with neither a money price nor a pacing amount is NOT_PRICED', async () => {
    const r = await terms({ commercial: { payMorsels: 0 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NOT_PRICED');
  });
});
