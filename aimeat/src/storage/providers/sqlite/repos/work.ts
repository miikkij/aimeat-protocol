import type Database from 'better-sqlite3';
import type { WorkRecord, WalletTransaction } from '../../../interface.js';

function deserializeWork(row: Record<string, unknown>): WorkRecord {
  const record: WorkRecord = {
    trackingCode: row.trackingCode as string,
    status: row.status as string,
    actionId: row.actionId as string,
    providerGaii: row.providerGaii as string,
    requesterGaii: row.requesterGaii as string,
    input: JSON.parse(row.input as string),
    cost: JSON.parse(row.cost as string),
    ttlExpiresAt: row.ttlExpiresAt as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.output) record.output = JSON.parse(row.output as string);
  if (row.callbackUrl) record.callbackUrl = row.callbackUrl as string;
  if (row.rating) record.rating = JSON.parse(row.rating as string);
  return record;
}

function deserializeTransaction(row: Record<string, unknown>): WalletTransaction {
  const record: WalletTransaction = {
    id: row.id as string,
    gaii: row.gaii as string,
    type: row.type as string,
    amount: row.amount as number,
    timestamp: row.timestamp as string,
  };
  if (row.counterpartyGaii) record.counterpartyGaii = row.counterpartyGaii as string;
  if (row.trackingCode) record.trackingCode = row.trackingCode as string;
  return record;
}

// ── Work ──

export function createWork(db: Database.Database, work: WorkRecord): WorkRecord {
  db.prepare(
    `INSERT INTO work (trackingCode, status, actionId, providerGaii, requesterGaii, input, output, cost, ttlExpiresAt, callbackUrl, rating, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    work.trackingCode, work.status, work.actionId,
    work.providerGaii, work.requesterGaii,
    JSON.stringify(work.input), work.output ? JSON.stringify(work.output) : null,
    JSON.stringify(work.cost), work.ttlExpiresAt,
    work.callbackUrl ?? null,
    work.rating ? JSON.stringify(work.rating) : null,
    work.createdAt, work.updatedAt,
  );
  return work;
}

export function getWork(db: Database.Database, trackingCode: string): WorkRecord | null {
  const row = db.prepare('SELECT * FROM work WHERE trackingCode = ?').get(trackingCode) as Record<string, unknown> | undefined;
  return row ? deserializeWork(row) : null;
}

export function updateWork(db: Database.Database, trackingCode: string, updates: Partial<WorkRecord>): WorkRecord | null {
  const existing = getWork(db, trackingCode);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE work SET status = ?, actionId = ?, providerGaii = ?, requesterGaii = ?,
     input = ?, output = ?, cost = ?, ttlExpiresAt = ?, callbackUrl = ?, rating = ?,
     createdAt = ?, updatedAt = ? WHERE trackingCode = ?`
  ).run(
    updated.status, updated.actionId, updated.providerGaii, updated.requesterGaii,
    JSON.stringify(updated.input), updated.output ? JSON.stringify(updated.output) : null,
    JSON.stringify(updated.cost), updated.ttlExpiresAt,
    updated.callbackUrl ?? null,
    updated.rating ? JSON.stringify(updated.rating) : null,
    updated.createdAt, updated.updatedAt,
    trackingCode,
  );
  return updated;
}

export function listWorkByProvider(db: Database.Database, gaii: string): WorkRecord[] {
  const rows = db.prepare('SELECT * FROM work WHERE providerGaii = ?').all(gaii) as Record<string, unknown>[];
  return rows.map(r => deserializeWork(r));
}

export function listWorkByRequester(db: Database.Database, gaii: string): WorkRecord[] {
  const rows = db.prepare('SELECT * FROM work WHERE requesterGaii = ?').all(gaii) as Record<string, unknown>[];
  return rows.map(r => deserializeWork(r));
}

export function listAllWork(db: Database.Database, limit = 10000): WorkRecord[] {
  const rows = db.prepare('SELECT * FROM work ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
  return rows.map(r => deserializeWork(r));
}

// ── Wallet Transactions ──

export function addTransaction(db: Database.Database, tx: WalletTransaction): WalletTransaction {
  db.prepare(
    `INSERT INTO wallet_transactions (id, gaii, type, amount, counterpartyGaii, trackingCode, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tx.id, tx.gaii, tx.type, tx.amount,
    tx.counterpartyGaii ?? null, tx.trackingCode ?? null, tx.timestamp,
  );
  return tx;
}

export function getTransactions(db: Database.Database, gaii: string, limit = 50): WalletTransaction[] {
  const rows = db.prepare(
    'SELECT * FROM wallet_transactions WHERE gaii = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(gaii, limit) as Record<string, unknown>[];
  return rows.reverse().map(r => deserializeTransaction(r));
}

export function listAllTransactions(db: Database.Database, limit = 10000): WalletTransaction[] {
  const rows = db.prepare('SELECT * FROM wallet_transactions ORDER BY timestamp DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
  return rows.map(r => deserializeTransaction(r));
}

export function deleteTransactions(db: Database.Database, gaii: string): number {
  const result = db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(gaii);
  return result.changes;
}
