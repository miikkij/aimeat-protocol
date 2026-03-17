export interface SessionRecord {
  sessionId: string;
  gaii: string;
  owner: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface SessionRepository {
  createSession(session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): Promise<void>;
  listActiveSessions(owner: string): Promise<SessionRecord[]>;
  revokeSession(sessionId: string): Promise<boolean>;
  revokeAllSessions(owner: string): Promise<number>;
  isSessionRevoked(sessionId: string): Promise<boolean>;
}
