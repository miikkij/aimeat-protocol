/**
 * @file test/unit/app-size-health.test.ts
 * @description Does the publish response say something true about how big an app has become?
 *
 *   THE NUMBERS BELOW ARE REAL. The growth line is Fatalii's Drum Sample Slicer as the production
 *   node holds it: version 369 at 3 178 694 bytes on 2026-08-25, back through 3 176 869, 3 164 429,
 *   3 138 288, 3 126 898, 3 096 690, 3 092 412, 3 050 884, 2 999 449 on 2026-08-24. That app is why
 *   this exists — its author felt the slowdown for two days before anyone could name it — so the
 *   test that matters is whether it would have been warned, and when.
 *
 *   The quiet case is asserted just as hard. The median app on that node is 39 kB, and a response
 *   that lectures 130 authors to reach one is a response people stop reading.
 * @usage pnpm test -- app-size-health
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { appSizeHealth } from '../../src/services/app-size-health.js';
import type { AppVersionSize } from '../../src/storage/interface.js';

const MB = 1024 * 1024;
const CEILING = 5 * MB;

/** The real version line, newest first. */
const SLICER: AppVersionSize[] = [
  { versionNumber: 369, size: 3178694, createdAt: '2026-08-25T13:39:42.314Z' },
  { versionNumber: 368, size: 3176869, createdAt: '2026-08-25T13:30:06.720Z' },
  { versionNumber: 367, size: 3164429, createdAt: '2026-08-25T12:32:15.385Z' },
  { versionNumber: 366, size: 3164429, createdAt: '2026-08-25T12:26:45.834Z' },
  { versionNumber: 365, size: 3138288, createdAt: '2026-08-25T10:04:03.662Z' },
  { versionNumber: 364, size: 3126898, createdAt: '2026-08-25T09:18:07.352Z' },
  { versionNumber: 363, size: 3096690, createdAt: '2026-08-24T21:27:04.571Z' },
  { versionNumber: 362, size: 3092412, createdAt: '2026-08-24T20:14:47.232Z' },
  { versionNumber: 361, size: 3050884, createdAt: '2026-08-24T16:21:31.609Z' },
  { versionNumber: 360, size: 2999449, createdAt: '2026-08-24T13:15:04.313Z' },
];

describe('the app that prompted this', () => {
  const health = appSizeHealth({
    bytes: 3178694, ceilingBytes: CEILING, history: SLICER, at: '2026-08-25T13:39:42.314Z',
  });

  it('states where it stands against the ceiling', () => {
    expect(health.bytes).toBe(3178694);
    expect(health.share_of_ceiling).toBe(0.61);
    expect(health.ceiling_bytes).toBe(CEILING);
  });

  it('measures the growth rate over days rather than over publishes', () => {
    // 179 245 bytes across just over a day, whatever the number of publishes in it.
    expect(health.per_day_bytes).toBeGreaterThan(100_000);
    expect(health.measured_days).toBeGreaterThanOrEqual(1);
    expect(health.measured_versions).toBe(10);
  });

  it('names the day this rate meets the ceiling', () => {
    expect(health.full_on).toMatch(/^2026-09-/);
  });

  it('speaks, and says what to do rather than only what is wrong', () => {
    expect(health.level).toBe('warn');
    expect(health.note).toContain('3.03 MB');
    expect(health.note).toContain('61%');
    expect(health.note).toMatch(/storage/);
    expect(health.note).toContain('node:aimeat-app-workstation');
  });

  it('reports the step this publish added', () => {
    expect(health.grew_bytes).toBe(1825);
  });
});

describe('a week earlier, when it was still cheap to act', () => {
  // 2026-08-18: 2.42 MB, growing about 200 kB a day. Under half the ceiling, so the ceiling alone
  // says nothing — the rate is what has to speak.
  const week: AppVersionSize[] = [
    { versionNumber: 300, size: 2_620_000, createdAt: '2026-08-18T22:00:00.000Z' },
    { versionNumber: 299, size: 2_540_000, createdAt: '2026-08-18T12:00:00.000Z' },
    { versionNumber: 298, size: 2_420_000, createdAt: '2026-08-17T22:00:00.000Z' },
  ];
  const health = appSizeHealth({ bytes: 2_620_000, ceilingBytes: CEILING, history: week, at: '2026-08-18T22:00:00.000Z' });

  it('warns on the rate although the size alone would not', () => {
    expect(health.share_of_ceiling).toBeLessThan(0.6);
    expect(health.level).toBe('warn');
    expect(health.note).toBeDefined();
  });
});

describe('the median app on the node says nothing at all', () => {
  const small: AppVersionSize[] = [
    { versionNumber: 12, size: 39_000, createdAt: '2026-08-25T10:00:00.000Z' },
    { versionNumber: 11, size: 37_500, createdAt: '2026-08-23T10:00:00.000Z' },
  ];
  const health = appSizeHealth({ bytes: 39_000, ceilingBytes: CEILING, history: small, at: '2026-08-25T10:00:00.000Z' });

  it('is quiet, and still carries the numbers', () => {
    expect(health.level).toBe('quiet');
    expect(health.note).toBeUndefined();
    expect(health.share_of_ceiling).toBe(0.01);
    expect(health.grew_bytes).toBe(1500);
  });
});

describe('what it does when it cannot measure', () => {
  it('a first publish has a share and no rate', () => {
    const health = appSizeHealth({ bytes: 120_000, ceilingBytes: CEILING, history: [], at: '2026-08-25T10:00:00.000Z' });
    expect(health.share_of_ceiling).toBe(0.02);
    expect(health.grew_bytes).toBeUndefined();
    expect(health.per_day_bytes).toBeUndefined();
    expect(health.level).toBe('quiet');
  });

  it('two publishes an hour apart do not become a daily rate', () => {
    const health = appSizeHealth({
      bytes: 900_000, ceilingBytes: CEILING, at: '2026-08-25T11:00:00.000Z',
      history: [
        { versionNumber: 2, size: 900_000, createdAt: '2026-08-25T11:00:00.000Z' },
        { versionNumber: 1, size: 400_000, createdAt: '2026-08-25T10:00:00.000Z' },
      ],
    });
    expect(health.per_day_bytes).toBeUndefined();
    expect(health.full_on).toBeUndefined();
    expect(health.grew_bytes).toBe(500_000);
  });

  it('an app that stopped growing still hears about its size', () => {
    const flat: AppVersionSize[] = [
      { versionNumber: 40, size: 4_800_000, createdAt: '2026-08-25T10:00:00.000Z' },
      { versionNumber: 39, size: 4_800_000, createdAt: '2026-08-01T10:00:00.000Z' },
    ];
    const health = appSizeHealth({ bytes: 4_800_000, ceilingBytes: CEILING, history: flat, at: '2026-08-25T10:00:00.000Z' });
    expect(health.per_day_bytes).toBeUndefined();
    expect(health.level).toBe('at-the-wall');
    expect(health.note).toContain('may be refused');
  });

  it('a caller that asks before the row exists gets the same answer', () => {
    const withRow = appSizeHealth({ bytes: 3178694, ceilingBytes: CEILING, history: SLICER, at: '2026-08-25T13:39:42.314Z' });
    const withoutRow = appSizeHealth({
      bytes: 3178694, ceilingBytes: CEILING, history: SLICER.slice(1), at: '2026-08-25T13:39:42.314Z',
    });
    expect(withoutRow.grew_bytes).toBe(withRow.grew_bytes);
    expect(withoutRow.level).toBe(withRow.level);
  });
});
