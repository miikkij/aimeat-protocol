/**
 * @file app-grant.repository.ts
 * @description Repository interface for app grants (app_grants). A grant is a
 *              long-lived authorization issued to an in-page app so it can mint
 *              agent tokens that resolve to the granting owner's GHII. The
 *              refresh token hash is rotated on use and nulled on revocation.
 * @structure AppGrantRepository — CRUD keyed by grantId, plus lookup by refresh
 *            token hash, the live (owner, app) lookup, and listing by owner.
 * @usage import type { AppGrantRepository } from './repositories/app-grant.repository.js';
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial: app grants (owner-issued app authorizations)
 *   v1.1.0 — 2026-07-25 — Add getAppGrantByOwnerAndApp: the one-live-grant-per-(owner, app)
 *     invariant needs a direct lookup, not list-all + find (which both consent paths did).
 */
import type { AppGrantRecord } from '../interface.js';

export interface AppGrantRepository {
  createAppGrant(grant: AppGrantRecord): Promise<AppGrantRecord>;
  getAppGrant(grantId: string): Promise<AppGrantRecord | null>;
  getAppGrantByRefreshHash(tokenHash: string): Promise<AppGrantRecord | null>;
  /**
   * The owner's single live (non-revoked) grant for an app, or null. A partial unique index over
   * (owner, app) WHERE NOT revoked makes "single" a DB guarantee — re-consent updates this row
   * rather than stacking another one (which is how one owner accumulated 86 grants).
   */
  getAppGrantByOwnerAndApp(owner: string, app: string): Promise<AppGrantRecord | null>;
  listAppGrantsByOwner(owner: string): Promise<AppGrantRecord[]>;
  updateAppGrant(grantId: string, updates: Partial<Pick<AppGrantRecord, 'refreshTokenHash' | 'lastUsedAt' | 'revoked' | 'scopes' | 'spendCapMorsels' | 'spentMorsels'>>): Promise<AppGrantRecord | null>;
  deleteAppGrant(grantId: string): Promise<boolean>;
}
