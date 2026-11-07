/**
 * @file src/storage/repositories/catalogue.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic repository interface for the catalogue layer — CRUD contracts for
 *   CSM (Community Schema Model) and MSM records that storage providers implement.
 *
 * @structure
 *   - CatalogueRepository: createCsm/getCsm/listCsms/deleteCsm, the CSM version and visibility
 *     methods, + MSM create/get/list/update/delete
 *
 * @version-history
 *   v1.2.0 — 2026-11-07 — replaceCsmVersion, setCsmVisibility, listCsmVersions, getCsmVersion: a CSM
 *     has a version, keeps the versions it replaced, and has a visibility. deleteCsm removes the kept
 *     versions too.
 *   v1.1.0 — 2026-09-09 — updateCsm deleted: no caller.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { CsmRecord, CsmVersionRecord, MsmRecord } from '../interface.js';

/** What PUT /v1/csm/{name} writes over the current row. */
export interface CsmVersionUpdate {
  definition: Record<string, unknown>;
  serviceType: string;
  semantic?: CsmRecord['semantic'];
  updatedAt: string;
}

export interface CatalogueRepository {
  createCsm(record: CsmRecord): Promise<CsmRecord>;
  getCsm(name: string): Promise<CsmRecord | null>;
  listCsms(opts?: { serviceType?: string }): Promise<CsmRecord[]>;
  /** Deletes the CSM and every version it kept. */
  deleteCsm(name: string): Promise<boolean>;
  /**
   * Write the next version of a CSM when its current version is `expectedVersion`: keep `previous`
   * in the version history and raise the row's version by one, in one transaction. Null, and
   * nothing written, when the row is gone or holds another version.
   */
  replaceCsmVersion(name: string, expectedVersion: number, next: CsmVersionUpdate, previous: CsmVersionRecord): Promise<CsmRecord | null>;
  setCsmVisibility(name: string, visibility: string, updatedAt: string): Promise<boolean>;
  /** The kept (replaced) versions, oldest first, at most `limit` (default 1000). */
  listCsmVersions(name: string, opts?: { limit?: number }): Promise<CsmVersionRecord[]>;
  getCsmVersion(name: string, version: number): Promise<CsmVersionRecord | null>;
  createMsm(record: MsmRecord): Promise<MsmRecord>;
  getMsm(name: string): Promise<MsmRecord | null>;
  listMsms(opts?: { category?: string }): Promise<MsmRecord[]>;
  updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null>;
  deleteMsm(name: string): Promise<boolean>;
}
