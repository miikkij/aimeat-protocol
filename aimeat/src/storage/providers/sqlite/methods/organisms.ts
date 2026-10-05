/**
 * @file src/storage/providers/sqlite/methods/organisms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/organisms.ts (organismMethods), so a
 *   fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure organismMethods
 * @usage Object.assign(SqliteStorage.prototype, organismMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — createOrganism, getOrganism, listOrganisms, updateOrganism, deleteOrganism,
 *     deserializeOrganism moved here from governance.ts; 20 methods (createMembership, getMembership,
 *     listMembers, …) moved here from community.ts so the file mirrors postgres-kysely/methods/organisms.ts
 *     (secaudit 2026-10, M8).
 */
import type {
  ArchiveFilter, OrganismRecord, OrganismMembershipRecord, JoinRequestRecord, PendingApprovalRecord,
  OrganismReputationRecord,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { logger } from '../../../../utils/logger.js';

/** The organism `owners` JSON array, or the single owner the row had before the column existed. */
function parseOwners(raw: unknown, creatorGhii: string): string[] {
  if (typeof raw !== 'string' || !raw) return [creatorGhii];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Narrowing to the creator is the safe direction, so the value stays. What did not stay is the
    // silence: this returned exactly what the "column did not exist" path above returns, so a
    // CORRUPT owners column and an old row were indistinguishable, and an organism could quietly
    // lose its co-owners with nothing to read.
    logger.warn('Organism owners column does not parse; falling back to the creator alone', {
      creatorGhii, error: e instanceof Error ? e.message : String(e),
    });
    return [creatorGhii];
  }
  if (Array.isArray(parsed) && parsed.length) return parsed.filter((x): x is string => typeof x === 'string');
  return [creatorGhii];
}

export const organismMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Organisms ──
  // ══════════════════════════════════════════════════════════

  async createOrganism(this: SqliteStorage, record: OrganismRecord): Promise<OrganismRecord> {
    this.db.prepare(
      `INSERT INTO organisms (id, name, description, type, location, interests, creatorGhii, createdBy, owners, admins,
       members, agentGaiis, boardId, joinPolicy, maxMembers, visibility, memberVisibility, agentAccess, moderationConfig,
       memoryNamespace, semantic, createdAt, updatedAt, archived, archivedAt, archivedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.description, record.type,
      record.location ? JSON.stringify(record.location) : null,
      JSON.stringify(record.interests), record.creatorGhii,
      record.createdBy ?? record.creatorGhii,
      JSON.stringify(record.owners?.length ? record.owners : [record.creatorGhii]),
      JSON.stringify(record.admins), JSON.stringify(record.members),
      JSON.stringify(record.agentGaiis), record.boardId,
      record.joinPolicy, record.maxMembers, record.visibility,
      record.memberVisibility ?? null,
      record.agentAccess ?? null,
      JSON.stringify(record.moderationConfig), record.memoryNamespace,
      record.semantic ? JSON.stringify(record.semantic) : null,
      record.createdAt, record.updatedAt,
      record.archived ? 1 : 0, record.archivedAt ?? null, record.archivedBy ?? null,
    );
    return record;
  },

  async getOrganism(this: SqliteStorage, id: string): Promise<OrganismRecord | null> {
    const row = this.db.prepare('SELECT * FROM organisms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeOrganism(row) : null;
  },

  async listOrganisms(this: SqliteStorage, opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number; archived?: ArchiveFilter }): Promise<OrganismRecord[]> {
    const page = opts?.page ?? 1;
    // Member-scoped queries return ALL matches by default (an owner's membership set is naturally bounded);
    // never silently truncate to a page, which drops the owner's oldest organisms from "My Organisms" once
    // they belong to more than one page. Only browse/discovery (no member filter) page-caps by default.
    const perPage = opts?.perPage ?? (opts?.member ? Number.MAX_SAFE_INTEGER : 20);

    const rows = this.db.prepare('SELECT * FROM organisms ORDER BY createdAt DESC').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeOrganism(r));

    // Archive filter (default 'include' — preserve legacy behaviour; callers that browse/discover pass
    // 'exclude' so archived organisms drop out; 'only' powers an "Archived" view).
    if (opts?.archived === 'exclude') results = results.filter(o => !o.archived);
    else if (opts?.archived === 'only') results = results.filter(o => !!o.archived);
    if (opts?.type) results = results.filter(o => o.type === opts.type);
    if (opts?.city) results = results.filter(o => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    if (opts?.interest) results = results.filter(o => o.interests.some(i => i.toLowerCase() === opts.interest!.toLowerCase()));
    if (opts?.member) results = results.filter(o => o.members.includes(opts.member!));
    if (opts?.visibility) results = results.filter(o => o.visibility === opts.visibility);

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  },

  async updateOrganism(this: SqliteStorage, id: string, updates: Partial<OrganismRecord>): Promise<OrganismRecord | null> {
    const existing = await this.getOrganism(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE organisms SET name = ?, description = ?, type = ?, location = ?, interests = ?,
       creatorGhii = ?, createdBy = ?, owners = ?, admins = ?, members = ?, agentGaiis = ?, boardId = ?,
       joinPolicy = ?, maxMembers = ?, visibility = ?, memberVisibility = ?, agentAccess = ?, moderationConfig = ?,
       memoryNamespace = ?, semantic = ?, createdAt = ?, updatedAt = ?,
       archived = ?, archivedAt = ?, archivedBy = ? WHERE id = ?`
    ).run(
      updated.name, updated.description, updated.type,
      updated.location ? JSON.stringify(updated.location) : null,
      JSON.stringify(updated.interests), updated.creatorGhii,
      updated.createdBy ?? updated.creatorGhii,
      JSON.stringify(updated.owners?.length ? updated.owners : [updated.creatorGhii]),
      JSON.stringify(updated.admins), JSON.stringify(updated.members),
      JSON.stringify(updated.agentGaiis), updated.boardId,
      updated.joinPolicy, updated.maxMembers, updated.visibility,
      updated.memberVisibility ?? null,
      updated.agentAccess ?? null,
      JSON.stringify(updated.moderationConfig), updated.memoryNamespace,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.createdAt, updated.updatedAt,
      updated.archived ? 1 : 0, updated.archivedAt ?? null, updated.archivedBy ?? null, id,
    );
    return updated;
  },

  async deleteOrganism(this: SqliteStorage, id: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // Get the organism to find its boardId and memoryNamespace
      const org = this.db.prepare('SELECT boardId, memoryNamespace FROM organisms WHERE id = ?').get(id) as { boardId: string; memoryNamespace: string } | undefined;

      // Cascade: delete memberships and join requests
      this.db.prepare('DELETE FROM organism_memberships WHERE organismId = ?').run(id);
      this.db.prepare('DELETE FROM join_requests WHERE organismId = ?').run(id);

      // Cascade: delete organism reputation
      this.db.prepare('DELETE FROM organism_reputations WHERE organismId = ?').run(id);

      if (org) {
        // Cascade: delete the organism's board and its posts/subscriptions
        this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(org.boardId);
        this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(org.boardId);
        this.db.prepare('DELETE FROM boards WHERE id = ?').run(org.boardId);

        // Cascade: delete ALL content under the organism's key namespace, across every owner. The
        // workspace records/documents/meta are keyed `organism.{id}.…` but OWNED by the member who
        // wrote them (creator GHII, a contributor's GAII), NOT by `memoryNamespace` — so a
        // delete-by-ownerGaii left them orphaned (and still searchable via the FTS index). Delete by
        // key prefix instead; the memory_fts AFTER DELETE trigger clears the search index in step.
        const orgKey = `organism.${id}`;
        const orgPrefix = `organism.${id}.%`;
        this.db.prepare('DELETE FROM memory WHERE key = ? OR key LIKE ?').run(orgKey, orgPrefix);
        this.db.prepare('DELETE FROM memory_history WHERE key = ? OR key LIKE ?').run(orgKey, orgPrefix);
        this.db.prepare('DELETE FROM schemas WHERE keyPattern = ? OR keyPattern LIKE ?').run(orgKey, orgPrefix);
      }
      // The classification labels on the organism's content go with it (TARGET-082).
      this.db.prepare('DELETE FROM content_labels WHERE scope = ?').run(`organism:${id}`);
      // So does the classification audit log of that content (TARGET-082 V4).
      this.db.prepare('DELETE FROM classification_audit WHERE scope = ?').run(`organism:${id}`);

      const result = this.db.prepare('DELETE FROM organisms WHERE id = ?').run(id);
      return result.changes > 0;
    });
    return txn();
  },

  /** owners is a JSON array column added after the fact: absent, empty or malformed all mean
   *  "whatever creatorGhii said", which is the only owner such a row ever had. */
  deserializeOrganism(this: SqliteStorage, row: Record<string, unknown>): OrganismRecord {
    const record: OrganismRecord = {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      type: row.type as OrganismRecord['type'],
      interests: JSON.parse(row.interests as string) as string[],
      creatorGhii: row.creatorGhii as string,
      // Rows written before the ownership split carry neither column; creatorGhii was the only answer
      // the node had, so it is the fallback for both (schema.ts backfills the same way on boot).
      createdBy: (row.createdBy as string | null) ?? (row.creatorGhii as string),
      owners: parseOwners(row.owners, row.creatorGhii as string),
      admins: JSON.parse(row.admins as string) as string[],
      members: JSON.parse(row.members as string) as string[],
      agentGaiis: JSON.parse(row.agentGaiis as string) as string[],
      boardId: row.boardId as string,
      joinPolicy: row.joinPolicy as OrganismRecord['joinPolicy'],
      maxMembers: row.maxMembers as number,
      visibility: row.visibility as OrganismRecord['visibility'],
      memberVisibility: (row.memberVisibility as OrganismRecord['memberVisibility'] | null) ?? undefined,
      agentAccess: (row.agentAccess as OrganismRecord['agentAccess'] | null) ?? undefined,
      moderationConfig: JSON.parse(row.moderationConfig as string),
      memoryNamespace: row.memoryNamespace as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.location) record.location = JSON.parse(row.location as string);
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.archived) record.archived = true;
    if (row.archivedAt) record.archivedAt = row.archivedAt as string;
    if (row.archivedBy) record.archivedBy = row.archivedBy as string;
    return record;
  },
  // ── Memberships ──
  // ══════════════════════════════════════════════════════════

  async createMembership(this: SqliteStorage, record: OrganismMembershipRecord): Promise<OrganismMembershipRecord> {
    this.db.prepare(
      `INSERT INTO organism_memberships (id, organismId, ghii, role, status, joinedAt, invitedBy, invitedWorkspaces)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.ghii, record.role,
      record.status, record.joinedAt, record.invitedBy ?? null,
      record.invitedWorkspaces?.length ? JSON.stringify(record.invitedWorkspaces) : null,
    );
    return record;
  },

  async getMembership(this: SqliteStorage, organismId: string, ghii: string): Promise<OrganismMembershipRecord | null> {
    const row = this.db.prepare('SELECT * FROM organism_memberships WHERE organismId = ? AND ghii = ?').get(organismId, ghii) as Record<string, unknown> | undefined;
    return row ? this.deserializeMembership(row) : null;
  },

  async listMembers(this: SqliteStorage, organismId: string, opts?: { role?: string; status?: string }): Promise<OrganismMembershipRecord[]> {
    let sql = 'SELECT * FROM organism_memberships WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.role) { sql += ' AND role = ?'; params.push(opts.role); }
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMembership(r));
  },

  async listMembershipsByGhii(this: SqliteStorage, ghii: string): Promise<OrganismMembershipRecord[]> {
    const rows = this.db.prepare('SELECT * FROM organism_memberships WHERE ghii = ?').all(ghii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMembership(r));
  },

  async updateMembership(this: SqliteStorage, id: string, updates: Partial<OrganismMembershipRecord>): Promise<OrganismMembershipRecord | null> {
    const row = this.db.prepare('SELECT * FROM organism_memberships WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const existing = this.deserializeMembership(row);
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE organism_memberships SET organismId = ?, ghii = ?, role = ?, status = ?, joinedAt = ?, invitedBy = ?, invitedWorkspaces = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.ghii, updated.role, updated.status,
      updated.joinedAt, updated.invitedBy ?? null,
      updated.invitedWorkspaces?.length ? JSON.stringify(updated.invitedWorkspaces) : null, id,
    );
    return updated;
  },

  async deleteMembership(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM organism_memberships WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeMembership(this: SqliteStorage, row: Record<string, unknown>): OrganismMembershipRecord {
    const record: OrganismMembershipRecord = {
      id: row.id as string,
      organismId: row.organismId as string,
      ghii: row.ghii as string,
      role: row.role as OrganismMembershipRecord['role'],
      status: row.status as OrganismMembershipRecord['status'],
      joinedAt: row.joinedAt as string,
    };
    if (row.invitedBy) record.invitedBy = row.invitedBy as string;
    if (row.invitedWorkspaces) {
      try {
        record.invitedWorkspaces = JSON.parse(row.invitedWorkspaces as string);
      } catch (err) {
        // Dropping this silently means an invite that grants NO workspaces looks like an invite
        // that was never meant to grant any. Name the row instead.
        logger.warn('Membership row has malformed invitedWorkspaces JSON; the invite grants no workspaces', { id: row.id, error: (err as Error).message });
      }
    }
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Join Requests ──
  // ══════════════════════════════════════════════════════════

  async createJoinRequest(this: SqliteStorage, record: JoinRequestRecord): Promise<JoinRequestRecord> {
    this.db.prepare(
      `INSERT INTO join_requests (id, organismId, ghii, message, status, reviewedBy, createdAt, reviewedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.ghii, record.message ?? null,
      record.status, record.reviewedBy ?? null, record.createdAt, record.reviewedAt ?? null,
    );
    return record;
  },

  async getJoinRequest(this: SqliteStorage, id: string): Promise<JoinRequestRecord | null> {
    const row = this.db.prepare('SELECT * FROM join_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeJoinRequest(row) : null;
  },

  async listJoinRequests(this: SqliteStorage, organismId: string, opts?: { status?: string }): Promise<JoinRequestRecord[]> {
    let sql = 'SELECT * FROM join_requests WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeJoinRequest(r));
  },

  async updateJoinRequest(this: SqliteStorage, id: string, updates: Partial<JoinRequestRecord>): Promise<JoinRequestRecord | null> {
    const existing = await this.getJoinRequest(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE join_requests SET organismId = ?, ghii = ?, message = ?, status = ?,
       reviewedBy = ?, createdAt = ?, reviewedAt = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.ghii, updated.message ?? null,
      updated.status, updated.reviewedBy ?? null,
      updated.createdAt, updated.reviewedAt ?? null, id,
    );
    return updated;
  },

  deserializeJoinRequest(this: SqliteStorage, row: Record<string, unknown>): JoinRequestRecord {
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
  },

  // ══════════════════════════════════════════════════════════
  // ── Pending Approvals (Phase 4 — Gate primitive) ──
  // ══════════════════════════════════════════════════════════

  async createPendingApproval(this: SqliteStorage, record: PendingApprovalRecord): Promise<PendingApprovalRecord> {
    this.db.prepare(
      `INSERT INTO pending_approvals (id, organismId, flowGateId, stageId, actor, action, arguments,
         risk, approverRole, prompt, status, decidedBy, decidedAt, resolutionNote, deadline, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.flowGateId ?? null, record.stageId ?? null,
      record.actor, record.action, record.arguments !== undefined ? JSON.stringify(record.arguments) : null,
      record.risk, record.approverRole, record.prompt ?? null, record.status,
      record.decidedBy ?? null, record.decidedAt ?? null, record.resolutionNote ?? null,
      record.deadline ?? null, record.createdAt, record.updatedAt,
    );
    return record;
  },

  async getPendingApproval(this: SqliteStorage, id: string): Promise<PendingApprovalRecord | null> {
    const row = this.db.prepare('SELECT * FROM pending_approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePendingApproval(row) : null;
  },

  async listPendingApprovals(this: SqliteStorage, organismId: string, opts?: { status?: string }): Promise<PendingApprovalRecord[]> {
    let sql = 'SELECT * FROM pending_approvals WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    sql += ' ORDER BY createdAt DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePendingApproval(r));
  },

  // BULK (Phase 3) — pending approvals for MANY organisms in ONE `organismId IN (…)` query, grouped by org.
  async listPendingApprovalsForOrgs(this: SqliteStorage, organismIds: string[], opts?: { status?: string }): Promise<Record<string, PendingApprovalRecord[]>> {
    if (organismIds.length === 0) return {};
    const ph = organismIds.map(() => '?').join(',');
    let sql = `SELECT * FROM pending_approvals WHERE organismId IN (${ph})`;
    const params: unknown[] = [...organismIds];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    sql += ' ORDER BY createdAt DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const out: Record<string, PendingApprovalRecord[]> = {};
    for (const r of rows) { const rec = this.deserializePendingApproval(r); (out[rec.organismId] ??= []).push(rec); }
    return out;
  },

  async updatePendingApproval(this: SqliteStorage, id: string, updates: Partial<PendingApprovalRecord>): Promise<PendingApprovalRecord | null> {
    const existing = await this.getPendingApproval(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE pending_approvals SET organismId = ?, flowGateId = ?, stageId = ?, actor = ?, action = ?,
         arguments = ?, risk = ?, approverRole = ?, prompt = ?, status = ?, decidedBy = ?, decidedAt = ?,
         resolutionNote = ?, deadline = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.flowGateId ?? null, updated.stageId ?? null, updated.actor, updated.action,
      updated.arguments !== undefined ? JSON.stringify(updated.arguments) : null, updated.risk, updated.approverRole,
      updated.prompt ?? null, updated.status, updated.decidedBy ?? null, updated.decidedAt ?? null,
      updated.resolutionNote ?? null, updated.deadline ?? null, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  },

  async listOverduePendingApprovals(this: SqliteStorage, nowIso: string): Promise<PendingApprovalRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM pending_approvals WHERE status = 'pending' AND deadline IS NOT NULL AND deadline < ?`
    ).all(nowIso) as Record<string, unknown>[];
    return rows.map(r => this.deserializePendingApproval(r));
  },

  deserializePendingApproval(this: SqliteStorage, row: Record<string, unknown>): PendingApprovalRecord {
    const record: PendingApprovalRecord = {
      id: row.id as string,
      organismId: row.organismId as string,
      actor: row.actor as string,
      action: row.action as string,
      risk: row.risk as PendingApprovalRecord['risk'],
      approverRole: row.approverRole as PendingApprovalRecord['approverRole'],
      status: row.status as PendingApprovalRecord['status'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.flowGateId) record.flowGateId = row.flowGateId as string;
    if (row.stageId) record.stageId = row.stageId as string;
    if (row.arguments) record.arguments = JSON.parse(row.arguments as string);
    if (row.prompt) record.prompt = row.prompt as string;
    if (row.decidedBy) record.decidedBy = row.decidedBy as string;
    if (row.decidedAt) record.decidedAt = row.decidedAt as string;
    if (row.resolutionNote) record.resolutionNote = row.resolutionNote as string;
    if (row.deadline) record.deadline = row.deadline as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Organism Reputation ──
  // ══════════════════════════════════════════════════════════

  async setOrganismReputation(this: SqliteStorage, record: OrganismReputationRecord): Promise<OrganismReputationRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO organism_reputations (organismId, score, breakdown, calculatedAt)
       VALUES (?, ?, ?, ?)`
    ).run(
      record.organismId, record.score,
      JSON.stringify(record.breakdown), record.calculatedAt,
    );
    return record;
  },
};
