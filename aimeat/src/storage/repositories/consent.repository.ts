/**
 * @file src/storage/repositories/consent.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic storage contract for the consent layer — CRUD over consent grants,
 *   matching a grant to a (memory key, accessor) access attempt, expiring stale grants, and the
 *   append/query/prune lifecycle of the consent audit log. Implemented per storage backend.
 *
 * @structure
 *   - ConsentRepository: the interface all backends implement
 *   - Grants: create/get/list/update/delete + findMatchingConsents + expireStaleConsents
 *   - Node-wide: consentFacets — SQL-side counts, operator-gated by the caller
 *   - Audit: addConsentAuditEntry, listConsentAudit, pruneConsentAudit
 *
 * @version-history
 *   v1.2.0 — 2026-08-23 — consentFacets(): the consent half of the operator's compliance report
 *     (BR-02). Every read here was ownerGaii-keyed, so a node-wide answer could only be assembled
 *     by listing owners and fanning out — a cost that grows with how long the node has existed
 *     rather than with the size of the answer, which is the shape services/ai-usage-admin.ts had to
 *     be rewritten to escape.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-16 — listConsentsForAgents batch primitive (collapses directory/matching N+1)
 */
import type { ConsentRecord, ConsentAuditEntry, ConsentFacet, ConsentFacetQuery } from '../interface.js';

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
  /**
   * Grant counts grouped by status, scope and day — the consent half of the operator's compliance
   * report.
   *
   * OPERATOR-ONLY when `ownerGhii` is absent: this applies no caller restriction, so the calling
   * route MUST gate it on the operator role. Same contract as `queryUsageDailyAllOwners` and
   * `aiProvenanceFacets`, stated the same way so the three read alike.
   *
   * Counted in SQL rather than by paging rows into memory, for the reason aiProvenanceFacets gives:
   * a capped page would turn "how many grants are active on this node" into "how many in the first
   * page I looked at", and a compliance report that quietly truncates is worse than no report,
   * because it reads as coverage.
   */
  consentFacets(query?: ConsentFacetQuery): Promise<ConsentFacet[]>;
  addConsentAuditEntry(entry: ConsentAuditEntry): Promise<ConsentAuditEntry>;
  listConsentAudit(ownerGaii: string, opts?: {
    days?: number;
    consentId?: string;
    accessorGaii?: string;
  }): Promise<ConsentAuditEntry[]>;
  /** Delete consent-audit entries with timestamp strictly before the given ISO date. Returns the count removed. */
  pruneConsentAudit(beforeIso: string): Promise<number>;
}
