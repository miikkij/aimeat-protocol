/**
 * @file src/storage/repositories/micro-memory.repository.ts
 * @description Storage-interface contract for micro-memory sets — the backend-agnostic repository shape
 *   each provider implements for the (deprecated) access-code-addressable micro-memory feature.
 *
 * @structure
 *   - MicroMemoryRepository: set/get/list/delete micro-memory sets, delete a single entry,
 *     and lookup a set by its access code
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { MicroMemoryRecord } from '../interface.js';

export interface MicroMemoryRepository {
  setMicroMemory(record: MicroMemoryRecord): Promise<MicroMemoryRecord>;
  getMicroMemory(gaii: string, set: string): Promise<MicroMemoryRecord | null>;
  listMicroMemorySets(gaii: string): Promise<MicroMemoryRecord[]>;
  /** Total micro-memory bytes + set count across MANY identities in ONE query (usage summary; keeps it
   *  off a per-identity fan-out over this deprecated subsystem). */
  getMicroMemoryTotalForOwners(gaiis: string[]): Promise<{ bytes: number; sets: number }>;
  deleteMicroMemory(gaii: string, set: string): Promise<boolean>;
  deleteMicroMemoryEntry(gaii: string, set: string, key: string): Promise<boolean>;
  findMicroMemoryByAccessCode(set: string, accessCode: string): Promise<MicroMemoryRecord | null>;
}
