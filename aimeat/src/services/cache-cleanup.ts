/**
 * @file src/services/cache-cleanup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cache Cleanup Service — prevents unbounded storage growth from federated data by
 *   scanning the federation key prefixes (federated:, replica:, genesis:, _conflict_, expiring:)
 *   ACROSS EVERY OWNER PRINCIPAL and deleting entries older than their respective TTLs. Runs hourly.
 *
 *   THE SCAN IS BY KEY PREFIX, NEVER BY AGENT. A received replica is stored under the SENDING node's
 *   principal (`agent#owner@source`, `owner@source`), and no code path writes a foreign principal into
 *   the agents table. Until 2026-10-20 this cycle enumerated storage.listAgents() and read each local
 *   agent's memory, so it never visited one replica: the TTL was declared and never applied, and a
 *   record its owner had deleted stayed publicly readable on every peer that received it
 *   (secaudit 2026-10, cache-cleanup.ts:runCleanupCycle:replica-under-sender-identity-never-expires).
 *
 * @structure
 *   - runCleanupCycle(config, storage): single sweep across every owner; returns per-prefix removal counts
 *   - startCacheCleanupJob(config, storage): schedules the hourly cycle (30s warm-up), returns the timer
 *   - CleanupResult / FEDERATION_PREFIXES: result shape and the scanned key prefixes
 *
 * @version-history
 *   2026-10-27 — A row dated more than five minutes ahead of this node's clock is rewritten with the
 *     cycle's time and kept, so it ages out from then; such a row was kept on every cycle for as long
 *     as the time a peer chose (secaudit2026oct26, replica peer-chosen-updatedAt). Counted in
 *     `futureClamped`.
 *   2026-10-20 — The cycle enumerates the federation KEY PREFIXES across every owner
 *     (listAllMemoryMeta) instead of walking the local agents table, so a replica stored under a
 *     foreign principal is visited and its 168 h TTL applies. The result counts owners and rows
 *     instead of agents, and a conflict copy kept beside a replica takes the conflict TTL wherever
 *     its key sits (secaudit 2026-10).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { NONCE_WINDOW_MS } from './request-nonce.js';

export interface CleanupResult {
  federatedRemoved: number;
  replicaRemoved: number;
  genesisRemoved: number;
  conflictRemoved: number;
  expiringRemoved: number;
  /** Distinct owner principals that held at least one row under a federation prefix. */
  ownersScanned: number;
  /** Rows read under the federation prefixes, removed or kept. */
  rowsScanned: number;
  /** Rows dated ahead of this node's clock, brought to the present so they age out. */
  futureClamped: number;
  cleanedAt: string;
}

/** Key prefixes used by federation data sync. */
const FEDERATION_PREFIXES = ['federated:', 'replica:', 'genesis:', '_conflict_', 'expiring:'] as const;
type FederationPrefix = typeof FEDERATION_PREFIXES[number];

/**
 * Rows read per listing call. The listing is the value-free META projection, so a page is metadata
 * only; the bound is there so a node holding a large replica set does not build one array of every
 * row before the first delete.
 */
const PAGE_SIZE = 500;

/**
 * A stop for the paging loop. A row that is listed and then neither removed nor counted as kept would
 * be read again for ever; the kept count below rules that out, and this bounds the loop anyway.
 */
const MAX_PAGES = 10_000;

/** A conflict copy is kept beside the record it lost to: `replica:<src>:<key>._conflict_<ms>`. */
function isConflictCopy(prefix: FederationPrefix, key: string): boolean {
  return prefix === '_conflict_' || key.includes('._conflict_');
}

/**
 * Run a single cleanup cycle.
 * Lists every memory row under each federation key prefix, across all owner principals,
 * and removes the rows older than the configured TTL.
 */
export async function runCleanupCycle(
  config: AimeatConfig,
  storage: Storage,
): Promise<CleanupResult> {
  const now = new Date();
  const result: CleanupResult = {
    federatedRemoved: 0,
    replicaRemoved: 0,
    genesisRemoved: 0,
    conflictRemoved: 0,
    expiringRemoved: 0,
    ownersScanned: 0,
    rowsScanned: 0,
    futureClamped: 0,
    cleanedAt: now.toISOString(),
  };

  // Cache TTL for federated/replica/genesis entries (from genesis sync config, fallback to 168h/7 days)
  const cacheTtlHours = config.genesisMemoryCacheTtlHours || 168;
  const cacheCutoff = new Date(now.getTime() - cacheTtlHours * 3_600_000);

  // Conflict entries: 7-day fixed TTL
  const conflictCutoff = new Date(now.getTime() - 7 * 24 * 3_600_000);

  // Grace period for expiring entries (de-peering grace)
  const graceCutoff = new Date(now.getTime() - config.depeeringGracePeriodHours * 3_600_000);

  const cutoffFor = (prefix: FederationPrefix, key: string): Date => {
    if (isConflictCopy(prefix, key)) return conflictCutoff;
    if (prefix === 'expiring:') return graceCutoff;
    // federated:, replica:, genesis: — all use cache TTL
    return cacheCutoff;
  };

  const countRemoval = (prefix: FederationPrefix, key: string): void => {
    if (isConflictCopy(prefix, key)) { result.conflictRemoved++; return; }
    switch (prefix) {
      case 'federated:': result.federatedRemoved++; break;
      case 'replica:': result.replicaRemoved++; break;
      case 'genesis:': result.genesisRemoved++; break;
      case 'expiring:': result.expiringRemoved++; break;
    }
  };

  const owners = new Set<string>();

  for (const prefix of FEDERATION_PREFIXES) {
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      let rows;
      try {
        rows = (await storage.listAllMemoryMeta({ prefix, limit: PAGE_SIZE, offset })).items;
      } catch (err) {
        // The prefix is left for the next cycle rather than failing the whole sweep.
        logger.warn('runCleanupCycle: a prefix listing failed, continuing with the next prefix', {
          prefix, offset, error: String(err),
        });
        break;
      }
      if (rows.length === 0) break;

      // Rows this page left in place. A removed row is out of the next listing, so the window only
      // has to step over what stayed.
      let kept = 0;
      for (const row of rows) {
        result.rowsScanned++;
        owners.add(row.ownerGaii);
        if (new Date(row.updatedAt).getTime() > now.getTime() + NONCE_WINDOW_MS) {
          // Dated ahead of this node's clock: a replica stored before the replicate route took the
          // receive time for such a record (secaudit2026oct26). Kept as this cycle's time, so it ages
          // out from now instead of staying for as long as the time a peer chose.
          kept++;
          try {
            // Written on the version read: a replicate landing in between keeps its own write.
            const full = await storage.getMemory(row.ownerGaii, row.key);
            if (full && storage.setMemoryIfVersion && await storage.setMemoryIfVersion({ ...full, version: full.version + 1, updatedAt: now.toISOString() }, full.version)) result.futureClamped++;
          } catch (err) {
            logger.warn('runCleanupCycle: a row dated ahead of the clock could not be brought to the present, continuing', {
              prefix, key: row.key, owner: row.ownerGaii, error: String(err),
            });
          }
          continue;
        }
        if (new Date(row.updatedAt) >= cutoffFor(prefix, row.key)) { kept++; continue; }
        try {
          if (await storage.deleteMemory(row.ownerGaii, row.key)) countRemoval(prefix, row.key);
          else kept++;
        } catch (err) {
          kept++;
          logger.warn('runCleanupCycle: a row could not be removed, continuing', {
            prefix, key: row.key, owner: row.ownerGaii, error: String(err),
          });
        }
      }

      if (rows.length < PAGE_SIZE) break;
      offset += kept;
    }
  }

  result.ownersScanned = owners.size;

  const totalRemoved = result.federatedRemoved + result.replicaRemoved +
    result.genesisRemoved + result.conflictRemoved + result.expiringRemoved;

  if (totalRemoved > 0) {
    logger.info('Cache cleanup completed', {
      federated: result.federatedRemoved,
      replica: result.replicaRemoved,
      genesis: result.genesisRemoved,
      conflict: result.conflictRemoved,
      expiring: result.expiringRemoved,
      ownersScanned: result.ownersScanned,
      rowsScanned: result.rowsScanned,
    });
  }

  return result;
}

/**
 * Start the cache cleanup scheduler. Runs every hour.
 * Returns the interval timer so it can be stopped on shutdown.
 */
export function startCacheCleanupJob(
  config: AimeatConfig,
  storage: Storage,
): NodeJS.Timeout {
  const INTERVAL_MS = 60 * 60_000; // 1 hour

  logger.info('Cache cleanup scheduler started (hourly)');

  // Initial cleanup after 30s to avoid startup contention
  setTimeout(() => {
    runCleanupCycle(config, storage).catch(err => {
      logger.error('Initial cache cleanup failed', { error: (err as Error).message });
    });
  }, 30_000);

  return setInterval(() => {
    runCleanupCycle(config, storage).catch(err => {
      logger.error('Cache cleanup cycle failed', { error: (err as Error).message });
    });
  }, INTERVAL_MS);
}
