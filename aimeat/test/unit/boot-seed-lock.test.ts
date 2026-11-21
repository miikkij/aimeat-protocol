/**
 * @file boot-seed-lock.test.ts
 * @description The boot seeding's settled signal (src/server-bootstrap/boot-seed-lock.ts): pending
 *   until done() is called and every tracked seeder has settled, a rejected seeder counts as settled,
 *   and a seeder tracked after done() (the core scheduled jobs) makes the state pending again until it
 *   settles. `GET /v1/build` answers it as `seeds`, and the E2E runner waits for it.
 * @structure the four cases above, on a storage without a boot lock (SQLite's shape)
 * @usage cd aimeat && pnpm exec vitest run test/unit/boot-seed-lock.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import { holdBootLock, trackBootSeed, bootSeedsState } from '../../src/server-bootstrap/boot-seed-lock.js';

const noLock = {} as Storage;

/** A promise and the two functions that end it. */
function deferred<T = void>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(r => setTimeout(r, 0));

describe('boot seeding settled signal', () => {
  it('is pending while a seeder runs and settled after it and done()', async () => {
    const seeds = await holdBootLock(noLock);
    const a = deferred<number>();
    const returned = seeds.track(a.promise, 'profile schemas');
    expect(returned).toBe(a.promise);
    seeds.done();
    expect(bootSeedsState()).toEqual({ settled: false, pending: ['profile schemas'] });
    a.resolve(3);
    await tick();
    expect(bootSeedsState()).toEqual({ settled: true, pending: [] });
  });

  it('stays pending until done() even when every seeder has settled', async () => {
    const seeds = await holdBootLock(noLock);
    await seeds.track(Promise.resolve(1));
    await tick();
    expect(bootSeedsState().settled).toBe(false);
    seeds.done();
    expect(bootSeedsState().settled).toBe(true);
  });

  it('counts a rejected seeder as settled', async () => {
    const seeds = await holdBootLock(noLock);
    const a = deferred();
    seeds.track(a.promise.catch(() => undefined), 'bundled cortexes');
    const b = deferred();
    seeds.track(b.promise, 'example packages');
    seeds.done();
    a.reject(new Error('disk full'));
    b.reject(new Error('disk full'));
    await b.promise.catch(() => undefined);
    await tick();
    expect(bootSeedsState()).toEqual({ settled: true, pending: [] });
  });

  it('is pending again while a seeder started after done() runs', async () => {
    const seeds = await holdBootLock(noLock);
    seeds.done();
    expect(bootSeedsState().settled).toBe(true);
    const jobs = deferred();
    trackBootSeed(jobs.promise, 'core scheduled jobs');
    expect(bootSeedsState()).toEqual({ settled: false, pending: ['core scheduled jobs'] });
    jobs.resolve();
    await tick();
    expect(bootSeedsState().settled).toBe(true);
  });
});
