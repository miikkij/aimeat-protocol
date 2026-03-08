import type { ReplicationQueueEntry } from '../interface.js';

export interface ReplicationQueueRepository {
  enqueueReplication(entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string>;
  dequeueReplication(peerId: string, limit: number): Promise<ReplicationQueueEntry[]>;
  markReplicationSent(ids: string[]): Promise<void>;
  markReplicationFailed(ids: string[]): Promise<void>;
  pruneReplicationQueue(maxAge: Date): Promise<number>;
  replicationQueueSize(): Promise<number>;
}
