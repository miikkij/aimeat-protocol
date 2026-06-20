/**
 * @file app-grant.repository.ts
 * @description Repository interface for app grants (app_grants). A grant is a
 *              long-lived authorization issued to an in-page app so it can mint
 *              agent tokens that resolve to the granting owner's GHII. The
 *              refresh token hash is rotated on use and nulled on revocation.
 * @structure AppGrantRepository — CRUD keyed by grantId, plus lookup by refresh
 *            token hash and listing by owner.
 * @usage import type { AppGrantRepository } from './repositories/app-grant.repository.js';
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial: app grants (owner-issued app authorizations)
 */
import type { AppGrantRecord } from '../interface.js';

export interface AppGrantRepository {
  createAppGrant(grant: AppGrantRecord): Promise<AppGrantRecord>;
  getAppGrant(grantId: string): Promise<AppGrantRecord | null>;
  getAppGrantByRefreshHash(tokenHash: string): Promise<AppGrantRecord | null>;
  listAppGrantsByOwner(owner: string): Promise<AppGrantRecord[]>;
  updateAppGrant(grantId: string, updates: Partial<Pick<AppGrantRecord, 'refreshTokenHash' | 'lastUsedAt' | 'revoked' | 'scopes'>>): Promise<AppGrantRecord | null>;
  deleteAppGrant(grantId: string): Promise<boolean>;
}
