import type { MemoryRecord } from '../interface.js';

export interface MemoryRepository {
  setMemory(record: MemoryRecord): Promise<MemoryRecord>;
  /** Atomically update memory only if the current version matches expectedVersion. Returns null on conflict. */
  setMemoryIfVersion?(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null>;
  getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null>;
  listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number }): Promise<MemoryRecord[]>;
  deleteMemory(ownerGaii: string, key: string): Promise<boolean>;
  deleteAllMemory(ownerGaii: string): Promise<number>;
  incrementMemoryFlagCount(ownerGaii: string, key: string): Promise<void>;
  searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number }): Promise<MemoryRecord[]>;
}
