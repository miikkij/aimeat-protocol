/**
 * @file src/storage/providers/sqlite/repos/owner.ts
 * @description SQLite (better-sqlite3) repository for owner (GHII) records — CRUD over the `owners`
 *   table with JSON serialization of the roles array.
 *
 * @structure
 *   - deserializeOwner: maps a DB row to an OwnerRecord
 *   - createOwner/getOwner/listOwners/updateOwner: insert (UNIQUE→NAME_TAKEN), fetch, list, update
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { OwnerRecord } from '../../../interface.js';

export function deserializeOwner(row: Record<string, unknown>): OwnerRecord {
  return {
    name: row.name as string,
    displayName: (row.displayName as string) ?? undefined,
    publicKey: row.publicKey as string,
    roles: JSON.parse(row.roles as string) as string[],
    createdAt: row.createdAt as string,
  };
}

export function createOwner(db: Database.Database, owner: OwnerRecord): OwnerRecord {
  try {
    db.prepare(
      `INSERT INTO owners (name, displayName, publicKey, roles, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      owner.name,
      owner.displayName ?? null,
      owner.publicKey,
      JSON.stringify(owner.roles),
      owner.createdAt,
    );
    return owner;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
    throw err;
  }
}

export function getOwner(db: Database.Database, name: string): OwnerRecord | null {
  const row = db.prepare('SELECT * FROM owners WHERE name = ?').get(name) as Record<string, unknown> | undefined;
  return row ? deserializeOwner(row) : null;
}

export function listOwners(db: Database.Database): OwnerRecord[] {
  const rows = db.prepare('SELECT * FROM owners').all() as Record<string, unknown>[];
  return rows.map(r => deserializeOwner(r));
}

export function updateOwner(db: Database.Database, name: string, updates: Partial<OwnerRecord>): OwnerRecord | null {
  const existing = getOwner(db, name);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE owners SET displayName = ?, publicKey = ?, roles = ?, createdAt = ? WHERE name = ?`
  ).run(
    updated.displayName ?? null,
    updated.publicKey,
    JSON.stringify(updated.roles),
    updated.createdAt,
    name,
  );
  return updated;
}

export function deleteOwner(db: Database.Database, name: string): boolean {
  const txn = db.transaction(() => {
    // 1. Get all agents belonging to this owner
    const agentRows = db.prepare('SELECT gaii FROM agents WHERE owner = ?').all(name) as { gaii: string }[];
    const agentGaiis = agentRows.map(r => r.gaii);

    // 2. Cascade delete all agent-related data for each agent
    for (const gaii of agentGaiis) {
      cascadeDeleteAgentData(db, gaii);
    }

    // 3. Delete all agents for this owner
    db.prepare('DELETE FROM agents WHERE owner = ?').run(name);

    // 4. Delete GHII records for this owner
    db.prepare('DELETE FROM ghiis WHERE ownerName = ?').run(name);

    // 5. Delete personal nodes and their mailbox items & push subscriptions
    const nodeRows = db.prepare('SELECT nodeId FROM personal_nodes WHERE ownerName = ?').all(name) as { nodeId: string }[];
    for (const node of nodeRows) {
      db.prepare('DELETE FROM mailbox_items WHERE personalNodeId = ?').run(node.nodeId);
      db.prepare('DELETE FROM personal_push_subscriptions WHERE personalNodeId = ?').run(node.nodeId);
      db.prepare('DELETE FROM notification_preferences WHERE personalNodeId = ?').run(node.nodeId);
    }
    db.prepare('DELETE FROM personal_nodes WHERE ownerName = ?').run(name);

    // 6. Delete push subscriptions for this owner
    db.prepare('DELETE FROM push_subscriptions WHERE ownerName = ?').run(name);
    db.prepare('DELETE FROM personal_push_subscriptions WHERE ownerName = ?').run(name);

    // 7. Delete listings for this owner
    db.prepare('DELETE FROM listings WHERE ownerName = ?').run(name);

    // 8. Delete purchases for this owner (as buyer or seller)
    db.prepare('DELETE FROM purchases WHERE buyerOwner = ? OR sellerOwner = ?').run(name, name);

    // 9. Delete chat instances for this owner
    db.prepare('DELETE FROM chat_instances WHERE ownerName = ?').run(name);

    // 10. Delete email verifications for this owner
    db.prepare('DELETE FROM email_verifications WHERE ownerName = ?').run(name);

    // 11. Delete the owner record itself
    const result = db.prepare('DELETE FROM owners WHERE name = ?').run(name);
    return result.changes > 0;
  });
  return txn();
}

/**
 * Cascade-delete all data associated with a single agent GAII.
 * Called inside a transaction by both deleteOwner and deleteAgent.
 */
export function cascadeDeleteAgentData(db: Database.Database, gaii: string): void {
  // Memory
  db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(gaii);
  // Micro-memory
  db.prepare('DELETE FROM micro_memory WHERE gaii = ?').run(gaii);
  // Actions
  db.prepare('DELETE FROM actions WHERE providerGaii = ?').run(gaii);
  // Work (as provider or requester) — also clean up related disputes
  const workRows = db.prepare(
    'SELECT trackingCode FROM work WHERE providerGaii = ? OR requesterGaii = ?'
  ).all(gaii, gaii) as { trackingCode: string }[];
  for (const w of workRows) {
    db.prepare('DELETE FROM dispute_audit WHERE disputeId IN (SELECT id FROM disputes WHERE trackingCode = ?)').run(w.trackingCode);
    db.prepare('DELETE FROM disputes WHERE trackingCode = ?').run(w.trackingCode);
  }
  db.prepare('DELETE FROM work WHERE providerGaii = ? OR requesterGaii = ?').run(gaii, gaii);
  // Wallet transactions
  db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(gaii);
  // Board posts authored by this agent
  db.prepare('DELETE FROM board_posts WHERE authorGaii = ?').run(gaii);
  // Board subscriptions
  db.prepare('DELETE FROM board_subscriptions WHERE gaii = ?').run(gaii);
  // Boards owned by this agent — also delete their posts and subscriptions
  const boardRows = db.prepare('SELECT id FROM boards WHERE ownerGaii = ?').all(gaii) as { id: string }[];
  for (const b of boardRows) {
    db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(b.id);
    db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(b.id);
  }
  db.prepare('DELETE FROM boards WHERE ownerGaii = ?').run(gaii);
  // Consents and consent audit
  db.prepare('DELETE FROM consent_audit WHERE ownerGaii = ?').run(gaii);
  db.prepare('DELETE FROM consents WHERE ownerGaii = ?').run(gaii);
  // Storage files
  db.prepare('DELETE FROM storage_files WHERE ownerGaii = ?').run(gaii);
  // Matches (as profileA or profileB)
  db.prepare('DELETE FROM matches WHERE profileA = ? OR profileB = ?').run(gaii, gaii);
  // Flags raised by this agent
  db.prepare('DELETE FROM flags WHERE flaggedBy = ?').run(gaii);
  // Escrow holds
  db.prepare('DELETE FROM escrow_holds WHERE fromGaii = ?').run(gaii);
  // OTKs (one-time keys)
  db.prepare('DELETE FROM otks WHERE ownerGaii = ?').run(gaii);
  // OAuth refresh tokens and approvals for this agent
  db.prepare('DELETE FROM oauth_refresh_tokens WHERE gaii = ?').run(gaii);
  db.prepare('DELETE FROM oauth_approvals WHERE gaii = ?').run(gaii);
}
