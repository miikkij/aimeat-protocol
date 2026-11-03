/**
 * @file maintenance-cache.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The running node's copy of the maintenance state, kept true to storage. The request
 *   guard (server-bootstrap/middleware-guards.ts) asks it on every request, so it answers from
 *   memory; a read older than the re-read interval starts one storage read in the background and
 *   the next request sees its answer.
 *
 *   WHY IT RE-READS. `aimeat maintenance on|off` (src/index.ts) is a process of its own and writes
 *   storage only, and a standby or second process sees only its own operator switch. Until
 *   2026-11-04 the node read the state once at boot, so the command the startup banner recommends
 *   did nothing until a restart (codebase analysis 2026-11-03, item A8).
 *
 *   The read never blocks a request: maintenance is often switched on because the database is in
 *   trouble, and a guard that waits for that database would stop the node it is meant to protect.
 *   The operator's own switch (set()) takes effect at once, and a re-read that started before it
 *   does not overwrite it.
 * @structure
 *   - MAINTENANCE_REREAD_MS — the re-read interval
 *   - createMaintenanceCache(read, initial, opts) → { get, set }
 *   - loadMaintenanceCache(storage) — the node's cache, seeded from storage at boot
 * @usage const maintenance = await loadMaintenanceCache(storage); maintenance.get().enabled
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item A8).
 */
import type { MaintenanceState, Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** How old the copy may be before a request starts a re-read. A CLI stop reaches the node within this, plus one request. */
export const MAINTENANCE_REREAD_MS = 5_000;

export interface MaintenanceCache {
  /** The current state, from memory. Starts a background re-read when the copy is older than the interval. */
  get(): MaintenanceState;
  /** The operator's switch on this process: takes effect at once, and wins over a re-read already under way. */
  set(state: MaintenanceState): void;
}

const OFF: MaintenanceState = { enabled: false, message: '', enabledAt: null, enabledBy: null };

export function createMaintenanceCache(
  read: () => Promise<MaintenanceState>,
  initial: MaintenanceState,
  opts: { rereadMs?: number; now?: () => number } = {},
): MaintenanceCache {
  const rereadMs = opts.rereadMs ?? MAINTENANCE_REREAD_MS;
  const now = opts.now ?? Date.now;
  // One object for the life of the process: callers that hold it see every change.
  const state: MaintenanceState = { ...initial };
  let readAt = now();
  let generation = 0;
  let reading = false;

  const reread = (): void => {
    reading = true;
    const startedAt = generation;
    read().then((fresh) => {
      // A switch made on this process after the read began is newer than what the read saw.
      if (generation === startedAt && fresh) Object.assign(state, fresh);
    }, (err: unknown) => {
      logger.warn('maintenance: re-read from storage failed, keeping the last known state', { error: String(err) });
    }).finally(() => {
      readAt = now();
      reading = false;
    });
  };

  return {
    get() {
      if (!reading && now() - readAt >= rereadMs) reread();
      return state;
    },
    set(next) {
      generation++;
      Object.assign(state, next);
      readAt = now();
    },
  };
}

/** The node's maintenance cache: read once at boot (off when storage cannot answer), then kept fresh. */
export async function loadMaintenanceCache(storage: Storage): Promise<MaintenanceCache> {
  let initial = OFF;
  try {
    initial = await storage.getMaintenanceMode();
  } catch (err) { logger.warn('maintenance: boot read failed, starting with maintenance off', { error: String(err) }); }
  return createMaintenanceCache(() => storage.getMaintenanceMode(), initial);
}
