/**
 * @file src/storage/providers/sqlite/methods/identity-nodes.ts
 * @description File, Peering, Chunked-upload, GHII, Chat-instance, Email-verify, Personal-node, Mailbox, Maintenance methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 *   v1.2.0 — 2026-07-16 — Add getGHIIsByGhiis batch (Phase 3): many GHII records by ghii in one query.
 *   v1.1.0 — 2026-07-16 — listStorageFilesForOwners batch primitive.
 */
import type {
  PeeringRequestRecord, ChunkedUploadRecord, GHIIRecord, PersonalNodeRecord, MailboxItemRecord,
  MaintenanceState, EmailVerificationRecord, ChatInstanceRecord
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const identityNodesMethods = {
  // Stored files moved to methods/storage-files.ts when this file passed 800 lines. A pure
  // extraction: same bodies, merged onto the same prototype, one import away in index.ts.

  // ══════════════════════════════════════════════════════════
  // ── Peering Requests ──
  // ══════════════════════════════════════════════════════════

  async createPeeringRequest(this: SqliteStorage, req: PeeringRequestRecord): Promise<PeeringRequestRecord> {
    this.db.prepare(
      `INSERT INTO peering_requests (id, fromNodeUrl, fromNodeId, toNodeId, targetUrl, publicKey, message, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.id, req.fromNodeUrl, req.fromNodeId ?? null,
      req.toNodeId ?? null, req.targetUrl ?? null,
      req.publicKey ?? null, req.message ?? null,
      req.status, req.createdAt, req.updatedAt,
    );
    return req;
  },

  async getPeeringRequest(this: SqliteStorage, id: string): Promise<PeeringRequestRecord | null> {
    const row = this.db.prepare('SELECT * FROM peering_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePeeringRequest(row) : null;
  },

  async listPeeringRequests(this: SqliteStorage, status?: string): Promise<PeeringRequestRecord[]> {
    let sql = 'SELECT * FROM peering_requests';
    const params: unknown[] = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePeeringRequest(r));
  },

  async updatePeeringRequest(this: SqliteStorage, id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null> {
    const existing = await this.getPeeringRequest(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE peering_requests SET fromNodeUrl = ?, fromNodeId = ?, toNodeId = ?, targetUrl = ?,
       publicKey = ?, message = ?, status = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.fromNodeUrl, updated.fromNodeId ?? null,
      updated.toNodeId ?? null, updated.targetUrl ?? null,
      updated.publicKey ?? null, updated.message ?? null,
      updated.status, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  },

  async deletePeeringRequest(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM peering_requests WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializePeeringRequest(this: SqliteStorage, row: Record<string, unknown>): PeeringRequestRecord {
    const record: PeeringRequestRecord = {
      id: row.id as string,
      fromNodeUrl: row.fromNodeUrl as string,
      status: row.status as PeeringRequestRecord['status'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.fromNodeId) record.fromNodeId = row.fromNodeId as string;
    if (row.toNodeId) record.toNodeId = row.toNodeId as string;
    if (row.targetUrl) record.targetUrl = row.targetUrl as string;
    if (row.publicKey) record.publicKey = row.publicKey as string;
    if (row.message) record.message = row.message as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Chunked Uploads (in-memory, same as MongoDB adapter) ──
  // ══════════════════════════════════════════════════════════

  async createChunkedUpload(this: SqliteStorage, record: ChunkedUploadRecord): Promise<ChunkedUploadRecord> {
    this.chunkedUploads.set(record.uploadId, record);
    return record;
  },

  async getChunkedUpload(this: SqliteStorage, uploadId: string): Promise<ChunkedUploadRecord | null> {
    const record = this.chunkedUploads.get(uploadId) ?? null;
    if (record && new Date(record.expiresAt).getTime() < Date.now()) {
      this.chunkedUploads.delete(uploadId);
      return null;
    }
    return record;
  },

  async addChunk(this: SqliteStorage, uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean> {
    const record = this.chunkedUploads.get(uploadId);
    if (!record) return false;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      this.chunkedUploads.delete(uploadId);
      return false;
    }
    record.receivedChunks.set(chunkIndex, data);
    return true;
  },

  async deleteChunkedUpload(this: SqliteStorage, uploadId: string): Promise<boolean> {
    return this.chunkedUploads.delete(uploadId);
  },

  // ══════════════════════════════════════════════════════════
  // ── GHII (Global Human Identity Identifier) ──
  // ══════════════════════════════════════════════════════════

  async createGHII(this: SqliteStorage, record: GHIIRecord): Promise<GHIIRecord> {
    try {
      this.db.prepare(
        `INSERT INTO ghiis (ghii, username, nodeId, displayName, bio, avatar, locale, passwordHash,
         verificationLevel, ownerName, createdAt, updatedAt, totpSecret, totpEnabled, totpBackupCodes,
         totpLastUsedAt, totpLastUsedCode, totpFailedAttempts, totpLockedUntil, semantic, emailHash,
         emailVerifiedAt, verificationMethod, magicLinkEnabled, notificationEmail, lastLoginAt,
         loginCount, verifiedAttributes, verificationIssuer, verificationCredentialHash, ftnVerified,
         googleSub, externalIdentities, trustScore, morselBalance, allowedOrigins)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.ghii, record.username, record.nodeId, record.displayName,
        record.bio ?? null, record.avatar ?? null, record.locale ?? null,
        record.passwordHash ?? null, record.verificationLevel, record.ownerName,
        record.createdAt, record.updatedAt,
        record.totpSecret ?? null, record.totpEnabled ? 1 : 0,
        record.totpBackupCodes ? JSON.stringify(record.totpBackupCodes) : null,
        record.totpLastUsedAt ?? null, record.totpLastUsedCode ?? null,
        record.totpFailedAttempts ?? 0, record.totpLockedUntil ?? null,
        record.semantic ? JSON.stringify(record.semantic) : null,
        record.emailHash ?? null, record.emailVerifiedAt ?? null,
        record.verificationMethod ?? null, record.magicLinkEnabled ? 1 : 0,
        record.notificationEmail ?? null, record.lastLoginAt ?? null,
        record.loginCount ?? 0,
        record.verifiedAttributes ? JSON.stringify(record.verifiedAttributes) : null,
        record.verificationIssuer ?? null, record.verificationCredentialHash ?? null,
        record.ftnVerified ? 1 : 0,
        record.googleSub ?? null,
        record.externalIdentities ? JSON.stringify(record.externalIdentities) : null,
        record.trustScore ?? null, record.morselBalance ?? null,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('GHII_TAKEN', { cause: err });
      throw err;
    }
  },

  async getGHIIsByGhiis(this: SqliteStorage, ghiis: string[]): Promise<Record<string, GHIIRecord>> {
    if (ghiis.length === 0) return {};
    const placeholders = ghiis.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM ghiis WHERE ghii IN (${placeholders})`).all(...ghiis) as Record<string, unknown>[];
    const out: Record<string, GHIIRecord> = {};
    for (const row of rows) { const rec = this.deserializeGHII(row); out[rec.ghii] = rec; }
    return out;
  },

  async getGHII(this: SqliteStorage, ghii: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE ghii = ?').get(ghii) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async getGHIIByOwner(this: SqliteStorage, ownerName: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async getGHIIByEmailHash(this: SqliteStorage, emailHash: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE emailHash = ?').get(emailHash) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async getGHIIsByEmailHash(this: SqliteStorage, emailHash: string): Promise<GHIIRecord[]> {
    const rows = this.db.prepare('SELECT * FROM ghiis WHERE emailHash = ?').all(emailHash) as Record<string, unknown>[];
    return rows.map(r => this.deserializeGHII(r));
  },

  async getGHIIByGoogleSub(this: SqliteStorage, googleSub: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE googleSub = ?').get(googleSub) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async getGHIIByExternalId(this: SqliteStorage, provider: string, sub: string): Promise<GHIIRecord | null> {
    // Google keeps its indexed mirror column for a fast path; all providers also live in the
    // generic externalIdentities JSON map, matched with json_extract (JSON1, built into better-sqlite3).
    if (provider === 'google') {
      const byMirror = this.db.prepare('SELECT * FROM ghiis WHERE googleSub = ?').get(sub) as Record<string, unknown> | undefined;
      if (byMirror) return this.deserializeGHII(byMirror);
    }
    const row = this.db.prepare("SELECT * FROM ghiis WHERE json_extract(externalIdentities, '$.' || ?) = ?")
      .get(provider, sub) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async updateGHII(this: SqliteStorage, ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null> {
    const existing = await this.getGHII(ghii);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE ghiis SET username = ?, nodeId = ?, displayName = ?, bio = ?, avatar = ?, locale = ?,
       passwordHash = ?, verificationLevel = ?, ownerName = ?, createdAt = ?, updatedAt = ?,
       totpSecret = ?, totpEnabled = ?, totpBackupCodes = ?, totpLastUsedAt = ?,
       totpLastUsedCode = ?, totpFailedAttempts = ?, totpLockedUntil = ?,
       passwordFailedAttempts = ?, passwordLockedUntil = ?, semantic = ?,
       emailHash = ?, emailVerifiedAt = ?, verificationMethod = ?, magicLinkEnabled = ?,
       notificationEmail = ?, lastLoginAt = ?, loginCount = ?, verifiedAttributes = ?,
       verificationIssuer = ?, verificationCredentialHash = ?, ftnVerified = ?,
       googleSub = ?, externalIdentities = ?, trustScore = ?, morselBalance = ?, allowedOrigins = ?
       WHERE ghii = ?`
    ).run(
      updated.username, updated.nodeId, updated.displayName,
      updated.bio ?? null, updated.avatar ?? null, updated.locale ?? null,
      updated.passwordHash ?? null, updated.verificationLevel, updated.ownerName,
      updated.createdAt, updated.updatedAt,
      updated.totpSecret ?? null, updated.totpEnabled ? 1 : 0,
      updated.totpBackupCodes ? JSON.stringify(updated.totpBackupCodes) : null,
      updated.totpLastUsedAt ?? null, updated.totpLastUsedCode ?? null,
      updated.totpFailedAttempts ?? 0, updated.totpLockedUntil ?? null,
      updated.passwordFailedAttempts ?? 0, updated.passwordLockedUntil ?? null,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.emailHash ?? null, updated.emailVerifiedAt ?? null,
      updated.verificationMethod ?? null, updated.magicLinkEnabled ? 1 : 0,
      updated.notificationEmail ?? null, updated.lastLoginAt ?? null,
      updated.loginCount ?? 0,
      updated.verifiedAttributes ? JSON.stringify(updated.verifiedAttributes) : null,
      updated.verificationIssuer ?? null, updated.verificationCredentialHash ?? null,
      updated.ftnVerified ? 1 : 0,
      updated.googleSub ?? null,
      updated.externalIdentities ? JSON.stringify(updated.externalIdentities) : null,
      updated.trustScore ?? null, updated.morselBalance ?? null,
      updated.allowedOrigins ? JSON.stringify(updated.allowedOrigins) : null,
      ghii,
    );
    return updated;
  },

  async listGHIIs(this: SqliteStorage, opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> {
    const rows = this.db.prepare('SELECT * FROM ghiis').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeGHII(r));
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      results = results.filter(r =>
        r.username.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        (r.bio?.toLowerCase().includes(q) ?? false)
      );
    }
    if (opts?.level !== undefined) {
      results = results.filter(r => r.verificationLevel >= opts.level!);
    }
    return results;
  },

  async deleteGHII(this: SqliteStorage, ghii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM ghiis WHERE ghii = ?').run(ghii);
    return result.changes > 0;
  },

  deserializeGHII(this: SqliteStorage, row: Record<string, unknown>): GHIIRecord {
    const record: GHIIRecord = {
      username: row.username as string,
      nodeId: row.nodeId as string,
      ghii: row.ghii as string,
      displayName: row.displayName as string,
      verificationLevel: row.verificationLevel as 0 | 1 | 2 | 3,
      ownerName: row.ownerName as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      totpEnabled: (row.totpEnabled as number) === 1,
    };
    if (row.bio) record.bio = row.bio as string;
    if (row.avatar) record.avatar = row.avatar as string;
    if (row.locale) record.locale = row.locale as string;
    if (row.passwordHash) record.passwordHash = row.passwordHash as string;
    if (row.totpSecret) record.totpSecret = row.totpSecret as string;
    if (row.totpBackupCodes) record.totpBackupCodes = JSON.parse(row.totpBackupCodes as string);
    if (row.totpLastUsedAt) record.totpLastUsedAt = row.totpLastUsedAt as string;
    if (row.totpLastUsedCode) record.totpLastUsedCode = row.totpLastUsedCode as string;
    if (row.totpFailedAttempts) record.totpFailedAttempts = row.totpFailedAttempts as number;
    if (row.totpLockedUntil) record.totpLockedUntil = row.totpLockedUntil as string;
    // Password lockout state — the columns existed but no provider read or wrote them, so
    // config.passwordLockoutAttempts could never engage (every wrong password read back 0 attempts).
    if (row.passwordFailedAttempts) record.passwordFailedAttempts = row.passwordFailedAttempts as number;
    if (row.passwordLockedUntil) record.passwordLockedUntil = row.passwordLockedUntil as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.emailHash) record.emailHash = row.emailHash as string;
    if (row.emailVerifiedAt) record.emailVerifiedAt = row.emailVerifiedAt as string;
    if (row.verificationMethod) record.verificationMethod = row.verificationMethod as GHIIRecord['verificationMethod'];
    if (row.magicLinkEnabled) record.magicLinkEnabled = (row.magicLinkEnabled as number) === 1;
    if (row.notificationEmail) record.notificationEmail = row.notificationEmail as string;
    if (row.lastLoginAt) record.lastLoginAt = row.lastLoginAt as string;
    if (row.loginCount) record.loginCount = row.loginCount as number;
    if (row.verifiedAttributes) record.verifiedAttributes = JSON.parse(row.verifiedAttributes as string);
    if (row.verificationIssuer) record.verificationIssuer = row.verificationIssuer as string;
    if (row.verificationCredentialHash) record.verificationCredentialHash = row.verificationCredentialHash as string;
    if (row.ftnVerified) record.ftnVerified = (row.ftnVerified as number) === 1;
    if (row.googleSub) record.googleSub = row.googleSub as string;
    if (row.externalIdentities) record.externalIdentities = JSON.parse(row.externalIdentities as string);
    if (row.trustScore !== null && row.trustScore !== undefined) record.trustScore = row.trustScore as number;
    if (row.morselBalance !== null && row.morselBalance !== undefined) record.morselBalance = row.morselBalance as number;
    if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
    return record;
  },

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
      `SELECT * FROM email_verifications WHERE ownerName = ? AND purpose = ? AND status = 'pending' AND expiresAt > ? LIMIT 1`
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

  async getEmailVerificationsByOwner(this: SqliteStorage, ownerName: string): Promise<EmailVerificationRecord[]> {
    const rows = this.db.prepare('SELECT * FROM email_verifications WHERE ownerName = ?').all(ownerName) as Record<string, unknown>[];
    return rows.map(r => this.deserializeEmailVerification(r));
  },

  async deleteExpiredEmailVerifications(this: SqliteStorage): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `DELETE FROM email_verifications WHERE status = 'pending' AND expiresAt < ?`
    ).run(now);
    return result.changes;
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

  // ══════════════════════════════════════════════════════════
  // ── Personal Nodes ──
  // ══════════════════════════════════════════════════════════

  async createPersonalNode(this: SqliteStorage, node: PersonalNodeRecord): Promise<PersonalNodeRecord> {
    this.db.prepare(
      `INSERT INTO personal_nodes (nodeId, ownerName, anchorNodeId, publicKey, status, agentGaiis,
       lastSeen, mailboxQuotaBytes, mailboxUsedBytes, visibility, createdAt, updatedAt, semantic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      node.nodeId, node.ownerName, node.anchorNodeId, node.publicKey,
      node.status, JSON.stringify(node.agentGaiis), node.lastSeen,
      node.mailboxQuotaBytes, node.mailboxUsedBytes, node.visibility,
      node.createdAt, node.updatedAt,
      node.semantic ? JSON.stringify(node.semantic) : null,
    );
    return { ...node };
  },

  async getPersonalNode(this: SqliteStorage, nodeId: string): Promise<PersonalNodeRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_nodes WHERE nodeId = ?').get(nodeId) as Record<string, unknown> | undefined;
    return row ? this.deserializePersonalNode(row) : null;
  },

  async getPersonalNodeByOwner(this: SqliteStorage, ownerName: string): Promise<PersonalNodeRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_nodes WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
    return row ? this.deserializePersonalNode(row) : null;
  },

  async listPersonalNodes(this: SqliteStorage, opts?: { status?: string }): Promise<PersonalNodeRecord[]> {
    let sql = 'SELECT * FROM personal_nodes';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePersonalNode(r));
  },

  async updatePersonalNode(this: SqliteStorage, nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null> {
    const existing = await this.getPersonalNode(nodeId);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE personal_nodes SET ownerName = ?, anchorNodeId = ?, publicKey = ?, status = ?,
       agentGaiis = ?, lastSeen = ?, mailboxQuotaBytes = ?, mailboxUsedBytes = ?,
       visibility = ?, createdAt = ?, updatedAt = ?, semantic = ? WHERE nodeId = ?`
    ).run(
      updated.ownerName, updated.anchorNodeId, updated.publicKey, updated.status,
      JSON.stringify(updated.agentGaiis), updated.lastSeen,
      updated.mailboxQuotaBytes, updated.mailboxUsedBytes,
      updated.visibility, updated.createdAt, updated.updatedAt,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      nodeId,
    );
    return { ...updated };
  },

  async deletePersonalNode(this: SqliteStorage, nodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM personal_nodes WHERE nodeId = ?').run(nodeId);
    return result.changes > 0;
  },

  deserializePersonalNode(this: SqliteStorage, row: Record<string, unknown>): PersonalNodeRecord {
    const record: PersonalNodeRecord = {
      nodeId: row.nodeId as string,
      ownerName: row.ownerName as string,
      anchorNodeId: row.anchorNodeId as string,
      publicKey: row.publicKey as string,
      status: row.status as PersonalNodeRecord['status'],
      agentGaiis: JSON.parse(row.agentGaiis as string) as string[],
      lastSeen: row.lastSeen as string,
      mailboxQuotaBytes: row.mailboxQuotaBytes as number,
      mailboxUsedBytes: row.mailboxUsedBytes as number,
      visibility: row.visibility as PersonalNodeRecord['visibility'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Mailbox ──
  // ══════════════════════════════════════════════════════════

  async createMailboxItem(this: SqliteStorage, item: MailboxItemRecord): Promise<MailboxItemRecord> {
    this.db.prepare(
      `INSERT INTO mailbox_items (id, personalNodeId, type, fromGaii, toGaii, payload, sizeBytes, retentionDays, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      item.id, item.personalNodeId, item.type, item.fromGaii, item.toGaii,
      item.payload, item.sizeBytes, item.retentionDays, item.expiresAt, item.createdAt,
    );
    // Update the personal node's mailbox usage
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = mailboxUsedBytes + ? WHERE nodeId = ?'
    ).run(item.sizeBytes, item.personalNodeId);
    return { ...item };
  },

  async getMailboxItem(this: SqliteStorage, id: string): Promise<MailboxItemRecord | null> {
    const row = this.db.prepare('SELECT * FROM mailbox_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeMailboxItem(row) : null;
  },

  async listMailboxItems(this: SqliteStorage, personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]> {
    let sql = 'SELECT * FROM mailbox_items WHERE personalNodeId = ?';
    const params: unknown[] = [personalNodeId];
    if (opts?.type) { sql += ' AND type = ?'; params.push(opts.type); }
    sql += ' ORDER BY createdAt ASC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMailboxItem(r));
  },

  async deleteMailboxItem(this: SqliteStorage, id: string): Promise<boolean> {
    const item = await this.getMailboxItem(id);
    if (!item) return false;
    // Update the personal node's mailbox usage
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = MAX(0, mailboxUsedBytes - ?) WHERE nodeId = ?'
    ).run(item.sizeBytes, item.personalNodeId);
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async deleteMailboxItemsByNode(this: SqliteStorage, personalNodeId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE personalNodeId = ?').run(personalNodeId);
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = 0 WHERE nodeId = ?'
    ).run(personalNodeId);
    return result.changes;
  },

  async getMailboxStats(this: SqliteStorage, personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(sizeBytes), 0) as totalBytes FROM mailbox_items WHERE personalNodeId = ?'
    ).get(personalNodeId) as Record<string, unknown>;
    return {
      count: row.count as number,
      totalBytes: row.totalBytes as number,
    };
  },

  async cleanExpiredMailboxItems(this: SqliteStorage): Promise<number> {
    const now = new Date().toISOString();
    // Get expired items to update personal node usage
    const expiredItems = this.db.prepare(
      'SELECT personalNodeId, sizeBytes FROM mailbox_items WHERE expiresAt < ?'
    ).all(now) as Record<string, unknown>[];

    // Aggregate by personalNodeId
    const bytesPerNode = new Map<string, number>();
    for (const item of expiredItems) {
      const nodeId = item.personalNodeId as string;
      bytesPerNode.set(nodeId, (bytesPerNode.get(nodeId) ?? 0) + (item.sizeBytes as number));
    }

    // Delete expired items
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE expiresAt < ?').run(now);

    // Update personal node usage
    for (const [nodeId, bytes] of bytesPerNode) {
      this.db.prepare(
        'UPDATE personal_nodes SET mailboxUsedBytes = MAX(0, mailboxUsedBytes - ?) WHERE nodeId = ?'
      ).run(bytes, nodeId);
    }

    return result.changes;
  },

  deserializeMailboxItem(this: SqliteStorage, row: Record<string, unknown>): MailboxItemRecord {
    return {
      id: row.id as string,
      personalNodeId: row.personalNodeId as string,
      type: row.type as MailboxItemRecord['type'],
      fromGaii: row.fromGaii as string,
      toGaii: row.toGaii as string,
      payload: row.payload as string,
      sizeBytes: row.sizeBytes as number,
      retentionDays: row.retentionDays as number,
      expiresAt: row.expiresAt as string,
      createdAt: row.createdAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Maintenance Mode ──
  // ══════════════════════════════════════════════════════════

  async getMaintenanceMode(this: SqliteStorage): Promise<MaintenanceState> {
    const row = this.db.prepare('SELECT * FROM maintenance WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) {
      return { enabled: false, message: '', enabledAt: null, enabledBy: null };
    }
    return {
      enabled: (row.enabled as number) === 1,
      message: row.message as string,
      enabledAt: (row.enabledAt as string) ?? null,
      enabledBy: (row.enabledBy as string) ?? null,
    };
  },

  async setMaintenanceMode(this: SqliteStorage, state: MaintenanceState): Promise<MaintenanceState> {
    this.db.prepare(
      `INSERT OR REPLACE INTO maintenance (id, enabled, message, enabledAt, enabledBy) VALUES (1, ?, ?, ?, ?)`
    ).run(
      state.enabled ? 1 : 0, state.message,
      state.enabledAt, state.enabledBy,
    );
    return state;
  },

  // ══════════════════════════════════════════════════════════
};
