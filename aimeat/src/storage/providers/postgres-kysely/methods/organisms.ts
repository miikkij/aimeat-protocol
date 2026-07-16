/**
 * @file src/storage/providers/postgres-kysely/methods/organisms.ts
 * @description Organism / workspace governance domain for the Postgres+Kysely backend: organisms,
 *   memberships, join requests, pending approvals (the Gate primitive), and reputation. Translated 1:1
 *   from the Prisma implementation against the same tables. deleteOrganism cascades to memberships /
 *   join-requests / reputation / board rows / all `organism.{id}.*` memory + versions + schema locks.
 * @version-history
 *   v1.2.0 — 2026-07-16 — Memberships carry invitedWorkspaces (jsonb, migration 0006): ws grants chosen at invite time.
 *   v1.1.0 — 2026-07-16 — Add listPendingApprovalsForOrgs batch (Phase 3): pending approvals for many orgs
 *     in one organismId-IN query.
 *   v1.0.0 — 2026-07-15 — Phase 5: organism governance on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type {
  ArchiveFilter, JoinRequestRecord, OrganismMembershipRecord, OrganismRecord,
  OrganismReputationRecord, PendingApprovalRecord,
} from '../../../interface.js';
import type { JoinRequest, Organism, OrganismMembership, PendingApproval } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));

function toOrg(r: Selectable<Organism>): OrganismRecord {
  return {
    id: r.id, name: r.name, description: r.description, type: r.type as OrganismRecord['type'], location: (r.location ?? undefined) as OrganismRecord['location'],
    interests: r.interests ?? [], creatorGhii: r.creatorGhii, admins: r.admins ?? [], members: r.members ?? [], agentGaiis: r.agentGaiis ?? [],
    boardId: r.boardId, joinPolicy: r.joinPolicy as OrganismRecord['joinPolicy'], maxMembers: r.maxMembers,
    visibility: r.visibility as OrganismRecord['visibility'], memberVisibility: (r.memberVisibility ?? undefined) as OrganismRecord['memberVisibility'],
    moderationConfig: r.moderationConfig as OrganismRecord['moderationConfig'], memoryNamespace: r.memoryNamespace,
    semantic: (r.semantic ?? undefined) as OrganismRecord['semantic'], archived: r.archived ? true : undefined,
    archivedAt: isoOpt(r.archivedAt), archivedBy: r.archivedBy ?? undefined, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}
function toMember(r: Selectable<OrganismMembership>): OrganismMembershipRecord {
  return {
    id: r.id, organismId: r.organismId, ghii: r.ghii, role: r.role as OrganismMembershipRecord['role'], status: r.status as OrganismMembershipRecord['status'], joinedAt: iso(r.joinedAt), invitedBy: r.invitedBy ?? undefined,
    invitedWorkspaces: (r.invitedWorkspaces ?? undefined) as OrganismMembershipRecord['invitedWorkspaces'],
  };
}
function toJoin(r: Selectable<JoinRequest>): JoinRequestRecord {
  return { id: r.id, organismId: r.organismId, ghii: r.ghii, message: r.message ?? undefined, status: r.status as JoinRequestRecord['status'], reviewedBy: r.reviewedBy ?? undefined, createdAt: iso(r.createdAt), reviewedAt: isoOpt(r.reviewedAt) };
}
function toApproval(r: Selectable<PendingApproval>): PendingApprovalRecord {
  return {
    id: r.id, organismId: r.organismId, flowGateId: r.flowGateId ?? undefined, stageId: r.stageId ?? undefined,
    actor: r.actor, action: r.action, arguments: (r.arguments ?? undefined) as PendingApprovalRecord['arguments'], risk: r.risk as PendingApprovalRecord['risk'],
    approverRole: r.approverRole as PendingApprovalRecord['approverRole'], prompt: r.prompt ?? undefined, status: r.status as PendingApprovalRecord['status'],
    decidedBy: r.decidedBy ?? undefined, decidedAt: isoOpt(r.decidedAt), resolutionNote: r.resolutionNote ?? undefined,
    deadline: isoOpt(r.deadline), createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

export const organismMethods = {
  async createOrganism(this: PostgresKyselyStorage, r: OrganismRecord): Promise<OrganismRecord> {
    await this.db.insertInto('Organism').values({
      id: r.id, name: r.name, description: r.description, type: r.type, location: jsonb(r.location ?? null), interests: r.interests,
      creatorGhii: r.creatorGhii, admins: r.admins, members: r.members, agentGaiis: r.agentGaiis, boardId: r.boardId,
      joinPolicy: r.joinPolicy, maxMembers: r.maxMembers, visibility: r.visibility, memberVisibility: r.memberVisibility ?? null,
      moderationConfig: jsonb(r.moderationConfig), memoryNamespace: r.memoryNamespace, semantic: jsonb(r.semantic ?? null),
      archived: r.archived ?? false, archivedAt: r.archivedAt ? new Date(r.archivedAt) : null, archivedBy: r.archivedBy ?? null,
      createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt ?? r.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getOrganism(this: PostgresKyselyStorage, id: string): Promise<OrganismRecord | null> {
    const r = await this.db.selectFrom('Organism').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toOrg(r) : null;
  },
  async listOrganisms(this: PostgresKyselyStorage, opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number; archived?: ArchiveFilter }): Promise<OrganismRecord[]> {
    const page = opts?.page ?? 1, perPage = opts?.perPage ?? 20;
    let q = this.db.selectFrom('Organism').selectAll();
    if (opts?.type) q = q.where('type', '=', opts.type);
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    if (opts?.archived === 'exclude') q = q.where('archived', '=', false);
    else if (opts?.archived === 'only') q = q.where('archived', '=', true);
    let results = (await q.orderBy('createdAt', 'desc').execute()).map(toOrg);
    if (opts?.city) results = results.filter(o => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    if (opts?.interest) results = results.filter(o => o.interests.some(i => i.toLowerCase() === opts.interest!.toLowerCase()));
    if (opts?.member) results = results.filter(o => o.members.includes(opts.member!));
    return results.slice((page - 1) * perPage, (page - 1) * perPage + perPage);
  },
  async updateOrganism(this: PostgresKyselyStorage, id: string, updates: Partial<OrganismRecord>): Promise<OrganismRecord | null> {
    try {
      const data: Record<string, unknown> = { ...updates };
      delete data.id;
      if ('location' in data) data.location = jsonb(data.location ?? null);
      if ('moderationConfig' in data) data.moderationConfig = jsonb(data.moderationConfig);
      if ('semantic' in data) data.semantic = jsonb(data.semantic ?? null);
      if (typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
      if (typeof data.updatedAt === 'string') data.updatedAt = new Date(data.updatedAt);
      if (typeof data.archivedAt === 'string') data.archivedAt = new Date(data.archivedAt);
      const rows = await this.db.updateTable('Organism').set(data as never).where('id', '=', id).returningAll().execute();
      return rows[0] ? toOrg(rows[0]) : null;
    } catch { return null; }
  },
  async deleteOrganism(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const org = await this.db.selectFrom('Organism').select('boardId').where('id', '=', id).executeTakeFirst();
    await this.db.deleteFrom('OrganismMembership').where('organismId', '=', id).execute();
    await this.db.deleteFrom('JoinRequest').where('organismId', '=', id).execute();
    await this.db.deleteFrom('OrganismReputation').where('organismId', '=', id).execute().catch(() => {});
    if (org?.boardId) {
      await this.db.deleteFrom('BoardPost').where('boardId', '=', org.boardId).execute().catch(() => {});
      await this.db.deleteFrom('BoardSubscription').where('boardId', '=', org.boardId).execute().catch(() => {});
      await this.db.deleteFrom('Board').where('boardId', '=', org.boardId).execute().catch(() => {});
    }
    const orgKey = `organism.${id}`;
    for (const tbl of ['Memory', 'MemoryVersion'] as const) {
      await this.db.deleteFrom(tbl).where(eb => eb.or([eb('key', '=', orgKey), eb('key', 'like', `${orgKey}.%`)])).execute();
    }
    await this.db.deleteFrom('SchemaLock').where(eb => eb.or([eb('keyPattern', '=', orgKey), eb('keyPattern', 'like', `${orgKey}.%`)])).execute();
    try { await this.db.deleteFrom('Organism').where('id', '=', id).execute(); return true; } catch { return false; }
  },

  async createMembership(this: PostgresKyselyStorage, r: OrganismMembershipRecord): Promise<OrganismMembershipRecord> {
    await this.db.insertInto('OrganismMembership').values({ id: r.id, organismId: r.organismId, ghii: r.ghii, role: r.role, status: r.status, joinedAt: new Date(r.joinedAt), invitedBy: r.invitedBy ?? null, invitedWorkspaces: jsonb(r.invitedWorkspaces?.length ? r.invitedWorkspaces : null) as never }).execute();
    return r;
  },
  async getMembership(this: PostgresKyselyStorage, organismId: string, ghii: string): Promise<OrganismMembershipRecord | null> {
    const r = await this.db.selectFrom('OrganismMembership').selectAll().where('organismId', '=', organismId).where('ghii', '=', ghii).executeTakeFirst();
    return r ? toMember(r) : null;
  },
  async listMembers(this: PostgresKyselyStorage, organismId: string, opts?: { role?: string; status?: string }): Promise<OrganismMembershipRecord[]> {
    let q = this.db.selectFrom('OrganismMembership').selectAll().where('organismId', '=', organismId);
    if (opts?.role) q = q.where('role', '=', opts.role);
    if (opts?.status) q = q.where('status', '=', opts.status);
    return (await q.execute()).map(toMember);
  },
  async listMembershipsByGhii(this: PostgresKyselyStorage, ghii: string): Promise<OrganismMembershipRecord[]> {
    return (await this.db.selectFrom('OrganismMembership').selectAll().where('ghii', '=', ghii).execute()).map(toMember);
  },
  async updateMembership(this: PostgresKyselyStorage, id: string, updates: Partial<OrganismMembershipRecord>): Promise<OrganismMembershipRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.role) data.role = updates.role;
    if (updates.status) data.status = updates.status;
    if ('invitedWorkspaces' in updates) data.invitedWorkspaces = jsonb(updates.invitedWorkspaces?.length ? updates.invitedWorkspaces : null);
    if (Object.keys(data).length === 0) { const r = await this.db.selectFrom('OrganismMembership').selectAll().where('id', '=', id).executeTakeFirst(); return r ? toMember(r) : null; }
    const rows = await this.db.updateTable('OrganismMembership').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toMember(rows[0]) : null;
  },
  async deleteMembership(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('OrganismMembership').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async createJoinRequest(this: PostgresKyselyStorage, r: JoinRequestRecord): Promise<JoinRequestRecord> {
    await this.db.insertInto('JoinRequest').values({ id: r.id, organismId: r.organismId, ghii: r.ghii, message: r.message ?? null, status: r.status, reviewedBy: r.reviewedBy ?? null, createdAt: new Date(r.createdAt), reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null }).execute();
    return r;
  },
  async getJoinRequest(this: PostgresKyselyStorage, id: string): Promise<JoinRequestRecord | null> {
    const r = await this.db.selectFrom('JoinRequest').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toJoin(r) : null;
  },
  async listJoinRequests(this: PostgresKyselyStorage, organismId: string, opts?: { status?: string }): Promise<JoinRequestRecord[]> {
    let q = this.db.selectFrom('JoinRequest').selectAll().where('organismId', '=', organismId);
    if (opts?.status) q = q.where('status', '=', opts.status);
    return (await q.execute()).map(toJoin);
  },
  async updateJoinRequest(this: PostgresKyselyStorage, id: string, updates: Partial<JoinRequestRecord>): Promise<JoinRequestRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status) data.status = updates.status;
    if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
    if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
    const rows = await this.db.updateTable('JoinRequest').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toJoin(rows[0]) : null;
  },

  async setOrganismReputation(this: PostgresKyselyStorage, r: OrganismReputationRecord): Promise<OrganismReputationRecord> {
    const shared = { score: r.score, breakdown: jsonb(r.breakdown), calculatedAt: new Date(r.calculatedAt) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insertInto('OrganismReputation').values({ organismId: r.organismId, ...shared } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.column('organismId').doUpdateSet(shared as any)).execute();
    return r;
  },
  async getOrganismReputation(this: PostgresKyselyStorage, organismId: string): Promise<OrganismReputationRecord | null> {
    const r = await this.db.selectFrom('OrganismReputation').selectAll().where('organismId', '=', organismId).executeTakeFirst();
    return r ? { organismId: r.organismId, score: r.score, breakdown: r.breakdown as OrganismReputationRecord['breakdown'], calculatedAt: iso(r.calculatedAt) } : null;
  },

  async createPendingApproval(this: PostgresKyselyStorage, r: PendingApprovalRecord): Promise<PendingApprovalRecord> {
    await this.db.insertInto('PendingApproval').values({
      id: r.id, organismId: r.organismId, flowGateId: r.flowGateId ?? null, stageId: r.stageId ?? null, actor: r.actor, action: r.action,
      arguments: jsonb(r.arguments ?? null), risk: r.risk, approverRole: r.approverRole, prompt: r.prompt ?? null, status: r.status,
      decidedBy: r.decidedBy ?? null, decidedAt: r.decidedAt ? new Date(r.decidedAt) : null, resolutionNote: r.resolutionNote ?? null,
      deadline: r.deadline ? new Date(r.deadline) : null, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getPendingApproval(this: PostgresKyselyStorage, id: string): Promise<PendingApprovalRecord | null> {
    const r = await this.db.selectFrom('PendingApproval').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toApproval(r) : null;
  },
  async listPendingApprovals(this: PostgresKyselyStorage, organismId: string, opts?: { status?: string }): Promise<PendingApprovalRecord[]> {
    let q = this.db.selectFrom('PendingApproval').selectAll().where('organismId', '=', organismId);
    if (opts?.status) q = q.where('status', '=', opts.status);
    return (await q.orderBy('createdAt', 'desc').execute()).map(toApproval);
  },
  // BULK (Phase 3) — pending approvals for MANY organisms in ONE `organismId IN (…)` query, grouped by org.
  async listPendingApprovalsForOrgs(this: PostgresKyselyStorage, organismIds: string[], opts?: { status?: string }): Promise<Record<string, PendingApprovalRecord[]>> {
    if (organismIds.length === 0) return {};
    let q = this.db.selectFrom('PendingApproval').selectAll().where('organismId', 'in', organismIds);
    if (opts?.status) q = q.where('status', '=', opts.status);
    const out: Record<string, PendingApprovalRecord[]> = {};
    for (const r of await q.orderBy('createdAt', 'desc').execute()) (out[r.organismId] ??= []).push(toApproval(r));
    return out;
  },
  async updatePendingApproval(this: PostgresKyselyStorage, id: string, updates: Partial<PendingApprovalRecord>): Promise<PendingApprovalRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.decidedBy !== undefined) data.decidedBy = updates.decidedBy;
    if (updates.decidedAt !== undefined) data.decidedAt = updates.decidedAt ? new Date(updates.decidedAt) : null;
    if (updates.resolutionNote !== undefined) data.resolutionNote = updates.resolutionNote;
    if (updates.arguments !== undefined) data.arguments = jsonb(updates.arguments ?? null);
    if (updates.deadline !== undefined) data.deadline = updates.deadline ? new Date(updates.deadline) : null;
    data.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : new Date();
    const rows = await this.db.updateTable('PendingApproval').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toApproval(rows[0]) : null;
  },
  async listOverduePendingApprovals(this: PostgresKyselyStorage, nowIso: string): Promise<PendingApprovalRecord[]> {
    const rows = await this.db.selectFrom('PendingApproval').selectAll().where('status', '=', 'pending')
      .where('deadline', 'is not', null).where('deadline', '<', new Date(nowIso)).execute();
    return rows.map(toApproval);
  },
};
