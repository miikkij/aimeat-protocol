/**
 * @file src/storage/providers/sqlite/repos/action.ts
 * @description SQLite (better-sqlite3) repository for action records — CRUD over the `actions`
 *   table with JSON (de)serialization of schemas, pricing, tags, and semantic metadata.
 *
 * @structure
 *   - deserializeAction: maps a DB row (parsing JSON columns) to an ActionRecord
 *   - createAction/getAction: insert (with UNIQUE→ACTION_EXISTS) and fetch by provider+id
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { ActionRecord } from '../../../interface.js';

function deserializeAction(row: Record<string, unknown>): ActionRecord {
  const record: ActionRecord = {
    id: row.id as string,
    providerGaii: row.providerGaii as string,
    displayName: row.displayName as string,
    description: row.description as string,
    inputSchema: JSON.parse(row.inputSchema as string),
    outputSchema: JSON.parse(row.outputSchema as string),
    pricing: JSON.parse(row.pricing as string),
    tags: JSON.parse(row.tags as string) as string[],
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.category) record.category = row.category as string;
  if (row.estimatedTimeSeconds !== null) record.estimatedTimeSeconds = row.estimatedTimeSeconds as number;
  if (row.maxInputSizeBytes !== null) record.maxInputSizeBytes = row.maxInputSizeBytes as number;
  if (row.webhookUrl) record.webhookUrl = row.webhookUrl as string;
  if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
  record.federate = (row as any).federate === 1;
  return record;
}

export function createAction(db: Database.Database, action: ActionRecord): ActionRecord {
  try {
    db.prepare(
      `INSERT INTO actions (providerGaii, id, displayName, description, category, inputSchema, outputSchema, pricing, estimatedTimeSeconds, maxInputSizeBytes, tags, webhookUrl, createdAt, updatedAt, semantic, federate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      action.providerGaii, action.id, action.displayName, action.description,
      action.category ?? null,
      JSON.stringify(action.inputSchema), JSON.stringify(action.outputSchema),
      JSON.stringify(action.pricing),
      action.estimatedTimeSeconds ?? null, action.maxInputSizeBytes ?? null,
      JSON.stringify(action.tags), action.webhookUrl ?? null,
      action.createdAt, action.updatedAt,
      action.semantic ? JSON.stringify(action.semantic) : null,
      action.federate ? 1 : 0,
    );
    return action;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('ACTION_EXISTS', { cause: err });
    throw err;
  }
}

export function getAction(db: Database.Database, id: string, providerGaii: string): ActionRecord | null {
  const row = db.prepare('SELECT * FROM actions WHERE providerGaii = ? AND id = ?').get(providerGaii, id) as Record<string, unknown> | undefined;
  return row ? deserializeAction(row) : null;
}

export function listActions(db: Database.Database, opts?: { search?: string; category?: string }): ActionRecord[] {
  const rows = db.prepare('SELECT * FROM actions').all() as Record<string, unknown>[];
  let results = rows.map(r => deserializeAction(r));
  if (opts?.category) {
    results = results.filter(a => a.category === opts.category);
  }
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    results = results.filter(a =>
      a.displayName.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.tags.some(t => t.toLowerCase().includes(q))
    );
  }
  return results;
}

export function deleteAction(db: Database.Database, id: string, providerGaii: string): boolean {
  const result = db.prepare('DELETE FROM actions WHERE providerGaii = ? AND id = ?').run(providerGaii, id);
  return result.changes > 0;
}

export function deleteActionsByProvider(db: Database.Database, gaii: string): number {
  const result = db.prepare('DELETE FROM actions WHERE providerGaii = ?').run(gaii);
  return result.changes;
}

export function listActionsByProvider(db: Database.Database, gaii: string): ActionRecord[] {
  const rows = db.prepare('SELECT * FROM actions WHERE providerGaii = ?').all(gaii) as Record<string, unknown>[];
  return rows.map(r => deserializeAction(r));
}

export function updateAction(db: Database.Database, id: string, providerGaii: string, updates: Partial<ActionRecord>): ActionRecord | null {
  const existing = getAction(db, id, providerGaii);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE actions SET displayName = ?, description = ?, category = ?, inputSchema = ?,
     outputSchema = ?, pricing = ?, estimatedTimeSeconds = ?, maxInputSizeBytes = ?,
     tags = ?, webhookUrl = ?, createdAt = ?, updatedAt = ?, semantic = ?, federate = ?
     WHERE providerGaii = ? AND id = ?`
  ).run(
    updated.displayName, updated.description, updated.category ?? null,
    JSON.stringify(updated.inputSchema), JSON.stringify(updated.outputSchema),
    JSON.stringify(updated.pricing),
    updated.estimatedTimeSeconds ?? null, updated.maxInputSizeBytes ?? null,
    JSON.stringify(updated.tags), updated.webhookUrl ?? null,
    updated.createdAt, updated.updatedAt,
    updated.semantic ? JSON.stringify(updated.semantic) : null,
    updated.federate ? 1 : 0,
    providerGaii, id,
  );
  return updated;
}
