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
import { computeSplit, type BeneficiarySplit, type BeneficiaryRole, type DynamicDesignation } from '../beneficiary-split.js';
import { percentFee } from '../money.js';

/** The amounts a proportional split is most likely to lose a unit on, plus the real kumppani price. */
const ADVERSARIAL = [1, 2, 3, 7, 11, 13, 99, 100, 101, 999, 1000, 500_000, 999_999, 1_000_000];
const PERCENTS = [1, 3, 7, 30, 33, 50, 70, 99, 100];

function split(over: Partial<BeneficiarySplit> = {}): BeneficiarySplit {
  return {
    splitId: 's1', providerGhii: 'prov@n', ext: 'kumppani', action: 'getRegisterChanges',
    capabilityLabel: 'kumppani/getRegisterChanges', mode: 'pool', poolPercent: 70, roles: [],
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

describe('roles — a value chain, where nobody dilutes anybody', () => {
  const CHAIN: BeneficiaryRole[] = [
    { role: 'levittaja', percent: 10, ghii: 'dist@n', note: '' },
    { role: 'muusikko', percent: 40, ghii: 'artist@n', note: '' },
    { role: 'levy-yhtio', percent: 20, ghii: 'label@n', note: '' },
    { role: 'kauppapaikka', percent: 30, ghii: 'shop@n', note: '' },
  ];
  const chain = (over: Partial<BeneficiarySplit> = {}) =>
    // poolPercent 0, as a real chain has: a chain divides by role, never from a pool.
    split({ mode: 'roles', poolPercent: 0, roles: CHAIN, beneficiaries: [], ...over });

  it('pays the worked example exactly: 10 EUR, 2 % rake, four roles', () => {
    const price = 10_000_000;
    const fee = percentFee(price, 2);              // 200 000
    const r = computeSplit(price - fee, chain());  // 9 800 000 to divide
    const by = (role: string) => r.lines.find(l => l.role === role)?.amount;
    expect(fee).toBe(200_000);
    expect(by('levittaja')).toBe(980_000);
    expect(by('muusikko')).toBe(3_920_000);
    expect(by('levy-yhtio')).toBe(1_960_000);
    expect(by('kauppapaikka')).toBe(2_940_000);
    expect(fee + r.providerNet + sum(r.lines.map(l => l.amount))).toBe(price);
  });

  it('an unfilled role pays nobody, and does NOT enlarge the others', () => {
    // The whole point of a chain: 40 % going unclaimed must not become somebody else's windfall.
    const filled = computeSplit(9_800_000, chain());
    const missing = computeSplit(9_800_000, chain({
      roles: CHAIN.map(r => (r.role === 'muusikko' ? { ...r, ghii: null } : r)),
    }));
    const by = (r: ReturnType<typeof computeSplit>, role: string) => r.lines.find(l => l.role === role)?.amount;
    expect(by(missing, 'muusikko')).toBeUndefined();
    for (const role of ['levittaja', 'levy-yhtio', 'kauppapaikka']) {
      expect(by(missing, role)).toBe(by(filled, role));
    }
    // The unclaimed 40 % stays with the provider rather than vanishing or being redistributed.
    expect(missing.providerNet).toBe(filled.providerNet + 3_920_000);
  });

  it('a role can be filled per call, and that wins over the standing holder', () => {
    const r = computeSplit(9_800_000, chain({ dynamic: true }),
      [{ ghii: 'guest@n', role: 'muusikko' }]);
    const artist = r.lines.find(l => l.role === 'muusikko');
    expect(artist?.ghii).toBe('guest@n');
    expect(artist?.amount).toBe(3_920_000);
    expect(artist?.kind).toBe('dynamic');
  });

  it('a per-call filling is ignored unless the split is dynamic', () => {
    const r = computeSplit(9_800_000, chain({ dynamic: false }), [{ ghii: 'guest@n', role: 'muusikko' }]);
    expect(r.lines.find(l => l.role === 'muusikko')?.ghii).toBe('artist@n');
  });

  it('conserves at every amount: the lines never exceed the cut', () => {
    for (const gross of ADVERSARIAL) {
      const r = computeSplit(gross, chain());
      expect(sum(r.lines.map(l => l.amount))).toBe(r.pool);
      expect(r.pool + r.providerNet).toBe(gross);
      expect(r.pool).toBeLessThanOrEqual(gross);
    }
  });

  it('each role floors on its own, and the residue stays with the provider', () => {
    // 7 at 10/40/20/30 is 0.7/2.8/1.4/2.1 → 0/2/1/2 = 5, and 2 stays put. The provider is the only
    // party whose share is defined as "what is left", so that is where the rounding lands.
    const r = computeSplit(7, chain());
    expect(r.lines.map(l => l.amount)).toEqual([2, 1, 2]);
    expect(r.pool).toBe(5);
    expect(r.providerNet).toBe(2);
  });
});
