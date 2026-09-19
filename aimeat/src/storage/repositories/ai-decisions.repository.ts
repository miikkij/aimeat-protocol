/**
 * @file src/storage/repositories/ai-decisions.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for AI decision rows (TARGET-080, AIMEAT.decide). One row per
 *   call to the decision model. Written once; afterwards only `record.review` may change, and rows
 *   age out through deleteAiDecisionsBefore(), which is the lifecycle of this store.
 * @structure
 *   - createAiDecision(row)                         -- append one decision
 *   - getAiDecision(id)                             -- resolve by id (caller authorizes)
 *   - findCachedAiDecision(owner, cacheKey, since)  -- newest fresh, non-cached row for a cache key
 *   - listAiDecisions(query)                        -- the owner's decisions, newest first
 *   - setAiDecisionReview(id, owner, review)        -- a person confirms or overrides
 *   - deleteAiDecisionsBefore(before)               -- the lifecycle: rows age out
 * @usage
 *   import type { AiDecisionRepository } from './repositories/ai-decisions.repository.js';
 * @version-history
 *   v1.0.0 — 2026-09-19 — TARGET-080. Initial.
 */
import type { AiDecisionRow, AiDecisionListQuery, AiDecisionReview } from '../types/ai-decisions.js';

export interface AiDecisionRepository {
  createAiDecision(row: AiDecisionRow): Promise<void>;

  /**
   * Resolve by id. Applies NO authorization: the caller compares `ownerGhii` against the resolved
   * identity and returns the same 404 for "absent" and "not yours".
   */
  getAiDecision(id: string): Promise<AiDecisionRow | undefined>;

  /**
   * The cache lookup: the newest row of this owner with this cache key, created at or after `since`,
   * that was itself answered by the model (no `record.cachedFrom`). A cached answer never serves as
   * the source of another, so a chain of cache hits always points at one real call.
   */
  findCachedAiDecision(ownerGhii: string, cacheKey: string, since: string): Promise<AiDecisionRow | undefined>;

  /**
   * The owner's decisions, newest first. `limit` defaults to 50 and is capped at 200. `before` is a
   * createdAt cursor (exclusive). `total` counts every row the filter matches, ignoring the cursor
   * and the limit, so the page and the count describe the same population.
   */
  listAiDecisions(query: AiDecisionListQuery): Promise<{ items: AiDecisionRow[]; total: number }>;

  /**
   * Write `record.review` and nothing else. Returns false when the row does not exist or belongs to
   * another owner, so the caller can answer both the same way.
   */
  setAiDecisionReview(id: string, ownerGhii: string, review: AiDecisionReview): Promise<boolean>;

  /** Delete every row created before `before` (ISO). Returns the number deleted. */
  deleteAiDecisionsBefore(before: string): Promise<number>;
}
