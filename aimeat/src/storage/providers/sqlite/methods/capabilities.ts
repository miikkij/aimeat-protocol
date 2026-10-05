/**
 * @file src/storage/providers/sqlite/methods/capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/capabilities.ts (capabilityMethods),
 *   so a fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure capabilityMethods
 * @usage Object.assign(SqliteStorage.prototype, capabilityMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 16 methods (deserializeCapability, createCapability, getCapability, …) moved here
 *     from capability-agents.ts so the file mirrors postgres-kysely/methods/capabilities.ts (secaudit
 *     2026-10, M8).
 */
import type { CapabilityRecord, CapabilityLogEntry, CapabilityStats } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

/** Refresh the trust blob's derived vouch count from the rows — one truth, copied for cheap reads. */
async function syncVouchCount(storage: SqliteStorage, capabilityId: string): Promise<void> {
  const cap = await storage.getCapability(capabilityId);
  if (!cap) return;
  const row = storage.db.prepare('SELECT COUNT(*) AS n FROM capability_vouches WHERE capabilityId = ?')
    .get(capabilityId) as { n: number } | undefined;
  const trust = { ...cap.trust, vouchCount: row ? row.n : 0 };
  storage.db.prepare('UPDATE capabilities SET trust = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(trust), new Date().toISOString(), capabilityId);
}

export const capabilityMethods = {
  // ── Capability Layer ──────────────────────────────────────────────

  deserializeCapability(this: SqliteStorage, row: Record<string, unknown>): CapabilityRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      summary: (row.summary as string) || '',
      ownerGhii: row.ownerGhii as string,
      visibility: row.visibility as CapabilityRecord['visibility'],
      scope: 'local',
      status: row.status as CapabilityRecord['status'],
      rejectionReason: (row.rejectionReason as string) || null,
      deprecationMessage: (row.deprecationMessage as string) || null,
      replacedBy: (row.replacedBy as string) || null,
      source: { type: row.sourceType as string, ref: row.sourceRef as string, version: row.sourceVersion as string } as CapabilityRecord['source'],
      authRequired: row.authRequired as CapabilityRecord['authRequired'],
      callable: row.callable === 1 || row.callable === true,
      inputSchema: row.inputSchema ? JSON.parse(row.inputSchema as string) : null,
      outputSchema: row.outputSchema ? JSON.parse(row.outputSchema as string) : null,
      exports: row.exports ? JSON.parse(row.exports as string) : null,
      usage: (row.usage as string) || '',
      whenToUse: (row.whenToUse as string) || '',
      whenNotToUse: (row.whenNotToUse as string) || '',
      examples: JSON.parse((row.examples as string) || '[]'),
      dependencies: JSON.parse((row.dependencies as string) || '[]'),
      schemaHash: (row.schemaHash as string) || '',
      webhookUrl: (row.webhookUrl as string) || null,
      cost: row.cost ? JSON.parse(row.cost as string) : null,
      trustRequired: row.trustRequired as number | null,
      trust: JSON.parse((row.trust as string) || '{}'),
      redactedFields: JSON.parse((row.redactedFields as string) || '[]'),
      operatorOverride: row.operatorOverride ? JSON.parse(row.operatorOverride as string) : null,
      stats: JSON.parse((row.stats as string) || '{}'),
      tags: JSON.parse((row.tags as string) || '[]'),
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  async createCapability(this: SqliteStorage, record: CapabilityRecord): Promise<CapabilityRecord> {
    this.db.prepare(`INSERT INTO capabilities (id, name, summary, ownerGhii, visibility, scope, status,
      rejectionReason, deprecationMessage, replacedBy, sourceType, sourceRef, sourceVersion,
      authRequired, callable, inputSchema, outputSchema, exports, usage, whenToUse, whenNotToUse,
      examples, dependencies, schemaHash, webhookUrl, cost, trustRequired, trust, redactedFields,
      operatorOverride, stats, tags, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.summary, record.ownerGhii, record.visibility, record.scope, record.status,
      record.rejectionReason, record.deprecationMessage, record.replacedBy,
      record.source.type, record.source.ref, record.source.version,
      record.authRequired, record.callable ? 1 : 0,
      record.inputSchema ? JSON.stringify(record.inputSchema) : null,
      record.outputSchema ? JSON.stringify(record.outputSchema) : null,
      record.exports ? JSON.stringify(record.exports) : null,
      record.usage, record.whenToUse, record.whenNotToUse,
      JSON.stringify(record.examples), JSON.stringify(record.dependencies), record.schemaHash,
      record.webhookUrl,
      record.cost ? JSON.stringify(record.cost) : null,
      record.trustRequired,
      JSON.stringify(record.trust), JSON.stringify(record.redactedFields),
      record.operatorOverride ? JSON.stringify(record.operatorOverride) : null,
      JSON.stringify(record.stats), JSON.stringify(record.tags),
      record.createdAt, record.updatedAt,
    );
    return record;
  },

  async getCapability(this: SqliteStorage, id: string): Promise<CapabilityRecord | null> {
    const row = this.db.prepare('SELECT * FROM capabilities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeCapability(row) : null;
  },

  async updateCapability(this: SqliteStorage, id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null> {
    const existing = await this.getCapability(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, updatedAt: updates.updatedAt || new Date().toISOString() };
    if (updates.source) {
      merged.source = { ...existing.source, ...updates.source };
    }
    this.db.prepare(`UPDATE capabilities SET name=?, summary=?, ownerGhii=?, visibility=?, status=?,
      rejectionReason=?, deprecationMessage=?, replacedBy=?, sourceType=?, sourceRef=?, sourceVersion=?,
      authRequired=?, callable=?, inputSchema=?, outputSchema=?, exports=?, usage=?, whenToUse=?, whenNotToUse=?,
      examples=?, dependencies=?, schemaHash=?, webhookUrl=?, cost=?, trustRequired=?, trust=?, redactedFields=?,
      operatorOverride=?, stats=?, tags=?, updatedAt=? WHERE id=?`
    ).run(
      merged.name, merged.summary, merged.ownerGhii, merged.visibility, merged.status,
      merged.rejectionReason, merged.deprecationMessage, merged.replacedBy,
      merged.source.type, merged.source.ref, merged.source.version,
      merged.authRequired, merged.callable ? 1 : 0,
      merged.inputSchema ? JSON.stringify(merged.inputSchema) : null,
      merged.outputSchema ? JSON.stringify(merged.outputSchema) : null,
      merged.exports ? JSON.stringify(merged.exports) : null,
      merged.usage, merged.whenToUse, merged.whenNotToUse,
      JSON.stringify(merged.examples), JSON.stringify(merged.dependencies), merged.schemaHash,
      merged.webhookUrl,
      merged.cost ? JSON.stringify(merged.cost) : null,
      merged.trustRequired,
      JSON.stringify(merged.trust), JSON.stringify(merged.redactedFields),
      merged.operatorOverride ? JSON.stringify(merged.operatorOverride) : null,
      JSON.stringify(merged.stats), JSON.stringify(merged.tags),
      merged.updatedAt, id,
    );
    return merged;
  },

  async deleteCapability(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM capabilities WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async listCapabilities(this: SqliteStorage, filters: import('../../../interface.js').CapabilityFilter): Promise<{ capabilities: CapabilityRecord[]; total: number }> {
    let query = 'SELECT * FROM capabilities WHERE 1=1';
    const params: unknown[] = [];

    if (filters.ownerGhii) { query += ' AND ownerGhii = ?'; params.push(filters.ownerGhii); }
    if (filters.visibility) { query += ' AND visibility = ?'; params.push(filters.visibility); }
    if (filters.publicOrOwner) { query += ' AND (visibility = ? OR ownerGhii = ?)'; params.push('public', filters.publicOrOwner); }
    if (filters.status) { query += ' AND status = ?'; params.push(filters.status); }
    if (filters.sourceType) { query += ' AND sourceType = ?'; params.push(filters.sourceType); }
    if (filters.authRequired) { query += ' AND authRequired = ?'; params.push(filters.authRequired); }
    if (filters.callable !== undefined) { query += ' AND callable = ?'; params.push(filters.callable ? 1 : 0); }

    query += ' ORDER BY updatedAt DESC';
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];

    let results = rows.map(r => this.deserializeCapability(r));

    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(c => filters.tags!.some(t => c.tags.includes(t)));
    }

    const total = results.length;
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    const start = (page - 1) * perPage;
    results = results.slice(start, start + perPage);

    return { capabilities: results, total };
  },

  async listCapabilitiesByOwner(this: SqliteStorage, ownerGhii: string): Promise<CapabilityRecord[]> {
    const rows = this.db.prepare('SELECT * FROM capabilities WHERE ownerGhii = ? ORDER BY updatedAt DESC').all(ownerGhii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCapability(r));
  },

  async getCapabilityBySourceRef(this: SqliteStorage, sourceRef: string): Promise<CapabilityRecord | null> {
    const row = this.db.prepare('SELECT * FROM capabilities WHERE sourceRef = ?').get(sourceRef) as Record<string, unknown> | undefined;
    return row ? this.deserializeCapability(row) : null;
  },

  async listCapabilitiesBySourceType(this: SqliteStorage, sourceType: string): Promise<CapabilityRecord[]> {
    const rows = this.db.prepare('SELECT * FROM capabilities WHERE sourceType = ?').all(sourceType) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCapability(r));
  },

  async incrementCapabilityStats(this: SqliteStorage, id: string, delta: { success: number; error: number; totalMs: number; lastError?: string }): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const s = cap.stats;
    const newTotal = s.totalInvocations + delta.success + delta.error;
    const newSuccess = s.successCount + delta.success;
    const newError = s.errorCount + delta.error;
    const totalMs = (s.avgResponseMs * s.totalInvocations) + delta.totalMs;
    const newAvg = newTotal > 0 ? Math.round(totalMs / newTotal) : 0;
    const updated: CapabilityStats = {
      totalInvocations: newTotal,
      successCount: newSuccess,
      errorCount: newError,
      lastInvokedAt: new Date().toISOString(),
      avgResponseMs: newAvg,
      lastError: delta.lastError ?? s.lastError,
    };
    this.db.prepare('UPDATE capabilities SET stats = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(updated), new Date().toISOString(), id);
  },

  async addCapabilityLog(this: SqliteStorage, entry: CapabilityLogEntry): Promise<void> {
    this.db.prepare(`INSERT INTO capability_logs (id, capabilityId, callerGhii, input, status, durationMs, error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(entry.id, entry.capabilityId, entry.callerGhii, JSON.stringify(entry.input), entry.status, entry.durationMs, entry.error, entry.timestamp);
  },

  async listCapabilityLogs(this: SqliteStorage, capabilityId: string, filters: { status?: 'success' | 'error'; page?: number; perPage?: number }): Promise<{ logs: CapabilityLogEntry[]; total: number }> {
    let countQ = 'SELECT COUNT(*) as c FROM capability_logs WHERE capabilityId = ?';
    let dataQ = 'SELECT * FROM capability_logs WHERE capabilityId = ?';
    const params: unknown[] = [capabilityId];

    if (filters.status) {
      countQ += ' AND status = ?';
      dataQ += ' AND status = ?';
      params.push(filters.status);
    }

    const total = (this.db.prepare(countQ).get(...params) as { c: number }).c;
    dataQ += ' ORDER BY timestamp DESC';
    const page = filters.page || 1;
    const perPage = filters.perPage || 50;
    dataQ += ` LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;

    const rows = this.db.prepare(dataQ).all(...params) as Record<string, unknown>[];
    const logs: CapabilityLogEntry[] = rows.map(r => ({
      id: r.id as string,
      capabilityId: r.capabilityId as string,
      callerGhii: r.callerGhii as string,
      input: JSON.parse((r.input as string) || '{}'),
      status: r.status as 'success' | 'error',
      durationMs: r.durationMs as number,
      error: (r.error as string) || null,
      timestamp: r.timestamp as string,
    }));
    return { logs, total };
  },

  async setCapabilityOverride(this: SqliteStorage, id: string, override: import('../../../interface.js').CapabilityOverride | null): Promise<void> {
    this.db.prepare('UPDATE capabilities SET operatorOverride = ?, updatedAt = ? WHERE id = ?')
      .run(override ? JSON.stringify(override) : null, new Date().toISOString(), id);
  },

  // ── Vouches are ROWS. The table's primary key (capabilityId, userGhii) is the dedup: one
  //    person, one vouch, and the count is derived — never a number anyone increments. The
  //    trust-blob copy of the count is refreshed after every change so listings that read the
  //    blob stay truthful without a join.

  async addCapabilityVouch(this: SqliteStorage, capabilityId: string, userGhii: string, comment?: string): Promise<boolean> {
    const cap = await this.getCapability(capabilityId);
    if (!cap) return false;
    const res = this.db.prepare(
      'INSERT INTO capability_vouches (capabilityId, userGhii, comment, createdAt) VALUES (?, ?, ?, ?) '
      + 'ON CONFLICT(capabilityId, userGhii) DO NOTHING',
    ).run(capabilityId, userGhii, comment ?? null, new Date().toISOString());
    await syncVouchCount(this, capabilityId);
    return res.changes > 0;
  },

  async removeCapabilityVouch(this: SqliteStorage, capabilityId: string, userGhii: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM capability_vouches WHERE capabilityId = ? AND userGhii = ?')
      .run(capabilityId, userGhii);
    await syncVouchCount(this, capabilityId);
    return res.changes > 0;
  },

  async countCapabilityVouches(this: SqliteStorage, capabilityId: string): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM capability_vouches WHERE capabilityId = ?')
      .get(capabilityId) as { n: number } | undefined;
    return row ? row.n : 0;
  },
};
