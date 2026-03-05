import type { OtkRecord } from '../interface.js';

export interface OtkRepository {
  createOtk(otk: OtkRecord): Promise<OtkRecord>;
  getOtk(key: string): Promise<OtkRecord | null>;
  consumeOtk(key: string, graceMs?: number): Promise<OtkRecord | null>;
  listOtksBySession(sessionId: string): Promise<OtkRecord[]>;
  expireSessionOtks(sessionId: string): Promise<number>;
}
