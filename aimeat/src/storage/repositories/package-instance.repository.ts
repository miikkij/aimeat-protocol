/**
 * @file package-instance.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package instance repository interface — tracks installed copies of packages.
 *   Each instance links to a package group and version, and records the real components
 *   created during installation with their original content hashes for customization detection.
 * @structure PackageInstanceRepository interface with CRUD and query methods
 * @usage import type { PackageInstanceRepository } from './package-instance.repository.js';
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 1 storage layer)
 */

import type { PackageInstanceRecord, InstanceFilter } from '../interface.js';

export interface PackageInstanceRepository {
  createInstance(record: PackageInstanceRecord): Promise<PackageInstanceRecord>;
  getInstance(id: string): Promise<PackageInstanceRecord | null>;
  listInstances(filter: InstanceFilter): Promise<{ instances: PackageInstanceRecord[]; total: number }>;
  updateInstance(id: string, updates: Partial<PackageInstanceRecord>): Promise<PackageInstanceRecord | null>;
  deleteInstance(id: string): Promise<boolean>;
  listInstancesByPackage(packageGroupId: string): Promise<{ instances: PackageInstanceRecord[]; total: number }>;
}
