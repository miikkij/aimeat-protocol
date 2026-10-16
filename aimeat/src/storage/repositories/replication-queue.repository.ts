/**
 * @file src/storage/repositories/replication-queue.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic storage contract for the per-peer federation replication queue —
 *   enqueue pending changes, dequeue a batch for a peer, mark sent/failed, prune aged entries, and
 *   report queue depth. Implemented per storage backend.
 *
 * @structure
 *   - ReplicationQueueRepository: enqueue/dequeueReplication, markReplicationSent/Failed
 *   - pruneReplicationQueue(maxAge) / replicationQueueSize(): maintenance and depth reporting
 *
 * @version-history
 *   2026-10-16 — replicationQueueSize is the rows not yet sent (status pending) on both providers (decision 2026-10-16).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { ReplicationQueueEntry } from '../interface.js';

export interface ReplicationQueueRepository {
  enqueueReplication(entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string>;
  dequeueReplication(peerId: string, limit: number): Promise<ReplicationQueueEntry[]>;
  markReplicationSent(ids: string[]): Promise<void>;
  markReplicationFailed(ids: string[]): Promise<void>;
  /** Deletes the rows older than `maxAge` and every sent row; answers how many went. */
  pruneReplicationQueue(maxAge: Date): Promise<number>;
  /** The queue depth: rows not yet sent (status pending). Sent and failed rows are not counted. */
  replicationQueueSize(): Promise<number>;
}
