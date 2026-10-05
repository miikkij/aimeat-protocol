/**
 * @file src/storage/providers/sqlite/methods/agent-msg-dispute-invite.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/agent-msg-dispute-invite.ts
 *   (agentMessageMethods, disputeMethods, invitationMethods), so a fix in one provider finds its twin by file
 *   name. Bodies moved verbatim from the files named in the version history; bound to SqliteStorage via the
 *   prototype merge in ../index.ts.
 * @structure agentMessageMethods, disputeMethods, invitationMethods
 * @usage Object.assign(SqliteStorage.prototype, agentMessageMethods, disputeMethods, invitationMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 9 methods (createDispute, getDispute, getDisputeByTrackingCode, …) moved here from
 *     work.ts; 10 methods (mapInvitationRow, createInvitation, getInvitationByHash, …) moved here from
 *     extensions-notify.ts; createMessage, getMessage, listMessages, listPendingMessages,
 *     updateMessageStatus, countMessagesByAgents, listThreads moved here from messaging.ts so the file
 *     mirrors postgres-kysely/methods/agent-msg-dispute-invite.ts (secaudit 2026-10, M8).
 */
import type { DisputeRecord, DisputeAuditEntry, AgentMessageRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import * as agentMessageRepo from '../repos/agent-message.js';

export const agentMessageMethods = {
  // ── Agent Messages ──
  // ══════════════════════════════════════════════════════════

  async createMessage(this: SqliteStorage, record: AgentMessageRecord): Promise<AgentMessageRecord> {
    return agentMessageRepo.createMessage(this.db, record);
  },

  async getMessage(this: SqliteStorage, id: string): Promise<AgentMessageRecord | null> {
    return agentMessageRepo.getMessage(this.db, id);
  },

  async listMessages(this: SqliteStorage, agentGaii: string, opts?: { direction?: 'inbound' | 'outbound'; threadId?: string; page?: number; perPage?: number }): Promise<{ messages: AgentMessageRecord[]; total: number }> {
    return agentMessageRepo.listMessages(this.db, agentGaii, opts);
  },

  async listPendingMessages(this: SqliteStorage, agentGaii: string): Promise<AgentMessageRecord[]> {
    return agentMessageRepo.listPendingMessages(this.db, agentGaii);
  },

  async updateMessageStatus(this: SqliteStorage, id: string, status: string, processedAt?: string): Promise<AgentMessageRecord | null> {
    return agentMessageRepo.updateMessageStatus(this.db, id, status, processedAt);
  },

  async countMessagesByAgents(this: SqliteStorage, agentGaiis: string[]): Promise<Record<string, { total: number; lastMessageAt: string | null }>> {
    return agentMessageRepo.countMessagesByAgents(this.db, agentGaiis);
  },

  async listThreads(this: SqliteStorage, agentGaii: string): Promise<{ threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[]> {
    return agentMessageRepo.listThreads(this.db, agentGaii);
  },
};

export const disputeMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Disputes ──
  // ══════════════════════════════════════════════════════════

  async createDispute(this: SqliteStorage, dispute: DisputeRecord): Promise<DisputeRecord> {
    this.db.prepare(
      `INSERT INTO disputes (id, trackingCode, status, openedBy, reason, ruling, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      dispute.id, dispute.trackingCode, dispute.status,
      dispute.openedBy, dispute.reason,
      dispute.ruling ? JSON.stringify(dispute.ruling) : null,
      dispute.createdAt, dispute.updatedAt,
    );
    return dispute;
  },

  async getDispute(this: SqliteStorage, id: string): Promise<DisputeRecord | null> {
    const row = this.db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeDispute(row) : null;
  },

  async getDisputeByTrackingCode(this: SqliteStorage, tc: string): Promise<DisputeRecord | null> {
    const row = this.db.prepare('SELECT * FROM disputes WHERE trackingCode = ?').get(tc) as Record<string, unknown> | undefined;
    return row ? this.deserializeDispute(row) : null;
  },

  async updateDispute(this: SqliteStorage, id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null> {
    const existing = await this.getDispute(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE disputes SET trackingCode = ?, status = ?, openedBy = ?, reason = ?, ruling = ?,
       createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.trackingCode, updated.status, updated.openedBy, updated.reason,
      updated.ruling ? JSON.stringify(updated.ruling) : null,
      updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  },

  async addDisputeAuditEntry(this: SqliteStorage, disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry> {
    this.db.prepare(
      `INSERT INTO dispute_audit (disputeId, sequence, event, actor, timestamp, data, hash, previousHash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      disputeId, entry.sequence, entry.event, entry.actor,
      entry.timestamp, JSON.stringify(entry.data),
      entry.hash, entry.previousHash,
    );
    return entry;
  },

  async getDisputeAuditLog(this: SqliteStorage, disputeId: string): Promise<DisputeAuditEntry[]> {
    const rows = this.db.prepare('SELECT * FROM dispute_audit WHERE disputeId = ? ORDER BY sequence ASC').all(disputeId) as Record<string, unknown>[];
    return rows.map(r => ({
      sequence: r.sequence as number,
      event: r.event as string,
      actor: r.actor as string,
      timestamp: r.timestamp as string,
      data: JSON.parse(r.data as string),
      hash: r.hash as string,
      previousHash: r.previousHash as string,
    }));
  },

  async listDisputesByProvider(this: SqliteStorage, gaii: string): Promise<DisputeRecord[]> {
    // Need to join with work to find by provider
    const rows = this.db.prepare(
      `SELECT d.* FROM disputes d
       INNER JOIN work w ON d.trackingCode = w.trackingCode
       WHERE w.providerGaii = ?`
    ).all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeDispute(r));
  },

  async listAllDisputes(this: SqliteStorage, limit = 10000): Promise<DisputeRecord[]> {
    const rows = this.db.prepare('SELECT * FROM disputes ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeDispute(r));
  },

  deserializeDispute(this: SqliteStorage, row: Record<string, unknown>): DisputeRecord {
    const record: DisputeRecord = {
      id: row.id as string,
      trackingCode: row.trackingCode as string,
      status: row.status as DisputeRecord['status'],
      openedBy: row.openedBy as string,
      reason: row.reason as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.ruling) record.ruling = JSON.parse(row.ruling as string);
    return record;
  },
};

export const invitationMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Email invitations ──
  // ══════════════════════════════════════════════════════════

  mapInvitationRow(this: SqliteStorage, row: Record<string, unknown>): import('../../../../storage/repositories/invitation.repository.js').InvitationRecord {
    return {
      id: row.id as string,
      tokenHash: row.tokenHash as string,
      organismId: (row.organismId as string | null) ?? null,
      orgRole: (row.orgRole as 'member' | 'admin') ?? 'member',
      type: (row.type as 'link' | 'code' | 'registration') ?? 'link',
      workspaces: row.workspaces ? JSON.parse(row.workspaces as string) : [],
      email: row.email as string,
      emailHash: row.emailHash as string,
      invitedBy: row.invitedBy as string,
      provisionedOwner: (row.provisionedOwner as string | null) ?? null,
      message: (row.message as string | null) ?? null,
      status: row.status as 'pending' | 'accepted' | 'cancelled' | 'expired',
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
      acceptedAt: (row.acceptedAt as string | null) ?? null,
      acceptedBy: (row.acceptedBy as string | null) ?? null,
      returnUrl: (row.returnUrl as string | null) ?? null,
      meta: row.meta ? JSON.parse(row.meta as string) : null,
    };
  },

  async createInvitation(this: SqliteStorage, rec: import('../../../../storage/repositories/invitation.repository.js').InvitationRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO invitations
         (id, tokenHash, organismId, orgRole, type, workspaces, email, emailHash, invitedBy, provisionedOwner, message, status, createdAt, expiresAt, acceptedAt, acceptedBy, returnUrl, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      rec.id, rec.tokenHash, rec.organismId, rec.orgRole, rec.type ?? 'link', JSON.stringify(rec.workspaces ?? []),
      rec.email, rec.emailHash, rec.invitedBy, rec.provisionedOwner ?? null, rec.message ?? null, rec.status,
      rec.createdAt, rec.expiresAt, rec.acceptedAt ?? null, rec.acceptedBy ?? null, rec.returnUrl ?? null,
      rec.meta ? JSON.stringify(rec.meta) : null,
    );
  },

  async getInvitationByHash(this: SqliteStorage, tokenHash: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
    const row = this.db.prepare('SELECT * FROM invitations WHERE tokenHash = ? LIMIT 1').get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapInvitationRow(row) : null;
  },

  async getInvitation(this: SqliteStorage, id: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
    const row = this.db.prepare('SELECT * FROM invitations WHERE id = ? LIMIT 1').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapInvitationRow(row) : null;
  },

  async listInvitationsByOrganism(this: SqliteStorage, organismId: string, opts?: { status?: string }): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord[]> {
    const rows = opts?.status
      ? this.db.prepare('SELECT * FROM invitations WHERE organismId = ? AND status = ? ORDER BY createdAt DESC').all(organismId, opts.status) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM invitations WHERE organismId = ? ORDER BY createdAt DESC').all(organismId) as Record<string, unknown>[];
    return rows.map((r) => this.mapInvitationRow(r));
  },

  async listInvitationsByEmailHash(this: SqliteStorage, emailHash: string, opts?: { status?: string; type?: string }): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord[]> {
    const where: string[] = ['emailHash = ?'];
    const values: unknown[] = [emailHash];
    if (opts?.status) { where.push('status = ?'); values.push(opts.status); }
    if (opts?.type) { where.push('type = ?'); values.push(opts.type); }
    const rows = this.db.prepare(
      `SELECT * FROM invitations WHERE ${where.join(' AND ')} ORDER BY createdAt DESC`
    ).all(...values) as Record<string, unknown>[];
    return rows.map((r) => this.mapInvitationRow(r));
  },

  async countInvitationsByInviter(this: SqliteStorage, invitedBy: string, opts?: { organismId?: string; type?: 'link' | 'code'; statuses?: string[] }): Promise<number> {
    const where: string[] = ['invitedBy = ?'];
    const values: unknown[] = [invitedBy];
    if (opts?.organismId) { where.push('organismId = ?'); values.push(opts.organismId); }
    if (opts?.type) { where.push('type = ?'); values.push(opts.type); }
    if (opts?.statuses && opts.statuses.length) {
      where.push(`status IN (${opts.statuses.map(() => '?').join(', ')})`);
      values.push(...opts.statuses);
    }
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM invitations WHERE ${where.join(' AND ')}`).get(...values) as { n: number };
    return row.n;
  },

  async getCodeInvitationByProvisionedOwner(this: SqliteStorage, owner: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
    const row = this.db.prepare(
      "SELECT * FROM invitations WHERE type = 'code' AND provisionedOwner = ? ORDER BY createdAt DESC LIMIT 1"
    ).get(owner) as Record<string, unknown> | undefined;
    return row ? this.mapInvitationRow(row) : null;
  },

  async updateInvitation(this: SqliteStorage, id: string, updates: Partial<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord>): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.acceptedAt !== undefined) { fields.push('acceptedAt = ?'); values.push(updates.acceptedAt); }
    if (updates.acceptedBy !== undefined) { fields.push('acceptedBy = ?'); values.push(updates.acceptedBy); }
    if (updates.orgRole !== undefined) { fields.push('orgRole = ?'); values.push(updates.orgRole); }
    if (updates.workspaces !== undefined) { fields.push('workspaces = ?'); values.push(JSON.stringify(updates.workspaces ?? [])); }
    if (fields.length) {
      values.push(id);
      this.db.prepare(`UPDATE invitations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    return this.getInvitation(id);
  },

  async cleanupExpiredInvitations(this: SqliteStorage, nowIso: string): Promise<number> {
    // Only magic-link invites auto-expire. Code invites provisioned a real account, so they are
    // reclaimed by an explicit cancel (which deletes the account) — never blindly swept to 'expired'.
    const result = this.db.prepare(
      `UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND type = 'link' AND expiresAt <= ?`
    ).run(nowIso);
    return result.changes;
  },
};
