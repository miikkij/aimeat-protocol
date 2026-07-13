/**
 * @file src/storage/repositories/auth.repository.ts
 * @description Storage interface segment for auth token revocation — the contract every backend
 *   implements to persist a revoked-token denylist keyed by token hash, with expiry-based cleanup.
 *
 * @structure
 *   - AuthRepository: interface with revokeToken, isTokenRevoked, and cleanExpiredRevocations
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
export interface AuthRepository {
  revokeToken(tokenHash: string, expiresAt: number): Promise<void>;
  isTokenRevoked(tokenHash: string): Promise<boolean>;
  cleanExpiredRevocations(): Promise<number>;
}
