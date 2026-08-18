/**
 * @file src/storage/repositories/oauth.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic storage interface for OAuth state — the persistence contract each
 *   provider implements for registered OAuth clients, refresh tokens, and remembered consent approvals,
 *   including bulk deletes by client, GAII, and owner.
 *
 * @structure
 *   - OAuthRepository: interface for OAuth client CRUD, refresh-token CRUD, and approval (remembered-consent) CRUD
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { OAuthClientRecord, OAuthRefreshTokenRecord, OAuthApprovalRecord } from '../interface.js';

export interface OAuthRepository {
  // Clients
  createOAuthClient(client: OAuthClientRecord): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClientRecord | null>;
  deleteOAuthClient(clientId: string): Promise<boolean>;
  listOAuthClients(): Promise<OAuthClientRecord[]>;

  // Refresh tokens
  createOAuthRefreshToken(token: OAuthRefreshTokenRecord): Promise<void>;
  getOAuthRefreshToken(tokenHash: string): Promise<OAuthRefreshTokenRecord | null>;
  deleteOAuthRefreshToken(tokenHash: string): Promise<boolean>;
  deleteOAuthRefreshTokensByClient(clientId: string): Promise<number>;
  deleteOAuthRefreshTokensByGaii(gaii: string): Promise<number>;

  // Approvals (remembered consent grants)
  createOAuthApproval(approval: OAuthApprovalRecord): Promise<void>;
  getOAuthApproval(clientId: string, gaii: string): Promise<OAuthApprovalRecord | null>;
  deleteOAuthApproval(clientId: string, gaii: string): Promise<boolean>;
  deleteOAuthApprovalsByClient(clientId: string): Promise<number>;
  deleteOAuthApprovalsByGaii(gaii: string): Promise<number>;
  listOAuthApprovalsByOwner(owner: string): Promise<OAuthApprovalRecord[]>;
}
