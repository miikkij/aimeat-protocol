/**
 * @file src/storage/repositories/work.repository.ts
 * @description Storage interface segment for work items (escrow/paid work between agents) — the
 *   contract every backend implements to create, fetch, update, and list work records by provider or
 *   requester GAII (identified by tracking code).
 *
 * @structure
 *   - WorkRepository: interface with createWork/getWork/updateWork plus provider/requester/all listings
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { WorkRecord } from '../interface.js';

export interface WorkRepository {
  createWork(work: WorkRecord): Promise<WorkRecord>;
  getWork(trackingCode: string): Promise<WorkRecord | null>;
  updateWork(trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null>;
  listWorkByProvider(gaii: string): Promise<WorkRecord[]>;
  listWorkByRequester(gaii: string): Promise<WorkRecord[]>;
  listAllWork(limit?: number): Promise<WorkRecord[]>;
}
