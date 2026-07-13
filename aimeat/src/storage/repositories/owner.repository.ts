/**
 * @file src/storage/repositories/owner.repository.ts
 * @description Storage-layer interface for owner (GHII account) persistence, implemented per backend
 *   (SQLite / Prisma).
 *
 * @structure
 *   - OwnerRepository: createOwner / getOwner / listOwners / updateOwner / deleteOwner
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { OwnerRecord } from '../interface.js';

export interface OwnerRepository {
  createOwner(owner: OwnerRecord): Promise<OwnerRecord>;
  getOwner(name: string): Promise<OwnerRecord | null>;
  listOwners(): Promise<OwnerRecord[]>;
  updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null>;
  deleteOwner(name: string): Promise<boolean>;
}
