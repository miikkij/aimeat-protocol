/**
 * @file test/unit/acceptance-criteria.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules of an acceptance-criteria list (src/services/app/acceptance-criteria.ts):
 *   shapes and bounds, evidence for an evidenced line and a reason for a waived one, the stamps a
 *   line keeps while it does not change, and which lines a write newly waives.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-acceptance-criteria-in-the-design-spec-checked-at-publish).
 */
import { describe, expect, it } from 'vitest';
import { checkCriteria, criteriaCounts, openCriteriaIds, type AppCriterion } from '../../src/services/app/acceptance-criteria.js';

const ALICE = 'alice@node';
const at = (by: string, appVersion: number, now: string) => ({ by, appVersion, now });

describe('checkCriteria', () => {
  it('refuses what is not a list, a bad id, a repeated id, a missing text and an unknown check or status', () => {
    expect(checkCriteria('x', [], at(ALICE, 1, 't'))).toMatchObject({ ok: false });
    expect(checkCriteria([{ id: 'Bad Id', text: 'x', check: 'person' }], [], at(ALICE, 1, 't'))).toMatchObject({ ok: false });
    expect(checkCriteria([{ id: 'a', text: 'x', check: 'person' }, { id: 'a', text: 'y', check: 'person' }], [], at(ALICE, 1, 't'))).toMatchObject({ ok: false });
    expect(checkCriteria([{ id: 'a', text: '', check: 'person' }], [], at(ALICE, 1, 't'))).toMatchObject({ ok: false });
    expect(checkCriteria([{ id: 'a', text: 'x', check: 'vibes' }], [], at(ALICE, 1, 't'))).toMatchObject({ ok: false });
    expect(checkCriteria([{ id: 'a', text: 'x', check: 'person', status: 'done' }], [], at(ALICE, 1, 't'))).toMatchObject({ ok: false });
    expect(checkCriteria(Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, text: 'x', check: 'person' })), [], at(ALICE, 1, 't'))).toMatchObject({ ok: false });
  });

  it('asks evidence of an evidenced line and a reason of a waived one', () => {
    const noEvidence = checkCriteria([{ id: 'a', text: 'x', check: 'scenario', status: 'evidenced' }], [], at(ALICE, 1, 't'));
    expect(noEvidence.ok).toBe(false);
    if (!noEvidence.ok) expect(noEvidence.message).toContain('evidence');
    const noReason = checkCriteria([{ id: 'a', text: 'x', check: 'person', status: 'waived' }], [], at(ALICE, 1, 't'));
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.message).toContain('waived_reason');
  });

  it('defaults a line to open, and stamps a line that became evidenced or waived', () => {
    const out = checkCriteria([
      { id: 'empty-state', text: 'An empty list says how to add the first item.', check: 'screenshot' },
      { id: 'phone', text: 'Works at 390 px.', check: 'scenario', status: 'evidenced', evidence: 'scenario phone passed' },
      { id: 'offline', text: 'Works offline.', check: 'person', status: 'waived', waived_reason: 'Not in this release.' },
    ], [], at(ALICE, 3, '2026-11-26T00:00:00Z'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.criteria[0].status).toBe('open');
    expect(out.criteria[1]).toMatchObject({ evidencedBy: ALICE, evidencedVersion: 3, evidencedAt: '2026-11-26T00:00:00Z' });
    expect(out.criteria[2]).toMatchObject({ waivedBy: ALICE, waivedReason: 'Not in this release.' });
    expect(out.newlyWaived).toEqual(['offline']);
  });

  it('keeps the stamps of a line that did not change, so a builder rewriting the list does not take over a waiver', () => {
    const live: AppCriterion[] = [
      { id: 'offline', text: 'Works offline.', check: 'person', status: 'waived', waivedReason: 'Later.', waivedBy: ALICE, waivedAt: 't0' },
      { id: 'phone', text: 'Works at 390 px.', check: 'scenario', status: 'evidenced', evidence: 'ok', evidencedBy: ALICE, evidencedAt: 't0', evidencedVersion: 2 },
    ];
    const out = checkCriteria([
      { id: 'offline', text: 'Works offline.', check: 'person', status: 'waived', waived_reason: 'Later.' },
      { id: 'phone', text: 'Works at 390 px.', check: 'scenario', status: 'evidenced', evidence: 'ok' },
    ], live, at('bob#bob@node', 5, 't1'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.newlyWaived).toEqual([]);
    expect(out.criteria[0]).toMatchObject({ waivedBy: ALICE, waivedAt: 't0' });
    expect(out.criteria[1]).toMatchObject({ evidencedBy: ALICE, evidencedVersion: 2 });
  });

  it('counts the lines and names the open ones in order', () => {
    const list: AppCriterion[] = [
      { id: 'a', text: 'x', check: 'person', status: 'open' },
      { id: 'b', text: 'x', check: 'person', status: 'evidenced', evidence: 'y' },
      { id: 'c', text: 'x', check: 'person', status: 'open' },
    ];
    expect(criteriaCounts(list)).toEqual({ open: 2, evidenced: 1, waived: 0, total: 3 });
    expect(openCriteriaIds({ criteria: list })).toEqual(['a', 'c']);
    expect(openCriteriaIds(null)).toEqual([]);
  });
});
