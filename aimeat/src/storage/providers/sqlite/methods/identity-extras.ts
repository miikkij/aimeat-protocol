/**
 * @file src/storage/providers/sqlite/methods/identity-extras.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/identity-extras.ts
 *   (identityExtraMethods), so a fix in one provider finds its twin by file name. Bodies moved verbatim from
 *   the files named in the version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure identityExtraMethods
 * @usage Object.assign(SqliteStorage.prototype, identityExtraMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 12 methods (createChatInstance, getChatInstance, listChatInstances, …) moved here
 *     from identity-nodes.ts so the file mirrors postgres-kysely/methods/identity-extras.ts (secaudit
 *     2026-10, M8).
 */
import type { EmailVerificationRecord, ChatInstanceRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const identityExtraMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Chat Instances ──
  // ══════════════════════════════════════════════════════════

  async createChatInstance(this: SqliteStorage, record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
    try {
      this.db.prepare(
        `INSERT INTO chat_instances (id, platform, appName, ownerName, ghii, nodeId, isAnonymous, createdAt, lastSeen, agentGaii, mcpClientId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.platform, record.appName, record.ownerName,
        record.ghii, record.nodeId, record.isAnonymous ? 1 : 0,
        record.createdAt, record.lastSeen,
        record.agentGaii ?? null, record.mcpClientId ?? null,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('CHAT_INSTANCE_EXISTS', { cause: err });
      throw err;
    }
  },

  async getChatInstance(this: SqliteStorage, id: string): Promise<ChatInstanceRecord | null> {
    const row = this.db.prepare('SELECT * FROM chat_instances WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeChatInstance(row) : null;
  },

  async listChatInstances(this: SqliteStorage, opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]> {
    let sql = 'SELECT * FROM chat_instances WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.ownerName) { sql += ' AND ownerName = ?'; params.push(opts.ownerName); }
    if (opts?.platform) { sql += ' AND platform = ?'; params.push(opts.platform); }
    if (opts?.ghii) { sql += ' AND ghii = ?'; params.push(opts.ghii); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeChatInstance(r));
  },

  async updateChatInstance(this: SqliteStorage, id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
    const existing = await this.getChatInstance(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE chat_instances SET platform = ?, appName = ?, ownerName = ?, ghii = ?,
       nodeId = ?, isAnonymous = ?, createdAt = ?, lastSeen = ?, agentGaii = ?, mcpClientId = ? WHERE id = ?`
    ).run(
      updated.platform, updated.appName, updated.ownerName, updated.ghii,
      updated.nodeId, updated.isAnonymous ? 1 : 0,
      updated.createdAt, updated.lastSeen,
      updated.agentGaii ?? null, updated.mcpClientId ?? null, id,
    );
    return updated;
  },

  async deleteChatInstance(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM chat_instances WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeChatInstance(this: SqliteStorage, row: Record<string, unknown>): ChatInstanceRecord {
    return {
      id: row.id as string,
      platform: row.platform as string,
      appName: row.appName as string,
      ownerName: row.ownerName as string,
      ghii: row.ghii as string,
      nodeId: row.nodeId as string,
      isAnonymous: (row.isAnonymous as number) === 1,
      createdAt: row.createdAt as string,
      lastSeen: row.lastSeen as string,
      agentGaii: (row.agentGaii as string) || undefined,
      mcpClientId: (row.mcpClientId as string) || undefined,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Email Verifications ──
  // ══════════════════════════════════════════════════════════

  async createEmailVerification(this: SqliteStorage, record: EmailVerificationRecord): Promise<EmailVerificationRecord> {
    this.db.prepare(
      `INSERT INTO email_verifications (id, ownerName, emailHash, code, purpose, status, attempts, expiresAt, createdAt, verifiedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.ownerName, record.emailHash, record.code,
      record.purpose, record.status, record.attempts,
      record.expiresAt, record.createdAt, record.verifiedAt,
    );
    return record;
  },

  async getEmailVerification(this: SqliteStorage, id: string): Promise<EmailVerificationRecord | null> {
    const row = this.db.prepare('SELECT * FROM email_verifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeEmailVerification(row) : null;
  },

  async getActiveEmailVerification(this: SqliteStorage, ownerName: string, purpose: string): Promise<EmailVerificationRecord | null> {
    const now = new Date().toISOString();
    const row = this.db.prepare(
      `SELECT * FROM email_verifications WHERE ownerName = ? AND purpose = ? AND status = 'pending' AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1`
    ).get(ownerName, purpose, now) as Record<string, unknown> | undefined;
    return row ? this.deserializeEmailVerification(row) : null;
  },

  async updateEmailVerification(this: SqliteStorage, id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null> {
    const existing = await this.getEmailVerification(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE email_verifications SET ownerName = ?, emailHash = ?, code = ?, purpose = ?,
       status = ?, attempts = ?, expiresAt = ?, createdAt = ?, verifiedAt = ? WHERE id = ?`
    ).run(
      updated.ownerName, updated.emailHash, updated.code, updated.purpose,
      updated.status, updated.attempts, updated.expiresAt,
      updated.createdAt, updated.verifiedAt, id,
    );
    return updated;
  },

  /** One conditional UPDATE, so two concurrent redeems of a single-use link cannot both win. */
  async spendEmailVerification(this: SqliteStorage, id: string, verifiedAt: string): Promise<boolean> {
    return this.db.prepare(`UPDATE email_verifications SET status = 'verified', verifiedAt = ? WHERE id = ? AND status = 'pending'`)
      .run(verifiedAt, id).changes === 1;
  },

  deserializeEmailVerification(this: SqliteStorage, row: Record<string, unknown>): EmailVerificationRecord {
    return {
      id: row.id as string,
      ownerName: row.ownerName as string,
      emailHash: row.emailHash as string,
      code: row.code as string,
      purpose: row.purpose as EmailVerificationRecord['purpose'],
      status: row.status as EmailVerificationRecord['status'],
      attempts: row.attempts as number,
      expiresAt: row.expiresAt as string,
      createdAt: row.createdAt as string,
      verifiedAt: (row.verifiedAt as string) ?? null,
    };
  },
};
