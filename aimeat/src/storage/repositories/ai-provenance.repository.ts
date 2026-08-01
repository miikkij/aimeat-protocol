/**
 * @file src/storage/repositories/ai-provenance.repository.ts
 * @description Repository interface for addressable AI provenance records (TARGET-058). Append-only
 *   by design: a provenance record is an attributable statement about a specific set of bytes, so
 *   correcting one means minting a new record about the new bytes, never editing the old statement.
 *   There is deliberately no update or delete method here.
 * @structure
 *   - createAiProvenance(row)                  -- append one record
 *   - getAiProvenance(id)                      -- resolve by node-local id (route authorizes)
 *   - findAiProvenanceByHash(hash, query)      -- the DETECTION lookup, filtered in SQL
 * @usage
 *   import type { AiProvenanceRepository } from './repositories/ai-provenance.repository.js';
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import type { AiProvenanceRecordRow, AiProvenanceHashQuery } from '../interface.js';

export interface AiProvenanceRepository {
  createAiProvenance(row: AiProvenanceRecordRow): Promise<void>;

  /**
   * Resolve by id. Applies NO authorization — the calling route must compare `ownerGhii` against
   * `resolveIdentity()` and return an IDENTICAL 404 for "absent" and "not yours".
   */
  getAiProvenance(id: string): Promise<AiProvenanceRecordRow | undefined>;

  /**
   * The hash-keyed detection lookup: "did this node produce these exact bytes?". Filtering happens
   * in SQL — public records always, plus the caller's own when `query.ownerGhii` is given — so a
   * private row belonging to a third party never reaches the process at all.
   */
  findAiProvenanceByHash(contentHash: string, query?: AiProvenanceHashQuery): Promise<AiProvenanceRecordRow[]>;
}
