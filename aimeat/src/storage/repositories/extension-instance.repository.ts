/**
 * @file src/storage/repositories/extension-instance.repository.ts
 * @description Storage-backend-agnostic interface for extension instance records — per-owner
 *   instantiations of an extension. Each backend (SQLite, MongoDB, PostgreSQL) implements it.
 *
 * @structure
 *   - ExtensionInstanceRepository: create/get/list/update/delete instances by extension + instanceId
 *   - deleteExtensionInstancesByOwner(ownerIdentity): cascade cleanup for an owner
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { ExtensionInstanceRecord } from '../interface.js';

export interface ExtensionInstanceRepository {
  createExtensionInstance(record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord>;
  getExtensionInstance(extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null>;
  listExtensionInstances(extensionName: string): Promise<ExtensionInstanceRecord[]>;
  updateExtensionInstance(extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null>;
  deleteExtensionInstance(extensionName: string, instanceId: string): Promise<boolean>;
  deleteExtensionInstancesByOwner(ownerIdentity: string): Promise<number>;
}
