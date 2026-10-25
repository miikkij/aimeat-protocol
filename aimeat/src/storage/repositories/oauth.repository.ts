/**
 * @file src/storage/repositories/oauth.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic storage interface for OAuth state — the persistence contract each
 *   provider implements for registered OAuth clients, refresh tokens, and remembered consent approvals,
 *   including the bulk delete of refresh tokens by GAII.
 *
 * @structure
 *   - OAuthRepository: interface for OAuth client create/get, refresh-token create/get/delete, and
 *     approval (remembered-consent) create/get
 *
 * @version-history
 *   2026-10-25 — deleteUnusedOAuthClients(createdBefore): the daily core job's sweep of dynamically
 *     registered clients nobody uses (secaudit2026oct22, dcr-unbounded-client-records).
 *   v1.1.0 — 2026-09-09 — deleteOAuthClient, listOAuthClients, deleteOAuthRefreshTokensByClient,
 *     deleteOAuthApproval, deleteOAuthApprovalsByClient, deleteOAuthApprovalsByGaii and
 *     listOAuthApprovalsByOwner deleted: no caller outside the storage layer.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { OAuthClientRecord, OAuthRefreshTokenRecord, OAuthApprovalRecord } from '../interface.js';

export interface OAuthRepository {
  // Clients
  createOAuthClient(client: OAuthClientRecord): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClientRecord | null>;
  /**
   * Delete every client registered before `createdBefore` (an ISO time) that no refresh token and no
   * remembered approval names: a registration nobody finished or kept. Returns how many went.
   */
  deleteUnusedOAuthClients(createdBefore: string): Promise<number>;

  // Refresh tokens
  createOAuthRefreshToken(token: OAuthRefreshTokenRecord): Promise<void>;
  getOAuthRefreshToken(tokenHash: string): Promise<OAuthRefreshTokenRecord | null>;
  deleteOAuthRefreshToken(tokenHash: string): Promise<boolean>;
  deleteOAuthRefreshTokensByGaii(gaii: string): Promise<number>;

  // Approvals (remembered consent grants)
  createOAuthApproval(approval: OAuthApprovalRecord): Promise<void>;
  getOAuthApproval(clientId: string, gaii: string): Promise<OAuthApprovalRecord | null>;
}
