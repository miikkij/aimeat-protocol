/**
 * @file test/unit/cache-single-flight.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The read cache (services/cache.ts) and which entries a change drops
 *   (services/cache-invalidation.ts), codebase analysis 2026-11-03, item C4.
 *
 *   - Single flight: concurrent misses of one key compute once and all get its answer; a failed run
 *     fails its own caller only and the others compute for themselves; a run invalidated while it
 *     ran answers its waiters and is not stored.
 *   - Invalidation: a memory change only its owner reads (emitRecordChange with private and owner
 *     levels) keeps the entries computed from records others read and drops the owner's entries and
 *     the any-level entries; every other change drops what it dropped before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/cache-single-flight.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C4).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { cached, clearCache, invalidateTag, MEMORY_ANY_LEVEL_TAG } from '../../src/services/cache.js';
import { dropCachesForChange } from '../../src/services/cache-invalidation.js';
import { emitRecordChange, emitRecordChangePriorUnknown, emitChange, onChangeEvent, offChangeEvent, type ChangeEvent } from '../../src/services/event-bus.js';
import { setThisNodeId } from '../../src/utils/gaii.js';

const NODE = 'cache-test-node';
const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r; }); return { p, open }; };

beforeEach(() => { clearCache(); setThisNodeId(NODE); });
afterAll(() => { clearCache(); setThisNodeId(null); });

describe('single flight', () => {
  it('concurrent misses of one key compute once and share the answer', async () => {
    let runs = 0;
    const g = gate();
    const compute = async () => { runs++; await g.p; return { n: runs }; };
    const readers = [cached('sf:a', 60_000, compute), cached('sf:a', 60_000, compute), cached('sf:a', 60_000, compute)];
    g.open();
    const answers = await Promise.all(readers);
    expect(runs).toBe(1);
    expect(answers.every(a => a === answers[0])).toBe(true);
    // Stored: the next reader gets the same value without a run.
    expect(await cached('sf:a', 60_000, compute)).toBe(answers[0]);
    expect(runs).toBe(1);
  });

  it('a failed run fails its own caller; a waiting reader computes for itself and stores', async () => {
    let runs = 0;
    const g = gate();
    const first = cached('sf:b', 60_000, async () => { runs++; await g.p; throw new Error('storage down'); });
    const second = cached('sf:b', 60_000, async () => { runs++; return 'ok'; });
    g.open();
    await expect(first).rejects.toThrow('storage down');
    expect(await second).toBe('ok');
    expect(runs).toBe(2);
    expect(await cached('sf:b', 60_000, async () => 'not run')).toBe('ok');
  });

  it('a run invalidated while it ran answers its waiters and is not stored', async () => {
    let runs = 0;
    const g = gate();
    const compute = async () => { const mine = ++runs; await g.p; return `run ${mine}`; };
    const first = cached('sf:c', 60_000, compute, ['domain:memory']);
    invalidateTag('domain:memory');
    // A reader after the invalidation does not join the stale run.
    const after = cached('sf:c', 60_000, async () => { runs++; return 'fresh'; }, ['domain:memory']);
    g.open();
    expect(await first).toBe('run 1');
    expect(await after).toBe('fresh');
    expect(await cached('sf:c', 60_000, async () => 'not run', ['domain:memory'])).toBe('fresh');
  });
});

describe('which entries a memory change drops', () => {
  const warm = async () => {
    await cached('pub', 60_000, async () => 'public', ['domain:memory']);
    await cached('mine', 60_000, async () => 'alice', ['domain:memory', 'owner:alice:memory']);
    await cached('bob', 60_000, async () => 'bob', ['domain:memory', 'owner:bob:memory']);
    await cached('any', 60_000, async () => 'any', ['domain:memory', MEMORY_ANY_LEVEL_TAG]);
  };
  /** Which of the four entries are still stored. */
  const kept = async () => {
    const out: string[] = [];
    for (const key of ['pub', 'mine', 'bob', 'any']) {
      let ran = false;
      await cached(key, 60_000, async () => { ran = true; return 'recomputed'; });
      if (!ran) out.push(key);
    }
    return out;
  };
  let seen: ChangeEvent[] = [];
  const listener = (evt: ChangeEvent) => { seen.push(evt); dropCachesForChange(evt); };

  it('an owner-only change keeps the public entries and drops the owner\'s and the any-level ones', async () => {
    await warm();
    seen = [];
    onChangeEvent(listener);
    try {
      emitRecordChange('memory', `claude#alice@${NODE}`, 'private', 'owner');
    } finally { offChangeEvent(listener); }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ domain: 'memory', ownerGaii: `claude#alice@${NODE}`, ownerOnly: true });
    expect(await kept()).toEqual(['pub', 'bob']);
  });

  it('a change others may read drops every memory entry, as before', async () => {
    for (const emit of [
      () => emitRecordChange('memory', `alice@${NODE}`, 'public'),
      () => emitRecordChange('memory', `alice@${NODE}`, 'private', 'public'),
      () => emitRecordChangePriorUnknown('memory', `alice@${NODE}`, 'private'),
      () => emitChange('memory', `alice@${NODE}`),
      () => emitChange('memory'),
    ]) {
      clearCache();
      await warm();
      onChangeEvent(listener);
      try { emit(); } finally { offChangeEvent(listener); }
      expect(await kept()).toEqual([]);
    }
  });

  it('the streams hear a prior-unknown change exactly as emitRecordChange routes it', async () => {
    seen = [];
    onChangeEvent(listener);
    try {
      emitRecordChangePriorUnknown('memory', `alice@${NODE}`, 'private');
      emitRecordChangePriorUnknown('memory', `alice@${NODE}`, 'public');
    } finally { offChangeEvent(listener); }
    expect(seen.map(e => [e.ownerGaii, e.ownerOnly])).toEqual([[`alice@${NODE}`, undefined], [undefined, undefined]]);
  });

  it('another domain is unchanged: its broad tag and the owner tag go', async () => {
    await cached('files', 60_000, async () => 'f', ['domain:files']);
    onChangeEvent(listener);
    try { emitRecordChange('files', `alice@${NODE}`, 'private'); } finally { offChangeEvent(listener); }
    let ran = false;
    await cached('files', 60_000, async () => { ran = true; return 'again'; });
    expect(ran).toBe(true);
  });
});
