/**
 * @file workflow-lock-lifecycle.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Real workflow lock serialization and cleanup under success, failure and contention.
 * @version-history 1.0.0 2026-09-27 Reproduce the retained promise map entries.
 */
import { describe, expect, it } from 'vitest';
import { WorkflowEngine } from '../../src/services/workflow/engine.js';
import { loadConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

interface Locks {
  locks: Map<string, Promise<void>>;
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
function engine(): Locks {
  // These tests exercise the actual private lock method; callbacks never use storage.
  return new WorkflowEngine(loadConfig().config, {} as Storage) as unknown as Locks;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('workflow lock lifecycle', () => {
  it('releases every completed run instead of retaining one entry per historical run', async () => {
    const e = engine();
    await Promise.all(Array.from({ length: 100 }, (_, i) => e.withLock(String(i), async () => i)));
    expect(e.locks.size).toBe(0);
  });
  it('releases a failed callback and allows the next callback', async () => {
    const e = engine();
    await expect(e.withLock('run', async () => { throw new Error('step failed'); })).rejects.toThrow('step failed');
    expect(await e.withLock('run', async () => 'next')).toBe('next');
    expect(e.locks.size).toBe(0);
  });
  it('serializes the same run without deleting a waiting successor lock', async () => {
    const e = engine();
    const entered = deferred(), releaseFirst = deferred(), enteredSecond = deferred(), releaseSecond = deferred();
    const order: number[] = [];
    const first = e.withLock('same', async () => { order.push(1); entered.resolve(); await releaseFirst.promise; });
    await entered.promise;
    const second = e.withLock('same', async () => { order.push(2); enteredSecond.resolve(); await releaseSecond.promise; });
    expect(order).toEqual([1]);
    releaseFirst.resolve();
    await first;
    await enteredSecond.promise;
    expect(e.locks.has('same')).toBe(true);
    releaseSecond.resolve();
    await second;
    expect(order).toEqual([1, 2]);
    expect(e.locks.size).toBe(0);
  });
  it('lets another run finish while the first run is waiting', async () => {
    const e = engine();
    const entered = deferred(), release = deferred();
    const first = e.withLock('first', async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    try {
      expect(await e.withLock('other', async () => 'independent')).toBe('independent');
      expect(e.locks.has('first')).toBe(true);
    } finally { release.resolve(); await first; }
    expect(e.locks.size).toBe(0);
  });
});

