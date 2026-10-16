/**
 * @file src/services/sync-scheduler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Coordinates federation catalogue/memory sync to peers based on the node's
 *   sync mode (bulk/instant/hybrid), debouncing change events into batched sync runs and
 *   applying peer prioritization and throttling from sync-health.
 *
 * @structure
 *   - notifyCatalogueChange(): debounces CSM/action changes into a batched peer sync (instant/hybrid)
 *   - batchTimer / batchedPeerIds: module-level debounce state for the batch window
 *   - scheduleMemoryDrain(): the debounced drain after a memory enqueue (instant/hybrid)
 *   - drainSyncQueue(): catalogue and memory jobs per peer, each marked by its result
 *
 * @version-history
 *   v1.2.0 — 2026-10-16 — The drain sends memory_replicate entries (sendQueuedMemoryEntries) and marks
 *     each by its result; it had marked them 'sent' with no request to a peer. A memory enqueue now
 *     triggers a debounced drain in instant and hybrid mode. The trust_advisory branch is gone:
 *     nothing enqueues that type (QA audit F3-01, S6-06).
 *   v1.1.0 — 2026-09-08 — The debounced flush waits for its enqueues before it drains.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { syncCatalogueToPeer, enqueueCatalogueSync } from './catalogue-sync.js';
import { replicateMemoryToAllPeers, sendQueuedMemoryEntries, onMemoryReplicationEnqueued } from './memory-replication.js';
import {
  computePeerPriorities,
  getSyncHealthMetrics,
  isSyncThrottled,
  incrementActiveSyncs,
  decrementActiveSyncs,
  recordSyncDuration,
  recordSyncAttempt,
} from './sync-health.js';
import { logger } from '../utils/logger.js';

/** Batch window: accumulate events for 5s before flushing. */
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchedPeerIds = new Set<string>();

/**
 * Notify the scheduler that a CSM or action change occurred.
 * In instant/hybrid modes, this triggers batched sync.
 */
export function notifyCatalogueChange(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): void {
  if (config.syncMode === 'bulk') return; // Bulk mode: only scheduled syncs

  // Collect all active peer IDs for batch sync
  const activePeerIds = [...peers.values()]
    .filter(p => p.status === 'active')
    .map(p => p.nodeId);

  for (const id of activePeerIds) {
    batchedPeerIds.add(id);
  }

  // Debounce: wait syncBatchDelayMs before firing
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    const peerIds = [...batchedPeerIds];
    batchedPeerIds = new Set();
    batchTimer = null;

    if (peerIds.length === 0) return;

    // Enqueue every sync, THEN drain: until 2026-09-08 the drain was started without waiting for
    // the enqueues, so it could reach the queue before the rows it was meant to carry were in it,
    // and the job sat pending until the next drain (e2e-federation-settlements-sync).
    (async () => {
      for (const peerId of peerIds) {
        await enqueueCatalogueSync(peerId, config, storage).catch(err => {
          logger.warn(`Failed to enqueue catalogue sync for peer ${peerId}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      await drainSyncQueue(config, storage, peers);
    })().catch(err => {
      logger.error('Failed to drain sync queue after catalogue change', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, config.syncBatchDelayMs);
}

/** Debounce timers for the drain that follows a memory enqueue, per storage instance. */
const memoryDrainTimers = new Map<Storage, ReturnType<typeof setTimeout>>();

/**
 * Drain the queue once the batch window after a memory enqueue has passed: in instant and hybrid
 * mode a change leaves at once, not at the next scheduled round. Registered with the memory
 * replication service by startSyncScheduler.
 */
function scheduleMemoryDrain(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
  if (config.syncMode === 'bulk') return;
  const existing = memoryDrainTimers.get(storage);
  if (existing) clearTimeout(existing);
  memoryDrainTimers.set(storage, setTimeout(() => {
    memoryDrainTimers.delete(storage);
    drainSyncQueue(config, storage, peers).catch(err => {
      logger.error('Failed to drain sync queue after a memory change', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, config.syncBatchDelayMs));
}

/**
 * Drain the replication queue: dequeue entries and execute syncs.
 * Respects concurrent sync limit and peer priority.
 */
export async function drainSyncQueue(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<void> {
  if (isSyncThrottled()) {
    logger.warn('Sync queue drain skipped — throttling active');
    return;
  }

  const priorities = computePeerPriorities(peers);
  const concurrency = config.maxConcurrentSyncs;

  // Process top N peers by priority
  const topPeers = priorities.slice(0, concurrency);

  const syncPromises = topPeers.map(async (priority) => {
    const peer = peers.get(priority.peerId);
    if (!peer) return;

    // Dequeue entries for this peer
    const entries = await storage.dequeueReplication(priority.peerId, 10);
    if (entries.length === 0) return;

    incrementActiveSyncs();
    const startTime = Date.now();

    try {
      // Process catalogue_sync entries
      const catalogueEntries = entries.filter(e => e.type === 'catalogue_sync');
      if (catalogueEntries.length > 0) {
        const result = await syncCatalogueToPeer(peer, config, storage);
        recordSyncAttempt(result.success);

        if (result.success) {
          await storage.markReplicationSent(catalogueEntries.map(e => e.id));
        } else {
          await storage.markReplicationFailed(catalogueEntries.map(e => e.id));
        }
      }

      // Process memory_replicate entries: one single-record send per entry, each marked by its own
      // result. Until 2026-10-16 this branch marked every entry 'sent' and sent nothing.
      const memoryEntries = entries.filter(e => e.type === 'memory_replicate');
      if (memoryEntries.length > 0) {
        const { sent, failed } = await sendQueuedMemoryEntries(peer, memoryEntries, config, storage);
        recordSyncAttempt(failed.length === 0);
        await storage.markReplicationSent(sent);
        await storage.markReplicationFailed(failed);
      }

      recordSyncDuration(Date.now() - startTime);
    } catch (err) {
      recordSyncAttempt(false);
      const entryIds = entries.map(e => e.id);
      await storage.markReplicationFailed(entryIds).catch(err => { logger.warn('drainSyncQueue: continuing after a suppressed failure', { error: String(err) }); });
      logger.warn(`Sync queue drain failed for peer ${peer.nodeId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      decrementActiveSyncs();
    }
  });

  await Promise.allSettled(syncPromises);
}

/**
 * Start the sync scheduler. Runs scheduled sync cycles based on syncIntervalHours.
 * Returns a cleanup function to stop the scheduler.
 */
export function startSyncScheduler(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): { stop: () => void } {
  const BASE_INTERVAL_MS = config.syncIntervalHours * 3_600_000;

  logger.info('Sync scheduler started', {
    mode: config.syncMode,
    intervalHours: config.syncIntervalHours,
    maxConcurrentSyncs: config.maxConcurrentSyncs,
  });

  // Initial sync after 60 seconds (allow server startup to complete)
  const initialTimer = setTimeout(() => {
    runScheduledSync(config, storage, peers);
  }, 60_000);

  // Recurring sync with jitter (±25%)
  function scheduleNext(): void {
    const jitter = BASE_INTERVAL_MS * 0.25 * (Math.random() * 2 - 1);
    const nextMs = Math.max(60_000, BASE_INTERVAL_MS + jitter);

    recurringTimer = setTimeout(() => {
      runScheduledSync(config, storage, peers);
      scheduleNext();
    }, nextMs);
  }

  let recurringTimer: ReturnType<typeof setTimeout>;
  scheduleNext();

  const unregisterMemoryDrain = onMemoryReplicationEnqueued(storage, () => scheduleMemoryDrain(config, storage, peers));

  return {
    stop() {
      clearTimeout(initialTimer);
      clearTimeout(recurringTimer);
      if (batchTimer) clearTimeout(batchTimer);
      unregisterMemoryDrain();
      const memoryTimer = memoryDrainTimers.get(storage);
      if (memoryTimer) { clearTimeout(memoryTimer); memoryDrainTimers.delete(storage); }
      logger.info('Sync scheduler stopped');
    },
  };
}

/**
 * Run a scheduled sync cycle.
 * Syncs catalogue to all peers + drains replication queue + prunes old entries.
 */
async function runScheduledSync(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<void> {
  try {
    const healthMetrics = await getSyncHealthMetrics(storage);
    if (healthMetrics.throttled) {
      logger.warn('Scheduled sync skipped — throttling active', { reason: healthMetrics.throttleReason });
      return;
    }

    logger.info('Starting scheduled sync cycle', {
      mode: config.syncMode,
      queueDepth: healthMetrics.queueDepth,
    });

    // 1. Sync catalogue to peers by priority
    const priorities = computePeerPriorities(peers);
    const concurrency = config.maxConcurrentSyncs;

    for (let i = 0; i < priorities.length; i += concurrency) {
      const batch = priorities.slice(i, i + concurrency);
      await Promise.allSettled(
        batch.map(async (priority) => {
          const peer = peers.get(priority.peerId);
          if (!peer) return;

          incrementActiveSyncs();
          const start = Date.now();
          try {
            const result = await syncCatalogueToPeer(peer, config, storage);
            recordSyncAttempt(result.success);
            recordSyncDuration(Date.now() - start);
          } catch (err) {
            logger.warn('sync-scheduler: suppressed failure, continuing', { error: String(err) });
            recordSyncAttempt(false);
          } finally {
            decrementActiveSyncs();
          }
        }),
      );
    }

    // 2. Run memory replication cycle
    await replicateMemoryToAllPeers(config, storage, peers).catch(err => {
      logger.warn('Memory replication cycle failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 3. Drain any queued items
    await drainSyncQueue(config, storage, peers);

    // 4. Prune old queue entries
    const pruneCutoff = new Date(Date.now() - config.replicationQueueTtlHours * 3_600_000);
    const pruned = await storage.pruneReplicationQueue(pruneCutoff);
    if (pruned > 0) {
      logger.info(`Pruned ${pruned} old replication queue entries`);
    }

    logger.info('Scheduled sync cycle completed');
  } catch (err) {
    logger.error('Scheduled sync cycle failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
