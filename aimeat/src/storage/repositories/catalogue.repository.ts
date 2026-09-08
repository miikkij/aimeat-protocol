/**
 * @file src/storage/repositories/catalogue.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic repository interface for the catalogue layer — CRUD contracts for
 *   CSM (Community Schema Model) and MSM records that storage providers implement.
 *
 * @structure
 *   - CatalogueRepository: createCsm/getCsm/listCsms/deleteCsm + MSM create/get/list/update/delete
 *
 * @version-history
 *   v1.1.0 — 2026-09-09 — updateCsm deleted: no caller.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { CsmRecord, MsmRecord } from '../interface.js';

export interface CatalogueRepository {
  createCsm(record: CsmRecord): Promise<CsmRecord>;
  getCsm(name: string): Promise<CsmRecord | null>;
  listCsms(opts?: { serviceType?: string }): Promise<CsmRecord[]>;
  deleteCsm(name: string): Promise<boolean>;
  createMsm(record: MsmRecord): Promise<MsmRecord>;
  getMsm(name: string): Promise<MsmRecord | null>;
  listMsms(opts?: { category?: string }): Promise<MsmRecord[]>;
  updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null>;
  deleteMsm(name: string): Promise<boolean>;
}
