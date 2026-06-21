import type { ConsentRecord, ConsentAuditEntry } from '../interface.js';

export interface ConsentRepository {
  createConsent(record: ConsentRecord): Promise<ConsentRecord>;
  getConsent(id: string): Promise<ConsentRecord | null>;
  listConsents(ownerGaii: string, opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<ConsentRecord[]>;
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
