/**
 * @file src/storage/repositories/ai-provenance.repository.ts
 * @description Repository interface for addressable AI provenance records (TARGET-058). Append-only
 *   by design: a provenance record is an attributable statement about a specific set of bytes, so
 *   correcting one means minting a new record about the new bytes, never editing the old statement.
 *   There is deliberately no update or delete method here.
 * @structure
 *   - createAiProvenance(row)                  -- append one record
 *   - getAiProvenance(id)                      -- resolve by node-local id (route authorizes)
 *   - getAiProvenanceMany(ids)                 -- the batch form, so a page of items costs one query
 *   - findAiProvenanceByHash(hash, query)      -- the DETECTION lookup, filtered in SQL
 *   - publiclyLinkedProvenanceIds(ids)         -- THE visibility rule: which records describe
 *                                                 content that is publicly readable right now
 *   - aiProvenanceFacets(query)                -- SQL-side counts for the operator report + sweep
 *   - listAiProvenance(query)                  -- the records themselves, newest first
 * @usage
 *   import type { AiProvenanceRepository } from './repositories/ai-provenance.repository.js';
 * @version-history
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 8. aiProvenanceFacets() + listAiProvenance(): the
 *     read side the operator report, the unlabelled-content sweep and the per-owner view need.
 *     Counted in SQL, because a capped page would turn "how many public items carry no label" into
 *     a number that silently means "how many in the first page", which reads as coverage.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. publiclyLinkedProvenanceIds(): visibility follows the
 *     content instead of being a stored, caller-settable flag on the record.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import type {
  AiProvenanceRecordRow, AiProvenanceHashQuery,
  AiProvenanceFacet, AiProvenanceFacetQuery, AiProvenanceListQuery,
} from '../interface.js';

export interface AiProvenanceRepository {
  createAiProvenance(row: AiProvenanceRecordRow): Promise<void>;

  /**
   * Resolve by id. Applies NO authorization — the calling route must compare `ownerGhii` against
   * `resolveIdentity()` and return an IDENTICAL 404 for "absent" and "not yours".
   */
  getAiProvenance(id: string): Promise<AiProvenanceRecordRow | undefined>;

  /**
   * Resolve MANY ids in one query — the batch form of getAiProvenance(), for a surface that reads a
   * page of items and needs the record attached to each.
   *
   * It exists because the alternative is an N+1 that grows with the content, not with the traffic: a
   * workspace read, an MCP read tool and a listing all fetch a page of records and then one
   * provenance lookup PER record. Applies no authorization either — same contract as the singular
   * form: the caller has already decided the items are readable, and provenance travels with the
   * content it describes. Missing ids are simply absent from the result; order is not guaranteed.
   */
  getAiProvenanceMany(ids: string[]): Promise<AiProvenanceRecordRow[]>;

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

  /**
   * The counts behind the operator transparency report, the scheduled sweep and the per-owner view:
   * every record grouped by what it says, whether its content is public, and whether a label was
   * owed — computed in SQL rather than by paging rows into memory.
   *
   * SQL and not a JS roll-up on purpose. A capped page would make "how many public items carry no
   * label" a number that silently means "how many in the first 5000 I looked at", and a compliance
   * report that quietly truncates is worse than no report: it reads as coverage. This returns the
   * whole population, one row per distinct combination.
   */
  aiProvenanceFacets(query?: AiProvenanceFacetQuery): Promise<AiProvenanceFacet[]>;

  /**
   * Records themselves, newest first, for the two surfaces that show a LIST rather than a count:
   * the sweep's notification (what exactly is unlabelled) and the owner's own "what my agents
   * published" view.
   *
   * `unlabelledPublicOnly` is the sweep's filter and the report's detail list — a record whose
   * content is publicly readable, where nobody reviewed the substance, and whose pre-rendered
   * disclosure block does not say a label was required. That combination is the case nobody thought
   * of, and on the evidence of Phases 4, 5 and 6 it keeps existing.
   */
  listAiProvenance(query?: AiProvenanceListQuery): Promise<{ items: AiProvenanceRecordRow[]; total: number }>;
}
