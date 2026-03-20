/**
 * @file template-listing.repository.ts
 * @description Template listing repository interface — social/discovery layer on top of
 *   packages. Manages gallery listings, reviews (separate table), and threaded discussions
 *   (separate table). One listing per package group.
 * @structure TemplateListingRepository interface with listing CRUD, review methods, discussion methods
 * @usage import type { TemplateListingRepository } from './template-listing.repository.js';
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 1 storage layer)
 *   v1.1.0 — 2026-03-20 — add listPendingTemplates method for moderation workflow
 */

import type { TemplateListingRecord, TemplateReview, TemplateDiscussion, TemplateFilter } from '../interface.js';

export interface TemplateListingRepository {
  // ── Listings ──
  createTemplateListing(record: TemplateListingRecord): Promise<TemplateListingRecord>;
  getTemplateListing(id: string): Promise<TemplateListingRecord | null>;
  getListingByPackage(packageGroupId: string): Promise<TemplateListingRecord | null>;
  listTemplateListings(filter: TemplateFilter): Promise<{ listings: TemplateListingRecord[]; total: number }>;
  updateTemplateListing(id: string, updates: Partial<TemplateListingRecord>): Promise<TemplateListingRecord | null>;
  deleteTemplateListing(id: string): Promise<boolean>;
  incrementInstallCount(listingId: string): Promise<void>;
  listPendingTemplates(limit?: number, offset?: number): Promise<TemplateListingRecord[]>;

  // ── Reviews (separate table) ──
  addReview(review: TemplateReview): Promise<TemplateReview>;
  getReviewsByListing(listingId: string, limit?: number, offset?: number): Promise<{ reviews: TemplateReview[]; total: number }>;
  getReviewByAuthor(listingId: string, authorGhii: string): Promise<TemplateReview | null>;
  updateReview(id: string, updates: Partial<TemplateReview>): Promise<TemplateReview | null>;
  deleteReview(id: string): Promise<boolean>;
  recalculateRating(listingId: string): Promise<{ rating: number; reviewCount: number }>;

  // ── Discussions (separate table) ──
  addDiscussion(discussion: TemplateDiscussion): Promise<TemplateDiscussion>;
  getDiscussionsByListing(listingId: string, limit?: number, offset?: number): Promise<{ discussions: TemplateDiscussion[]; total: number }>;
  deleteDiscussion(id: string): Promise<boolean>;
}
