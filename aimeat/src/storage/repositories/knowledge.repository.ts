/**
 * @file src/storage/repositories/knowledge.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic repository interface for the knowledge layer — CRUD contracts for
 *   memory links (the knowledge graph) and operator package reviews that storage providers implement.
 *
 * @structure
 *   - KnowledgeRepository (Memory Links): create/list/delete links, find broken links, purge by contributor
 *   - KnowledgeRepository (Operator Reviews): create/list reviews by package and delete-by-operator
 *
 * @version-history
 *   v1.1.0 — 2026-09-09 — getLink and listAllReviews deleted: no caller.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { MemoryLinkRecord, OperatorReviewRecord } from '../interface.js';

export interface KnowledgeRepository {
  /* ── Memory Links ── */
  createLink(record: MemoryLinkRecord): Promise<MemoryLinkRecord>;
  listLinks(key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string }): Promise<MemoryLinkRecord[]>;
  deleteLink(source: string, target: string): Promise<boolean>;
  findBrokenLinks(ownerGaii: string): Promise<MemoryLinkRecord[]>;

  deleteLinksByContributor(gaii: string): Promise<number>;

  /* ── Operator Reviews ── */
  createReview(record: OperatorReviewRecord): Promise<OperatorReviewRecord>;
  listReviews(packageId: string): Promise<OperatorReviewRecord[]>;
  deleteReviewsByOperator(gaii: string): Promise<number>;
}
