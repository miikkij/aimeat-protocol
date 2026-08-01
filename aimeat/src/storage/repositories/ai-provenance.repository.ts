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
 *   - publiclyLinkedProvenanceIds(ids)         -- THE visibility rule: which records describe
 *                                                 content that is publicly readable right now
 * @usage
 *   import type { AiProvenanceRepository } from './repositories/ai-provenance.repository.js';
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. publiclyLinkedProvenanceIds(): visibility follows the
 *     content instead of being a stored, caller-settable flag on the record.
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
   * in SQL — publicly linked records always, plus the caller's own when `query.ownerGhii` is given —
   * so a third party's non-public row never reaches the process at all.
   */
  findAiProvenanceByHash(contentHash: string, query?: AiProvenanceHashQuery): Promise<AiProvenanceRecordRow[]>;

  /**
   * THE visibility rule, in one query: of these provenance ids, which describe content that ANY
   * anonymous reader can currently read?
   *
   * A record is publicly resolvable exactly when some item pointing at it is itself public — a
   * public memory record (which is also how workspace records, agent faces and WebMCP manifests are
   * stored) or a published, unparked, unhidden, code-free app. Publishing the content makes its
   * record resolvable; making the content private again takes it back to the identical 404. There
   * is no second visibility concept to keep in sync, and no flag a caller could set to publish a
   * statement about content nobody may read.
   *
   * Returns the subset that is public, in no particular order. An empty input returns empty.
   */
  publiclyLinkedProvenanceIds(ids: string[]): Promise<string[]>;
}
