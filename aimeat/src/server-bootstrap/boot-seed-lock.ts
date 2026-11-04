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
 * @structure holdBootLock(storage) → { track(promise), done() }
 * @usage const bootSeeds = await holdBootLock(storage); bootSeeds.track(seedX(...)); ... bootSeeds.done();
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: migration and boot lock).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface BootSeeds {
  /** Count this seeder in; answers the same promise, so the call site keeps its chain. */
  track<T>(seed: Promise<T>): Promise<T>;
  /** Give the lock back once every tracked seeder has settled. Does not wait. */
  done(): void;
}

/** Take the boot lock for the seeding (or go on without one), and answer the tracker. */
export async function holdBootLock(storage: Storage): Promise<BootSeeds> {
  const release = storage.bootLock
    ? await storage.bootLock().catch((err: unknown) => {
      logger.warn('boot lock: could not be taken; seeding without it', { error: String(err) });
      return null;
    })
    : null;
  const pending: Promise<unknown>[] = [];
  return {
    track<T>(seed: Promise<T>): Promise<T> {
      pending.push(seed);
      return seed;
    },
    done(): void {
      if (!release) return;
      void Promise.allSettled(pending)
        .then(() => release())
        .catch((err: unknown) => logger.warn('boot lock: release failed; the connection that held it is gone', { error: String(err) }));
    },
  };
}
