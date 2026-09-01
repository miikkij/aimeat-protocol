/**
 * @file fee-parity.test.ts
 * @description The operator's cut is the same whether the buyer has an account here or not.
 *
 *   WHY THIS IS A TEST AND NOT A COMMENT. There are two roads to a money sale now — the checkout
 *   session, and the A2A door where a buyer from another node pays with x402 and holds no session.
 *   The second one shipped with `fee: 0`, named in its own comment as a gap. A lower rate on the
 *   foreign road makes "have no account on this node" the cheapest way to buy, which is the
 *   incentive this product least wants to create, and the way that comes back is not somebody
 *   deciding it: it is somebody editing one formula and not the other.
 *
 *   SO THE PROPERTY IS EQUALITY, not a number. The test never asserts "the fee is 2%" — that is the
 *   operator's setting and it may be anything. It asserts that both roads read the SAME
 *   configuration value through the SAME function and produce the SAME number for the same amount,
 *   across rates and amounts including the ones where rounding could differ.
 *
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the A2A fee decision (Agent v2, V6a).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { percentFee } from '../../src/commerce/money.js';
import { commerceFeePercent } from '../../src/services/marketplace-fee.js';
import type { AimeatConfig } from '../../src/config.js';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

/** A config carrying only what the fee policy reads. */
function configWith(commerce: number | null, marketplace: number | null): AimeatConfig {
    return { commerceFeePercent: commerce, marketplaceTransactionFeePercent: marketplace } as unknown as AimeatConfig;
}

/**
 * The two roads, as the two call sites actually spell them.
 *
 * `completeSession` does `percentFee(gross, commerceFeePercent(config))` per line; the A2A handler
 * does `percentFee(priced.price.amount, commerceFeePercent(this.config))`. Both are reproduced here
 * as the expressions they are, so this test fails if either call site is changed to something else
 * — which is checked separately below by reading the sources.
 */
const checkoutRoad = (gross: number, config: AimeatConfig) => percentFee(gross, commerceFeePercent(config));
const a2aRoad = (gross: number, config: AimeatConfig) => percentFee(gross, commerceFeePercent(config));

describe('the platform fee does not depend on whether the buyer has an account here', () => {
    const rates: Array<[number | null, number | null]> = [
        [2, null],        // the node's own commerce knob
        [5, 12],          // commerce set, marketplace ignored
        [null, 7],        // commerce unset, inherits marketplace
        [null, null],     // neither set: the 5 % default
        [0, null],        // an operator who takes nothing takes nothing on both roads
        [100, null],      // the absurd end, where a difference would be loudest
    ];
    // Amounts in money micros, chosen around the rounding boundaries: a fee formula that floors on
    // one road and rounds on the other agrees on 1_000_000 and disagrees on 333_333.
    const amounts = [0, 1, 7, 333_333, 999_999, 1_000_000, 2_500_000, 999_999_999];

    for (const [commerce, marketplace] of rates) {
        const config = configWith(commerce, marketplace);
        it(`agrees at commerce=${commerce} marketplace=${marketplace}`, () => {
            for (const gross of amounts) {
                expect(a2aRoad(gross, config)).toBe(checkoutRoad(gross, config));
            }
        });
    }

    it('and the rate is a real one, so equality is not two zeroes agreeing', () => {
        // Both roads returning 0 for everything would pass every assertion above. This is the one
        // that says the mechanism is live.
        const config = configWith(2, null);
        expect(a2aRoad(2_500_000, config)).toBe(50_000);
        expect(checkoutRoad(2_500_000, config)).toBe(50_000);
    });
});

describe('both call sites read the same configuration value', () => {
    // Equality of two expressions in THIS file proves nothing if a call site stopped using them.
    // Reading the sources is what ties the test to the code: it is not a grep for correctness, it
    // is a grep for "is this still the same function", which is exactly what a string can answer.
    it('the checkout fee leg calls commerceFeePercent', () => {
        expect(read('commerce/session-service.ts')).toContain('percentFee(args.gross, commerceFeePercent(config))');
    });

    it('the A2A foreign handler calls commerceFeePercent', () => {
        expect(read('services/a2a-foreign-handler.ts'))
            .toContain('percentFee(priced.price.amount, commerceFeePercent(this.config))');
    });

    it('and neither has grown a second percentage of its own', () => {
        for (const file of ['commerce/session-service.ts', 'services/a2a-foreign-handler.ts']) {
            const src = read(file);
            // A literal percentage next to the word fee is the shape this test exists to refuse.
            expect(src).not.toMatch(/fee\s*=\s*[^;\n]*\*\s*0?\.\d/);
        }
    });
});
