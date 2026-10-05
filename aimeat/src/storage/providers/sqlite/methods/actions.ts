/**
 * @file src/storage/providers/sqlite/methods/actions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/actions.ts (actionMethods), so a fix
 *   in one provider finds its twin by file name. Bodies moved verbatim from the files named in the version
 *   history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure actionMethods
 * @usage Object.assign(SqliteStorage.prototype, actionMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — createAction, getAction, listActions, deleteAction, listActionsByProvider,
 *     countActionsForProviders, updateAction, deserializeAction moved here from work.ts so the file mirrors
 *     postgres-kysely/methods/actions.ts (secaudit 2026-10, M8).
 */
import type { ActionRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { countActionsForProviders as countActionsForProvidersRepo } from '../repos/action.js';

export const actionMethods = {
  // ── Actions ──
  // ══════════════════════════════════════════════════════════

  async createAction(this: SqliteStorage, action: ActionRecord): Promise<ActionRecord> {
    try {
      this.db.prepare(
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
  },

  async getAction(this: SqliteStorage, id: string, providerGaii: string): Promise<ActionRecord | null> {
    const row = this.db.prepare('SELECT * FROM actions WHERE providerGaii = ? AND id = ?').get(providerGaii, id) as Record<string, unknown> | undefined;
    return row ? this.deserializeAction(row) : null;
  },

  async listActions(this: SqliteStorage, opts?: { search?: string; category?: string }): Promise<ActionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM actions').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeAction(r));
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
  },

  async deleteAction(this: SqliteStorage, id: string, providerGaii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM actions WHERE providerGaii = ? AND id = ?').run(providerGaii, id);
    return result.changes > 0;
  },

  async listActionsByProvider(this: SqliteStorage, gaii: string): Promise<ActionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM actions WHERE providerGaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAction(r));
  },

  async countActionsForProviders(this: SqliteStorage, providerGaiis: string[]): Promise<number> {
    return countActionsForProvidersRepo(this.db, providerGaiis);
  },

  async updateAction(this: SqliteStorage, id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null> {
    const existing = await this.getAction(id, providerGaii);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
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
  },

  deserializeAction(this: SqliteStorage, row: Record<string, unknown>): ActionRecord {
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
    record.federate = row.federate === 1;
    return record;
  },
};
