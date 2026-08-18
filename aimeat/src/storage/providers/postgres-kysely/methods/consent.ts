/**
 * @file src/storage/providers/postgres-kysely/methods/consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Consent domain for the Postgres+Kysely backend (Consent / ConsentAudit). Backs the
 *   workspace-access grant flow and the GDPR consent ledger. findMatchingConsents reuses the shared
 *   recipient/pattern matchers (services/consent + pattern-utils + gaii) so access decisions are
 *   identical across backends. Translated 1:1 from the Prisma implementation.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: consent on Postgres+Kysely.
 *   v1.1.0 — 2026-07-16 — listConsentsForAgents batch primitive.
 */
import type { Selectable } from 'kysely';
import type { ConsentAuditEntry, ConsentRecord } from '../../../interface.js';
import { matchesRecipient } from '../../../../services/consent.js';
import { parseGaiiLoose } from '../../../../utils/gaii.js';
import { consentMatchPattern } from '../../../pattern-utils.js';
import type { Consent } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const isoOpt = (t: Date | string | null | undefined): string | null => (t == null ? null : (t instanceof Date ? t : new Date(t)).toISOString());
const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toConsent(r: Selectable<Consent>): ConsentRecord {
  return {
    id: r.id, ownerGaii: r.ownerGaii, dataPattern: r.dataPattern, recipient: r.recipient, purpose: r.purpose, scope: r.scope as ConsentRecord['scope'],
    expires: isoOpt(r.expires), status: r.status as ConsentRecord['status'], grantedAt: iso(r.grantedAt),
    revokedAt: isoOpt(r.revokedAt), metadata: (r.metadata ?? undefined) as ConsentRecord['metadata'],
  };
}

export const consentMethods = {
  async createConsent(this: PostgresKyselyStorage, r: ConsentRecord): Promise<ConsentRecord> {
    await this.db.insertInto('Consent').values({
      id: r.id, ownerGaii: r.ownerGaii, dataPattern: r.dataPattern, recipient: r.recipient, purpose: r.purpose, scope: r.scope,
      expires: r.expires ? new Date(r.expires) : null, status: r.status, grantedAt: new Date(r.grantedAt),
      revokedAt: r.revokedAt ? new Date(r.revokedAt) : null, metadata: jsonb(r.metadata ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getConsent(this: PostgresKyselyStorage, id: string): Promise<ConsentRecord | null> {
    const r = await this.db.selectFrom('Consent').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toConsent(r) : null;
  },
  async listConsents(this: PostgresKyselyStorage, ownerGaii: string, opts?: { status?: 'active' | 'revoked' | 'expired'; recipient?: string }): Promise<ConsentRecord[]> {
    let q = this.db.selectFrom('Consent').selectAll().where('ownerGaii', '=', ownerGaii);
    if (opts?.status) q = q.where('status', '=', opts.status);
    if (opts?.recipient) q = q.where('recipient', '=', opts.recipient);
    return (await q.execute()).map(toConsent);
  },
  async listConsentsForAgents(this: PostgresKyselyStorage, ownerGaiis: string[], opts?: { status?: 'active' | 'revoked' | 'expired'; recipient?: string }): Promise<Record<string, ConsentRecord[]>> {
    const out: Record<string, ConsentRecord[]> = {};
    for (const g of ownerGaiis) out[g] = [];
    if (ownerGaiis.length === 0) return out;
    let q = this.db.selectFrom('Consent').selectAll().where('ownerGaii', 'in', ownerGaiis);
    if (opts?.status) q = q.where('status', '=', opts.status);
    if (opts?.recipient) q = q.where('recipient', '=', opts.recipient);
    for (const row of await q.execute()) {
      const c = toConsent(row);
      (out[c.ownerGaii] ??= []).push(c);
    }
    return out;
  },
  async updateConsent(this: PostgresKyselyStorage, id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status) data.status = updates.status;
    if (updates.revokedAt) data.revokedAt = new Date(updates.revokedAt);
    if (updates.expires !== undefined) data.expires = updates.expires ? new Date(updates.expires) : null;
    if (updates.metadata !== undefined) data.metadata = jsonb(updates.metadata ?? null);
    if (Object.keys(data).length === 0) return this.getConsent(id);
    const rows = await this.db.updateTable('Consent').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toConsent(rows[0]) : null;
  },
  async deleteConsent(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Consent').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async findMatchingConsents(this: PostgresKyselyStorage, ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]> {
    const rows = await this.db.selectFrom('Consent').selectAll().where('ownerGaii', '=', ownerGaii).where('status', '=', 'active').execute();
    const now = new Date().toISOString();
    const results: ConsentRecord[] = [];
    for (const row of rows) {
      const consent = toConsent(row);
      if (consent.expires && consent.expires < now) {
        await this.db.updateTable('Consent').set({ status: 'expired' }).where('id', '=', consent.id).execute();
        continue;
      }
      const accessor = parseGaiiLoose(accessorGaii);
      if (!matchesRecipient(consent.recipient, accessorGaii, accessor.owner, accessor.node)) continue;
      if (!consentMatchPattern(consent.dataPattern, memoryKey)) continue;
      results.push(consent);
    }
    return results;
  },
  async expireStaleConsents(this: PostgresKyselyStorage, before: string): Promise<number> {
    const r = await this.db.updateTable('Consent').set({ status: 'expired' })
      .where('status', '=', 'active').where('expires', 'is not', null).where('expires', '<', new Date(before)).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  },
  async addConsentAuditEntry(this: PostgresKyselyStorage, entry: ConsentAuditEntry): Promise<ConsentAuditEntry> {
    await this.db.insertInto('ConsentAudit').values({
      consentId: entry.consentId, ownerGaii: entry.ownerGaii, accessorGaii: entry.accessorGaii, memoryKey: entry.memoryKey,
      action: entry.action, timestamp: new Date(entry.timestamp), allowed: entry.allowed,
    }).execute();
    return entry;
  },
  async pruneConsentAudit(this: PostgresKyselyStorage, beforeIso: string): Promise<number> {
    const r = await this.db.deleteFrom('ConsentAudit').where('timestamp', '<', new Date(beforeIso)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async listConsentAudit(this: PostgresKyselyStorage, ownerGaii: string, opts?: { days?: number; consentId?: string; accessorGaii?: string }): Promise<ConsentAuditEntry[]> {
    let q = this.db.selectFrom('ConsentAudit').selectAll().where('ownerGaii', '=', ownerGaii);
    if (opts?.days) q = q.where('timestamp', '>=', new Date(Date.now() - opts.days * 86400000));
    if (opts?.consentId) q = q.where('consentId', '=', opts.consentId);
    if (opts?.accessorGaii) q = q.where('accessorGaii', '=', opts.accessorGaii);
    const rows = await q.orderBy('timestamp', 'desc').execute();
    return rows.map(r => ({ id: r.id, consentId: r.consentId, ownerGaii: r.ownerGaii, accessorGaii: r.accessorGaii, memoryKey: r.memoryKey, action: r.action as ConsentAuditEntry['action'], timestamp: iso(r.timestamp), allowed: r.allowed }));
  },
};
