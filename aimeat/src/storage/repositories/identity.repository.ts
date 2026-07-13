/**
 * @file src/storage/repositories/identity.repository.ts
 * @description Backend-agnostic storage interface for human identity — the persistence contract each
 *   provider implements for GHII records (incl. lookups by owner, email hash, Google sub, and external
 *   OIDC id), chat instances, and email verifications.
 *
 * @structure
 *   - IdentityRepository: interface for GHII CRUD + lookups, chat-instance CRUD, and email-verification lifecycle
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { GHIIRecord, ChatInstanceRecord, EmailVerificationRecord } from '../interface.js';

export interface IdentityRepository {
  createGHII(record: GHIIRecord): Promise<GHIIRecord>;
  getGHII(ghii: string): Promise<GHIIRecord | null>;
  getGHIIByOwner(ownerName: string): Promise<GHIIRecord | null>;
  updateGHII(ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null>;
  getGHIIByEmailHash(emailHash: string): Promise<GHIIRecord | null>;
  getGHIIByGoogleSub(googleSub: string): Promise<GHIIRecord | null>;
  /** Look up a GHII by an external OIDC identity (provider id + stable subject). */
  getGHIIByExternalId(provider: string, sub: string): Promise<GHIIRecord | null>;
  listGHIIs(opts?: { q?: string; level?: number }): Promise<GHIIRecord[]>;
  deleteGHII(ghii: string): Promise<boolean>;
  createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord>;
  getChatInstance(id: string): Promise<ChatInstanceRecord | null>;
  listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]>;
  updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null>;
  deleteChatInstance(id: string): Promise<boolean>;
  createEmailVerification(record: EmailVerificationRecord): Promise<EmailVerificationRecord>;
  getEmailVerification(id: string): Promise<EmailVerificationRecord | null>;
  getActiveEmailVerification(ownerName: string, purpose: string): Promise<EmailVerificationRecord | null>;
  updateEmailVerification(id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null>;
  deleteExpiredEmailVerifications(): Promise<number>;
  getEmailVerificationsByOwner?(ownerName: string): Promise<EmailVerificationRecord[]>;
}
