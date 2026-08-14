/**
 * @file src/storage/providers/sqlite/repos/mailbox.ts
 * @description SQLite repository functions for personal-node mailbox items: CRUD over
 *   the `mailbox_items` table while keeping each personal node's `mailboxUsedBytes`
 *   quota counter in sync. Also carries maintenance-state persistence helpers.
 *
 * @structure
 *   - createMailboxItem/getMailboxItem/listMailboxItems: insert + read mailbox rows
 *   - deleteMailboxItem/deleteMailboxItemsByNode: delete rows and decrement usage bytes
 *   - deserializeMailboxItem: row → MailboxItemRecord mapping
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { MailboxItemRecord, MaintenanceState } from '../../../interface.js';

function deserializeMailboxItem(row: Record<string, unknown>): MailboxItemRecord {
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
}

export function createMailboxItem(db: Database.Database, item: MailboxItemRecord): MailboxItemRecord {
  db.prepare(
    `INSERT INTO mailbox_items (id, personalNodeId, type, fromGaii, toGaii, payload, sizeBytes, retentionDays, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    item.id, item.personalNodeId, item.type, item.fromGaii, item.toGaii,
    item.payload, item.sizeBytes, item.retentionDays, item.expiresAt, item.createdAt,
  );
  db.prepare(
    'UPDATE personal_nodes SET mailboxUsedBytes = mailboxUsedBytes + ? WHERE nodeId = ?'
  ).run(item.sizeBytes, item.personalNodeId);
  return { ...item };
}

export function getMailboxItem(db: Database.Database, id: string): MailboxItemRecord | null {
  const row = db.prepare('SELECT * FROM mailbox_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeMailboxItem(row) : null;
}

export function listMailboxItems(db: Database.Database, personalNodeId: string, opts?: { type?: string; limit?: number }): MailboxItemRecord[] {
  let sql = 'SELECT * FROM mailbox_items WHERE personalNodeId = ?';
  const params: unknown[] = [personalNodeId];
  if (opts?.type) { sql += ' AND type = ?'; params.push(opts.type); }
  sql += ' ORDER BY createdAt ASC';
  if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeMailboxItem(r));
}

export function deleteMailboxItem(db: Database.Database, id: string): boolean {
  const item = getMailboxItem(db, id);
  if (!item) return false;
  db.prepare(
    'UPDATE personal_nodes SET mailboxUsedBytes = MAX(0, mailboxUsedBytes - ?) WHERE nodeId = ?'
  ).run(item.sizeBytes, item.personalNodeId);
  const result = db.prepare('DELETE FROM mailbox_items WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteMailboxItemsByNode(db: Database.Database, personalNodeId: string): number {
  const result = db.prepare('DELETE FROM mailbox_items WHERE personalNodeId = ?').run(personalNodeId);
  db.prepare(
    'UPDATE personal_nodes SET mailboxUsedBytes = 0 WHERE nodeId = ?'
  ).run(personalNodeId);
  return result.changes;
}

export function getMailboxStats(db: Database.Database, personalNodeId: string): { count: number; totalBytes: number } {
  const row = db.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(sizeBytes), 0) as totalBytes FROM mailbox_items WHERE personalNodeId = ?'
  ).get(personalNodeId) as Record<string, unknown>;
  return {
    count: row.count as number,
    totalBytes: row.totalBytes as number,
  };
}

export function cleanExpiredMailboxItems(db: Database.Database): number {
  const now = new Date().toISOString();
  const expiredItems = db.prepare(
    'SELECT personalNodeId, sizeBytes FROM mailbox_items WHERE expiresAt < ?'
  ).all(now) as Record<string, unknown>[];

  const bytesPerNode = new Map<string, number>();
  for (const item of expiredItems) {
    const nodeId = item.personalNodeId as string;
    bytesPerNode.set(nodeId, (bytesPerNode.get(nodeId) ?? 0) + (item.sizeBytes as number));
  }

  const result = db.prepare('DELETE FROM mailbox_items WHERE expiresAt < ?').run(now);

  for (const [nodeId, bytes] of bytesPerNode) {
    db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = MAX(0, mailboxUsedBytes - ?) WHERE nodeId = ?'
    ).run(bytes, nodeId);
  }

  return result.changes;
}

// ── Maintenance Mode ──

export function getMaintenanceMode(db: Database.Database): MaintenanceState {
  const row = db.prepare('SELECT * FROM maintenance WHERE id = 1').get() as Record<string, unknown> | undefined;
  if (!row) {
    return { enabled: false, message: '', enabledAt: null, enabledBy: null };
  }
  return {
    enabled: (row.enabled as number) === 1,
    message: row.message as string,
    enabledAt: (row.enabledAt as string) ?? null,
    enabledBy: (row.enabledBy as string) ?? null,
  };
}

export function setMaintenanceMode(db: Database.Database, state: MaintenanceState): MaintenanceState {
  db.prepare(
    `INSERT OR REPLACE INTO maintenance (id, enabled, message, enabledAt, enabledBy) VALUES (1, ?, ?, ?, ?)`
  ).run(
    state.enabled ? 1 : 0, state.message,
    state.enabledAt, state.enabledBy,
  );
  return state;
}
