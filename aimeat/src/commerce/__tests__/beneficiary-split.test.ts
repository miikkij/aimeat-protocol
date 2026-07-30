/**
 * @file src/commerce/__tests__/beneficiary-split.test.ts
 * @description Unit tests for the second rake's arithmetic (src/commerce/beneficiary-split.ts). The
 *   property that matters is CONSERVATION: across every amount, every percent and every set of
 *   weights, `price === platformFee + providerNet + Σ beneficiaryCuts` — no micro-unit invented, none
 *   destroyed. Proven here rather than inferred from a settled ledger, because a rounding leak of one
 *   micro-unit per call is invisible in any single receipt and is exactly what a ledger cannot show.
 *
 *   Also fixed here: the pool FLOORS (a provider never pays out more than the percent they declared),
 *   the same party named twice is one creditor, and no rows means the provider keeps everything.
 * @usage cd aimeat && pnpm exec vitest run src/commerce/__tests__/beneficiary-split.test.ts
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial: conservation, floor policy, dedupe, and the empty cases.
 */
import { describe, it, expect } from 'vitest';
import { computeSplit, type BeneficiarySplit, type DynamicDesignation } from '../beneficiary-split.js';
import { percentFee } from '../money.js';

/** The amounts a proportional split is most likely to lose a unit on, plus the real kumppani price. */
const ADVERSARIAL = [1, 2, 3, 7, 11, 13, 99, 100, 101, 999, 1000, 500_000, 999_999, 1_000_000];
const PERCENTS = [1, 3, 7, 30, 33, 50, 70, 99, 100];

function split(over: Partial<BeneficiarySplit> = {}): BeneficiarySplit {
  return {
    splitId: 's1', providerGhii: 'prov@n', ext: 'kumppani', action: 'getRegisterChanges',
    capabilityLabel: 'kumppani/getRegisterChanges', poolPercent: 70,
    beneficiaries: [{ ghii: 'a@n', weight: 1, note: '' }],
    dynamic: false, state: 'active',
    createdAt: '', createdBy: '', updatedAt: '', ...over,
  };
}

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

describe('conservation — nothing is created or destroyed', () => {
  it('the lines always sum to the pool exactly, at every amount and percent', () => {
    for (const gross of ADVERSARIAL) {
      for (const pct of PERCENTS) {
        for (const weights of [[1], [1, 1], [1, 1, 1], [3, 1], [7, 2, 1], [1, 1, 1, 1, 1, 1, 1]]) {
          const s = split({
            poolPercent: pct,
            beneficiaries: weights.map((w, i) => ({ ghii: `b${i}@n`, weight: w, note: '' })),
          });
          const r = computeSplit(gross, s);
          expect(sum(r.lines.map(l => l.amount))).toBe(r.pool);
          expect(r.pool + r.providerNet).toBe(gross);
        }
      }
    }
  });

  it('composed with the platform rake: price === fee + providerNet + shares', () => {
    for (const price of ADVERSARIAL) {
      for (const rake of [0, 1, 5, 12, 50]) {
        const fee = percentFee(price, rake);
        const providerGross = price - fee;
        const r = computeSplit(providerGross, split({
          poolPercent: 70,
          beneficiaries: [{ ghii: 'a@n', weight: 2, note: '' }, { ghii: 'b@n', weight: 1, note: '' }],
        }));
        expect(fee + r.providerNet + sum(r.lines.map(l => l.amount))).toBe(price);
      }
    }
  });

  it('the real kumppani figure divides as expected (0.50 EUR, 5 % rake, 70 % pool)', () => {
    const price = 500_000;
    const fee = percentFee(price, 5);           // 25 000
    const r = computeSplit(price - fee, split({ poolPercent: 70 }));
    expect(fee).toBe(25_000);
    expect(r.pool).toBe(332_500);
    expect(r.providerNet).toBe(142_500);
    expect(fee + r.providerNet + r.pool).toBe(price);
  });
});

describe('the pool floors — a provider never over-pays their declared percent', () => {
  it('never exceeds the exact proportional share', () => {
    for (const gross of ADVERSARIAL) {
      for (const pct of PERCENTS) {
        const r = computeSplit(gross, split({ poolPercent: pct }));
        expect(r.pool).toBeLessThanOrEqual((gross * pct) / 100);
      }
    }
  });

  it('a sub-unit share rounds to nothing rather than to one', () => {
    // 1 morsel at 30 % is 0.3 of a morsel. Ceiling it would have the provider paying out a third
    // more than they earned on that call, which over a million calls is a real number.
    expect(computeSplit(1, split({ poolPercent: 30 })).pool).toBe(0);
    expect(computeSplit(1, split({ poolPercent: 30 })).providerNet).toBe(1);
  });
});

describe('weights', () => {
  it('splits proportionally when the division is exact', () => {
    const r = computeSplit(1000, split({
      poolPercent: 100,
      beneficiaries: [{ ghii: 'a@n', weight: 3, note: '' }, { ghii: 'b@n', weight: 1, note: '' }],
    }));
    expect(r.lines.find(l => l.ghii === 'a@n')?.amount).toBe(750);
    expect(r.lines.find(l => l.ghii === 'b@n')?.amount).toBe(250);
  });

  it('largest remainder hands the leftover to whoever lost most to the floor', () => {
    // 100 across three equal parties: 33.33 each, floors to 99, one unit left over.
    const r = computeSplit(100, split({
      poolPercent: 100,
      beneficiaries: ['a', 'b', 'c'].map(n => ({ ghii: `${n}@n`, weight: 1, note: '' })),
    }));
    expect(sum(r.lines.map(l => l.amount))).toBe(100);
    expect(r.lines.map(l => l.amount).sort()).toEqual([33, 33, 34]);
  });

  it('is deterministic — the same call divides the same way every time', () => {
    const s = split({ poolPercent: 100, beneficiaries: ['a', 'b', 'c'].map(n => ({ ghii: `${n}@n`, weight: 1, note: '' })) });
    const first = computeSplit(100, s).lines.map(l => `${l.ghii}:${l.amount}`);
    for (let i = 0; i < 20; i++) {
      expect(computeSplit(100, s).lines.map(l => `${l.ghii}:${l.amount}`)).toEqual(first);
    }
  });
});

describe('who is in the pool', () => {
  const dyn = (ghii: string, weight?: number): DynamicDesignation => ({ ghii, weight });

  it('ignores per-call designations unless the split is dynamic', () => {
    const r = computeSplit(1000, split({ poolPercent: 100, dynamic: false }), [dyn('z@n')]);
    expect(r.lines.map(l => l.ghii)).toEqual(['a@n']);
  });

  it('adds per-call designations when it is', () => {
    const r = computeSplit(1000, split({ poolPercent: 100, dynamic: true }), [dyn('z@n')]);
    expect(r.lines.map(l => l.ghii).sort()).toEqual(['a@n', 'z@n']);
    expect(sum(r.lines.map(l => l.amount))).toBe(1000);
  });

  it('the same party named statically and dynamically is one creditor, not two', () => {
    const r = computeSplit(1000, split({ poolPercent: 100, dynamic: true }), [dyn('a@n', 3)]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.amount).toBe(1000);
    expect(r.lines[0]!.weight).toBe(4);
  });

  it('a dynamic split whose call designated nobody leaves the whole cut with the provider', () => {
    const r = computeSplit(1000, split({ poolPercent: 70, dynamic: true, beneficiaries: [] }), []);
    expect(r.pool).toBe(0);
    expect(r.providerNet).toBe(1000);
    expect(r.lines).toEqual([]);
  });

  it('drops rows that cannot be paid rather than failing the call', () => {
    const r = computeSplit(1000, split({ poolPercent: 100, dynamic: true }), [
      dyn('', 5), dyn('ok@n', 0), dyn('ok2@n', -3), dyn('good@n', 1),
    ]);
    expect(r.lines.map(l => l.ghii).sort()).toEqual(['a@n', 'good@n']);
  });
});

describe('the cases where nothing is shared', () => {
  it('no split declared', () => {
    expect(computeSplit(1000, null)).toEqual({ pool: 0, lines: [], providerNet: 1000 });
  });
  it('paused', () => {
    expect(computeSplit(1000, split({ state: 'paused' })).pool).toBe(0);
  });
  it('zero percent', () => {
    expect(computeSplit(1000, split({ poolPercent: 0 })).pool).toBe(0);
  });
  it('a free call has nothing to divide', () => {
    expect(computeSplit(0, split())).toEqual({ pool: 0, lines: [], providerNet: 0 });
  });
  it('a negative gross cannot become a payout', () => {
    expect(computeSplit(-500, split()).pool).toBe(0);
  });
});
