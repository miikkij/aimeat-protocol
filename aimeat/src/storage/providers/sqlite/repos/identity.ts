/**
 * @file src/storage/providers/sqlite/repos/identity.ts
 * @description SQLite (better-sqlite3) implementation of the identity repository — CRUD for GHII
 *   records (incl. lookups by owner, email hash, and Google sub), chat instances, and email
 *   verifications, with row (de)serialization between DB columns and the record types.
 *
 * @structure
 *   - createGHII / getGHII / getGHIIByOwner / getGHIIByEmailHash / getGHIIByGoogleSub / updateGHII / listGHIIs / deleteGHII
 *   - createChatInstance / getChatInstance (+ list/update/delete): chat instance persistence
 *   - deserializeGHII: maps a DB row to a GHIIRecord (JSON fields, boolean coercion)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type {
  GHIIRecord, PersonalNodeRecord, ChatInstanceRecord,
  EmailVerificationRecord,
} from '../../../interface.js';

// ── GHII ──

function deserializeGHII(row: Record<string, unknown>): GHIIRecord {
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
  if (row.trustScore !== null && row.trustScore !== undefined) record.trustScore = row.trustScore as number;
  if (row.morselBalance !== null && row.morselBalance !== undefined) record.morselBalance = row.morselBalance as number;
  if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
  return record;
}

export function createGHII(db: Database.Database, record: GHIIRecord): GHIIRecord {
  try {
    db.prepare(
      `INSERT INTO ghiis (ghii, username, nodeId, displayName, bio, avatar, locale, passwordHash,
       verificationLevel, ownerName, createdAt, updatedAt, totpSecret, totpEnabled, totpBackupCodes,
       totpLastUsedAt, totpLastUsedCode, totpFailedAttempts, totpLockedUntil, semantic, emailHash,
       emailVerifiedAt, verificationMethod, magicLinkEnabled, notificationEmail, lastLoginAt,
       loginCount, verifiedAttributes, verificationIssuer, verificationCredentialHash, ftnVerified,
       googleSub, trustScore, morselBalance, allowedOrigins)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      record.trustScore ?? null, record.morselBalance ?? null,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
    );
    return record;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('GHII_TAKEN', { cause: err });
    throw err;
  }
}

export function getGHII(db: Database.Database, ghii: string): GHIIRecord | null {
  const row = db.prepare('SELECT * FROM ghiis WHERE ghii = ?').get(ghii) as Record<string, unknown> | undefined;
  return row ? deserializeGHII(row) : null;
}

export function getGHIIByOwner(db: Database.Database, ownerName: string): GHIIRecord | null {
  const row = db.prepare('SELECT * FROM ghiis WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
  return row ? deserializeGHII(row) : null;
}

export function getGHIIByEmailHash(db: Database.Database, emailHash: string): GHIIRecord | null {
  const row = db.prepare('SELECT * FROM ghiis WHERE emailHash = ?').get(emailHash) as Record<string, unknown> | undefined;
  return row ? deserializeGHII(row) : null;
}

export function getGHIIByGoogleSub(db: Database.Database, googleSub: string): GHIIRecord | null {
  const row = db.prepare('SELECT * FROM ghiis WHERE googleSub = ?').get(googleSub) as Record<string, unknown> | undefined;
  return row ? deserializeGHII(row) : null;
}

export function updateGHII(db: Database.Database, ghii: string, updates: Partial<GHIIRecord>): GHIIRecord | null {
  const existing = getGHII(db, ghii);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  db.prepare(
    `UPDATE ghiis SET username = ?, nodeId = ?, displayName = ?, bio = ?, avatar = ?, locale = ?,
     passwordHash = ?, verificationLevel = ?, ownerName = ?, createdAt = ?, updatedAt = ?,
     totpSecret = ?, totpEnabled = ?, totpBackupCodes = ?, totpLastUsedAt = ?,
     totpLastUsedCode = ?, totpFailedAttempts = ?, totpLockedUntil = ?, semantic = ?,
     emailHash = ?, emailVerifiedAt = ?, verificationMethod = ?, magicLinkEnabled = ?,
     notificationEmail = ?, lastLoginAt = ?, loginCount = ?, verifiedAttributes = ?,
     verificationIssuer = ?, verificationCredentialHash = ?, ftnVerified = ?,
     googleSub = ?, trustScore = ?, morselBalance = ?, allowedOrigins = ?
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
    updated.semantic ? JSON.stringify(updated.semantic) : null,
    updated.emailHash ?? null, updated.emailVerifiedAt ?? null,
    updated.verificationMethod ?? null, updated.magicLinkEnabled ? 1 : 0,
    updated.notificationEmail ?? null, updated.lastLoginAt ?? null,
    updated.loginCount ?? 0,
    updated.verifiedAttributes ? JSON.stringify(updated.verifiedAttributes) : null,
    updated.verificationIssuer ?? null, updated.verificationCredentialHash ?? null,
    updated.ftnVerified ? 1 : 0,
    updated.googleSub ?? null,
    updated.trustScore ?? null, updated.morselBalance ?? null,
    updated.allowedOrigins ? JSON.stringify(updated.allowedOrigins) : null,
    ghii,
  );
  return updated;
}

export function listGHIIs(db: Database.Database, opts?: { q?: string; level?: number }): GHIIRecord[] {
  const rows = db.prepare('SELECT * FROM ghiis').all() as Record<string, unknown>[];
  let results = rows.map(r => deserializeGHII(r));
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
}

export function deleteGHII(db: Database.Database, ghii: string): boolean {
  const result = db.prepare('DELETE FROM ghiis WHERE ghii = ?').run(ghii);
  return result.changes > 0;
}

// ── Chat Instances ──

function deserializeChatInstance(row: Record<string, unknown>): ChatInstanceRecord {
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
}

export function createChatInstance(db: Database.Database, record: ChatInstanceRecord): ChatInstanceRecord {
  try {
    db.prepare(
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
}

export function getChatInstance(db: Database.Database, id: string): ChatInstanceRecord | null {
  const row = db.prepare('SELECT * FROM chat_instances WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeChatInstance(row) : null;
}

export function listChatInstances(db: Database.Database, opts?: { ownerName?: string; platform?: string; ghii?: string }): ChatInstanceRecord[] {
  let sql = 'SELECT * FROM chat_instances WHERE 1=1';
  const params: unknown[] = [];
  if (opts?.ownerName) { sql += ' AND ownerName = ?'; params.push(opts.ownerName); }
  if (opts?.platform) { sql += ' AND platform = ?'; params.push(opts.platform); }
  if (opts?.ghii) { sql += ' AND ghii = ?'; params.push(opts.ghii); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeChatInstance(r));
}

export function updateChatInstance(db: Database.Database, id: string, updates: Partial<ChatInstanceRecord>): ChatInstanceRecord | null {
  const existing = getChatInstance(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE chat_instances SET platform = ?, appName = ?, ownerName = ?, ghii = ?,
     nodeId = ?, isAnonymous = ?, createdAt = ?, lastSeen = ?, agentGaii = ?, mcpClientId = ? WHERE id = ?`
  ).run(
    updated.platform, updated.appName, updated.ownerName, updated.ghii,
    updated.nodeId, updated.isAnonymous ? 1 : 0,
    updated.createdAt, updated.lastSeen,
    updated.agentGaii ?? null, updated.mcpClientId ?? null, id,
  );
  return updated;
}

export function deleteChatInstance(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM chat_instances WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Email Verifications ──

function deserializeEmailVerification(row: Record<string, unknown>): EmailVerificationRecord {
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
}

export function createEmailVerification(db: Database.Database, record: EmailVerificationRecord): EmailVerificationRecord {
  db.prepare(
    `INSERT INTO email_verifications (id, ownerName, emailHash, code, purpose, status, attempts, expiresAt, createdAt, verifiedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.ownerName, record.emailHash, record.code,
    record.purpose, record.status, record.attempts,
    record.expiresAt, record.createdAt, record.verifiedAt,
  );
  return record;
}

export function getEmailVerification(db: Database.Database, id: string): EmailVerificationRecord | null {
  const row = db.prepare('SELECT * FROM email_verifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeEmailVerification(row) : null;
}

export function getActiveEmailVerification(db: Database.Database, ownerName: string, purpose: string): EmailVerificationRecord | null {
  const now = new Date().toISOString();
  const row = db.prepare(
    `SELECT * FROM email_verifications WHERE ownerName = ? AND purpose = ? AND status = 'pending' AND expiresAt > ? LIMIT 1`
  ).get(ownerName, purpose, now) as Record<string, unknown> | undefined;
  return row ? deserializeEmailVerification(row) : null;
}

export function updateEmailVerification(db: Database.Database, id: string, updates: Partial<EmailVerificationRecord>): EmailVerificationRecord | null {
  const existing = getEmailVerification(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE email_verifications SET ownerName = ?, emailHash = ?, code = ?, purpose = ?,
     status = ?, attempts = ?, expiresAt = ?, createdAt = ?, verifiedAt = ? WHERE id = ?`
  ).run(
    updated.ownerName, updated.emailHash, updated.code, updated.purpose,
    updated.status, updated.attempts, updated.expiresAt,
    updated.createdAt, updated.verifiedAt, id,
  );
  return updated;
}

export function getEmailVerificationsByOwner(db: Database.Database, ownerName: string): EmailVerificationRecord[] {
  const rows = db.prepare('SELECT * FROM email_verifications WHERE ownerName = ?').all(ownerName) as Record<string, unknown>[];
  return rows.map(r => deserializeEmailVerification(r));
}

export function deleteExpiredEmailVerifications(db: Database.Database): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    `DELETE FROM email_verifications WHERE status = 'pending' AND expiresAt < ?`
  ).run(now);
  return result.changes;
}

// ── Personal Nodes ──

function deserializePersonalNode(row: Record<string, unknown>): PersonalNodeRecord {
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
}

export function createPersonalNode(db: Database.Database, node: PersonalNodeRecord): PersonalNodeRecord {
  db.prepare(
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
}

export function getPersonalNode(db: Database.Database, nodeId: string): PersonalNodeRecord | null {
  const row = db.prepare('SELECT * FROM personal_nodes WHERE nodeId = ?').get(nodeId) as Record<string, unknown> | undefined;
  return row ? deserializePersonalNode(row) : null;
}

export function getPersonalNodeByOwner(db: Database.Database, ownerName: string): PersonalNodeRecord | null {
  const row = db.prepare('SELECT * FROM personal_nodes WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
  return row ? deserializePersonalNode(row) : null;
}

export function listPersonalNodes(db: Database.Database, opts?: { status?: string }): PersonalNodeRecord[] {
  let sql = 'SELECT * FROM personal_nodes';
  const params: unknown[] = [];
  if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializePersonalNode(r));
}

export function updatePersonalNode(db: Database.Database, nodeId: string, updates: Partial<PersonalNodeRecord>): PersonalNodeRecord | null {
  const existing = getPersonalNode(db, nodeId);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  db.prepare(
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
}

export function deletePersonalNode(db: Database.Database, nodeId: string): boolean {
  const result = db.prepare('DELETE FROM personal_nodes WHERE nodeId = ?').run(nodeId);
  return result.changes > 0;
}
