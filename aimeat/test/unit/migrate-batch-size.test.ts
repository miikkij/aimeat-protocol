/**
 * @file test/unit/migrate-batch-size.test.ts
 * @description One press may only carry what the other end will accept.
 *
 *   TWO CAPS SAT ON ONE JOURNEY AND DID NOT KNOW ABOUT EACH OTHER. The migration press batched to
 *   `agentMigrateMaxPerPress` (50); the enrol route refuses more than `MAX_CARDS_PER_SUBMIT` (20)
 *   cards in one submission. So the connector built fifty cards, this node refused them in nought
 *   seconds, and the owner was told "your connector refused the move" — the wrong party, for a
 *   refusal made here.
 *
 *   Measured on a real 68-agent account on 2026-09-04: fifty-one movable, the button dead, and ten
 *   at a time working the entire time. That is the shape that makes this worth a test rather than a
 *   comment: neither number was wrong, and nobody had reconciled them.
 *
 *   The last assertion is the one that matters in a year. It does not check a value, it checks the
 *   RELATIONSHIP — so raising either cap on its own cannot quietly restore the defect.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, with the clamp it exists to hold.
 */
import { describe, it, expect } from 'vitest';
import { migrateBatchSize } from '../../src/routes/agents-v2/migrate.js';
import { MAX_CARDS_PER_SUBMIT } from '../../src/routes/agents-v2/enrolment.js';

describe('how many agents one migration press carries', () => {
  it('never exceeds what the enrol route will accept', () => {
    // The configured default is 50 and the enrol route takes 20. This is the exact case that broke.
    expect(migrateBatchSize(50)).toBe(MAX_CARDS_PER_SUBMIT);
  });

  it('honours a smaller configured cap, because that one is a deliberate choice', () => {
    expect(migrateBatchSize(5)).toBe(5);
  });

  it('never returns zero, whatever an operator writes in the config', () => {
    // A cap of 0 would make the press a no-op that reports success, which is worse than a refusal.
    expect(migrateBatchSize(0)).toBe(1);
    expect(migrateBatchSize(-10)).toBe(1);
  });

  it('is bounded by the enrol cap for every configured value', () => {
    for (const configured of [1, 19, 20, 21, 50, 1000]) {
      expect(migrateBatchSize(configured)).toBeLessThanOrEqual(MAX_CARDS_PER_SUBMIT);
      expect(migrateBatchSize(configured)).toBeGreaterThanOrEqual(1);
    }
  });
});
