/**
 * @file portal-work-service.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The portal's work service (public/js/services/work.js) sends the bodies the work routes
 *   read (src/routes/work.ts, WorkRatingSchema and WorkDeliverySchema in src/models/schemas.ts). The
 *   rate route takes rating 'positive' or 'negative', and the Work tab's rate dialog gives one to five
 *   stars: four and five are positive, as services/trust.ts counts a stored score of 4 or more. The
 *   deliver route reads output; the portal sends the delivery dialog's text there as a string.
 * @usage cd aimeat && pnpm exec vitest run test/unit/portal-work-service.test.ts
 * @version-history
 *   v1.1.0 - 2026-11-15 - deliverWork sends output, not result.
 *   v1.0.0 - 2026-11-15 - Initial: the rating is positive or negative, never the star count.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const sent: Array<{ path: string; body: unknown }> = [];
vi.mock('/js/api.js', () => ({
  apiGet: vi.fn(),
  api: vi.fn(async (path: string, opts: { body?: string }) => { sent.push({ path, body: opts?.body ? JSON.parse(opts.body) : undefined }); return { ok: true }; }),
}));

beforeEach(() => { sent.length = 0; });

describe('portal work service: submitRating', () => {
  it('sends positive for four and five stars, negative for one to three', async () => {
    const work = await import('../../public/js/services/work.js');
    for (const stars of [1, 2, 3, 4, 5]) await work.submitRating('tc-1', stars, 'ok');
    expect(sent.map(s => s.path)).toEqual(Array(5).fill('/v1/work/tc-1/rate'));
    expect(sent.map(s => s.body)).toEqual([
      { rating: 'negative', comment: 'ok' },
      { rating: 'negative', comment: 'ok' },
      { rating: 'negative', comment: 'ok' },
      { rating: 'positive', comment: 'ok' },
      { rating: 'positive', comment: 'ok' },
    ]);
  });
});

describe('portal work service: deliverWork', () => {
  it('sends the delivered text as output, the field POST /v1/work/:tc/deliver reads', async () => {
    const work = await import('../../public/js/services/work.js');
    await work.deliverWork('tc-2', 'The translation is attached.');
    expect(sent).toEqual([{ path: '/v1/work/tc-2/deliver', body: { output: 'The translation is attached.' } }]);
  });
});
