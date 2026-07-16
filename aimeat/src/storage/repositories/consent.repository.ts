/**
 * @file src/storage/repositories/consent.repository.ts
 * @description Backend-agnostic storage contract for the consent layer — CRUD over consent grants,
 *   matching a grant to a (memory key, accessor) access attempt, expiring stale grants, and the
 *   append/query/prune lifecycle of the consent audit log. Implemented per storage backend.
 *
 * @structure
 *   - ConsentRepository: the interface all backends implement
 *   - Grants: create/get/list/update/delete + findMatchingConsents + expireStaleConsents
 *   - Audit: addConsentAuditEntry, listConsentAudit, pruneConsentAudit
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-16 — listConsentsForAgents batch primitive (collapses directory/matching N+1)
 */
import type { ConsentRecord, ConsentAuditEntry } from '../interface.js';

export interface ConsentRepository {
  createConsent(record: ConsentRecord): Promise<ConsentRecord>;
  getConsent(id: string): Promise<ConsentRecord | null>;
  listConsents(ownerGaii: string, opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<ConsentRecord[]>;
  /**
   * Batch variant of listConsents: load consents for MANY owner GAIIs in one query.
   * Returns a map keyed by ownerGaii (every input gaii present, empty array if none).
   * Collapses the O(owners×agents) fan-out in directory/matching rebuilds into one IN query.
   */
  listConsentsForAgents(ownerGaiis: string[], opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<Record<string, ConsentRecord[]>>;
  updateConsent(id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null>;
  deleteConsent(id: string): Promise<boolean>;
  findMatchingConsents(ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]>;
  expireStaleConsents(before: string): Promise<number>;
  addConsentAuditEntry(entry: ConsentAuditEntry): Promise<ConsentAuditEntry>;
  listConsentAudit(ownerGaii: string, opts?: {
    days?: number;
    consentId?: string;
    accessorGaii?: string;
  }): Promise<ConsentAuditEntry[]>;
  /** Delete consent-audit entries with timestamp strictly before the given ISO date. Returns the count removed. */
  pruneConsentAudit(beforeIso: string): Promise<number>;
}
