/**
 * @file src/storage/repositories/owner.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-layer interface for owner (GHII account) persistence, implemented per backend
 *   (SQLite / Prisma).
 *
 * @structure
 *   - OwnerRepository: createOwner / getOwner / listOwners / updateOwner / deleteOwner
 *
 * @version-history
 *   2026-10-16 — operatorAccountState: whether any account and any operator exist, as two EXISTS
 *     queries, for the sign-in and registration paths that listed every owner to ask it (QA audit P7-10).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { OwnerRecord } from '../interface.js';

export interface OwnerRepository {
  createOwner(owner: OwnerRecord): Promise<OwnerRecord>;
  getOwner(name: string): Promise<OwnerRecord | null>;
  listOwners(): Promise<OwnerRecord[]>;
  /**
   * Whether any account other than `anonymous` exists, and whether any account holds the operator
   * role. Two EXISTS queries: every registration and every sign-in of an account that is not an
   * operator asks this, and it used to load the whole owner table to answer (QA audit P7-10).
   */
  operatorAccountState(): Promise<{ anyOwner: boolean; anyOperator: boolean }>;
  updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null>;
  deleteOwner(name: string): Promise<boolean>;
}
