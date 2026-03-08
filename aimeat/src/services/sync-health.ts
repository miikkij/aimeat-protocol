/**
 * Sync Health & Peer Priority — monitors sync infrastructure health
 * and computes peer priority scores for sync ordering.
 * Per RFC v1.6 §32.6.3 (throttling) and §32.6.4 (peer priority).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { getPeerSyncState } from './catalogue-sync.js';
import { logger } from '../utils/logger.js';

export interface SyncHealthMetrics {
  queueDepth: number;
  avgSyncDurationMs: number;
  failureRate: number;         // 0.0–1.0
  activeSyncs: number;
  throttled: boolean;
  throttleReason: string | null;
  lastCheckedAt: string;
}

export interface PeerPriority {
  peerId: string;
  nodeId: string;
  score: number;              // higher = higher priority
  factors: {
    statusWeight: number;     // active=1.0, degraded=0.5
    failureWeight: number;    // 1.0 - (failures / 10)
    lastSyncAge: number;      // hours since last successful sync
    recencyWeight: number;    // older = higher priority
  };
}

/** Track sync durations for average calculation. */
const syncDurations: number[] = [];
const MAX_DURATION_SAMPLES = 100;

/** Track current active sync count. */
let activeSyncCount = 0;

/** Track sync attempts and failures for rate calculation. */
let totalSyncAttempts = 0;
let totalSyncFailures = 0;

/** Whether throttling is currently active. */
let isThrottled = false;
let throttleReason: string | null = null;

/** Record a sync duration sample. */
export function recordSyncDuration(durationMs: number): void {
  syncDurations.push(durationMs);
  if (syncDurations.length > MAX_DURATION_SAMPLES) {
    syncDurations.shift();
  }
}

/** Record a sync attempt. */
export function recordSyncAttempt(success: boolean): void {
  totalSyncAttempts++;
  if (!success) totalSyncFailures++;
}

/** Increment/decrement active sync count. */
export function incrementActiveSyncs(): void { activeSyncCount++; }
export function decrementActiveSyncs(): void { activeSyncCount = Math.max(0, activeSyncCount - 1); }

/**
 * Get current sync health metrics.
 */
export async function getSyncHealthMetrics(storage: Storage): Promise<SyncHealthMetrics> {
  const queueDepth = await storage.replicationQueueSize();

  const avgDuration = syncDurations.length > 0
    ? syncDurations.reduce((a, b) => a + b, 0) / syncDurations.length
    : 0;

  const failureRate = totalSyncAttempts > 0
    ? totalSyncFailures / totalSyncAttempts
    : 0;

  // Throttling rules per §32.6.3
  const shouldThrottle = queueDepth > 1000 || failureRate > 0.5 || activeSyncCount > 10;

  if (shouldThrottle && !isThrottled) {
    isThrottled = true;
    throttleReason = queueDepth > 1000
      ? `Queue depth ${queueDepth} exceeds 1000`
      : failureRate > 0.5
        ? `Failure rate ${(failureRate * 100).toFixed(1)}% exceeds 50%`
        : `Active syncs ${activeSyncCount} exceeds 10`;
    logger.warn('Sync throttling activated', { reason: throttleReason });
  } else if (!shouldThrottle && isThrottled) {
    isThrottled = false;
    throttleReason = null;
    logger.info('Sync throttling deactivated — conditions cleared');
  }

  return {
    queueDepth,
    avgSyncDurationMs: Math.round(avgDuration),
    failureRate: Math.round(failureRate * 1000) / 1000,
    activeSyncs: activeSyncCount,
    throttled: isThrottled,
    throttleReason,
    lastCheckedAt: new Date().toISOString(),
  };
}

/**
 * Check if sync operations should be throttled.
 */
export function isSyncThrottled(): boolean {
  return isThrottled;
}

/**
 * Compute peer priority scores for sync ordering.
 * Higher score = higher priority (should sync first).
 *
 * Factors (per §32.6.4):
 * - Peer status (active > degraded)
 * - Consecutive failure count (fewer failures = higher priority)
 * - Time since last successful sync (longer = higher priority)
 */
export function computePeerPriorities(
  peers: Map<string, PeerInfo>,
): PeerPriority[] {
  const priorities: PeerPriority[] = [];
  const now = Date.now();

  for (const [peerId, peer] of peers) {
    if (peer.status !== 'active' && peer.status !== 'degraded') continue;

    const syncState = getPeerSyncState(peerId);

    // Status weight: active peers get full priority, degraded peers get half
    const statusWeight = peer.status === 'active' ? 1.0 : 0.5;

    // Failure weight: decreases with consecutive failures (0 failures = 1.0, 10+ = 0.0)
    const failureWeight = Math.max(0, 1.0 - (syncState.consecutiveFailures / 10));

    // Last sync age in hours (older = higher recency weight)
    const lastSyncAge = syncState.lastSyncAt
      ? (now - new Date(syncState.lastSyncAt).getTime()) / 3_600_000
      : 999; // Never synced = very high priority

    // Recency weight: normalized 0-1 where older = higher (cap at 168h / 1 week)
    const recencyWeight = Math.min(lastSyncAge / 168, 1.0);

    // Composite score
    const score = (statusWeight * 0.3) + (failureWeight * 0.3) + (recencyWeight * 0.4);

    priorities.push({
      peerId,
      nodeId: peer.nodeId,
      score,
      factors: {
        statusWeight,
        failureWeight,
        lastSyncAge: Math.round(lastSyncAge * 10) / 10,
        recencyWeight: Math.round(recencyWeight * 1000) / 1000,
      },
    });
  }

  // Sort by score descending (highest priority first)
  priorities.sort((a, b) => b.score - a.score);

  return priorities;
}
