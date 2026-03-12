import type Database from 'better-sqlite3';
import type { DisputeRecord, DisputeAuditEntry, AppealRecord } from '../../../interface.js';

function deserializeDispute(row: Record<string, unknown>): DisputeRecord {
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
}

function deserializeAppeal(row: Record<string, unknown>): AppealRecord {
  const record: AppealRecord = {
    id: row.id as string,
    flagId: row.flagId as string,
    appealedBy: row.appealedBy as string,
    reason: row.reason as string,
    status: row.status as AppealRecord['status'],
    createdAt: row.createdAt as string,
  };
  if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
  if (row.reviewNote) record.reviewNote = row.reviewNote as string;
  if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
  return record;
}

export function createDispute(db: Database.Database, dispute: DisputeRecord): DisputeRecord {
  db.prepare(
    `INSERT INTO disputes (id, trackingCode, status, openedBy, reason, ruling, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    dispute.id, dispute.trackingCode, dispute.status,
    dispute.openedBy, dispute.reason,
    dispute.ruling ? JSON.stringify(dispute.ruling) : null,
    dispute.createdAt, dispute.updatedAt,
  );
  return dispute;
}

export function getDispute(db: Database.Database, id: string): DisputeRecord | null {
  const row = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeDispute(row) : null;
}

export function getDisputeByTrackingCode(db: Database.Database, tc: string): DisputeRecord | null {
  const row = db.prepare('SELECT * FROM disputes WHERE trackingCode = ?').get(tc) as Record<string, unknown> | undefined;
  return row ? deserializeDispute(row) : null;
}

export function updateDispute(db: Database.Database, id: string, updates: Partial<DisputeRecord>): DisputeRecord | null {
  const existing = getDispute(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE disputes SET trackingCode = ?, status = ?, openedBy = ?, reason = ?, ruling = ?,
     createdAt = ?, updatedAt = ? WHERE id = ?`
  ).run(
    updated.trackingCode, updated.status, updated.openedBy, updated.reason,
    updated.ruling ? JSON.stringify(updated.ruling) : null,
    updated.createdAt, updated.updatedAt, id,
  );
  return updated;
}

export function addDisputeAuditEntry(db: Database.Database, disputeId: string, entry: DisputeAuditEntry): DisputeAuditEntry {
  db.prepare(
    `INSERT INTO dispute_audit (disputeId, sequence, event, actor, timestamp, data, hash, previousHash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    disputeId, entry.sequence, entry.event, entry.actor,
    entry.timestamp, JSON.stringify(entry.data),
    entry.hash, entry.previousHash,
  );
  return entry;
}

export function getDisputeAuditLog(db: Database.Database, disputeId: string): DisputeAuditEntry[] {
  const rows = db.prepare('SELECT * FROM dispute_audit WHERE disputeId = ? ORDER BY sequence ASC').all(disputeId) as Record<string, unknown>[];
  return rows.map(r => ({
    sequence: r.sequence as number,
    event: r.event as string,
    actor: r.actor as string,
    timestamp: r.timestamp as string,
    data: JSON.parse(r.data as string),
    hash: r.hash as string,
    previousHash: r.previousHash as string,
  }));
}

export function listDisputesByProvider(db: Database.Database, gaii: string): DisputeRecord[] {
  const rows = db.prepare(
    `SELECT d.* FROM disputes d
     INNER JOIN work w ON d.trackingCode = w.trackingCode
     WHERE w.providerGaii = ?`
  ).all(gaii) as Record<string, unknown>[];
  return rows.map(r => deserializeDispute(r));
}

export function listAllDisputes(db: Database.Database, limit = 10000): DisputeRecord[] {
  const rows = db.prepare('SELECT * FROM disputes ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
  return rows.map(r => deserializeDispute(r));
}

// ── Appeals ──

export function createAppeal(db: Database.Database, record: AppealRecord): AppealRecord {
  db.prepare(
    `INSERT INTO appeals (id, flagId, appealedBy, reason, status, reviewedBy, reviewNote, createdAt, reviewedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.flagId, record.appealedBy, record.reason,
    record.status, record.reviewedBy ?? null,
    record.reviewNote ?? null, record.createdAt, record.reviewedAt ?? null,
  );
  return record;
}

export function getAppeal(db: Database.Database, id: string): AppealRecord | null {
  const row = db.prepare('SELECT * FROM appeals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeAppeal(row) : null;
}

export function getAppealByFlagId(db: Database.Database, flagId: string): AppealRecord | null {
  const row = db.prepare('SELECT * FROM appeals WHERE flagId = ?').get(flagId) as Record<string, unknown> | undefined;
  return row ? deserializeAppeal(row) : null;
}

export function listAppeals(db: Database.Database, opts?: { status?: string; page?: number; perPage?: number }): AppealRecord[] {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;
  let sql = 'SELECT * FROM appeals WHERE 1=1';
  const params: unknown[] = [];
  if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
  sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  params.push(perPage, (page - 1) * perPage);
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeAppeal(r));
}

export function updateAppeal(db: Database.Database, id: string, updates: Partial<AppealRecord>): AppealRecord | null {
  const existing = getAppeal(db, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, id: existing.id };
  db.prepare(
    `UPDATE appeals SET flagId = ?, appealedBy = ?, reason = ?, status = ?,
     reviewedBy = ?, reviewNote = ?, createdAt = ?, reviewedAt = ? WHERE id = ?`
  ).run(
    updated.flagId, updated.appealedBy, updated.reason, updated.status,
    updated.reviewedBy ?? null, updated.reviewNote ?? null,
    updated.createdAt, updated.reviewedAt ?? null, id,
  );
  return updated;
}
