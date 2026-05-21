import type { MemoryLinkRecord, OperatorReviewRecord } from '../interface.js';

export interface KnowledgeRepository {
  /* ── Memory Links ── */
  createLink(record: MemoryLinkRecord): Promise<MemoryLinkRecord>;
  getLink(source: string, target: string): Promise<MemoryLinkRecord | null>;
  listLinks(key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string }): Promise<MemoryLinkRecord[]>;
  deleteLink(source: string, target: string): Promise<boolean>;
  findBrokenLinks(ownerGaii: string): Promise<MemoryLinkRecord[]>;

  deleteLinksByContributor(gaii: string): Promise<number>;

  /* ── Operator Reviews ── */
  createReview(record: OperatorReviewRecord): Promise<OperatorReviewRecord>;
  listReviews(packageId: string): Promise<OperatorReviewRecord[]>;
  listAllReviews(opts?: { page?: number; perPage?: number }): Promise<OperatorReviewRecord[]>;
  deleteReviewsByOperator(gaii: string): Promise<number>;
}
