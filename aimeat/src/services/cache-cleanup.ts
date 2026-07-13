/**
 * @file src/services/cache-cleanup.ts
 * @description Cache Cleanup Service — prevents unbounded storage growth from federated data by
 *   scanning each agent's memory for federation key prefixes (federated:, replica:, genesis:,
 *   _conflict_, expiring:) and deleting entries older than their respective TTLs. Runs hourly.
 *
 * @structure
 *   - runCleanupCycle(config, storage): single sweep across all agents; returns per-prefix removal counts
 *   - startCacheCleanupJob(config, storage): schedules the hourly cycle (30s warm-up), returns the timer
 *   - CleanupResult / FEDERATION_PREFIXES: result shape and the scanned key prefixes
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface CleanupResult {
  federatedRemoved: number;
  replicaRemoved: number;
  genesisRemoved: number;
  conflictRemoved: number;
  expiringRemoved: number;
  agentsScanned: number;
  cleanedAt: string;
}

/** Key prefixes used by federation data sync. */
const FEDERATION_PREFIXES = ['federated:', 'replica:', 'genesis:', '_conflict_', 'expiring:'] as const;

/**
 * Run a single cleanup cycle.
 * Iterates over all agents, lists their memory entries by prefix,
 * and removes entries older than the configured TTL.
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
    agentsScanned: 0,
    cleanedAt: now.toISOString(),
  };

  // Cache TTL for federated/replica/genesis entries (from genesis sync config, fallback to 168h/7 days)
  const cacheTtlHours = config.genesisMemoryCacheTtlHours || 168;
  const cacheCutoff = new Date(now.getTime() - cacheTtlHours * 3_600_000);

  // Conflict entries: 7-day fixed TTL
  const conflictCutoff = new Date(now.getTime() - 7 * 24 * 3_600_000);

  // Grace period for expiring entries (de-peering grace)
  const graceCutoff = new Date(now.getTime() - config.depeeringGracePeriodHours * 3_600_000);

  // Collect all agent GAIIs to scan their memory
  let agentGaiis: string[];
  try {
    const agents = await storage.listAgents();
    agentGaiis = agents.map(a => a.gaii);
  } catch {
    logger.warn('Cache cleanup: failed to list agents, skipping cycle');
    return result;
  }

  for (const gaii of agentGaiis) {
    result.agentsScanned++;

    for (const prefix of FEDERATION_PREFIXES) {
      try {
        const entries = await storage.listMemory(gaii, { prefix });

        for (const entry of entries) {
          const entryTime = new Date(entry.updatedAt);
          let shouldDelete = false;

          if (prefix === '_conflict_') {
            shouldDelete = entryTime < conflictCutoff;
          } else if (prefix === 'expiring:') {
            shouldDelete = entryTime < graceCutoff;
          } else {
            // federated:, replica:, genesis: — all use cache TTL
            shouldDelete = entryTime < cacheCutoff;
          }

          if (shouldDelete) {
            await storage.deleteMemory(gaii, entry.key);

            switch (prefix) {
              case 'federated:': result.federatedRemoved++; break;
              case 'replica:': result.replicaRemoved++; break;
              case 'genesis:': result.genesisRemoved++; break;
              case '_conflict_': result.conflictRemoved++; break;
              case 'expiring:': result.expiringRemoved++; break;
            }
          }
        }
      } catch {
        // listMemory with prefix may yield no results — that's expected
      }
    }
  }

  const totalRemoved = result.federatedRemoved + result.replicaRemoved +
    result.genesisRemoved + result.conflictRemoved + result.expiringRemoved;

  if (totalRemoved > 0) {
    logger.info('Cache cleanup completed', {
      federated: result.federatedRemoved,
      replica: result.replicaRemoved,
      genesis: result.genesisRemoved,
      conflict: result.conflictRemoved,
      expiring: result.expiringRemoved,
      agentsScanned: result.agentsScanned,
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
