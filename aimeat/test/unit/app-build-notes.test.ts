/**
 * @file test/unit/app-build-notes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The builder's reasons, read off the page: a row without its reason is dropped and
 *   said, a malformed block never throws, and the lists are bounded.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildNotesDeclared, NOTE_LIMITS } from '../../src/services/app-build-notes.js';

const page = (body: string) => `<!DOCTYPE html><html><head><script type="application/json" id="aimeat-build-notes">${body}</script></head><body></body></html>`;

describe('buildNotesDeclared', () => {
  it('a page with no block carries no notes', () => {
    expect(buildNotesDeclared('<html><head></head><body></body></html>')).toBeNull();
  });

  it('reads the three lists', () => {
    const out = buildNotesDeclared(page(JSON.stringify({
      took: [{ part: 'leiska-dashboard', why: 'numbers over one list is this app' }],
      passed: [{ part: 'leiska-work-queue', why: 'a queue has states; habits have none' }],
      made: [{ name: 'Week Grid', what: 'seven tappable days per habit', why: 'the Book has no grid of days a person ticks' }],
    })))!;
    expect(out.problems).toEqual([]);
    expect(out.notes.took).toEqual([{ part: 'leiska-dashboard', why: 'numbers over one list is this app' }]);
    expect(out.notes.passed[0].part).toBe('leiska-work-queue');
    expect(out.notes.made[0]).toEqual({ name: 'week-grid', what: 'seven tappable days per habit', why: 'the Book has no grid of days a person ticks' });
  });

  it('a row with no reason is the bare count again, so it is dropped and said', () => {
    const out = buildNotesDeclared(page(JSON.stringify({ took: [{ part: 'leiska-dashboard' }], made: [{ name: 'week-grid', what: 'a grid' }] })))!;
    expect(out.notes.took).toEqual([]);
    expect(out.notes.made).toEqual([]);
    expect(out.problems.join(' ')).toMatch(/gives no `why`/);
    expect(out.problems.join(' ')).toMatch(/needs both `what`/);
  });

  it('a block that is not JSON, or not an object, is a problem and never a throw', () => {
    expect(buildNotesDeclared(page('{ took: '))!.problems[0]).toMatch(/is not JSON/);
    expect(buildNotesDeclared(page('[1,2]'))!.problems[0]).toMatch(/must be one object/);
    expect(buildNotesDeclared(page('{"took":"leiska-dashboard"}'))!.problems[0]).toMatch(/must be a list/);
  });

  it('the lists and the sentences are bounded', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ part: `part-${i}`, why: 'x'.repeat(2000) }));
    const out = buildNotesDeclared(page(JSON.stringify({ took: many })))!;
    expect(out.notes.took).toHaveLength(NOTE_LIMITS.rows);
    expect(out.notes.took[0].why).toHaveLength(NOTE_LIMITS.why);
    expect(out.problems[0]).toMatch(/holds 40 rows/);
  });
});
