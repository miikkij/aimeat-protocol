/**
 * @file pat.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage contract for owner-created Personal Access Tokens (PATs):
 *   reusable, revocable Bearer tokens an owner issues for agents to authenticate
 *   and act (e.g. drive/verify a webapp they built). A token grants either selected
 *   agent scopes (scoped test GAII) or — when explicitly chosen — full owner / operator
 *   access. Only the SHA-256 hash of the raw token is ever stored.
 * @structure PatRecord shape; PatRepository interface (create/get-by-hash/list/revoke/touch).
 * @usage Implemented by each storage provider (SQLite, MongoDB) and composed into the Storage interface.
 * @version-history
 * v1.0.0 - 2026-06-03 - Initial (plan 2026-06-03-agent-access-tokens).
 */

export interface PatRecord {
  id: string;              // public id for list / revoke
  tokenHash: string;       // SHA-256 of the raw token (lookup key) — raw token is never stored
  label: string;           // user-facing name
  owner: string;           // owning GHII owner name
  scopes: string[];        // selected agent scopes (enforced on exchange unless grantOwner)
  grantOwner: boolean;     // "Full": the token acts as the owner GHII
  grantOperator: boolean;  // adds the operator role (only settable by an operator owner)
  readOwnerData: boolean;  // agent-scope tokens only: read the owner's data instead of a sandbox
  gaii: string;            // dedicated test GAII used when not grantOwner; ignored for owner/operator
  createdAt: string;       // ISO
  expiresAt: string | null;// ISO; null = no expiry
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface PatRepository {
  /** Persist a new personal access token (hash only). */
  createPat(pat: PatRecord): Promise<void>;
  /** Look up an active token by its SHA-256 hash (used on exchange). */
  getPatByHash(tokenHash: string): Promise<PatRecord | null>;
  /** List an owner's non-revoked tokens (never returns the raw token). */
  listPats(owner: string): Promise<PatRecord[]>;
  /** Revoke a token by id, scoped to its owner. Returns true if a token was revoked. */
  revokePat(id: string, owner: string): Promise<boolean>;
  /** Update lastUsedAt on successful exchange. */
  touchPat(id: string, usedAtIso: string): Promise<void>;
}
