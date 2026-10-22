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
 *   v1.2.0 — 2026-10-22 — A link row belongs to the namespace that holds its source manifest
 *     (`sourceOwner`, the ownerGaii of that record). createLink, listLinks (outgoing rows) and
 *     deleteLink take it, because a manifest key such as packages/<id>/manifest is unique only within
 *     one namespace and another account could hold the same key (secaudit 2026-10, v78).
 *     findBrokenLinks reads one namespace's rows; listUnplacedLinks, updateUnplacedLink and
 *     deleteUnplacedLink serve the once-only step that places the rows written before the column
 *     (services/knowledge-link-owner-keep.ts).
 *   v1.1.0 — 2026-09-09 — getLink and listAllReviews deleted: no caller.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { MemoryLinkRecord, OperatorReviewRecord } from '../interface.js';

/** The rows written before link rows carried their owner: '' until the once-only step places them. */
export const UNPLACED_LINK_OWNER = '';

export interface KnowledgeRepository {
  /* ── Memory Links ── */
  /**
   * Create or replace the link `record.source` → `record.target` of the namespace `sourceOwner` (the
   * ownerGaii of the record that holds the source manifest). Another namespace's row with the same
   * source and target is a different row and stays as it is.
   */
  createLink(record: MemoryLinkRecord, sourceOwner: string): Promise<MemoryLinkRecord>;
  /**
   * The links of `key`. Outgoing rows (source = key) are only those of `sourceOwner`, and none when it
   * is missing. Incoming rows (target = key) are every namespace's links to the key: they are other
   * owners' links to this package, and the clone count reads them.
   */
  listLinks(key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string; sourceOwner?: string }): Promise<MemoryLinkRecord[]>;
  /** Delete the link `source` → `target` of the namespace `sourceOwner` only. */
  deleteLink(source: string, target: string, sourceOwner: string): Promise<boolean>;
  /**
   * The links of the namespace `sourceOwner` (of the one source key, when given) whose source or
   * target is not a record in that namespace. The caller decides whether a target held elsewhere,
   * such as another owner's public package, counts as present.
   */
  findBrokenLinks(sourceOwner: string, source?: string): Promise<MemoryLinkRecord[]>;

  deleteLinksByContributor(gaii: string): Promise<number>;

  /** Rows written before link rows carried their owner (owner UNPLACED_LINK_OWNER). */
  listUnplacedLinks(): Promise<MemoryLinkRecord[]>;
  /** Give an unplaced row its owner and/or its contributor's full identity. False when no row changed. */
  updateUnplacedLink(source: string, target: string, change: { sourceOwner?: string; linkedBy?: string }): Promise<boolean>;
  /** Delete an unplaced row. */
  deleteUnplacedLink(source: string, target: string): Promise<boolean>;

  /* ── Operator Reviews ── */
  createReview(record: OperatorReviewRecord): Promise<OperatorReviewRecord>;
  listReviews(packageId: string): Promise<OperatorReviewRecord[]>;
  deleteReviewsByOperator(gaii: string): Promise<number>;
}
