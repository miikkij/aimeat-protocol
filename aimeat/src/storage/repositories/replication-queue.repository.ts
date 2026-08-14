/**
 * @file src/storage/repositories/replication-queue.repository.ts
 * @description Backend-agnostic storage contract for the per-peer federation replication queue —
 *   enqueue pending changes, dequeue a batch for a peer, mark sent/failed, prune aged entries, and
 *   report queue depth. Implemented per storage backend.
 *
 * @structure
 *   - ReplicationQueueRepository: enqueue/dequeueReplication, markReplicationSent/Failed
 *   - pruneReplicationQueue(maxAge) / replicationQueueSize(): maintenance and depth reporting
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { ReplicationQueueEntry } from '../interface.js';

export interface ReplicationQueueRepository {
  enqueueReplication(entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string>;
  dequeueReplication(peerId: string, limit: number): Promise<ReplicationQueueEntry[]>;
  markReplicationSent(ids: string[]): Promise<void>;
  markReplicationFailed(ids: string[]): Promise<void>;
  pruneReplicationQueue(maxAge: Date): Promise<number>;
  replicationQueueSize(): Promise<number>;
}
