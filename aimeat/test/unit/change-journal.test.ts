/**
 * @file test/unit/change-journal.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The change journal a reopened live stream catches up from: the entries after a
 *   position, nothing when nothing changed, and null for every position it cannot answer for (another
 *   boot, a number it never gave, one older than what it keeps), which makes the page reload all.
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (performance work, architecture item 6).
 */
import { describe, it, expect } from 'vitest';
import { createChangeJournal } from '../../src/services/live/change-journal.js';

describe('createChangeJournal', () => {
  it('gives the entries after a position, oldest first, with what each event named', () => {
    const j = createChangeJournal({ boot: 'b1' });
    j.record({ domain: 'memory', ownerGaii: 'alice@n' });
    const at = j.position();
    expect(at).toBe('b1.1');
    j.record({ domain: 'messages', ownerGaii: 'alice@n' });
    j.record({ domain: 'organisms', organismId: 'org-1' });
    expect(j.since(at)).toEqual([
      { seq: 2, domain: 'messages', ownerGaii: 'alice@n', organismId: undefined },
      { seq: 3, domain: 'organisms', ownerGaii: undefined, organismId: 'org-1' },
    ]);
    expect(j.since(j.position())).toEqual([]);
  });

  it('answers a fresh journal\'s own position with nothing changed', () => {
    const j = createChangeJournal({ boot: 'b1' });
    expect(j.since(j.position())).toEqual([]);
  });

  it('cannot answer for another boot, a number it never gave, or a malformed position', () => {
    const j = createChangeJournal({ boot: 'b1' });
    j.record({ domain: 'memory' });
    expect(j.since('b2.1')).toBeNull();
    expect(j.since('b1.9')).toBeNull();
    expect(j.since('b1.x')).toBeNull();
    expect(j.since('')).toBeNull();
  });

  it('cannot answer for a position older than the entries it keeps', () => {
    const j = createChangeJournal({ boot: 'b1', max: 3 });
    for (let i = 0; i < 5; i++) j.record({ domain: `d${i}` });
    // Kept: seq 3, 4, 5. A page at 2 missed nothing it cannot be told; at 1 it missed seq 2.
    expect(j.since('b1.2')?.map(e => e.seq)).toEqual([3, 4, 5]);
    expect(j.since('b1.1')).toBeNull();
  });
});
