/**
 * @file sharing-group.repository.ts
 * @description Repository interface for sharing group CRUD and member-based lookups
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type { SharingGroupRecord } from '../interface.js';

export interface SharingGroupRepository {
  createSharingGroup(record: SharingGroupRecord): Promise<SharingGroupRecord>;
  getSharingGroup(id: string): Promise<SharingGroupRecord | null>;
  listSharingGroups(ownerGaii: string): Promise<SharingGroupRecord[]>;
  listSharingGroupsByMember(identifier: string): Promise<SharingGroupRecord[]>;
  updateSharingGroup(id: string, updates: Partial<SharingGroupRecord>): Promise<SharingGroupRecord | null>;
  deleteSharingGroup(id: string): Promise<boolean>;
  countEntriesReferencingGroup(groupId: string): Promise<number>;
}
