/**
 * @file ecosystem-app.ts
 * @description SQLite (better-sqlite3) implementation of the EcosystemAppRepository — the GEAI
 *   principal records (`ecosystem_apps`) and the "hello integration" handshake requests (`eco_auth`).
 *   Near-copy of the agent + device-auth SQLite repos, minus tasks. JSON columns: scopes, dataAreas,
 *   appCredentials.
 * @structure EcosystemApp CRUD + EcoAuth create/get/update/count/list/cleanup
 * @usage Wired into the SQLite Storage facade (providers/sqlite/index.ts).
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for ecosystem-apps foundation (chunk 1).
 */
import type Database from 'better-sqlite3';
import type { EcosystemAppRecord, EcoAuthorizationRecord } from '../../../interface.js';

// ── EcosystemApp (GEAI principal) ────────────────────────────────────────

function deserializeEcosystemApp(row: Record<string, unknown>): EcosystemAppRecord {
  const record: EcosystemAppRecord = {
    geai: row.geai as string,
    app: row.app as string,
    owner: row.owner as string,
    publicKey: row.publicKey as string,
    scopes: row.scopes ? JSON.parse(row.scopes as string) : [],
    status: row.status as EcosystemAppRecord['status'],
    morselBalance: (row.morselBalance as number) ?? 0,
    createdAt: row.createdAt as string,
    lastSeen: row.lastSeen as string,
  };
  if (row.displayName) record.displayName = row.displayName as string;
  if (row.description) record.description = row.description as string;
  if (row.dataAreas) record.dataAreas = JSON.parse(row.dataAreas as string);
  if (row.boundRef) record.boundRef = row.boundRef as string;
  return record;
}

export function createEcosystemApp(db: Database.Database, app: EcosystemAppRecord): EcosystemAppRecord {
  try {
    db.prepare(
      `INSERT INTO ecosystem_apps (geai, app, owner, displayName, description, publicKey, scopes, dataAreas, boundRef, status, morselBalance, createdAt, lastSeen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      app.geai, app.app, app.owner,
      app.displayName ?? null, app.description ?? null,
      app.publicKey,
      JSON.stringify(app.scopes ?? []),
      app.dataAreas ? JSON.stringify(app.dataAreas) : null,
      app.boundRef ?? null,
      app.status, app.morselBalance ?? 0,
      app.createdAt, app.lastSeen,
    );
    return app;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
    throw err;
  }
}

export function getEcosystemApp(db: Database.Database, geai: string): EcosystemAppRecord | null {
  const row = db.prepare('SELECT * FROM ecosystem_apps WHERE geai = ?').get(geai) as Record<string, unknown> | undefined;
  return row ? deserializeEcosystemApp(row) : null;
}

export function getEcosystemAppByOwnerAndApp(db: Database.Database, owner: string, app: string): EcosystemAppRecord | null {
  const row = db.prepare('SELECT * FROM ecosystem_apps WHERE owner = ? AND app = ?').get(owner, app) as Record<string, unknown> | undefined;
  return row ? deserializeEcosystemApp(row) : null;
}

export function getEcosystemAppsByOwner(db: Database.Database, owner: string): EcosystemAppRecord[] {
  const rows = db.prepare('SELECT * FROM ecosystem_apps WHERE owner = ?').all(owner) as Record<string, unknown>[];
  return rows.map(r => deserializeEcosystemApp(r));
}

export function updateEcosystemApp(db: Database.Database, geai: string, updates: Partial<EcosystemAppRecord>): EcosystemAppRecord | null {
  const existing = getEcosystemApp(db, geai);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE ecosystem_apps SET app = ?, owner = ?, displayName = ?, description = ?, publicKey = ?,
     scopes = ?, dataAreas = ?, boundRef = ?, status = ?, morselBalance = ?, createdAt = ?, lastSeen = ?
     WHERE geai = ?`
  ).run(
    updated.app, updated.owner,
    updated.displayName ?? null, updated.description ?? null,
    updated.publicKey,
    JSON.stringify(updated.scopes ?? []),
    updated.dataAreas ? JSON.stringify(updated.dataAreas) : null,
    updated.boundRef ?? null,
    updated.status, updated.morselBalance ?? 0,
    updated.createdAt, updated.lastSeen,
    geai,
  );
  return updated;
}

export function deleteEcosystemApp(db: Database.Database, geai: string): boolean {
  const result = db.prepare('DELETE FROM ecosystem_apps WHERE geai = ?').run(geai);
  return result.changes > 0;
}

// ── EcoAuth (hello-integration handshake) ────────────────────────────────

function deserializeEcoAuth(row: Record<string, unknown>): EcoAuthorizationRecord {
  return {
    deviceCode: row.deviceCode as string,
    userCode: row.userCode as string,
    ownerName: row.ownerName as string,
    app: row.app as string,
    displayName: row.displayName as string | undefined,
    description: row.description as string | undefined,
    status: row.status as EcoAuthorizationRecord['status'],
    publicKey: row.publicKey as string | undefined,
    scopes: row.scopes ? JSON.parse(row.scopes as string) : undefined,
    dataAreas: row.dataAreas ? JSON.parse(row.dataAreas as string) : undefined,
    boundRef: row.boundRef as string | undefined,
    createdAt: row.createdAt as string,
    expiresAt: row.expiresAt as string,
    lastPolledAt: row.lastPolledAt as string | undefined,
    pollInterval: row.pollInterval as number,
    approvedBy: row.approvedBy as string | undefined,
    validationResult: row.validationResult ? JSON.parse(row.validationResult as string) : undefined,
    appCredentials: row.appCredentials ? JSON.parse(row.appCredentials as string) : undefined,
  };
}

export function createEcoAuth(db: Database.Database, req: EcoAuthorizationRecord): void {
  db.prepare(
    `INSERT INTO eco_auth (deviceCode, userCode, ownerName, app, displayName, description, status, publicKey, scopes, dataAreas, boundRef, createdAt, expiresAt, lastPolledAt, pollInterval, approvedBy, validationResult, appCredentials)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.deviceCode, req.userCode, req.ownerName, req.app,
    req.displayName ?? null, req.description ?? null,
    req.status, req.publicKey ?? null,
    req.scopes ? JSON.stringify(req.scopes) : null,
    req.dataAreas ? JSON.stringify(req.dataAreas) : null,
    req.boundRef ?? null,
    req.createdAt, req.expiresAt, req.lastPolledAt ?? null,
    req.pollInterval, req.approvedBy ?? null,
    req.validationResult ? JSON.stringify(req.validationResult) : null,
    req.appCredentials ? JSON.stringify(req.appCredentials) : null,
  );
}

export function getEcoAuthByDeviceCode(db: Database.Database, deviceCode: string): EcoAuthorizationRecord | null {
  const row = db.prepare('SELECT * FROM eco_auth WHERE deviceCode = ?').get(deviceCode) as Record<string, unknown> | undefined;
  return row ? deserializeEcoAuth(row) : null;
}

export function getEcoAuthByUserCode(db: Database.Database, userCode: string): EcoAuthorizationRecord | null {
  const row = db.prepare('SELECT * FROM eco_auth WHERE userCode = ?').get(userCode) as Record<string, unknown> | undefined;
  return row ? deserializeEcoAuth(row) : null;
}

export function updateEcoAuth(db: Database.Database, deviceCode: string, updates: Partial<EcoAuthorizationRecord>): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.scopes !== undefined) { fields.push('scopes = ?'); values.push(JSON.stringify(updates.scopes)); }
  if (updates.dataAreas !== undefined) { fields.push('dataAreas = ?'); values.push(JSON.stringify(updates.dataAreas)); }
  if (updates.boundRef !== undefined) { fields.push('boundRef = ?'); values.push(updates.boundRef); }
  if (updates.lastPolledAt !== undefined) { fields.push('lastPolledAt = ?'); values.push(updates.lastPolledAt); }
  if (updates.pollInterval !== undefined) { fields.push('pollInterval = ?'); values.push(updates.pollInterval); }
  if (updates.approvedBy !== undefined) { fields.push('approvedBy = ?'); values.push(updates.approvedBy); }
  if ('appCredentials' in updates) { fields.push('appCredentials = ?'); values.push(updates.appCredentials ? JSON.stringify(updates.appCredentials) : null); }
  if (fields.length === 0) return;
  values.push(deviceCode);
  db.prepare(`UPDATE eco_auth SET ${fields.join(', ')} WHERE deviceCode = ?`).run(...values);
}

export function countPendingEcoAuthByOwner(db: Database.Database, ownerName: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM eco_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ?`
  ).get(ownerName, new Date().toISOString()) as { cnt: number };
  return row.cnt;
}

export function listPendingEcoAuthByOwner(db: Database.Database, ownerName: string): EcoAuthorizationRecord[] {
  const rows = db.prepare(
    `SELECT * FROM eco_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ? ORDER BY createdAt DESC`
  ).all(ownerName, new Date().toISOString()) as Record<string, unknown>[];
  return rows.map(deserializeEcoAuth);
}

export function cleanupExpiredEcoAuth(db: Database.Database): number {
  const result = db.prepare(
    `DELETE FROM eco_auth WHERE status = 'pending' AND expiresAt <= ?`
  ).run(new Date().toISOString());
  return result.changes;
}
