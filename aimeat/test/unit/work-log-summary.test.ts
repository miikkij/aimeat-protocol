/**
 * @file test/unit/work-log-summary.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chat's "What was done" summary (public/components/WorkLog.js workSummary): a step the
 *   agent got past is not shown as a failure under an answer that came, and "One step did not go through"
 *   is said only when nothing in the turn finished (commercial's crew62 check, 2026-11-02).
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { workSummary } from '../../public/components/WorkLog.js';

const call = (title: string, status: string) => ({ title, status });

describe('workSummary', () => {
  it('leaves a kind that only failed out of the line, and says nothing failed when another step finished', () => {
    const out = workSummary([
      call('aimeat: aimeat tools find', 'completed'),
      call('aimeat: aimeat do something', 'failed'),
      call('aimeat: aimeat agents list', 'completed'),
    ], true);
    expect(out.kinds.map((k: { kind: string }) => k.kind)).toEqual(['find', 'read']);
    expect(out.stuck).toBe(false);
  });

  it('says one step did not go through when nothing in the turn finished', () => {
    const out = workSummary([call('aimeat: aimeat do something', 'failed')], true);
    expect(out.kinds).toEqual([]);
    expect(out.stuck).toBe(true);
  });

  it('keeps a kind that failed once and then finished, with its tick', () => {
    const out = workSummary([
      call('aimeat: aimeat memory read', 'failed'),
      call('aimeat: aimeat memory read', 'completed'),
    ], true);
    expect(out.kinds).toEqual([{ kind: 'read', done: true, running: false }]);
    expect(out.stuck).toBe(false);
  });
});
