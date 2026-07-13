/**
 * @file src/storage/providers/sqlite/repos/auth.ts
 * @description SQLite (better-sqlite3) repository functions for the auth data plane — one-time keys
 *   (OTK), RFC 8628 device-authorization records, and OAuth client/refresh-token/approval records.
 *   Each function takes the Database handle and performs a single prepared-statement operation.
 *
 * @structure
 *   - OTK: createOtk, getOtk, consumeOtk (initial-grace + expiry/used lifecycle), deserializeOtk
 *   - Device auth: create/get/consume records for the device-authorization grant
 *   - OAuth: client, refresh-token, and approval record CRUD
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type {
  OtkRecord, DeviceAuthorizationRecord,
  OAuthClientRecord, OAuthRefreshTokenRecord, OAuthApprovalRecord,
} from '../../../interface.js';

// ── OTK (One-Time Keys) ──

function deserializeOtk(row: Record<string, unknown>): OtkRecord {
  return {
    key: row.key as string,
    ownerGaii: row.ownerGaii as string,
    action: row.action as string,
    params: JSON.parse(row.params as string),
    expiresAt: row.expiresAt as string,
    initial: (row.initial as number) === 1,
    used: (row.used as number) === 1,
    usedAt: (row.usedAt as string) ?? null,
    sessionId: (row.sessionId as string) ?? null,
    createdAt: row.createdAt as string,
  };
}

export function createOtk(db: Database.Database, otk: OtkRecord): OtkRecord {
  db.prepare(
    `INSERT INTO otks (key, ownerGaii, action, params, expiresAt, initial, used, usedAt, sessionId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    otk.key, otk.ownerGaii, otk.action,
    JSON.stringify(otk.params), otk.expiresAt,
    otk.initial ? 1 : 0, otk.used ? 1 : 0,
    otk.usedAt, otk.sessionId, otk.createdAt,
  );
  return otk;
}

export function getOtk(db: Database.Database, key: string): OtkRecord | null {
  const row = db.prepare('SELECT * FROM otks WHERE key = ?').get(key) as Record<string, unknown> | undefined;
  return row ? deserializeOtk(row) : null;
}

export function consumeOtk(db: Database.Database, key: string, graceMs: number = 60_000): OtkRecord | null {
  const otk = getOtk(db, key);
  if (!otk) return null;

  if (otk.initial && !otk.used) {
    otk.used = true;
    otk.usedAt = new Date().toISOString();
    otk.expiresAt = new Date(Date.now() + graceMs).toISOString();
    db.prepare('UPDATE otks SET used = 1, usedAt = ?, expiresAt = ? WHERE key = ?').run(otk.usedAt, otk.expiresAt, key);
    return otk;
  }

  if (new Date(otk.expiresAt) < new Date()) {
    db.prepare('DELETE FROM otks WHERE key = ?').run(key);
    return null;
  }

  if (otk.used && otk.usedAt) {
    const usedAt = new Date(otk.usedAt).getTime();
    if (Date.now() - usedAt > graceMs) {
      db.prepare('DELETE FROM otks WHERE key = ?').run(key);
      return null;
    }
    return otk;
  }

  otk.used = true;
  otk.usedAt = new Date().toISOString();
  db.prepare('UPDATE otks SET used = 1, usedAt = ? WHERE key = ?').run(otk.usedAt, key);
  return otk;
}

export function listOtksBySession(db: Database.Database, sessionId: string): OtkRecord[] {
  const rows = db.prepare('SELECT * FROM otks WHERE sessionId = ?').all(sessionId) as Record<string, unknown>[];
  return rows.map(r => deserializeOtk(r));
}

export function expireSessionOtks(db: Database.Database, sessionId: string): number {
  const result = db.prepare('DELETE FROM otks WHERE sessionId = ?').run(sessionId);
  return result.changes;
}

// ── Sessions ──

export function createSession(db: Database.Database, session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): void {
  db.prepare(
    'INSERT INTO sessions (sessionId, gaii, owner, issuedAt, expiresAt, revoked) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(session.sessionId, session.gaii, session.owner, session.issuedAt, session.expiresAt);
}

export function listActiveSessions(db: Database.Database, owner: string): Array<{ sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string; revoked: boolean }> {
  return db.prepare(
    'SELECT sessionId, gaii, owner, issuedAt, expiresAt, revoked FROM sessions WHERE owner = ? AND revoked = 0 ORDER BY issuedAt DESC'
  ).all(owner) as Array<{ sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string; revoked: boolean }>;
}

export function revokeSession(db: Database.Database, sessionId: string): boolean {
  const result = db.prepare('UPDATE sessions SET revoked = 1 WHERE sessionId = ? AND revoked = 0').run(sessionId);
  return result.changes > 0;
}

export function revokeAllSessions(db: Database.Database, owner: string): number {
  const result = db.prepare('UPDATE sessions SET revoked = 1 WHERE owner = ? AND revoked = 0').run(owner);
  return result.changes;
}

export function isSessionRevoked(db: Database.Database, sessionId: string): boolean {
  const row = db.prepare('SELECT revoked FROM sessions WHERE sessionId = ?').get(sessionId) as { revoked: number } | undefined;
  if (!row) return false;
  return row.revoked === 1;
}

// ── Token Revocation ──

export function revokeToken(db: Database.Database, tokenHash: string, expiresAt: number): void {
  db.prepare(
    'INSERT OR REPLACE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)'
  ).run(tokenHash, expiresAt);
}

export function isTokenRevoked(db: Database.Database, tokenHash: string): boolean {
  const row = db.prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?').get(tokenHash);
  return !!row;
}

export function cleanExpiredRevocations(db: Database.Database): number {
  const result = db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
  return result.changes;
}

// ── Node Key ──

export function setNodeKey(db: Database.Database, publicKey: string, privateKey: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO node_key (id, publicKey, privateKey) VALUES (1, ?, ?)`
  ).run(publicKey, privateKey);
}

export function getNodeKey(db: Database.Database): { publicKey: string; privateKey: string } | null {
  const row = db.prepare('SELECT * FROM node_key WHERE id = 1').get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return { publicKey: row.publicKey as string, privateKey: row.privateKey as string };
}

// ── Device Authorization ──

function deserializeDeviceAuth(row: Record<string, unknown>): DeviceAuthorizationRecord {
  return {
    deviceCode: row.deviceCode as string,
    userCode: row.userCode as string,
    ownerName: row.ownerName as string,
    agentName: row.agentName as string,
    displayName: row.displayName as string | undefined,
    description: row.description as string | undefined,
    status: row.status as DeviceAuthorizationRecord['status'],
    scopes: row.scopes ? JSON.parse(row.scopes as string) : undefined,
    createdAt: row.createdAt as string,
    expiresAt: row.expiresAt as string,
    lastPolledAt: row.lastPolledAt as string | undefined,
    pollInterval: row.pollInterval as number,
    approvedBy: row.approvedBy as string | undefined,
    agentCredentials: row.agentCredentials ? JSON.parse(row.agentCredentials as string) : undefined,
  };
}

export function createDeviceAuth(db: Database.Database, req: DeviceAuthorizationRecord): void {
  db.prepare(
    `INSERT INTO device_auth (deviceCode, userCode, ownerName, agentName, displayName, description, status, scopes, createdAt, expiresAt, lastPolledAt, pollInterval, approvedBy, agentCredentials)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.deviceCode, req.userCode, req.ownerName, req.agentName,
    req.displayName ?? null, req.description ?? null,
    req.status, req.scopes ? JSON.stringify(req.scopes) : null,
    req.createdAt, req.expiresAt, req.lastPolledAt ?? null,
    req.pollInterval, req.approvedBy ?? null,
    req.agentCredentials ? JSON.stringify(req.agentCredentials) : null,
  );
}

export function getDeviceAuthByDeviceCode(db: Database.Database, deviceCode: string): DeviceAuthorizationRecord | null {
  const row = db.prepare('SELECT * FROM device_auth WHERE deviceCode = ?').get(deviceCode) as Record<string, unknown> | undefined;
  return row ? deserializeDeviceAuth(row) : null;
}

export function getDeviceAuthByUserCode(db: Database.Database, userCode: string): DeviceAuthorizationRecord | null {
  const row = db.prepare('SELECT * FROM device_auth WHERE userCode = ?').get(userCode) as Record<string, unknown> | undefined;
  return row ? deserializeDeviceAuth(row) : null;
}

export function updateDeviceAuth(db: Database.Database, deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.scopes !== undefined) { fields.push('scopes = ?'); values.push(JSON.stringify(updates.scopes)); }
  if (updates.lastPolledAt !== undefined) { fields.push('lastPolledAt = ?'); values.push(updates.lastPolledAt); }
  if (updates.pollInterval !== undefined) { fields.push('pollInterval = ?'); values.push(updates.pollInterval); }
  if (updates.approvedBy !== undefined) { fields.push('approvedBy = ?'); values.push(updates.approvedBy); }
  if ('agentCredentials' in updates) { fields.push('agentCredentials = ?'); values.push(updates.agentCredentials ? JSON.stringify(updates.agentCredentials) : null); }
  if (fields.length === 0) return;
  values.push(deviceCode);
  db.prepare(`UPDATE device_auth SET ${fields.join(', ')} WHERE deviceCode = ?`).run(...values);
}

export function countPendingDeviceAuthByOwner(db: Database.Database, ownerName: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM device_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ?`
  ).get(ownerName, new Date().toISOString()) as { cnt: number };
  return row.cnt;
}

export function listPendingDeviceAuthByOwner(db: Database.Database, ownerName: string): DeviceAuthorizationRecord[] {
  const rows = db.prepare(
    `SELECT * FROM device_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ? ORDER BY createdAt DESC`
  ).all(ownerName, new Date().toISOString()) as Record<string, unknown>[];
  return rows.map(deserializeDeviceAuth);
}

export function cleanupExpiredDeviceAuth(db: Database.Database): number {
  const result = db.prepare(
    `DELETE FROM device_auth WHERE status = 'pending' AND expiresAt <= ?`
  ).run(new Date().toISOString());
  return result.changes;
}

// ── OAuth 2.1 ──

export function createOAuthClient(db: Database.Database, client: OAuthClientRecord): void {
  db.prepare(
    `INSERT INTO oauth_clients (clientId, clientSecret, clientName, redirectUris, createdAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    client.clientId, client.clientSecret, client.clientName,
    JSON.stringify(client.redirectUris), client.createdAt,
  );
}

export function getOAuthClient(db: Database.Database, clientId: string): OAuthClientRecord | null {
  const row = db.prepare('SELECT * FROM oauth_clients WHERE clientId = ?').get(clientId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    clientId: row.clientId as string,
    clientSecret: row.clientSecret as string,
    clientName: row.clientName as string,
    redirectUris: JSON.parse(row.redirectUris as string),
    createdAt: row.createdAt as string,
  };
}

export function deleteOAuthClient(db: Database.Database, clientId: string): boolean {
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM oauth_refresh_tokens WHERE clientId = ?').run(clientId);
    db.prepare('DELETE FROM oauth_approvals WHERE clientId = ?').run(clientId);
    const result = db.prepare('DELETE FROM oauth_clients WHERE clientId = ?').run(clientId);
    return result.changes > 0;
  });
  return txn();
}

export function listOAuthClients(db: Database.Database): OAuthClientRecord[] {
  const rows = db.prepare('SELECT * FROM oauth_clients ORDER BY createdAt DESC').all() as Record<string, unknown>[];
  return rows.map(row => ({
    clientId: row.clientId as string,
    clientSecret: row.clientSecret as string,
    clientName: row.clientName as string,
    redirectUris: JSON.parse(row.redirectUris as string),
    createdAt: row.createdAt as string,
  }));
}

export function createOAuthRefreshToken(db: Database.Database, token: OAuthRefreshTokenRecord): void {
  db.prepare(
    `INSERT INTO oauth_refresh_tokens (tokenHash, clientId, gaii, owner, roles, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    token.tokenHash, token.clientId, token.gaii, token.owner,
    JSON.stringify(token.roles), token.createdAt,
  );
}

export function getOAuthRefreshToken(db: Database.Database, tokenHash: string): OAuthRefreshTokenRecord | null {
  const row = db.prepare('SELECT * FROM oauth_refresh_tokens WHERE tokenHash = ?').get(tokenHash) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    tokenHash: row.tokenHash as string,
    clientId: row.clientId as string,
    gaii: row.gaii as string,
    owner: row.owner as string,
    roles: JSON.parse(row.roles as string),
    createdAt: row.createdAt as string,
  };
}

export function deleteOAuthRefreshToken(db: Database.Database, tokenHash: string): boolean {
  const result = db.prepare('DELETE FROM oauth_refresh_tokens WHERE tokenHash = ?').run(tokenHash);
  return result.changes > 0;
}

export function deleteOAuthRefreshTokensByClient(db: Database.Database, clientId: string): number {
  const result = db.prepare('DELETE FROM oauth_refresh_tokens WHERE clientId = ?').run(clientId);
  return result.changes;
}

export function deleteOAuthRefreshTokensByGaii(db: Database.Database, gaii: string): number {
  const result = db.prepare('DELETE FROM oauth_refresh_tokens WHERE gaii = ?').run(gaii);
  return result.changes;
}

export function createOAuthApproval(db: Database.Database, approval: OAuthApprovalRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO oauth_approvals (clientId, gaii, owner, scope, approvedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    approval.clientId, approval.gaii, approval.owner,
    approval.scope, approval.approvedAt,
  );
}

export function getOAuthApproval(db: Database.Database, clientId: string, gaii: string): OAuthApprovalRecord | null {
  const row = db.prepare('SELECT * FROM oauth_approvals WHERE clientId = ? AND gaii = ?').get(clientId, gaii) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    clientId: row.clientId as string,
    gaii: row.gaii as string,
    owner: row.owner as string,
    scope: row.scope as string,
    approvedAt: row.approvedAt as string,
  };
}

export function deleteOAuthApproval(db: Database.Database, clientId: string, gaii: string): boolean {
  const result = db.prepare('DELETE FROM oauth_approvals WHERE clientId = ? AND gaii = ?').run(clientId, gaii);
  return result.changes > 0;
}

export function deleteOAuthApprovalsByClient(db: Database.Database, clientId: string): number {
  const result = db.prepare('DELETE FROM oauth_approvals WHERE clientId = ?').run(clientId);
  return result.changes;
}

export function deleteOAuthApprovalsByGaii(db: Database.Database, gaii: string): number {
  const result = db.prepare('DELETE FROM oauth_approvals WHERE gaii = ?').run(gaii);
  return result.changes;
}

export function listOAuthApprovalsByOwner(db: Database.Database, owner: string): OAuthApprovalRecord[] {
  const rows = db.prepare('SELECT * FROM oauth_approvals WHERE owner = ? ORDER BY approvedAt DESC').all(owner) as Record<string, unknown>[];
  return rows.map(row => ({
    clientId: row.clientId as string,
    gaii: row.gaii as string,
    owner: row.owner as string,
    scope: row.scope as string,
    approvedAt: row.approvedAt as string,
  }));
}
