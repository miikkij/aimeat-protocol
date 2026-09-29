/**
 * @file test/unit/classification-audit.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification audit log (TARGET-082 V4) against SqliteStorage(':memory:'): the
 *   buffer merges the same reader, item and action in one minute into one row, also across two
 *   flushes; another minute is another row; the merged read shows waiting rows at once; the list
 *   filters by owner, scope and action; the prune removes rows past the retention and keeps
 *   everything on null; the scope delete, the owner cascade and the organism delete remove the rows.
 *   Postgres mirrors these expectations (its methods are not run here).
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import {
  recordClassificationAudit, flushClassificationAudit, initClassificationAudit, shutdownClassificationAudit,
  pendingClassificationAudit, listClassificationAuditMerged, pruneClassificationAuditOlderThan,
  resetClassificationAudit, minuteOf, type ClassificationAuditEvent,
} from '../../src/services/classification/audit.js';

const ALICE = 'alice@test-node';
const BOB = 'bob@test-node';
const AGENT = 'claude#alice@test-node';
const ORG = 'organism:org-1';

function ev(over: Partial<ClassificationAuditEvent> = {}): ClassificationAuditEvent {
  return {
    scope: ALICE, ownerGaii: ALICE, kind: 'memory', key: 'notes.a', label: 'luottamuksellinen',
    reader: AGENT, readerKind: 'ai', action: 'shown', purpose: 'chat:anthropic/claude',
    at: '2026-09-29T10:15:20.000Z',
    ...over,
  };
}

describe('classification audit log (sqlite)', () => {
  let storage: SqliteStorage;
  beforeEach(() => {
    resetClassificationAudit();
    storage = new SqliteStorage(':memory:');
    initClassificationAudit(storage);
  });
  afterEach(async () => {
    await shutdownClassificationAudit();
    resetClassificationAudit();
    storage.close();
  });

  it('truncates a timestamp to its UTC minute', () => {
    expect(minuteOf('2026-09-29T10:15:59.999Z')).toBe('2026-09-29T10:15:00.000Z');
  });

  it('merges one reader, item and action in one minute into one row, across two flushes', async () => {
    recordClassificationAudit(ev({ at: '2026-09-29T10:15:01.000Z' }));
    recordClassificationAudit(ev({ at: '2026-09-29T10:15:30.000Z' }));
    expect(pendingClassificationAudit({ ownerGaii: ALICE })).toHaveLength(1);
    expect(pendingClassificationAudit({ ownerGaii: ALICE })[0].count).toBe(2);
    await flushClassificationAudit();
    expect(pendingClassificationAudit()).toHaveLength(0);

    recordClassificationAudit(ev({ at: '2026-09-29T10:15:50.000Z' }));
    await flushClassificationAudit();

    const rows = await storage.listClassificationAudit({ ownerGaii: ALICE });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      minute: '2026-09-29T10:15:00.000Z', count: 3, action: 'shown', reader: AGENT, readerKind: 'ai',
      label: 'luottamuksellinen', purpose: 'chat:anthropic/claude',
      firstAt: '2026-09-29T10:15:01.000Z', lastAt: '2026-09-29T10:15:50.000Z',
    });
  });

  it('makes a new row for another minute, another action or another reader', async () => {
    recordClassificationAudit(ev());
    recordClassificationAudit(ev({ at: '2026-09-29T10:16:05.000Z' }));
    recordClassificationAudit(ev({ action: 'used' }));
    recordClassificationAudit(ev({ reader: BOB, readerKind: 'human' }));
    await flushClassificationAudit();
    const rows = await storage.listClassificationAudit({ ownerGaii: ALICE });
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.count === 1)).toBe(true);
    // Newest first.
    expect(rows[0].minute).toBe('2026-09-29T10:16:00.000Z');
  });

  it('shows waiting rows at once, merged with the stored row of the same address', async () => {
    recordClassificationAudit(ev());
    await flushClassificationAudit();
    recordClassificationAudit(ev({ at: '2026-09-29T10:15:40.000Z' }));
    recordClassificationAudit(ev({ key: 'notes.b', at: '2026-09-29T10:17:00.000Z' }));
    const merged = await listClassificationAuditMerged(storage, { ownerGaii: ALICE });
    expect(merged.map(r => [r.key, r.count])).toEqual([['notes.b', 1], ['notes.a', 2]]);
    // Nothing of that is stored yet beyond the first flush.
    expect((await storage.listClassificationAudit({ ownerGaii: ALICE }))[0].count).toBe(1);
  });

  it('filters the list by owner, scope and action', async () => {
    recordClassificationAudit(ev());
    recordClassificationAudit(ev({ scope: BOB, ownerGaii: BOB, action: 'refused' }));
    recordClassificationAudit(ev({ scope: ORG, ownerGaii: null, kind: 'row', key: 'ws/space/r1', action: 'changed' }));
    await flushClassificationAudit();
    expect((await storage.listClassificationAudit({ ownerGaii: ALICE })).map(r => r.scope)).toEqual([ALICE]);
    expect((await storage.listClassificationAudit({ scope: ORG })).map(r => r.key)).toEqual(['ws/space/r1']);
    expect((await storage.listClassificationAudit({ action: 'refused' })).map(r => r.scope)).toEqual([BOB]);
    expect(await storage.listClassificationAudit({})).toHaveLength(3);
  });

  it('prunes rows past the retention, and keeps everything on null', async () => {
    recordClassificationAudit(ev({ at: '2025-01-01T00:00:00.000Z' }));
    recordClassificationAudit(ev({ key: 'notes.new', at: '2026-09-29T10:00:00.000Z' }));
    await flushClassificationAudit();
    const now = new Date('2026-09-29T12:00:00.000Z');
    expect(await pruneClassificationAuditOlderThan(storage, null, now)).toBe(0);
    expect(await storage.listClassificationAudit({})).toHaveLength(2);
    expect(await pruneClassificationAuditOlderThan(storage, 365, now)).toBe(1);
    expect((await storage.listClassificationAudit({})).map(r => r.key)).toEqual(['notes.new']);
  });

  it('deletes one scope, and goes with the owner and with the organism', async () => {
    recordClassificationAudit(ev());
    recordClassificationAudit(ev({ scope: BOB, ownerGaii: BOB }));
    recordClassificationAudit(ev({ scope: ORG, ownerGaii: null, kind: 'row', key: 'ws/space/r1' }));
    await flushClassificationAudit();

    expect(await storage.deleteClassificationAuditByScope(BOB)).toBe(1);
    expect((await storage.listClassificationAudit({})).map(r => r.scope).sort()).toEqual([ALICE, ORG].sort());

    await storage.cascadeDeleteAgentData(ALICE);
    expect((await storage.listClassificationAudit({})).map(r => r.scope)).toEqual([ORG]);

    await storage.deleteOrganism('org-1');
    expect(await storage.listClassificationAudit({})).toHaveLength(0);
  });

  it('ignores an event with no reader or no key, and never throws', () => {
    expect(() => recordClassificationAudit(ev({ reader: '' }))).not.toThrow();
    expect(() => recordClassificationAudit(ev({ key: '' }))).not.toThrow();
    expect(() => recordClassificationAudit(null as never)).not.toThrow();
    expect(pendingClassificationAudit()).toHaveLength(0);
  });

  it('storage adds counts on the address, inside one batch and onto a stored row, and keeps the id', async () => {
    const base = {
      minute: '2026-09-29T10:15:00.000Z', scope: ALICE, ownerGaii: ALICE, kind: 'memory' as const, key: 'k',
      label: 'sisainen', reader: AGENT, readerKind: 'ai' as const, action: 'used' as const, purpose: null,
    };
    await storage.addClassificationAudit([
      { ...base, id: 'first', count: 2, firstAt: '2026-09-29T10:15:10.000Z', lastAt: '2026-09-29T10:15:20.000Z' },
      { ...base, id: 'dup', count: 3, firstAt: '2026-09-29T10:15:05.000Z', lastAt: '2026-09-29T10:15:15.000Z', purpose: 'workflow:gpt' },
    ]);
    await storage.addClassificationAudit([
      { ...base, id: 'later', count: 1, label: 'luottamuksellinen', firstAt: '2026-09-29T10:15:40.000Z', lastAt: '2026-09-29T10:15:40.000Z' },
    ]);
    const rows = await storage.listClassificationAudit({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'first', count: 6, firstAt: '2026-09-29T10:15:05.000Z', lastAt: '2026-09-29T10:15:40.000Z',
      label: 'luottamuksellinen', purpose: 'workflow:gpt',
    });
  });
});
