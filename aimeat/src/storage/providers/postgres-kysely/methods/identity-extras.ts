/**
 * @file src/storage/providers/postgres-kysely/methods/identity-extras.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Chat instances (ChatInstance) + email verifications (EmailVerification) for the
 *   Postgres+Kysely backend — the parts of the identity repository not in methods/identity.ts.
 *   Translated 1:1 from the Prisma provider.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: chat instances + email verifications on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { ChatInstanceRecord, EmailVerificationRecord } from '../../../interface.js';
import type { ChatInstance, EmailVerification } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoN = (t: Date | string | null | undefined): string | null => (t == null ? null : iso(t));

function toChat(r: Selectable<ChatInstance>): ChatInstanceRecord {
  return {
    id: r.id, platform: r.platform, appName: r.appName, ownerName: r.ownerName, ghii: r.ghii, nodeId: r.nodeId,
    isAnonymous: r.isAnonymous, createdAt: iso(r.createdAt), lastSeen: iso(r.lastSeen),
    agentGaii: r.agentGaii || undefined, mcpClientId: r.mcpClientId || undefined,
  };
}
function toEmail(r: Selectable<EmailVerification>): EmailVerificationRecord {
  return {
    id: r.id, ownerName: r.ownerName, emailHash: r.emailHash, code: r.code, purpose: r.purpose as EmailVerificationRecord['purpose'],
    status: r.status as EmailVerificationRecord['status'], attempts: r.attempts, expiresAt: iso(r.expiresAt),
    createdAt: iso(r.createdAt), verifiedAt: isoN(r.verifiedAt),
  };
}

export const identityExtraMethods = {
  // ── Chat instances ──
  async createChatInstance(this: PostgresKyselyStorage, r: ChatInstanceRecord): Promise<ChatInstanceRecord> {
    await this.db.insertInto('ChatInstance').values({
      id: r.id, platform: r.platform, appName: r.appName, ownerName: r.ownerName, ghii: r.ghii, nodeId: r.nodeId,
      isAnonymous: r.isAnonymous, createdAt: new Date(r.createdAt), lastSeen: new Date(r.lastSeen),
      agentGaii: r.agentGaii ?? null, mcpClientId: r.mcpClientId ?? null,
    }).execute();
    return r;
  },
  async getChatInstance(this: PostgresKyselyStorage, id: string): Promise<ChatInstanceRecord | null> {
    const r = await this.db.selectFrom('ChatInstance').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toChat(r) : null;
  },
  async listChatInstances(this: PostgresKyselyStorage, opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]> {
    let q = this.db.selectFrom('ChatInstance').selectAll();
    if (opts?.ownerName) q = q.where('ownerName', '=', opts.ownerName);
    if (opts?.platform) q = q.where('platform', '=', opts.platform);
    if (opts?.ghii) q = q.where('ghii', '=', opts.ghii);
    return (await q.execute()).map(toChat);
  },
  async updateChatInstance(this: PostgresKyselyStorage, id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.lastSeen) data.lastSeen = new Date(updates.lastSeen);
    if (updates.platform) data.platform = updates.platform;
    if (updates.appName) data.appName = updates.appName;
    if (updates.agentGaii !== undefined) data.agentGaii = updates.agentGaii;
    if (updates.mcpClientId !== undefined) data.mcpClientId = updates.mcpClientId;
    if (Object.keys(data).length === 0) return this.getChatInstance(id);
    const rows = await this.db.updateTable('ChatInstance').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toChat(rows[0]) : null;
  },
  async deleteChatInstance(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('ChatInstance').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Email verifications ──
  async createEmailVerification(this: PostgresKyselyStorage, r: EmailVerificationRecord): Promise<EmailVerificationRecord> {
    await this.db.insertInto('EmailVerification').values({
      id: r.id, ownerName: r.ownerName, emailHash: r.emailHash, code: r.code, purpose: r.purpose, status: r.status,
      attempts: r.attempts, expiresAt: new Date(r.expiresAt), createdAt: new Date(r.createdAt), verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
    }).execute();
    return r;
  },
  async getEmailVerification(this: PostgresKyselyStorage, id: string): Promise<EmailVerificationRecord | null> {
    const r = await this.db.selectFrom('EmailVerification').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toEmail(r) : null;
  },
  async getActiveEmailVerification(this: PostgresKyselyStorage, ownerName: string, purpose: string): Promise<EmailVerificationRecord | null> {
    const r = await this.db.selectFrom('EmailVerification').selectAll().where('ownerName', '=', ownerName).where('purpose', '=', purpose)
      .where('status', '=', 'pending').where('expiresAt', '>', new Date()).orderBy('createdAt', 'desc').executeTakeFirst();
    return r ? toEmail(r) : null;
  },
  async updateEmailVerification(this: PostgresKyselyStorage, id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.attempts !== undefined) data.attempts = updates.attempts;
    if (updates.verifiedAt !== undefined) data.verifiedAt = updates.verifiedAt ? new Date(updates.verifiedAt) : null;
    if (updates.code !== undefined) data.code = updates.code;
    if (updates.expiresAt !== undefined) data.expiresAt = new Date(updates.expiresAt);
    if (Object.keys(data).length === 0) return this.getEmailVerification(id);
    const rows = await this.db.updateTable('EmailVerification').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toEmail(rows[0]) : null;
  },
  async deleteExpiredEmailVerifications(this: PostgresKyselyStorage): Promise<number> {
    const r = await this.db.deleteFrom('EmailVerification').where('expiresAt', '<', new Date()).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
