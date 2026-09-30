/**
 * @file test/unit/classification-wallet-reason.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description TARGET-082 review, item 3: the Data Wallet asks for a reason in the confirm step when
 *   a person accepts a suggestion that lowers a classification which needs one, and sends it as
 *   `justification` in POST /v1/classification/label/review. acceptStep (the view's decision, ranks
 *   from the person's policy) and reviewLabel (the request) are executed as the browser runs them.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-wallet-reason.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-30 — A label of higher rank that protects less asks for the reason too, and the
 *     page's protectsLess answers as the server's weakerFields (TARGET-082 second review).
 *   v1.0.0 — 2026-09-30 — TARGET-082 review, item 3. Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_LABELS } from '../../src/services/classification/defaults.js';

const apiPost = vi.fn(async (_path: string, _body: unknown) => ({ data: { applied: true } }));
vi.mock('/js/api.js', () => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiPost: (p: string, b: unknown) => apiPost(p, b) }));

const { acceptStep, protectsLess } = await import('../../public/views/profile/data-wallet/classification.js');
const { weakerFields } = await import('../../src/services/classification/levels.js');
const { reviewLabel } = await import('../../public/js/services/classification.js');

const policy = { labels: DEFAULT_LABELS.map(l => ({ ...l })) };
const item = (now: string, suggested: string) => ({ kind: 'memory', key: 'notes.a', label: now, labelDetail: null, suggestion: { label: suggested, labelDetail: null } });

describe('TARGET-082 review, item 3: the reason for lowering a classification', () => {
  beforeEach(() => apiPost.mockClear());

  it('accepting a lowering from a classification that needs a reason asks for the reason', () => {
    const step = acceptStep(policy, item('luottamuksellinen', 'julkinen'), 'accept');
    expect(step.kind).toBe('reason');
    expect(step).toHaveProperty('words.from');
    expect(step).toHaveProperty('words.to');
  });

  it('a lowering from a classification that needs no reason asks only for a confirmation', () => {
    expect(acceptStep(policy, item('sisainen', 'julkinen'), 'accept').kind).toBe('confirm');
  });

  it('a label of higher rank that protects less counts as a lowering, as on the server', () => {
    const weak = { ...policy.labels.find(l => l.id === 'julkinen')!, id: 'heikko', rank: 500 };
    const p = { labels: [...policy.labels, weak] };
    expect(acceptStep(p, item('luottamuksellinen', 'heikko'), 'accept').kind).toBe('reason');
  });

  it('protectsLess answers as the server\'s weakerFields on every pair of default labels', () => {
    const extra = [
      { ...policy.labels[0]!, id: 'aud', audience: { roles: ['admin'] } },
      { ...policy.labels[0]!, id: 'aud2', audience: { roles: ['admin', 'member'] } },
    ];
    const all = [...policy.labels, ...extra] as never[];
    for (const a of all) for (const b of all) {
      expect(protectsLess(a, b), `${(a as { id: string }).id} vs ${(b as { id: string }).id}`).toBe(weakerFields(a, b).length > 0);
    }
  });

  it('a raise and a reject ask nothing', () => {
    expect(acceptStep(policy, item('julkinen', 'luottamuksellinen'), 'accept').kind).toBe('none');
    expect(acceptStep(policy, item('luottamuksellinen', 'julkinen'), 'reject').kind).toBe('none');
  });

  it('the ranks come from the policy, not from a brief the item may lack', () => {
    const noBriefs = { ...item('erittain-luottamuksellinen', 'sisainen'), labelDetail: undefined };
    expect(acceptStep(policy, noBriefs, 'accept').kind).toBe('reason');
  });

  it('reviewLabel sends the reason as justification, trimmed, and nothing when there is none', async () => {
    await reviewLabel({ kind: 'memory', key: 'notes.a' }, 'accept', { justification: '  Public price list.  ' });
    expect(apiPost).toHaveBeenLastCalledWith('/v1/classification/label/review',
      { kind: 'memory', key: 'notes.a', decision: 'accept', justification: 'Public price list.' });
    await reviewLabel({ kind: 'memory', key: 'notes.a' }, 'reject');
    expect(apiPost).toHaveBeenLastCalledWith('/v1/classification/label/review', { kind: 'memory', key: 'notes.a', decision: 'reject' });
  });
});
