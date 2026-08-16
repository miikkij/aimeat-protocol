/**
 * @file account-events.test.ts
 * @description The per-owner event window and its archive, driven against real in-memory SQLite.
 *
 *   The property this file exists for is the WINDOW: the last 100 are always one indexed read, and
 *   everything past that moves to the archive rather than being deleted. An event that scrolled out
 *   of view is still a fact, and a feed that quietly destroys history is worse than no feed.
 *
 *   It also pins the two rules that make the feed readable: `kind` is a key and never a sentence,
 *   and one owner never sees another's events.
 * @usage cd aimeat && pnpm exec vitest run test/unit/account-events.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AccountEventKind } from '../../src/storage/interface.js';
import {
  recordAccountEvent, readAccountEvents, readAccountEventArchive, KEEP_HOT, windowSize,
} from '../../src/services/account-events.js';

const ALICE = 'alice@node';
const BOB = 'bob@node';
let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

/** `at` is supplied so ordering is deterministic rather than dependent on how fast the test runs. */
function at(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + n * 1000).toISOString();
}

async function seed(count: number, owner = ALICE, kind: AccountEventKind = 'app_published'): Promise<void> {
  for (let i = 0; i < count; i++) {
    await recordAccountEvent(storage, {
      ownerGhii: owner, kind, at: at(i), data: { name: `app-${i}` },
    });
  }
}

describe('the window', () => {
  it('keeps the newest KEEP_HOT and nothing more', async () => {
    await seed(KEEP_HOT + 12);
    const hot = await readAccountEvents(storage, ALICE, { limit: 500 });
    expect(hot).toHaveLength(KEEP_HOT);
    // Newest first, and the newest really is the last one written.
    expect(hot[0].data.name).toBe(`app-${KEEP_HOT + 11}`);
  });

  it('moves the overflow to the archive rather than deleting it', async () => {
    await seed(KEEP_HOT + 12);
    const archived = await readAccountEventArchive(storage, ALICE, { limit: 500 });
    expect(archived).toHaveLength(12);
    // The oldest twelve, which is exactly what fell out of the window.
    expect(archived.map(a => a.data.name).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `app-${i}`).sort(),
    );
    expect(await storage.countAccountEventArchive(ALICE)).toBe(12);
  });

  it('loses nothing: hot plus archive is everything that happened', async () => {
    const total = KEEP_HOT + 37;
    await seed(total);
    const hot = await readAccountEvents(storage, ALICE, { limit: 500 });
    const cold = await readAccountEventArchive(storage, ALICE, { limit: 500 });
    const names = new Set([...hot, ...cold].map(e => e.data.name));
    expect(names.size).toBe(total);
  });

  it('does not archive anything while the window is not full', async () => {
    await seed(5);
    expect(await readAccountEvents(storage, ALICE, { limit: 500 })).toHaveLength(5);
    expect(await storage.countAccountEventArchive(ALICE)).toBe(0);
  });
});

describe('what a row carries', () => {
  it('round-trips the key, the actor, the link and the interpolation values', async () => {
    await recordAccountEvent(storage, {
      ownerGhii: ALICE,
      kind: 'agent_task_done',
      actorGaii: 'scribe#alice@node',
      subject: 'task-9',
      link: '/v1/profile?tab=agents',
      data: { agent: 'scribe', title: 'Write the summary' },
      at: at(1),
    });
    const [row] = await readAccountEvents(storage, ALICE);
    expect(row.kind).toBe('agent_task_done');
    expect(row.actorGaii).toBe('scribe#alice@node');
    expect(row.subject).toBe('task-9');
    expect(row.link).toBe('/v1/profile?tab=agents');
    expect(row.data).toEqual({ agent: 'scribe', title: 'Write the summary' });
  });

  it('stores a KEY, never a sentence', async () => {
    // The node does not decide which language the person reads. If a row ever carried prose, a
    // translation would become a data migration.
    await seed(3);
    const rows = await readAccountEvents(storage, ALICE);
    for (const r of rows) {
      expect(r.kind).not.toMatch(/\s/);
      expect(r.kind).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('owner scoping', () => {
  it('never returns another owner events', async () => {
    await seed(4, ALICE);
    await seed(7, BOB);
    expect(await readAccountEvents(storage, ALICE, { limit: 500 })).toHaveLength(4);
    expect(await readAccountEvents(storage, BOB, { limit: 500 })).toHaveLength(7);
  });

  it('trims one owner window without touching another', async () => {
    await seed(KEEP_HOT + 5, ALICE);
    await seed(3, BOB);
    expect(await readAccountEvents(storage, BOB, { limit: 500 })).toHaveLength(3);
    expect(await storage.countAccountEventArchive(BOB)).toBe(0);
    expect(await storage.countAccountEventArchive(ALICE)).toBe(5);
  });
});

describe('recording never breaks the thing it reports', () => {
  it('resolves rather than throwing when storage refuses the write', async () => {
    // The caller's work has already succeeded by the time this runs. A feed row is not worth
    // failing a published app for.
    const broken = {
      appendAccountEvent: () => Promise.reject(new Error('disk on fire')),
      trimAccountEvents: () => Promise.resolve({ archived: 0 }),
    } as unknown as Storage;
    await expect(recordAccountEvent(broken, { ownerGhii: ALICE, kind: 'app_published' }))
      .resolves.toBeUndefined();
  });

  it('keeps the event when only the trim fails', async () => {
    let appended = 0;
    const halfBroken = {
      appendAccountEvent: () => { appended++; return Promise.resolve(); },
      trimAccountEvents: () => Promise.reject(new Error('trim exploded')),
    } as unknown as Storage;
    await expect(recordAccountEvent(halfBroken, { ownerGhii: ALICE, kind: 'app_published' }))
      .resolves.toBeUndefined();
    // An over-long window is cosmetic; a lost event is not.
    expect(appended).toBe(1);
  });
});

describe('the window is the operator decision', () => {
  it('uses the configured size instead of the default', async () => {
    const config = { accountEventWindow: 12 };
    for (let i = 0; i < 20; i++) {
      await recordAccountEvent(storage, {
        ownerGhii: ALICE, kind: 'app_published', at: at(i), data: { name: `app-${i}` },
      }, config);
    }
    expect(await readAccountEvents(storage, ALICE, { limit: 500 }, config)).toHaveLength(12);
    expect(await storage.countAccountEventArchive(ALICE)).toBe(8);
  });

  it('clamps a nonsense number rather than trusting it', async () => {
    // The config schema validates 10..10000, but a caller can hand this function anything, and a
    // window of 0 would archive every event the moment it was written.
    expect(windowSize({ accountEventWindow: 0 })).toBe(10);
    expect(windowSize({ accountEventWindow: 999_999 })).toBe(10_000);
    expect(windowSize(undefined)).toBe(KEEP_HOT);
  });
});
