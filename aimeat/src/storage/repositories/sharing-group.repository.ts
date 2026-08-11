/**
 * @file sharing-group.repository.ts
 * @description Repository interface for sharing group CRUD, member-based lookups, and the
 *   key-space shares that say what a group actually reaches.
 * @version-history
 *   v1.1.0 -- 2026-08-11 -- Key-space shares (GroupShareRecord): create/get/delete plus the two
 *     list directions the table exists for — by owner (what I share) and by group (what I was
 *     given, and the cross-owner read gate).
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type { GroupShareRecord, SharingGroupRecord } from '../interface.js';

export interface SharingGroupRepository {
  createSharingGroup(record: SharingGroupRecord): Promise<SharingGroupRecord>;
  getSharingGroup(id: string): Promise<SharingGroupRecord | null>;
  listSharingGroups(ownerGaii: string): Promise<SharingGroupRecord[]>;
  listSharingGroupsByMember(identifier: string): Promise<SharingGroupRecord[]>;
  updateSharingGroup(id: string, updates: Partial<SharingGroupRecord>): Promise<SharingGroupRecord | null>;
  deleteSharingGroup(id: string): Promise<boolean>;
  countEntriesReferencingGroup(groupId: string): Promise<number>;

  // ── Key-space shares ──
  // Three reads, because the table answers three different questions and each one is somebody's
  // whole view: the owner asking what they have given away, the reader asking what they have been
  // given, and the read path asking whether THIS key is covered right now.
  createGroupShare(record: GroupShareRecord): Promise<GroupShareRecord>;
  getGroupShare(id: string): Promise<GroupShareRecord | null>;
  /** Everything this owner shares, newest first. The Access tab's "what I have shared". */
  listGroupSharesByOwner(ownerGaii: string): Promise<GroupShareRecord[]>;
  /** Every share pointing at these groups. The reader's "what is shared with me", and the read gate. */
  listGroupSharesByGroups(groupIds: string[]): Promise<GroupShareRecord[]>;
  deleteGroupShare(id: string): Promise<boolean>;
  /** Drop every share of a group. Called when the group itself goes, so no share outlives its audience. */
  deleteGroupSharesByGroup(groupId: string): Promise<number>;
}
