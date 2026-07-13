/**
 * @file src/storage/providers/sqlite/repos/community.ts
 * @description SQLite (better-sqlite3) repository for community/organism data — CRUD for organisms,
 *   memberships, join requests, and organism reputation, plus row deserialization (JSON columns → records).
 *
 * @structure
 *   - deserializeOrganism / deserializeMembership / deserializeJoinRequest: row → typed record mappers
 *   - createOrganism / getOrganism / listOrganisms / updateOrganism / deleteOrganism: organism CRUD
 *   - createMembership / listMembers / updateMembership / ... : membership + join-request operations
 *   - setOrganismReputation / getOrganismReputation: reputation persistence
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { OrganismRecord, OrganismMembershipRecord, JoinRequestRecord, OrganismReputationRecord } from '../../../interface.js';

// ── Organism Helpers ──

function deserializeOrganism(row: Record<string, unknown>): OrganismRecord {
  const record: OrganismRecord = {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    type: row.type as OrganismRecord['type'],
    interests: JSON.parse(row.interests as string) as string[],
    creatorGhii: row.creatorGhii as string,
    admins: JSON.parse(row.admins as string) as string[],
    members: JSON.parse(row.members as string) as string[],
    agentGaiis: JSON.parse(row.agentGaiis as string) as string[],
    boardId: row.boardId as string,
    joinPolicy: row.joinPolicy as OrganismRecord['joinPolicy'],
    maxMembers: row.maxMembers as number,
    visibility: row.visibility as OrganismRecord['visibility'],
    moderationConfig: JSON.parse(row.moderationConfig as string),
    memoryNamespace: row.memoryNamespace as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.location) record.location = JSON.parse(row.location as string);
  if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
  return record;
}

function deserializeMembership(row: Record<string, unknown>): OrganismMembershipRecord {
  const record: OrganismMembershipRecord = {
    id: row.id as string,
    organismId: row.organismId as string,
    ghii: row.ghii as string,
    role: row.role as OrganismMembershipRecord['role'],
    status: row.status as OrganismMembershipRecord['status'],
    joinedAt: row.joinedAt as string,
  };
  if (row.invitedBy) record.invitedBy = row.invitedBy as string;
  return record;
}

function deserializeJoinRequest(row: Record<string, unknown>): JoinRequestRecord {
  const record: JoinRequestRecord = {
    id: row.id as string,
    organismId: row.organismId as string,
    ghii: row.ghii as string,
    status: row.status as JoinRequestRecord['status'],
    createdAt: row.createdAt as string,
  };
  if (row.message) record.message = row.message as string;
  if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
  if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
  return record;
}

// ── Organisms ──

export function createOrganism(db: Database.Database, record: OrganismRecord): OrganismRecord {
  db.prepare(
    `INSERT INTO organisms (id, name, description, type, location, interests, creatorGhii, admins,
     members, agentGaiis, boardId, joinPolicy, maxMembers, visibility, moderationConfig,
     memoryNamespace, semantic, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.name, record.description, record.type,
    record.location ? JSON.stringify(record.location) : null,
    JSON.stringify(record.interests), record.creatorGhii,
    JSON.stringify(record.admins), JSON.stringify(record.members),
    JSON.stringify(record.agentGaiis), record.boardId,
    record.joinPolicy, record.maxMembers, record.visibility,
    JSON.stringify(record.moderationConfig), record.memoryNamespace,
    record.semantic ? JSON.stringify(record.semantic) : null,
    record.createdAt, record.updatedAt,
  );
  return record;
}

export function getOrganism(db: Database.Database, id: string): OrganismRecord | null {
  const row = db.prepare('SELECT * FROM organisms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeOrganism(row) : null;
}

export function listOrganisms(db: Database.Database, opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number }): OrganismRecord[] {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;

  const rows = db.prepare('SELECT * FROM organisms ORDER BY createdAt DESC').all() as Record<string, unknown>[];
  let results = rows.map(r => deserializeOrganism(r));

  if (opts?.type) results = results.filter(o => o.type === opts.type);
  if (opts?.city) results = results.filter(o => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
  if (opts?.interest) results = results.filter(o => o.interests.some(i => i.toLowerCase() === opts.interest!.toLowerCase()));
  if (opts?.member) results = results.filter(o => o.members.includes(opts.member!));
  if (opts?.visibility) results = results.filter(o => o.visibility === opts.visibility);

  const start = (page - 1) * perPage;
  return results.slice(start, start + perPage);
}

export function updateOrganism(db: Database.Database, id: string, updates: Partial<OrganismRecord>): OrganismRecord | null {
  const existing = getOrganism(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, id: existing.id };
  db.prepare(
    `UPDATE organisms SET name = ?, description = ?, type = ?, location = ?, interests = ?,
     creatorGhii = ?, admins = ?, members = ?, agentGaiis = ?, boardId = ?,
     joinPolicy = ?, maxMembers = ?, visibility = ?, moderationConfig = ?,
     memoryNamespace = ?, semantic = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
  ).run(
    updated.name, updated.description, updated.type,
    updated.location ? JSON.stringify(updated.location) : null,
    JSON.stringify(updated.interests), updated.creatorGhii,
    JSON.stringify(updated.admins), JSON.stringify(updated.members),
    JSON.stringify(updated.agentGaiis), updated.boardId,
    updated.joinPolicy, updated.maxMembers, updated.visibility,
    JSON.stringify(updated.moderationConfig), updated.memoryNamespace,
    updated.semantic ? JSON.stringify(updated.semantic) : null,
    updated.createdAt, updated.updatedAt, id,
  );
  return updated;
}

export function deleteOrganism(db: Database.Database, id: string): boolean {
  const txn = db.transaction(() => {
    const org = db.prepare('SELECT boardId, memoryNamespace FROM organisms WHERE id = ?').get(id) as { boardId: string; memoryNamespace: string } | undefined;

    db.prepare('DELETE FROM organism_memberships WHERE organismId = ?').run(id);
    db.prepare('DELETE FROM join_requests WHERE organismId = ?').run(id);
    db.prepare('DELETE FROM organism_reputations WHERE organismId = ?').run(id);

    if (org) {
      db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(org.boardId);
      db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(org.boardId);
      db.prepare('DELETE FROM boards WHERE id = ?').run(org.boardId);
      db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(org.memoryNamespace);
    }

    const result = db.prepare('DELETE FROM organisms WHERE id = ?').run(id);
    return result.changes > 0;
  });
  return txn();
}

// ── Memberships ──

export function createMembership(db: Database.Database, record: OrganismMembershipRecord): OrganismMembershipRecord {
  db.prepare(
    `INSERT INTO organism_memberships (id, organismId, ghii, role, status, joinedAt, invitedBy)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.organismId, record.ghii, record.role,
    record.status, record.joinedAt, record.invitedBy ?? null,
  );
  return record;
}

export function getMembership(db: Database.Database, organismId: string, ghii: string): OrganismMembershipRecord | null {
  const row = db.prepare('SELECT * FROM organism_memberships WHERE organismId = ? AND ghii = ?').get(organismId, ghii) as Record<string, unknown> | undefined;
  return row ? deserializeMembership(row) : null;
}

export function listMembers(db: Database.Database, organismId: string, opts?: { role?: string; status?: string }): OrganismMembershipRecord[] {
  let sql = 'SELECT * FROM organism_memberships WHERE organismId = ?';
  const params: unknown[] = [organismId];
  if (opts?.role) { sql += ' AND role = ?'; params.push(opts.role); }
  if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeMembership(r));
}

export function listMembershipsByGhii(db: Database.Database, ghii: string): OrganismMembershipRecord[] {
  const rows = db.prepare('SELECT * FROM organism_memberships WHERE ghii = ?').all(ghii) as Record<string, unknown>[];
  return rows.map(r => deserializeMembership(r));
}

export function updateMembership(db: Database.Database, id: string, updates: Partial<OrganismMembershipRecord>): OrganismMembershipRecord | null {
  const row = db.prepare('SELECT * FROM organism_memberships WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const existing = deserializeMembership(row);
  const updated = { ...existing, ...updates, id: existing.id };
  db.prepare(
    `UPDATE organism_memberships SET organismId = ?, ghii = ?, role = ?, status = ?, joinedAt = ?, invitedBy = ? WHERE id = ?`
  ).run(
    updated.organismId, updated.ghii, updated.role, updated.status,
    updated.joinedAt, updated.invitedBy ?? null, id,
  );
  return updated;
}

export function deleteMembership(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM organism_memberships WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Join Requests ──

export function createJoinRequest(db: Database.Database, record: JoinRequestRecord): JoinRequestRecord {
  db.prepare(
    `INSERT INTO join_requests (id, organismId, ghii, message, status, reviewedBy, createdAt, reviewedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.organismId, record.ghii, record.message ?? null,
    record.status, record.reviewedBy ?? null, record.createdAt, record.reviewedAt ?? null,
  );
  return record;
}

export function getJoinRequest(db: Database.Database, id: string): JoinRequestRecord | null {
  const row = db.prepare('SELECT * FROM join_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeJoinRequest(row) : null;
}

export function listJoinRequests(db: Database.Database, organismId: string, opts?: { status?: string }): JoinRequestRecord[] {
  let sql = 'SELECT * FROM join_requests WHERE organismId = ?';
  const params: unknown[] = [organismId];
  if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeJoinRequest(r));
}

export function updateJoinRequest(db: Database.Database, id: string, updates: Partial<JoinRequestRecord>): JoinRequestRecord | null {
  const existing = getJoinRequest(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, id: existing.id };
  db.prepare(
    `UPDATE join_requests SET organismId = ?, ghii = ?, message = ?, status = ?,
     reviewedBy = ?, createdAt = ?, reviewedAt = ? WHERE id = ?`
  ).run(
    updated.organismId, updated.ghii, updated.message ?? null,
    updated.status, updated.reviewedBy ?? null,
    updated.createdAt, updated.reviewedAt ?? null, id,
  );
  return updated;
}

// ── Organism Reputation ──

export function setOrganismReputation(db: Database.Database, record: OrganismReputationRecord): OrganismReputationRecord {
  db.prepare(
    `INSERT OR REPLACE INTO organism_reputations (organismId, score, breakdown, calculatedAt)
     VALUES (?, ?, ?, ?)`
  ).run(
    record.organismId, record.score,
    JSON.stringify(record.breakdown), record.calculatedAt,
  );
  return record;
}

export function getOrganismReputation(db: Database.Database, organismId: string): OrganismReputationRecord | null {
  const row = db.prepare('SELECT * FROM organism_reputations WHERE organismId = ?').get(organismId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    organismId: row.organismId as string,
    score: row.score as number,
    breakdown: JSON.parse(row.breakdown as string),
    calculatedAt: row.calculatedAt as string,
  };
}
