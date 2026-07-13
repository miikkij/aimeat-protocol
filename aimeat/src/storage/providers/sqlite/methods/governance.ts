/**
 * @file src/storage/providers/sqlite/methods/governance.ts
 * @description Consent, Schema, CSM, MSM, Flag, Match, Organism methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  ArchiveFilter, SchemaRecord, ConsentRecord, ConsentAuditEntry, CsmRecord, MsmRecord,
  FlagRecord, FlagSummary, MatchRecord, OrganismRecord
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { matchWildcardPattern, consentMatchPattern } from '../../../pattern-utils.js';
import { matchesRecipient } from '../../../../services/consent.js';
import { parseGaiiLoose } from '../../../../utils/gaii.js';

export const governanceMethods = {
  // ── Consent Layer ──
  // ══════════════════════════════════════════════════════════

  async createConsent(this: SqliteStorage, record: ConsentRecord): Promise<ConsentRecord> {
    this.db.prepare(
      `INSERT INTO consents (id, ownerGaii, dataPattern, recipient, purpose, scope, expires, status, grantedAt, revokedAt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.ownerGaii, record.dataPattern, record.recipient,
      record.purpose, record.scope, record.expires,
      record.status, record.grantedAt, record.revokedAt,
      record.metadata ? JSON.stringify(record.metadata) : null,
    );
    return record;
  },

  async getConsent(this: SqliteStorage, id: string): Promise<ConsentRecord | null> {
    const row = this.db.prepare('SELECT * FROM consents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeConsent(row) : null;
  },

  async listConsents(this: SqliteStorage, ownerGaii: string, opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<ConsentRecord[]> {
    let sql = 'SELECT * FROM consents WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.recipient) { sql += ' AND recipient = ?'; params.push(opts.recipient); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeConsent(r));
  },

  async updateConsent(this: SqliteStorage, id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null> {
    const existing = await this.getConsent(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
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
  },

  async deleteConsent(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM consents WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async findMatchingConsents(this: SqliteStorage, ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]> {
    const now = new Date().toISOString();
    const rows = this.db.prepare(
      `SELECT * FROM consents WHERE ownerGaii = ? AND status = 'active'`
    ).all(ownerGaii) as Record<string, unknown>[];

    const results: ConsentRecord[] = [];
    for (const row of rows) {
      const consent = this.deserializeConsent(row);
      // Check expiration
      if (consent.expires && consent.expires < now) {
        this.db.prepare('UPDATE consents SET status = ? WHERE id = ?').run('expired', consent.id);
        continue;
      }
      // Check recipient (supports *, exact GAII, ghii:, domain:, node:)
      const accessor = parseGaiiLoose(accessorGaii);
      if (!matchesRecipient(consent.recipient, accessorGaii, accessor.owner, accessor.node)) continue;
      // Check data_pattern (glob match)
      if (!consentMatchPattern(consent.dataPattern, memoryKey)) continue;
      results.push(consent);
    }
    return results;
  },

  async expireStaleConsents(this: SqliteStorage, before: string): Promise<number> {
    const result = this.db.prepare(
      `UPDATE consents SET status = 'expired' WHERE status = 'active' AND expires IS NOT NULL AND expires < ?`
    ).run(before);
    return result.changes;
  },

  // Consent Audit
  async addConsentAuditEntry(this: SqliteStorage, entry: ConsentAuditEntry): Promise<ConsentAuditEntry> {
    this.db.prepare(
      `INSERT INTO consent_audit (id, consentId, ownerGaii, accessorGaii, memoryKey, action, timestamp, allowed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id, entry.consentId, entry.ownerGaii, entry.accessorGaii,
      entry.memoryKey, entry.action, entry.timestamp,
      entry.allowed ? 1 : 0,
    );
    return entry;
  },

  async pruneConsentAudit(this: SqliteStorage, beforeIso: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM consent_audit WHERE timestamp < ?').run(beforeIso);
    return result.changes;
  },

  async listConsentAudit(this: SqliteStorage, ownerGaii: string, opts?: {
    days?: number;
    consentId?: string;
    accessorGaii?: string;
  }): Promise<ConsentAuditEntry[]> {
    let sql = 'SELECT * FROM consent_audit WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];

    if (opts?.days) {
      const cutoff = new Date(Date.now() - opts.days * 86400000).toISOString();
      sql += ' AND timestamp >= ?';
      params.push(cutoff);
    }
    if (opts?.consentId) { sql += ' AND consentId = ?'; params.push(opts.consentId); }
    if (opts?.accessorGaii) { sql += ' AND accessorGaii = ?'; params.push(opts.accessorGaii); }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
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
  },

  deserializeConsent(this: SqliteStorage, row: Record<string, unknown>): ConsentRecord {
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
  },

  // ══════════════════════════════════════════════════════════
  // ── Schema Locking ──
  // ══════════════════════════════════════════════════════════

  async setSchema(this: SqliteStorage, record: SchemaRecord): Promise<SchemaRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO schemas (keyPattern, applyTo, schemaJson, schemaMode, lockedBy, setAt, updatedAt, semanticContext)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.keyPattern, record.applyTo,
      JSON.stringify(record.schemaJson), record.schemaMode,
      record.lockedBy, record.setAt, record.updatedAt,
      record.semanticContext ? JSON.stringify(record.semanticContext) : null,
    );
    return record;
  },

  async getSchema(this: SqliteStorage, keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
    if (applyTo) {
      const row = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, applyTo) as Record<string, unknown> | undefined;
      return row ? this.deserializeSchema(row) : null;
    }
    // Try exact first, then prefix
    const exactRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, 'exact') as Record<string, unknown> | undefined;
    if (exactRow) return this.deserializeSchema(exactRow);
    const prefixRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, 'prefix') as Record<string, unknown> | undefined;
    return prefixRow ? this.deserializeSchema(prefixRow) : null;
  },

  async deleteSchema(this: SqliteStorage, keyPattern: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM schemas WHERE keyPattern = ?').run(keyPattern);
    return result.changes > 0;
  },

  async listSchemas(this: SqliteStorage, prefix?: string): Promise<SchemaRecord[]> {
    let sql = 'SELECT * FROM schemas';
    const params: unknown[] = [];
    if (prefix) { sql += ' WHERE keyPattern LIKE ?'; params.push(prefix + '%'); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSchema(r));
  },

  async findApplicableSchema(this: SqliteStorage, memoryKey: string): Promise<SchemaRecord | null> {
    // 1. Exact match -- highest priority
    const exactRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(memoryKey, 'exact') as Record<string, unknown> | undefined;
    if (exactRow) return this.deserializeSchema(exactRow);

    // 2. Wildcard pattern match -- supports profile.*.interests style
    const prefixSchemas = this.db.prepare('SELECT * FROM schemas WHERE applyTo = ?').all('prefix') as Record<string, unknown>[];
    let bestWildcard: SchemaRecord | null = null;
    let bestSegments = 0;
    for (const row of prefixSchemas) {
      const record = this.deserializeSchema(row);
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

    // 3. Simple prefix match -- longest prefix wins
    const parts = memoryKey.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join('.');
      const prefixRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(prefix, 'prefix') as Record<string, unknown> | undefined;
      if (prefixRow) return this.deserializeSchema(prefixRow);
    }

    return null;
  },

  deserializeSchema(this: SqliteStorage, row: Record<string, unknown>): SchemaRecord {
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
  },

  // ══════════════════════════════════════════════════════════
  // ── CSM (Community Service Manifest) ──
  // ══════════════════════════════════════════════════════════

  async createCsm(this: SqliteStorage, record: CsmRecord): Promise<CsmRecord> {
    try {
      this.db.prepare(
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
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('CSM_NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getCsm(this: SqliteStorage, name: string): Promise<CsmRecord | null> {
    const row = this.db.prepare('SELECT * FROM csms WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeCsm(row) : null;
  },

  async listCsms(this: SqliteStorage, opts?: { serviceType?: string }): Promise<CsmRecord[]> {
    let sql = 'SELECT * FROM csms';
    const params: unknown[] = [];
    if (opts?.serviceType) { sql += ' WHERE serviceType = ?'; params.push(opts.serviceType); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCsm(r));
  },

  async updateCsm(this: SqliteStorage, name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null> {
    const existing = await this.getCsm(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates, name: existing.name };
    this.db.prepare(
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
  },

  async deleteCsm(this: SqliteStorage, name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM csms WHERE name = ?').run(name);
    return result.changes > 0;
  },

  deserializeCsm(this: SqliteStorage, row: Record<string, unknown>): CsmRecord {
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
  },

  // ══════════════════════════════════════════════════════════
  // ── MSM (Machine Service Manifest) ──
  // ══════════════════════════════════════════════════════════

  async createMsm(this: SqliteStorage, record: MsmRecord): Promise<MsmRecord> {
    try {
      this.db.prepare(
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
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('MSM_NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getMsm(this: SqliteStorage, name: string): Promise<MsmRecord | null> {
    const row = this.db.prepare('SELECT * FROM msms WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeMsm(row) : null;
  },

  async listMsms(this: SqliteStorage, opts?: { category?: string }): Promise<MsmRecord[]> {
    let sql = 'SELECT * FROM msms';
    const params: unknown[] = [];
    if (opts?.category) { sql += ' WHERE category = ?'; params.push(opts.category); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMsm(r));
  },

  async updateMsm(this: SqliteStorage, name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
    const existing = await this.getMsm(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates, name: existing.name, updatedAt: new Date().toISOString() };
    this.db.prepare(
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
  },

  async deleteMsm(this: SqliteStorage, name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM msms WHERE name = ?').run(name);
    return result.changes > 0;
  },

  deserializeMsm(this: SqliteStorage, row: Record<string, unknown>): MsmRecord {
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
  },

  // ══════════════════════════════════════════════════════════
  // ── Flags (Moderation) ──
  // ══════════════════════════════════════════════════════════

  async createFlag(this: SqliteStorage, record: FlagRecord): Promise<FlagRecord> {
    this.db.prepare(
      `INSERT INTO flags (id, targetType, targetId, flaggedBy, reason, description, status, reviewedBy, reviewedAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.targetType, record.targetId, record.flaggedBy,
      record.reason, record.description ?? null, record.status,
      record.reviewedBy ?? null, record.reviewedAt ?? null, record.createdAt,
    );
    return record;
  },

  async getFlag(this: SqliteStorage, id: string): Promise<FlagRecord | null> {
    const row = this.db.prepare('SELECT * FROM flags WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeFlag(row) : null;
  },

  async getFlagsByTarget(this: SqliteStorage, targetType: string, targetId: string): Promise<FlagRecord[]> {
    const rows = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ?').all(targetType, targetId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeFlag(r));
  },

  async getFlagByUser(this: SqliteStorage, targetType: string, targetId: string, flaggedBy: string): Promise<FlagRecord | null> {
    const row = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ? AND flaggedBy = ?').get(targetType, targetId, flaggedBy) as Record<string, unknown> | undefined;
    return row ? this.deserializeFlag(row) : null;
  },

  async getFlagSummary(this: SqliteStorage, targetType: string, targetId: string): Promise<FlagSummary | null> {
    const rows = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ?').all(targetType, targetId) as Record<string, unknown>[];
    if (rows.length === 0) return null;

    const byReason: Record<string, number> = {};
    let latestFlag = '';
    for (const r of rows) {
      const reason = r.reason as string;
      byReason[reason] = (byReason[reason] ?? 0) + 1;
      if ((r.createdAt as string) > latestFlag) latestFlag = r.createdAt as string;
    }

    return {
      targetType,
      targetId,
      totalFlags: rows.length,
      byReason,
      latestFlag,
    };
  },

  async updateFlag(this: SqliteStorage, id: string, updates: Partial<FlagRecord>): Promise<FlagRecord | null> {
    const existing = await this.getFlag(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE flags SET targetType = ?, targetId = ?, flaggedBy = ?, reason = ?,
       description = ?, status = ?, reviewedBy = ?, reviewedAt = ?, createdAt = ? WHERE id = ?`
    ).run(
      updated.targetType, updated.targetId, updated.flaggedBy, updated.reason,
      updated.description ?? null, updated.status,
      updated.reviewedBy ?? null, updated.reviewedAt ?? null, updated.createdAt, id,
    );
    return updated;
  },

  async listFlags(this: SqliteStorage, opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<FlagRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let sql = 'SELECT * FROM flags WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.targetType) { sql += ' AND targetType = ?'; params.push(opts.targetType); }

    sql += ' ORDER BY createdAt DESC';
    sql += ' LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeFlag(r));
  },

  deserializeFlag(this: SqliteStorage, row: Record<string, unknown>): FlagRecord {
    const record: FlagRecord = {
      id: row.id as string,
      targetType: row.targetType as FlagRecord['targetType'],
      targetId: row.targetId as string,
      flaggedBy: row.flaggedBy as string,
      reason: row.reason as FlagRecord['reason'],
      status: row.status as FlagRecord['status'],
      createdAt: row.createdAt as string,
    };
    if (row.description) record.description = row.description as string;
    if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
    if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Matches ──
  // ══════════════════════════════════════════════════════════

  async createMatch(this: SqliteStorage, record: MatchRecord): Promise<MatchRecord> {
    this.db.prepare(
      `INSERT INTO matches (id, profileA, profileB, score, breakdown, status, notifiedAt, respondedAt, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.profileA, record.profileB, record.score,
      JSON.stringify(record.breakdown), record.status,
      record.notifiedAt, record.respondedAt,
      record.expiresAt, record.createdAt,
    );
    return record;
  },

  async getMatch(this: SqliteStorage, id: string): Promise<MatchRecord | null> {
    const row = this.db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeMatch(row) : null;
  },

  async getMatchByPair(this: SqliteStorage, profileA: string, profileB: string): Promise<MatchRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM matches WHERE (profileA = ? AND profileB = ?) OR (profileA = ? AND profileB = ?)'
    ).get(profileA, profileB, profileB, profileA) as Record<string, unknown> | undefined;
    return row ? this.deserializeMatch(row) : null;
  },

  async listMatchesByProfile(this: SqliteStorage, profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<MatchRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 10;
    let sql = 'SELECT * FROM matches WHERE (profileA = ? OR profileB = ?)';
    const params: unknown[] = [profile, profile];

    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }

    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMatch(r));
  },

  async updateMatch(this: SqliteStorage, id: string, updates: Partial<MatchRecord>): Promise<MatchRecord | null> {
    const existing = await this.getMatch(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE matches SET profileA = ?, profileB = ?, score = ?, breakdown = ?,
       status = ?, notifiedAt = ?, respondedAt = ?, expiresAt = ?, createdAt = ? WHERE id = ?`
    ).run(
      updated.profileA, updated.profileB, updated.score,
      JSON.stringify(updated.breakdown), updated.status,
      updated.notifiedAt, updated.respondedAt,
      updated.expiresAt, updated.createdAt, id,
    );
    return updated;
  },

  async deleteExpiredMatches(this: SqliteStorage): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `DELETE FROM matches WHERE expiresAt < ? AND status != 'accepted'`
    ).run(now);
    return result.changes;
  },

  async deleteMatchesByProfile(this: SqliteStorage, profile: string): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM matches WHERE profileA = ? OR profileB = ?`
    ).run(profile, profile);
    return result.changes;
  },

  async listAllMatches(this: SqliteStorage, limit = 10000): Promise<MatchRecord[]> {
    const rows = this.db.prepare('SELECT * FROM matches ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMatch(r));
  },

  deserializeMatch(this: SqliteStorage, row: Record<string, unknown>): MatchRecord {
    return {
      id: row.id as string,
      profileA: row.profileA as string,
      profileB: row.profileB as string,
      score: row.score as number,
      breakdown: JSON.parse(row.breakdown as string),
      status: row.status as MatchRecord['status'],
      notifiedAt: (row.notifiedAt as string) ?? null,
      respondedAt: (row.respondedAt as string) ?? null,
      expiresAt: row.expiresAt as string,
      createdAt: row.createdAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Organisms ──
  // ══════════════════════════════════════════════════════════

  async createOrganism(this: SqliteStorage, record: OrganismRecord): Promise<OrganismRecord> {
    this.db.prepare(
      `INSERT INTO organisms (id, name, description, type, location, interests, creatorGhii, admins,
       members, agentGaiis, boardId, joinPolicy, maxMembers, visibility, memberVisibility, moderationConfig,
       memoryNamespace, semantic, createdAt, updatedAt, archived, archivedAt, archivedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.description, record.type,
      record.location ? JSON.stringify(record.location) : null,
      JSON.stringify(record.interests), record.creatorGhii,
      JSON.stringify(record.admins), JSON.stringify(record.members),
      JSON.stringify(record.agentGaiis), record.boardId,
      record.joinPolicy, record.maxMembers, record.visibility,
      record.memberVisibility ?? null,
      JSON.stringify(record.moderationConfig), record.memoryNamespace,
      record.semantic ? JSON.stringify(record.semantic) : null,
      record.createdAt, record.updatedAt,
      record.archived ? 1 : 0, record.archivedAt ?? null, record.archivedBy ?? null,
    );
    return record;
  },

  async getOrganism(this: SqliteStorage, id: string): Promise<OrganismRecord | null> {
    const row = this.db.prepare('SELECT * FROM organisms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeOrganism(row) : null;
  },

  async listOrganisms(this: SqliteStorage, opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number; archived?: ArchiveFilter }): Promise<OrganismRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;

    const rows = this.db.prepare('SELECT * FROM organisms ORDER BY createdAt DESC').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeOrganism(r));

    // Archive filter (default 'include' — preserve legacy behaviour; callers that browse/discover pass
    // 'exclude' so archived organisms drop out; 'only' powers an "Archived" view).
    if (opts?.archived === 'exclude') results = results.filter(o => !o.archived);
    else if (opts?.archived === 'only') results = results.filter(o => !!o.archived);
    if (opts?.type) results = results.filter(o => o.type === opts.type);
    if (opts?.city) results = results.filter(o => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    if (opts?.interest) results = results.filter(o => o.interests.some(i => i.toLowerCase() === opts.interest!.toLowerCase()));
    if (opts?.member) results = results.filter(o => o.members.includes(opts.member!));
    if (opts?.visibility) results = results.filter(o => o.visibility === opts.visibility);

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  },

  async updateOrganism(this: SqliteStorage, id: string, updates: Partial<OrganismRecord>): Promise<OrganismRecord | null> {
    const existing = await this.getOrganism(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE organisms SET name = ?, description = ?, type = ?, location = ?, interests = ?,
       creatorGhii = ?, admins = ?, members = ?, agentGaiis = ?, boardId = ?,
       joinPolicy = ?, maxMembers = ?, visibility = ?, memberVisibility = ?, moderationConfig = ?,
       memoryNamespace = ?, semantic = ?, createdAt = ?, updatedAt = ?,
       archived = ?, archivedAt = ?, archivedBy = ? WHERE id = ?`
    ).run(
      updated.name, updated.description, updated.type,
      updated.location ? JSON.stringify(updated.location) : null,
      JSON.stringify(updated.interests), updated.creatorGhii,
      JSON.stringify(updated.admins), JSON.stringify(updated.members),
      JSON.stringify(updated.agentGaiis), updated.boardId,
      updated.joinPolicy, updated.maxMembers, updated.visibility,
      updated.memberVisibility ?? null,
      JSON.stringify(updated.moderationConfig), updated.memoryNamespace,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.createdAt, updated.updatedAt,
      updated.archived ? 1 : 0, updated.archivedAt ?? null, updated.archivedBy ?? null, id,
    );
    return updated;
  },

  async deleteOrganism(this: SqliteStorage, id: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // Get the organism to find its boardId and memoryNamespace
      const org = this.db.prepare('SELECT boardId, memoryNamespace FROM organisms WHERE id = ?').get(id) as { boardId: string; memoryNamespace: string } | undefined;

      // Cascade: delete memberships and join requests
      this.db.prepare('DELETE FROM organism_memberships WHERE organismId = ?').run(id);
      this.db.prepare('DELETE FROM join_requests WHERE organismId = ?').run(id);

      // Cascade: delete organism reputation
      this.db.prepare('DELETE FROM organism_reputations WHERE organismId = ?').run(id);

      if (org) {
        // Cascade: delete the organism's board and its posts/subscriptions
        this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(org.boardId);
        this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(org.boardId);
        this.db.prepare('DELETE FROM boards WHERE id = ?').run(org.boardId);

        // Cascade: delete ALL content under the organism's key namespace, across every owner. The
        // workspace records/documents/meta are keyed `organism.{id}.…` but OWNED by the member who
        // wrote them (creator GHII, a contributor's GAII), NOT by `memoryNamespace` — so a
        // delete-by-ownerGaii left them orphaned (and still searchable via the FTS index). Delete by
        // key prefix instead; the memory_fts AFTER DELETE trigger clears the search index in step.
        const orgKey = `organism.${id}`;
        const orgPrefix = `organism.${id}.%`;
        this.db.prepare('DELETE FROM memory WHERE key = ? OR key LIKE ?').run(orgKey, orgPrefix);
        this.db.prepare('DELETE FROM memory_history WHERE key = ? OR key LIKE ?').run(orgKey, orgPrefix);
        this.db.prepare('DELETE FROM schemas WHERE keyPattern = ? OR keyPattern LIKE ?').run(orgKey, orgPrefix);
      }

      const result = this.db.prepare('DELETE FROM organisms WHERE id = ?').run(id);
      return result.changes > 0;
    });
    return txn();
  },

  deserializeOrganism(this: SqliteStorage, row: Record<string, unknown>): OrganismRecord {
    const record: OrganismRecord = {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      type: row.type as OrganismRecord['type'],
      interests: JSON.parse(row.interests as string) as string[],
      creatorGhii: row.creatorGhii as string,
      admins: JSON.parse(row.admins as string) as string[],
      members: JSON.parse(row.members as string) as string[],
      agentGaiis: JSON.parse(row.agentGaiis as string) as string[],
      boardId: row.boardId as string,
      joinPolicy: row.joinPolicy as OrganismRecord['joinPolicy'],
      maxMembers: row.maxMembers as number,
      visibility: row.visibility as OrganismRecord['visibility'],
      memberVisibility: (row.memberVisibility as OrganismRecord['memberVisibility'] | null) ?? undefined,
      moderationConfig: JSON.parse(row.moderationConfig as string),
      memoryNamespace: row.memoryNamespace as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.location) record.location = JSON.parse(row.location as string);
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.archived) record.archived = true;
    if (row.archivedAt) record.archivedAt = row.archivedAt as string;
    if (row.archivedBy) record.archivedBy = row.archivedBy as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
};
