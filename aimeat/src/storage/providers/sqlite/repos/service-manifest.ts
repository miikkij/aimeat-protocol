import type Database from 'better-sqlite3';
import type { CsmRecord, MsmRecord } from '../../../interface.js';

// ── CSM Helpers ──

function deserializeCsm(row: Record<string, unknown>): CsmRecord {
  const record: CsmRecord = {
    name: row.name as string,
    definition: JSON.parse(row.definition as string),
    jsonSchemaKey: row.jsonSchemaKey as string,
    serviceType: row.serviceType as string,
    registeredBy: row.registeredBy as string,
    registeredAt: row.registeredAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
  if (row.federate) record.federate = (row.federate as number) === 1;
  return record;
}

// ── MSM Helpers ──

function deserializeMsm(row: Record<string, unknown>): MsmRecord {
  const record: MsmRecord = {
    name: row.name as string,
    definition: JSON.parse(row.definition as string),
    category: row.category as string,
    authType: row.authType as string,
    actionsCount: row.actionsCount as number,
    registeredBy: row.registeredBy as string,
    registeredAt: row.registeredAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.federate) record.federate = (row.federate as number) === 1;
  return record;
}

// ── CSM ──

export function createCsm(db: Database.Database, record: CsmRecord): CsmRecord {
  try {
    db.prepare(
      `INSERT INTO csms (name, definition, jsonSchemaKey, serviceType, registeredBy, registeredAt, updatedAt, semantic, federate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.name, JSON.stringify(record.definition), record.jsonSchemaKey,
      record.serviceType, record.registeredBy, record.registeredAt, record.updatedAt,
      record.semantic ? JSON.stringify(record.semantic) : null,
      record.federate ? 1 : 0,
    );
    return record;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('CSM_NAME_TAKEN');
    throw err;
  }
}

export function getCsm(db: Database.Database, name: string): CsmRecord | null {
  const row = db.prepare('SELECT * FROM csms WHERE name = ?').get(name) as Record<string, unknown> | undefined;
  return row ? deserializeCsm(row) : null;
}

export function listCsms(db: Database.Database, opts?: { serviceType?: string }): CsmRecord[] {
  let sql = 'SELECT * FROM csms';
  const params: unknown[] = [];
  if (opts?.serviceType) { sql += ' WHERE serviceType = ?'; params.push(opts.serviceType); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeCsm(r));
}

export function updateCsm(db: Database.Database, name: string, updates: Partial<CsmRecord>): CsmRecord | null {
  const existing = getCsm(db, name);
  if (!existing) return null;
  const updated = { ...existing, ...updates, name: existing.name };
  db.prepare(
    `UPDATE csms SET definition = ?, jsonSchemaKey = ?, serviceType = ?, registeredBy = ?,
     registeredAt = ?, updatedAt = ?, semantic = ?, federate = ? WHERE name = ?`
  ).run(
    JSON.stringify(updated.definition), updated.jsonSchemaKey,
    updated.serviceType, updated.registeredBy,
    updated.registeredAt, updated.updatedAt,
    updated.semantic ? JSON.stringify(updated.semantic) : null,
    updated.federate ? 1 : 0,
    name,
  );
  return updated;
}

export function deleteCsm(db: Database.Database, name: string): boolean {
  const result = db.prepare('DELETE FROM csms WHERE name = ?').run(name);
  return result.changes > 0;
}

// ── MSM ──

export function createMsm(db: Database.Database, record: MsmRecord): MsmRecord {
  try {
    db.prepare(
      `INSERT INTO msms (name, definition, category, authType, actionsCount, registeredBy, registeredAt, updatedAt, federate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.name, JSON.stringify(record.definition), record.category,
      record.authType, record.actionsCount, record.registeredBy,
      record.registeredAt, record.updatedAt,
      record.federate ? 1 : 0,
    );
    return record;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('MSM_NAME_TAKEN');
    throw err;
  }
}

export function getMsm(db: Database.Database, name: string): MsmRecord | null {
  const row = db.prepare('SELECT * FROM msms WHERE name = ?').get(name) as Record<string, unknown> | undefined;
  return row ? deserializeMsm(row) : null;
}

export function listMsms(db: Database.Database, opts?: { category?: string }): MsmRecord[] {
  let sql = 'SELECT * FROM msms';
  const params: unknown[] = [];
  if (opts?.category) { sql += ' WHERE category = ?'; params.push(opts.category); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeMsm(r));
}

export function updateMsm(db: Database.Database, name: string, updates: Partial<MsmRecord>): MsmRecord | null {
  const existing = getMsm(db, name);
  if (!existing) return null;
  const updated = { ...existing, ...updates, name: existing.name, updatedAt: new Date().toISOString() };
  db.prepare(
    `UPDATE msms SET definition = ?, category = ?, authType = ?, actionsCount = ?,
     registeredBy = ?, registeredAt = ?, updatedAt = ?, federate = ? WHERE name = ?`
  ).run(
    JSON.stringify(updated.definition), updated.category, updated.authType,
    updated.actionsCount, updated.registeredBy,
    updated.registeredAt, updated.updatedAt,
    updated.federate ? 1 : 0,
    name,
  );
  return updated;
}

export function deleteMsm(db: Database.Database, name: string): boolean {
  const result = db.prepare('DELETE FROM msms WHERE name = ?').run(name);
  return result.changes > 0;
}
