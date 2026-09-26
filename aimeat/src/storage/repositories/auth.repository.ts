/**
 * @file src/storage/repositories/auth.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage interface segment for auth token revocation — the contract every backend
 *   implements to persist a revoked-token denylist keyed by token hash, with expiry-based cleanup.
 *
 * @structure
 *   - AuthRepository: interface with revokeToken, revokeTokenIfAbsent, isTokenRevoked, and
 *     cleanExpiredRevocations
 *
 * @version-history
 *   v1.1.0 — 2026-09-26 — revokeTokenIfAbsent: file a hash and say whether this call filed it, in
 *     one statement, so a one-time spend holds under concurrent requests (secaudit 2026-09, N5).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
export interface AuthRepository {
  revokeToken(tokenHash: string, expiresAt: number): Promise<void>;
  /**
   * File the hash unless it is already there, and say which: true when THIS call filed it, false
   * when it was there before, expired or not. One statement on every provider, so of any number of
   * concurrent calls with one hash exactly one gets true. A one-time spend asks this, never
   * isTokenRevoked and then revokeToken, which are two statements with a gap between them.
   */
  revokeTokenIfAbsent(tokenHash: string, expiresAt: number): Promise<boolean>;
  isTokenRevoked(tokenHash: string): Promise<boolean>;
  cleanExpiredRevocations(): Promise<number>;
}
