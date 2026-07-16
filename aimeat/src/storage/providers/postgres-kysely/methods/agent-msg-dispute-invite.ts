/**
 * @file src/storage/providers/postgres-kysely/methods/agent-msg-dispute-invite.ts
 * @description Three small domains for the Postgres+Kysely backend: agent messages (AgentMessage —
 *   agent↔owner dashboard inbox/threads), work disputes (Dispute + append-only DisputeAudit ledger),
 *   and email/code organism invitations (Invitation). Translated 1:1 from the Prisma implementation
 *   (mongodb methods/messaging.ts, work.ts, sessions.ts); mappers fold nullable columns back into the
 *   record shapes and jsonb columns (metadata / ruling / audit data / invite workspaces) round-trip.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: agent-message + dispute + invitation domains on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { AgentMessageRecord, DisputeRecord, DisputeAuditEntry } from '../../../interface.js';
import type { InvitationRecord, InvitationWorkspaceGrant } from '../../../repositories/invitation.repository.js';
import type { AgentMessage, Dispute, DisputeAudit, Invitation } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOrNull = (t: Date | string | null | undefined): string | null => (t == null ? null : iso(t));
const isoOrUndef = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));

// ── Mappers ──────────────────────────────────────────────────

function toMessage(r: Selectable<AgentMessage>): AgentMessageRecord {
  const rec: AgentMessageRecord = {
    id: r.id, agentGaii: r.agentGaii, threadId: r.threadId,
    direction: r.direction as AgentMessageRecord['direction'], senderGaii: r.senderGaii,
    content: r.content, status: r.status as AgentMessageRecord['status'], createdAt: iso(r.createdAt),
  };
  if (r.linkedTaskId) rec.linkedTaskId = r.linkedTaskId;
  if (r.metadata) rec.metadata = r.metadata as unknown as AgentMessageRecord['metadata'];
  if (r.processedAt) rec.processedAt = isoOrUndef(r.processedAt);
  return rec;
}

function toDispute(r: Selectable<Dispute>): DisputeRecord {
  return {
    id: r.disputeId, trackingCode: r.trackingCode, status: r.status as DisputeRecord['status'],
    openedBy: r.openedBy, reason: r.reason, ruling: (r.ruling ?? undefined) as DisputeRecord['ruling'],
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

function toInvitation(r: Selectable<Invitation>): InvitationRecord {
  return {
    id: r.id, tokenHash: r.tokenHash, organismId: r.organismId,
    orgRole: (r.orgRole ?? 'member') as InvitationRecord['orgRole'],
    type: (r.type ?? 'link') as InvitationRecord['type'],
    workspaces: (r.workspaces ?? []) as unknown as InvitationWorkspaceGrant[],
    email: r.email, emailHash: r.emailHash, invitedBy: r.invitedBy,
    provisionedOwner: r.provisionedOwner ?? null, message: r.message ?? null,
    status: r.status as InvitationRecord['status'],
    createdAt: iso(r.createdAt), expiresAt: iso(r.expiresAt),
    acceptedAt: isoOrNull(r.acceptedAt), acceptedBy: r.acceptedBy ?? null,
  };
}

// ── Agent Messages ───────────────────────────────────────────

export const agentMessageMethods = {
  async createMessage(this: PostgresKyselyStorage, record: AgentMessageRecord): Promise<AgentMessageRecord> {
    await this.db.insertInto('AgentMessage').values({
      id: record.id, agentGaii: record.agentGaii, threadId: record.threadId, direction: record.direction,
      senderGaii: record.senderGaii, content: record.content, status: record.status,
      linkedTaskId: record.linkedTaskId ?? null, metadata: jsonb(record.metadata ?? null),
      createdAt: new Date(record.createdAt), processedAt: record.processedAt ? new Date(record.processedAt) : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },
  async getMessage(this: PostgresKyselyStorage, id: string): Promise<AgentMessageRecord | null> {
    const r = await this.db.selectFrom('AgentMessage').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toMessage(r) : null;
  },
  async listMessages(this: PostgresKyselyStorage, agentGaii: string, opts?: { direction?: 'inbound' | 'outbound'; threadId?: string; page?: number; perPage?: number }): Promise<{ messages: AgentMessageRecord[]; total: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let q = this.db.selectFrom('AgentMessage').where('agentGaii', '=', agentGaii);
    if (opts?.direction) q = q.where('direction', '=', opts.direction);
    if (opts?.threadId) q = q.where('threadId', '=', opts.threadId);
    const rows = await q.selectAll().orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const countRow = await q.select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    return { messages: rows.map(toMessage), total: Number(countRow?.n ?? 0) };
  },
  async listPendingMessages(this: PostgresKyselyStorage, agentGaii: string): Promise<AgentMessageRecord[]> {
    const rows = await this.db.selectFrom('AgentMessage').selectAll()
      .where('agentGaii', '=', agentGaii).where('status', '=', 'pending').where('direction', '=', 'inbound')
      .orderBy('createdAt', 'asc').execute();
    return rows.map(toMessage);
  },
  async updateMessageStatus(this: PostgresKyselyStorage, id: string, status: string, processedAt?: string): Promise<AgentMessageRecord | null> {
    const data: Record<string, unknown> = { status };
    if (processedAt) data.processedAt = new Date(processedAt);
    const rows = await this.db.updateTable('AgentMessage').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toMessage(rows[0]) : null;
  },
  async listThreads(this: PostgresKyselyStorage, agentGaii: string): Promise<{ threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[]> {
    const groups = await this.db.selectFrom('AgentMessage')
      .where('agentGaii', '=', agentGaii)
      .select('threadId')
      .select(eb => eb.fn.countAll<number>().as('cnt'))
      .select(eb => eb.fn.max('createdAt').as('updatedAt'))
      .groupBy('threadId').execute();
    const results: { threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[] = [];
    for (const g of groups) {
      const last = await this.db.selectFrom('AgentMessage').select('content')
        .where('agentGaii', '=', agentGaii).where('threadId', '=', g.threadId)
        .orderBy('createdAt', 'desc').limit(1).executeTakeFirst();
      results.push({
        threadId: g.threadId, lastMessage: last?.content ?? '', messageCount: Number(g.cnt),
        updatedAt: g.updatedAt ? iso(g.updatedAt) : '',
      });
    }
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  },
  async countMessagesByAgents(this: PostgresKyselyStorage, agentGaiis: string[]): Promise<Record<string, { total: number; lastMessageAt: string | null }>> {
    const out: Record<string, { total: number; lastMessageAt: string | null }> = {};
    if (agentGaiis.length === 0) return out;
    const grouped = await this.db.selectFrom('AgentMessage')
      .where('agentGaii', 'in', agentGaiis).where('direction', '!=', 'inbound')
      .select('agentGaii')
      .select(eb => eb.fn.countAll<number>().as('total'))
      .select(eb => eb.fn.max('createdAt').as('lastMessageAt'))
      .groupBy('agentGaii').execute();
    for (const row of grouped) {
      out[row.agentGaii] = { total: Number(row.total), lastMessageAt: row.lastMessageAt ? iso(row.lastMessageAt) : null };
    }
    return out;
  },
};

// ── Disputes (Dispute + append-only DisputeAudit) ────────────

export const disputeMethods = {
  async createDispute(this: PostgresKyselyStorage, dispute: DisputeRecord): Promise<DisputeRecord> {
    await this.db.insertInto('Dispute').values({
      disputeId: dispute.id, trackingCode: dispute.trackingCode, status: dispute.status,
      openedBy: dispute.openedBy, reason: dispute.reason, ruling: jsonb(dispute.ruling ?? null),
      createdAt: new Date(dispute.createdAt), updatedAt: new Date(dispute.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return dispute;
  },
  async getDispute(this: PostgresKyselyStorage, id: string): Promise<DisputeRecord | null> {
    const r = await this.db.selectFrom('Dispute').selectAll().where('disputeId', '=', id).executeTakeFirst();
    return r ? toDispute(r) : null;
  },
  async getDisputeByTrackingCode(this: PostgresKyselyStorage, tc: string): Promise<DisputeRecord | null> {
    const r = await this.db.selectFrom('Dispute').selectAll().where('trackingCode', '=', tc).executeTakeFirst();
    return r ? toDispute(r) : null;
  },
  async updateDispute(this: PostgresKyselyStorage, id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status) data.status = updates.status;
    if (updates.ruling) data.ruling = jsonb(updates.ruling);
    if (updates.updatedAt) data.updatedAt = new Date(updates.updatedAt);
    if (Object.keys(data).length === 0) return this.getDispute(id);
    const rows = await this.db.updateTable('Dispute').set(data as never).where('disputeId', '=', id).returningAll().execute();
    return rows[0] ? toDispute(rows[0]) : null;
  },
  async addDisputeAuditEntry(this: PostgresKyselyStorage, disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry> {
    await this.db.insertInto('DisputeAudit').values({
      disputeId, sequence: entry.sequence, event: entry.event, actor: entry.actor,
      timestamp: new Date(entry.timestamp), data: jsonb(entry.data), hash: entry.hash, previousHash: entry.previousHash,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return entry;
  },
  async getDisputeAuditLog(this: PostgresKyselyStorage, disputeId: string): Promise<DisputeAuditEntry[]> {
    const rows = await this.db.selectFrom('DisputeAudit').selectAll().where('disputeId', '=', disputeId).orderBy('sequence', 'asc').execute();
    return rows.map((r: Selectable<DisputeAudit>) => ({
      sequence: r.sequence, event: r.event, actor: r.actor, timestamp: iso(r.timestamp),
      data: r.data as Record<string, unknown>, hash: r.hash, previousHash: r.previousHash,
    }));
  },
  async listDisputesByProvider(this: PostgresKyselyStorage, gaii: string): Promise<DisputeRecord[]> {
    const workItems = await this.db.selectFrom('Work').select('trackingCode').where('providerGaii', '=', gaii).execute();
    const tcs = workItems.map(w => w.trackingCode);
    if (tcs.length === 0) return [];
    const rows = await this.db.selectFrom('Dispute').selectAll().where('trackingCode', 'in', tcs).execute();
    return rows.map(toDispute);
  },
  async listAllDisputes(this: PostgresKyselyStorage, limit = 10000): Promise<DisputeRecord[]> {
    const rows = await this.db.selectFrom('Dispute').selectAll().orderBy('createdAt', 'desc').limit(Math.min(limit, 10000)).execute();
    return rows.map(toDispute);
  },
};

// ── Invitations (email / code) ───────────────────────────────

export const invitationMethods = {
  async createInvitation(this: PostgresKyselyStorage, rec: InvitationRecord): Promise<void> {
    await this.db.insertInto('Invitation').values({
      id: rec.id, tokenHash: rec.tokenHash, organismId: rec.organismId, orgRole: rec.orgRole,
      type: rec.type ?? 'link', workspaces: jsonb(rec.workspaces ?? []), email: rec.email,
      emailHash: rec.emailHash, invitedBy: rec.invitedBy, provisionedOwner: rec.provisionedOwner ?? null,
      message: rec.message ?? null, status: rec.status, createdAt: new Date(rec.createdAt),
      expiresAt: new Date(rec.expiresAt), acceptedAt: rec.acceptedAt ? new Date(rec.acceptedAt) : null,
      acceptedBy: rec.acceptedBy ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
  },
  async getInvitationByHash(this: PostgresKyselyStorage, tokenHash: string): Promise<InvitationRecord | null> {
    const r = await this.db.selectFrom('Invitation').selectAll().where('tokenHash', '=', tokenHash).executeTakeFirst();
    return r ? toInvitation(r) : null;
  },
  async getInvitation(this: PostgresKyselyStorage, id: string): Promise<InvitationRecord | null> {
    const r = await this.db.selectFrom('Invitation').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toInvitation(r) : null;
  },
  async listInvitationsByOrganism(this: PostgresKyselyStorage, organismId: string, opts?: { status?: InvitationRecord['status'] }): Promise<InvitationRecord[]> {
    let q = this.db.selectFrom('Invitation').selectAll().where('organismId', '=', organismId);
    if (opts?.status) q = q.where('status', '=', opts.status);
    return (await q.orderBy('createdAt', 'desc').execute()).map(toInvitation);
  },
  async countInvitationsByInviter(this: PostgresKyselyStorage, invitedBy: string, opts?: { organismId?: string; type?: InvitationRecord['type']; statuses?: InvitationRecord['status'][] }): Promise<number> {
    let q = this.db.selectFrom('Invitation').where('invitedBy', '=', invitedBy);
    if (opts?.organismId) q = q.where('organismId', '=', opts.organismId);
    if (opts?.type) q = q.where('type', '=', opts.type);
    if (opts?.statuses && opts.statuses.length) q = q.where('status', 'in', opts.statuses);
    const r = await q.select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    return Number(r?.n ?? 0);
  },
  async getCodeInvitationByProvisionedOwner(this: PostgresKyselyStorage, owner: string): Promise<InvitationRecord | null> {
    const r = await this.db.selectFrom('Invitation').selectAll()
      .where('type', '=', 'code').where('provisionedOwner', '=', owner)
      .orderBy('createdAt', 'desc').executeTakeFirst();
    return r ? toInvitation(r) : null;
  },
  async updateInvitation(this: PostgresKyselyStorage, id: string, updates: Partial<InvitationRecord>): Promise<InvitationRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.acceptedAt !== undefined) data.acceptedAt = updates.acceptedAt ? new Date(updates.acceptedAt) : null;
    if (updates.acceptedBy !== undefined) data.acceptedBy = updates.acceptedBy;
    if (updates.orgRole !== undefined) data.orgRole = updates.orgRole;
    if (updates.workspaces !== undefined) data.workspaces = jsonb(updates.workspaces ?? []);
    if (Object.keys(data).length === 0) return this.getInvitation(id);
    const rows = await this.db.updateTable('Invitation').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toInvitation(rows[0]) : null;
  },
  async cleanupExpiredInvitations(this: PostgresKyselyStorage, nowIso: string): Promise<number> {
    // Only magic-link invites auto-expire; code invites hold a real account and are reclaimed only
    // by an explicit cancel (which deletes the account). Mirrors the Prisma provider.
    const r = await this.db.updateTable('Invitation').set({ status: 'expired' })
      .where('status', '=', 'pending').where('type', '=', 'link').where('expiresAt', '<=', new Date(nowIso)).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  },
};
