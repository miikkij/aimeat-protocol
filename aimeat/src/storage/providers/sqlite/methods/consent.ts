/**
 * @file src/storage/providers/sqlite/methods/consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Consent methods for the SQLite backend: grants, the (memory key, accessor) match, the
 *   node-wide roll-up, and the audit log. Extracted from sqlite/methods/governance.ts to satisfy
 *   max-file-lines; bodies verbatim, merged back onto SqliteStorage by governance.ts.
 *
 *   The Postgres backend has had its consent domain in its own file since it was written, so this
 *   also makes the two providers mirror each other rather than only agree.
 * @structure consentMethods — the object governance.ts spreads into governanceMethods
 * @version-history
 *   v1.0.0 — 2026-08-23 — Pure extraction from governance.ts (BR-02 pushed it past 800 lines).
 */
import type { ConsentRecord, ConsentAuditEntry, ConsentFacet, ConsentFacetQuery } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { consentMatchPattern } from '../../../pattern-utils.js';
import { matchesRecipient } from '../../../../services/consent.js';
import { parseGaiiLoose } from '../../../../utils/gaii.js';

export const consentMethods = {
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

  async listConsentsForAgents(this: SqliteStorage, ownerGaiis: string[], opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<Record<string, ConsentRecord[]>> {
    const out: Record<string, ConsentRecord[]> = {};
    for (const g of ownerGaiis) out[g] = [];
    if (ownerGaiis.length === 0) return out;
    const placeholders = ownerGaiis.map(() => '?').join(',');
    let sql = `SELECT * FROM consents WHERE ownerGaii IN (${placeholders})`;
    const params: unknown[] = [...ownerGaiis];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.recipient) { sql += ' AND recipient = ?'; params.push(opts.recipient); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    for (const r of rows) {
      const c = this.deserializeConsent(r);
      (out[c.ownerGaii] ??= []).push(c);
    }
    return out;
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

  async consentFacets(this: SqliteStorage, query?: ConsentFacetQuery): Promise<ConsentFacet[]> {
    // grantedAt is an ISO-8601 string here, so its first ten characters ARE the UTC day. The
    // Postgres sibling stores a timestamp and casts it to UTC to land on the same bucket. Both
    // backends are asserted to COUNT the same grants (e2e-compliance-report); the day bucket itself
    // is not asserted, because no surface serves it yet — the report folds the facets to totals. A
    // surface that shows consent per day has to bring that assertion with it.
    const where: string[] = [];
    const params: unknown[] = [];
    if (query?.ownerGhii) { where.push('ownerGaii = ?'); params.push(query.ownerGhii); }
    if (query?.since) { where.push('grantedAt >= ?'); params.push(query.since); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT status, scope, substr(grantedAt, 1, 10) AS day, COUNT(*) AS n
         FROM consents${clause}
        GROUP BY status, scope, day`
    ).all(...params) as { status: string; scope: string; day: string; n: number }[];
    return rows.map(r => ({ status: r.status, scope: r.scope, day: r.day, count: Number(r.n) }));
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
};
