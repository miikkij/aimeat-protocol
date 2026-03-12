import type Database from 'better-sqlite3';
import type { ConsentRecord, ConsentAuditEntry, SchemaRecord } from '../../../interface.js';
import { consentMatchPattern } from '../../../pattern-utils.js';
import { matchesRecipient } from '../../../../services/consent.js';
import { parseGaiiLoose } from '../../../../utils/gaii.js';
import { matchWildcardPattern } from '../../../pattern-utils.js';

function deserializeConsent(row: Record<string, unknown>): ConsentRecord {
  const record: ConsentRecord = {
    id: row.id as string,
    ownerGaii: row.ownerGaii as string,
    dataPattern: row.dataPattern as string,
    recipient: row.recipient as string,
    purpose: row.purpose as string,
    scope: row.scope as ConsentRecord['scope'],
    expires: (row.expires as string) ?? null,
    status: row.status as ConsentRecord['status'],
    grantedAt: row.grantedAt as string,
    revokedAt: (row.revokedAt as string) ?? null,
  };
  if (row.metadata) record.metadata = JSON.parse(row.metadata as string);
  return record;
}

function deserializeSchema(row: Record<string, unknown>): SchemaRecord {
  const record: SchemaRecord = {
    keyPattern: row.keyPattern as string,
    applyTo: row.applyTo as SchemaRecord['applyTo'],
    schemaJson: JSON.parse(row.schemaJson as string),
    schemaMode: row.schemaMode as SchemaRecord['schemaMode'],
    lockedBy: row.lockedBy as string,
    setAt: row.setAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.semanticContext) record.semanticContext = JSON.parse(row.semanticContext as string);
  return record;
}

// ── Consent ──

export function createConsent(db: Database.Database, record: ConsentRecord): ConsentRecord {
  db.prepare(
    `INSERT INTO consents (id, ownerGaii, dataPattern, recipient, purpose, scope, expires, status, grantedAt, revokedAt, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.ownerGaii, record.dataPattern, record.recipient,
    record.purpose, record.scope, record.expires,
    record.status, record.grantedAt, record.revokedAt,
    record.metadata ? JSON.stringify(record.metadata) : null,
  );
  return record;
}

export function getConsent(db: Database.Database, id: string): ConsentRecord | null {
  const row = db.prepare('SELECT * FROM consents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeConsent(row) : null;
}

export function listConsents(db: Database.Database, ownerGaii: string, opts?: {
  status?: 'active' | 'revoked' | 'expired';
  recipient?: string;
}): ConsentRecord[] {
  let sql = 'SELECT * FROM consents WHERE ownerGaii = ?';
  const params: unknown[] = [ownerGaii];
  if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
  if (opts?.recipient) { sql += ' AND recipient = ?'; params.push(opts.recipient); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeConsent(r));
}

export function updateConsent(db: Database.Database, id: string, updates: Partial<ConsentRecord>): ConsentRecord | null {
  const existing = getConsent(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE consents SET ownerGaii = ?, dataPattern = ?, recipient = ?, purpose = ?,
     scope = ?, expires = ?, status = ?, grantedAt = ?, revokedAt = ?, metadata = ? WHERE id = ?`
  ).run(
    updated.ownerGaii, updated.dataPattern, updated.recipient, updated.purpose,
    updated.scope, updated.expires, updated.status,
    updated.grantedAt, updated.revokedAt,
    updated.metadata ? JSON.stringify(updated.metadata) : null,
    id,
  );
  return updated;
}

export function deleteConsent(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM consents WHERE id = ?').run(id);
  return result.changes > 0;
}

export function findMatchingConsents(db: Database.Database, ownerGaii: string, memoryKey: string, accessorGaii: string): ConsentRecord[] {
  const now = new Date().toISOString();
  const rows = db.prepare(
    `SELECT * FROM consents WHERE ownerGaii = ? AND status = 'active'`
  ).all(ownerGaii) as Record<string, unknown>[];

  const results: ConsentRecord[] = [];
  for (const row of rows) {
    const consent = deserializeConsent(row);
    if (consent.expires && consent.expires < now) {
      db.prepare('UPDATE consents SET status = ? WHERE id = ?').run('expired', consent.id);
      continue;
    }
    const accessor = parseGaiiLoose(accessorGaii);
    if (!matchesRecipient(consent.recipient, accessorGaii, accessor.owner, accessor.node)) continue;
    if (!consentMatchPattern(consent.dataPattern, memoryKey)) continue;
    results.push(consent);
  }
  return results;
}

// ── Consent Audit ──

export function addConsentAuditEntry(db: Database.Database, entry: ConsentAuditEntry): ConsentAuditEntry {
  db.prepare(
    `INSERT INTO consent_audit (id, consentId, ownerGaii, accessorGaii, memoryKey, action, timestamp, allowed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.id, entry.consentId, entry.ownerGaii, entry.accessorGaii,
    entry.memoryKey, entry.action, entry.timestamp,
    entry.allowed ? 1 : 0,
  );
  return entry;
}

export function listConsentAudit(db: Database.Database, ownerGaii: string, opts?: {
  days?: number;
  consentId?: string;
  accessorGaii?: string;
}): ConsentAuditEntry[] {
  let sql = 'SELECT * FROM consent_audit WHERE ownerGaii = ?';
  const params: unknown[] = [ownerGaii];

  if (opts?.days) {
    const cutoff = new Date(Date.now() - opts.days * 86400000).toISOString();
    sql += ' AND timestamp >= ?';
    params.push(cutoff);
  }
  if (opts?.consentId) { sql += ' AND consentId = ?'; params.push(opts.consentId); }
  if (opts?.accessorGaii) { sql += ' AND accessorGaii = ?'; params.push(opts.accessorGaii); }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => ({
    id: r.id as string,
    consentId: r.consentId as string,
    ownerGaii: r.ownerGaii as string,
    accessorGaii: r.accessorGaii as string,
    memoryKey: r.memoryKey as string,
    action: r.action as ConsentAuditEntry['action'],
    timestamp: r.timestamp as string,
    allowed: (r.allowed as number) === 1,
  }));
}

// ── Schema Locking ──

export function setSchema(db: Database.Database, record: SchemaRecord): SchemaRecord {
  db.prepare(
    `INSERT OR REPLACE INTO schemas (keyPattern, applyTo, schemaJson, schemaMode, lockedBy, setAt, updatedAt, semanticContext)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.keyPattern, record.applyTo,
    JSON.stringify(record.schemaJson), record.schemaMode,
    record.lockedBy, record.setAt, record.updatedAt,
    record.semanticContext ? JSON.stringify(record.semanticContext) : null,
  );
  return record;
}

export function getSchema(db: Database.Database, keyPattern: string, applyTo?: 'exact' | 'prefix'): SchemaRecord | null {
  if (applyTo) {
    const row = db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, applyTo) as Record<string, unknown> | undefined;
    return row ? deserializeSchema(row) : null;
  }
  const exactRow = db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, 'exact') as Record<string, unknown> | undefined;
  if (exactRow) return deserializeSchema(exactRow);
  const prefixRow = db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, 'prefix') as Record<string, unknown> | undefined;
  return prefixRow ? deserializeSchema(prefixRow) : null;
}

export function deleteSchema(db: Database.Database, keyPattern: string): boolean {
  const result = db.prepare('DELETE FROM schemas WHERE keyPattern = ?').run(keyPattern);
  return result.changes > 0;
}

export function listSchemas(db: Database.Database, prefix?: string): SchemaRecord[] {
  let sql = 'SELECT * FROM schemas';
  const params: unknown[] = [];
  if (prefix) { sql += ' WHERE keyPattern LIKE ?'; params.push(prefix + '%'); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeSchema(r));
}

export function findApplicableSchema(db: Database.Database, memoryKey: string): SchemaRecord | null {
  const exactRow = db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(memoryKey, 'exact') as Record<string, unknown> | undefined;
  if (exactRow) return deserializeSchema(exactRow);

  const prefixSchemas = db.prepare('SELECT * FROM schemas WHERE applyTo = ?').all('prefix') as Record<string, unknown>[];
  let bestWildcard: SchemaRecord | null = null;
  let bestSegments = 0;
  for (const row of prefixSchemas) {
    const record = deserializeSchema(row);
    if (!record.keyPattern.includes('*')) continue;
    if (matchWildcardPattern(record.keyPattern, memoryKey)) {
      const segments = record.keyPattern.split('.').length;
      if (segments > bestSegments) {
        bestWildcard = record;
        bestSegments = segments;
      }
    }
  }
  if (bestWildcard) return bestWildcard;

  const parts = memoryKey.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('.');
    const prefixRow = db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(prefix, 'prefix') as Record<string, unknown> | undefined;
    if (prefixRow) return deserializeSchema(prefixRow);
  }

  return null;
}
