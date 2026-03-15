/**
 * @file templates.ts
 * @description Template gallery API routes — discovery/social layer for AIMEAT packages.
 *   Manages gallery listings, reviews, threaded discussions, and featured promotions.
 * @structure
 *   - templatesRouter() — main router factory
 *   - POST /v1/templates — create listing
 *   - GET /v1/templates — gallery with filters/sort
 *   - GET /v1/templates/:id — single listing with reviews/discussions
 *   - PATCH /v1/templates/:id — update listing
 *   - DELETE /v1/templates/:id — remove listing
 *   - POST /v1/templates/:id/review — add/update review
 *   - GET /v1/templates/:id/reviews — list reviews
 *   - POST /v1/templates/:id/discussion — add discussion message
 *   - GET /v1/templates/:id/discussions — list discussions
 *   - PATCH /v1/templates/:id/featured — toggle featured
 * @usage
 *   import { templatesRouter } from '../routes/templates.js';
 *   app.use(templatesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 5)
 *   v1.1.0 — 2026-03-15 — GHII resolution via identity system
 *   v1.2.0 — 2026-03-15 — enforce templateReviewsEnabled/templateDiscussionsEnabled config; remove (config as any) cast
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, TemplateListingRecord, TemplateReview, TemplateDiscussion } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { resolveGhii } from '../utils/ghii-resolver.js';

const VALID_SORTS = ['rating', 'installs', 'newest'] as const;

export function templatesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── POST /v1/templates — Create listing ─────────────────────────────
  router.post('/v1/templates', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const roles = req.auth!.roles;

    // Role check: operator always allowed, owner only if configured
    const createRole = config.packageCreateRole ?? 'owner';
    if (!roles.includes('operator') && createRole === 'operator') {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only operators can create template listings'));
      return;
    }

    const { packageGroupId, title, description, screenshots, category, tags } = req.body ?? {};

    if (!packageGroupId || typeof packageGroupId !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'packageGroupId is required'));
      return;
    }
    if (!title || typeof title !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'title is required'));
      return;
    }
    if (!description || typeof description !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'description is required'));
      return;
    }

    try {
      // Validate that the package exists
      const pkg = await storage.getLatestPublished(packageGroupId);
      if (!pkg) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package group not found or has no published version'));
        return;
      }

      // Check for duplicate listing
      const existing = await storage.getListingByPackage(packageGroupId);
      if (existing) {
        res.status(409).json(error(config.nodeId, 'CONFLICT', 'A listing already exists for this package group'));
        return;
      }

      const now = new Date().toISOString();
      const authorGhii = await resolveGhii(storage, owner, req.auth!.sub);

      const record: TemplateListingRecord = {
        id: randomUUID(),
        packageGroupId,
        packageName: pkg.name,
        packageAuthor: pkg.author,
        publishedBy: owner,
        publishedByGhii: authorGhii,
        title,
        description,
        screenshots: screenshots ?? [],
        category: category ?? '',
        tags: tags ?? [],
        featured: false,
        installCount: 0,
        rating: 0,
        reviewCount: 0,
        status: 'listed',
        createdAt: now,
        updatedAt: now,
      };

      const created = await storage.createTemplateListing(record);
      emitChange('templates');
      res.status(201).json(success(config.nodeId, { listing: created }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── GET /v1/templates — Gallery with filters/sort ───────────────────
  router.get('/v1/templates', async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const tagsParam = req.query.tags as string | undefined;
      const tags = tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(Boolean) : undefined;
      const featuredParam = req.query.featured as string | undefined;
      const featured = featuredParam === 'true' ? true : featuredParam === 'false' ? false : undefined;
      const sortParam = req.query.sort as string | undefined;
      const sort = sortParam && VALID_SORTS.includes(sortParam as any) ? sortParam as typeof VALID_SORTS[number] : undefined;
      const search = req.query.search as string | undefined;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

      const result = await storage.listTemplateListings({
        category,
        tags,
        featured,
        sort,
        search,
        limit,
        offset,
      });

      res.json(success(config.nodeId, { templates: result.listings, total: result.total }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── GET /v1/templates/:id — Single listing with reviews/discussions ─
  router.get('/v1/templates/:id', async (req, res) => {
    const id = req.params.id as string;

    try {
      const listing = await storage.getTemplateListing(id);
      if (!listing) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Template listing not found'));
        return;
      }

      const [reviewsResult, discussionsResult] = await Promise.all([
        storage.getReviewsByListing(id, 10, 0),
        storage.getDiscussionsByListing(id, 20, 0),
      ]);

      res.json(success(config.nodeId, {
        listing,
        reviews: reviewsResult.reviews,
        discussions: discussionsResult.discussions,
      }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── PATCH /v1/templates/:id — Update listing ───────────────────────
  router.patch('/v1/templates/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const roles = req.auth!.roles;

    try {
      const listing = await storage.getTemplateListing(id);
      if (!listing) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Template listing not found'));
        return;
      }

      // Must be the publisher or an operator
      if (listing.publishedBy !== owner && !roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the publisher or an operator can update this listing'));
        return;
      }

      const { title, description, screenshots, category, tags } = req.body ?? {};
      const updates: Partial<TemplateListingRecord> = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (screenshots !== undefined) updates.screenshots = screenshots;
      if (category !== undefined) updates.category = category;
      if (tags !== undefined) updates.tags = tags;
      updates.updatedAt = new Date().toISOString();

      const updated = await storage.updateTemplateListing(id, updates);
      emitChange('templates');
      res.json(success(config.nodeId, { listing: updated }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── DELETE /v1/templates/:id — Remove listing ──────────────────────
  router.delete('/v1/templates/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const roles = req.auth!.roles;

    try {
      const listing = await storage.getTemplateListing(id);
      if (!listing) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Template listing not found'));
        return;
      }

      // Must be the publisher or an operator
      if (listing.publishedBy !== owner && !roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the publisher or an operator can delete this listing'));
        return;
      }

      await storage.deleteTemplateListing(id);
      emitChange('templates');
      res.json(success(config.nodeId, { deleted: true }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── POST /v1/templates/:id/review — Add/update review ──────────────
  router.post('/v1/templates/:id/review', requireAuth(), async (req, res) => {
    if (!config.templateReviewsEnabled) {
      res.status(403).json(error(config.nodeId, 'DISABLED', 'Reviews are disabled'));
      return;
    }

    const listingId = req.params.id as string;
    const owner = req.auth!.owner;
    // TODO: resolve owner's GHII via identity system when integration is confirmed
    const authorGhii = req.auth!.sub;

    const { rating, comment } = req.body ?? {};

    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'rating must be an integer between 1 and 5'));
      return;
    }
    if (typeof comment !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'comment must be a string'));
      return;
    }

    try {
      // Verify listing exists
      const listing = await storage.getTemplateListing(listingId);
      if (!listing) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Template listing not found'));
        return;
      }

      // Check if user already reviewed this listing
      const existing = await storage.getReviewByAuthor(listingId, authorGhii);

      if (existing) {
        // Update existing review
        const updated = await storage.updateReview(existing.id, { rating, comment });
        await storage.recalculateRating(listingId);
        emitChange('templates');
        res.json(success(config.nodeId, { review: updated }));
      } else {
        // Create new review
        const now = new Date().toISOString();
        const review: TemplateReview = {
          id: randomUUID(),
          listingId,
          authorGhii,
          authorName: owner,
          rating,
          comment,
          createdAt: now,
        };
        const created = await storage.addReview(review);
        await storage.recalculateRating(listingId);
        emitChange('templates');
        res.status(201).json(success(config.nodeId, { review: created }));
      }
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── GET /v1/templates/:id/reviews — List reviews ───────────────────
  router.get('/v1/templates/:id/reviews', async (req, res) => {
    if (!config.templateReviewsEnabled) {
      res.json(success(config.nodeId, { reviews: [], total: 0 }));
      return;
    }

    const listingId = req.params.id as string;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    try {
      const result = await storage.getReviewsByListing(listingId, limit, offset);
      res.json(success(config.nodeId, { reviews: result.reviews, total: result.total }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── POST /v1/templates/:id/discussion — Add discussion message ─────
  router.post('/v1/templates/:id/discussion', requireAuth(), async (req, res) => {
    if (!config.templateDiscussionsEnabled) {
      res.status(403).json(error(config.nodeId, 'DISABLED', 'Discussions are disabled'));
      return;
    }

    const listingId = req.params.id as string;
    const owner = req.auth!.owner;
    // TODO: resolve owner's GHII via identity system when integration is confirmed
    const authorGhii = req.auth!.sub;

    const { message, parentId } = req.body ?? {};

    if (!message || typeof message !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'message must be a non-empty string'));
      return;
    }

    try {
      // Verify listing exists
      const listing = await storage.getTemplateListing(listingId);
      if (!listing) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Template listing not found'));
        return;
      }

      const now = new Date().toISOString();
      const discussion: TemplateDiscussion = {
        id: randomUUID(),
        listingId,
        authorGhii,
        authorName: owner,
        message,
        parentId: parentId ?? undefined,
        createdAt: now,
      };

      const created = await storage.addDiscussion(discussion);
      emitChange('templates');
      res.status(201).json(success(config.nodeId, { discussion: created }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── GET /v1/templates/:id/discussions — List discussions ────────────
  router.get('/v1/templates/:id/discussions', async (req, res) => {
    if (!config.templateDiscussionsEnabled) {
      res.json(success(config.nodeId, { discussions: [], total: 0 }));
      return;
    }

    const listingId = req.params.id as string;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    try {
      const result = await storage.getDiscussionsByListing(listingId, limit, offset);
      res.json(success(config.nodeId, { discussions: result.discussions, total: result.total }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  // ── PATCH /v1/templates/:id/featured — Toggle featured (operator) ──
  router.patch('/v1/templates/:id/featured', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const { featured } = req.body ?? {};

    if (typeof featured !== 'boolean') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'featured must be a boolean'));
      return;
    }

    try {
      const listing = await storage.getTemplateListing(id);
      if (!listing) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Template listing not found'));
        return;
      }

      const updated = await storage.updateTemplateListing(id, {
        featured,
        updatedAt: new Date().toISOString(),
      });
      emitChange('templates');
      res.json(success(config.nodeId, { listing: updated }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', (err as Error).message));
    }
  });

  return router;
}
