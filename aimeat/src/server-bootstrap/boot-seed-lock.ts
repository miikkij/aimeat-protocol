/**
 * @file boot-seed-lock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The boot seeding under the node's boot lock (storage.bootLock, PostgreSQL only), so
 *   two processes of one node that start together seed one after the other: the second waits until
 *   the first one's seeders, the awaited ones and the ones it started without waiting, have all
 *   settled. The seeders stay as they were (most of them are not awaited, so the boot does not wait
 *   for them); each one is only handed to track(), and done() gives the lock back when every tracked
 *   seeder has settled.
 *
 *   On SQLite there is no lock: one process per database file.
 *
 *   SETTLED. The same tracker says whether this process's seeding has finished: bootSeedsState()
 *   answers pending until done() has been called and every seeder tracked before or after it has
 *   settled. `GET /v1/build` carries it as `seeds`, and the E2E runner waits for `settled` before the
 *   first test (test/run-e2e-server.ts, test/helpers/wait-for-server.ts). Without that wait a suite
 *   that reads a seeded record raced the seeder: on SQLite the seeder won, on PostgreSQL, where the
 *   migrations run first, it lost, and the flake taught everyone to run a suite again until it was
 *   green, which is how a real regression gets waved through. A seeder started outside
 *   initializeServices (the core scheduled jobs, server-bootstrap/background-jobs.ts) is counted with
 *   trackBootSeed().
 * @structure holdBootLock(storage) → { track(promise, label?), done() } · trackBootSeed(promise, label) ·
 *   bootSeedsState() → { settled, pending }
 * @usage const bootSeeds = await holdBootLock(storage); bootSeeds.track(seedX(...)); ... bootSeeds.done();
 * @version-history
 *   v1.1.0 — 2026-11-21 — bootSeedsState() and trackBootSeed(): the seeding's settled signal for
 *     `GET /v1/build`, which the E2E runner waits for (the seeding bullet of docs/pitfalls.md §19, now deleted).
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: migration and boot lock).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface BootSeeds {
  /** Count this seeder in; answers the same promise, so the call site keeps its chain. */
  track<T>(seed: Promise<T>, label?: string): Promise<T>;
  /** Give the lock back once every tracked seeder has settled. Does not wait. */
  done(): void;
}

/** The entry that stands for "seeding has not been closed by done()" while it is in the map. */
const SEEDING_OPEN = Symbol('boot seeding open');

// process-local: which of THIS process's boot seeders are still running. A probe asks one process
// about its own boot; a second process seeds and answers for itself.
const pendingSeeds = new Map<symbol, string>([[SEEDING_OPEN, 'boot seeding not finished']]);

/** Count a seeder into this process's seeding; it leaves the count when it settles, either way. */
export function trackBootSeed<T>(seed: Promise<T>, label = 'seeder'): Promise<T> {
  const key = Symbol(label);
  pendingSeeds.set(key, label);
  const leave = (): void => { pendingSeeds.delete(key); };
  seed.then(leave, leave);
  return seed;
}

/** Whether this process's boot seeding has finished, and which seeders are still running when not. */
export function bootSeedsState(): { settled: boolean; pending: string[] } {
  return { settled: pendingSeeds.size === 0, pending: [...pendingSeeds.values()] };
}

/** Take the boot lock for the seeding (or go on without one), and answer the tracker. */
export async function holdBootLock(storage: Storage): Promise<BootSeeds> {
  // A second boot in one process (a test) opens the seeding again until its done().
  pendingSeeds.set(SEEDING_OPEN, 'boot seeding not finished');
  const release = storage.bootLock
    ? await storage.bootLock().catch((err: unknown) => {
      logger.warn('boot lock: could not be taken; seeding without it', { error: String(err) });
      return null;
    })
    : null;
  const pending: Promise<unknown>[] = [];
  return {
    track<T>(seed: Promise<T>, label?: string): Promise<T> {
      pending.push(seed);
      return trackBootSeed(seed, label);
    },
    done(): void {
      pendingSeeds.delete(SEEDING_OPEN);
      if (!release) return;
      void Promise.allSettled(pending)
        .then(() => release())
        .catch((err: unknown) => logger.warn('boot lock: release failed; the connection that held it is gone', { error: String(err) }));
    },
  };
}
