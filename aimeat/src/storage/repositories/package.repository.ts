/**
 * @file package.repository.ts
 * @description Package domain repository interface — create, retrieve, update, and archive
 *   versioned package records. Each record represents a single version; all versions of
 *   the same package share a packageGroupId.
 * @structure PackageRepository interface with CRUD, version queries, and archive
 * @usage import type { PackageRepository } from './package.repository.js';
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 1 storage layer)
 */

import type { PackageRecord, PackageFilter } from '../interface.js';

export interface PackageRepository {
  createPackage(record: PackageRecord): Promise<PackageRecord>;
  getPackage(id: string): Promise<PackageRecord | null>;
  getPackageByGroupAndVersion(groupId: string, version: string): Promise<PackageRecord | null>;
  getLatestPublished(groupId: string): Promise<PackageRecord | null>;
  listPackages(filter: PackageFilter): Promise<{ packages: PackageRecord[]; total: number }>;
  listVersions(groupId: string, limit?: number, offset?: number): Promise<{ versions: PackageRecord[]; total: number }>;
  updatePackage(id: string, updates: Partial<PackageRecord>): Promise<PackageRecord | null>;
  archivePackage(id: string): Promise<boolean>;
}
