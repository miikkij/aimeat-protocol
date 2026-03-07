export interface AuthRepository {
  revokeToken(tokenHash: string, expiresAt: number): Promise<void>;
  isTokenRevoked(tokenHash: string): Promise<boolean>;
  cleanExpiredRevocations(): Promise<number>;
}
