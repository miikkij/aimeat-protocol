/**
 * @file sharing-group.ts
 * @description SQLite implementation for sharing group CRUD and member-based lookups
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type Database from 'better-sqlite3';
import type { SharingGroupRecord } from '../../../interface.js';

// ── Helpers ──

function deserializeSharingGroup(row: Record<string, unknown>): SharingGroupRecord {
  const record: SharingGroupRecord = {
    id: row.id as string,
    name: row.name as string,
    ownerGaii: row.ownerGaii as string,
    members: JSON.parse(row.members as string),
    defaultPermissions: JSON.parse(row.defaultPermissions as string),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.description) record.description = row.description as string;
  return record;
}

// ── Sharing Groups ──

export function createSharingGroup(db: Database.Database, record: SharingGroupRecord): SharingGroupRecord {
  db.prepare(
    `INSERT INTO sharing_groups
     (id, name, description, ownerGaii, members, defaultPermissions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.name,
    record.description ?? null,
    record.ownerGaii,
    JSON.stringify(record.members),
    JSON.stringify(record.defaultPermissions),
    record.createdAt,
    record.updatedAt,
  );
  return record;
}

export function getSharingGroup(db: Database.Database, id: string): SharingGroupRecord | null {
  const row = db.prepare('SELECT * FROM sharing_groups WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeSharingGroup(row) : null;
}

export function listSharingGroups(db: Database.Database, ownerGaii: string): SharingGroupRecord[] {
  const rows = db.prepare('SELECT * FROM sharing_groups WHERE ownerGaii = ? ORDER BY createdAt DESC').all(ownerGaii) as Record<string, unknown>[];
  return rows.map(deserializeSharingGroup);
}

export function listSharingGroupsByMember(db: Database.Database, identifier: string): SharingGroupRecord[] {
  const rows = db.prepare(
    `SELECT sg.* FROM sharing_groups sg, json_each(sg.members) m
     WHERE json_extract(m.value, '$.identifier') = ?`
  ).all(identifier) as Record<string, unknown>[];
  return rows.map(deserializeSharingGroup);
}

export function updateSharingGroup(
  db: Database.Database,
  id: string,
  updates: Partial<SharingGroupRecord>,
): SharingGroupRecord | null {
  const existing = getSharingGroup(db, id);
  if (!existing) return null;

  const merged: SharingGroupRecord = {
    ...existing,
    ...updates,
    id: existing.id, // id is immutable
    ownerGaii: existing.ownerGaii, // ownerGaii is immutable
    createdAt: existing.createdAt, // createdAt is immutable
  };

  db.prepare(
    `UPDATE sharing_groups SET
       name = ?, description = ?, members = ?,
       defaultPermissions = ?, updatedAt = ?
     WHERE id = ?`
  ).run(
    merged.name,
    merged.description ?? null,
    JSON.stringify(merged.members),
    JSON.stringify(merged.defaultPermissions),
    merged.updatedAt,
    id,
  );

  return merged;
}

export function deleteSharingGroup(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM sharing_groups WHERE id = ?').run(id);
  return result.changes > 0;
}

export function countEntriesReferencingGroup(db: Database.Database, groupId: string): number {
  const memoryCount = (db.prepare('SELECT COUNT(*) as cnt FROM memory WHERE groupId = ?').get(groupId) as { cnt: number }).cnt;
  const fileCount = (db.prepare('SELECT COUNT(*) as cnt FROM storage_files WHERE groupId = ?').get(groupId) as { cnt: number }).cnt;
  return memoryCount + fileCount;
}
