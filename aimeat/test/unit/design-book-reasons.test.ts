/**
 * @file test/unit/design-book-reasons.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The builder's reasons against SqliteStorage(':memory:'): writing down, counting and
 *   keeping are three different things; a rebuild replaces its own row; a private app tells the
 *   Book nothing; a thrown-away version keeps its reasons with its owner.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { DesignBookReasons, OWNER_NOTES_PREFIX } from '../../src/services/design-book/reasons.js';

const config = { nodeId: 'node-test', baseUrl: 'http://localhost' } as AimeatConfig;
const ALICE = { ownerGhii: 'alice@node-test', ownerName: 'alice' };
const BOB = { ownerGhii: 'bob@node-test', ownerName: 'bob' };
let storage: Storage;
let reasons: DesignBookReasons;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  reasons = new DesignBookReasons(storage, config);
});

const notes = (why: string) => ({
  took: [{ part: 'leiska-dashboard', why }],
  passed: [{ part: 'leiska-work-queue', why: 'a queue has states; habits have none' }],
  made: [{ name: 'week-grid', what: 'seven tappable days per habit', why: 'the Book has no grid of days' }],
});
const version = (who: typeof ALICE, filename: string, v: number, why: string, shareable = true) =>
  reasons.record({ ...who, filename, version: v, notes: notes(why), level: 'fine', register: 'genre-almanac', shareable });

describe('DesignBookReasons', () => {
  it('taken counts builders reaching for a part; kept counts apps somebody was satisfied with', async () => {
    await version(ALICE, 'habits.html', 1, 'numbers over one list');
    await version(BOB, 'chores.html', 1, 'the name matched');
    let part = await reasons.forPart('leiska-dashboard');
    expect([part.taken, part.kept]).toEqual([2, 0]);

    const harvest = await reasons.keep({ ...ALICE, filename: 'habits.html', kept: true });
    expect(harvest?.version).toBe(1);
    expect(harvest?.made[0].name).toBe('week-grid');
    part = await reasons.forPart('leiska-dashboard');
    expect([part.taken, part.kept]).toEqual([2, 1]);
    expect(part.took.find(r => r.app === 'alice/habits.html')?.kept).toBe(true);

    await reasons.keep({ ...ALICE, filename: 'habits.html', kept: false });
    expect((await reasons.forPart('leiska-dashboard')).kept).toBe(0);
  });

  it('a rebuild replaces its own row, is not yet kept, and the owner keeps every version\'s reasons', async () => {
    await version(ALICE, 'habits.html', 1, 'first try');
    await reasons.keep({ ...ALICE, filename: 'habits.html', kept: true });
    await version(ALICE, 'habits.html', 2, 'second try, after the first was thrown away');
    const part = await reasons.forPart('leiska-dashboard');
    expect(part.taken).toBe(1);
    expect(part.took[0]).toMatchObject({ version: 2, why: 'second try, after the first was thrown away', kept: false });

    const mine = JSON.parse((await storage.getMemory(ALICE.ownerGhii, OWNER_NOTES_PREFIX + 'habits.html'))!.value as string);
    expect(mine.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(mine.versions[0].took[0].why).toBe('first try');
  });

  it('an app nobody else may open tells the Book nothing, and its owner still has the notes', async () => {
    const out = await version(ALICE, 'private.html', 1, 'mine alone', false);
    expect(out.shared).toBe(false);
    expect((await reasons.forPart('leiska-dashboard')).taken).toBe(0);
    expect((await reasons.queue()).made).toEqual([]);
    expect(await storage.getMemory(ALICE.ownerGhii, OWNER_NOTES_PREFIX + 'private.html')).not.toBeNull();
  });

  it('the queue is what was made by hand, kept apps first, and what was most often passed over, with the words', async () => {
    await version(ALICE, 'habits.html', 1, 'a');
    await version(BOB, 'chores.html', 1, 'b');
    await reasons.keep({ ...BOB, filename: 'chores.html', kept: true });
    const q = await reasons.queue();
    expect(q.made[0]).toMatchObject({ name: 'week-grid', times: 2, kept: 1 });
    expect(q.passed_over[0]).toMatchObject({ part: 'leiska-work-queue', times: 2 });
    expect(q.passed_over[0].reasons[0].why).toMatch(/habits have none/);
  });

  it('a deleted app leaves the Book\'s records', async () => {
    await version(ALICE, 'habits.html', 1, 'a');
    await reasons.forget(ALICE.ownerGhii, 'alice', 'habits.html');
    expect((await reasons.forPart('leiska-work-queue')).passed_over).toBe(0);
    expect((await reasons.forPart('leiska-dashboard')).taken).toBe(0);
    expect((await reasons.queue()).made).toEqual([]);
  });

  it('keeping an app that wrote no notes answers null', async () => {
    expect(await reasons.keep({ ...ALICE, filename: 'nothing.html', kept: true })).toBeNull();
  });
});
