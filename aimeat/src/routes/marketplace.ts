import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import {
  VALID_CATEGORIES,
  VALID_CONDITIONS,
  VALID_AVAILABILITIES,
  createListing,
  purchaseListing,
  deliverPurchase,
  ratePurchase,
} from '../services/marketplace.js';

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

export function marketplaceRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── POST /v1/marketplace/listings — Create listing ──
  router.post('/v1/marketplace/listings', requireAuth(), async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const ownerName = req.auth!.owner;

    // Look up GHII for the authenticated user
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord) {
      res.status(403).json(error(config.nodeId, 'GHII_REQUIRED',
        'You must have a GHII profile to create a listing'));
      return;
    }

    const { title, description, category, priceMorsels, condition, availability, location, tags } = req.body ?? {};

    // Validate required fields
    if (!title || typeof title !== 'string' || title.length < 3 || title.length > 200) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'title must be a string between 3 and 200 characters'));
      return;
    }
    if (!description || typeof description !== 'string' || description.length < 10 || description.length > 5000) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'description must be a string between 10 and 5000 characters'));
      return;
    }
    if (!category || !(VALID_CATEGORIES as readonly string[]).includes(category)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `category must be one of: ${VALID_CATEGORIES.join(', ')}`));
      return;
    }
    if (typeof priceMorsels !== 'number' || priceMorsels < 1 || !Number.isInteger(priceMorsels)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'priceMorsels must be a positive integer'));
      return;
    }
    if (condition && !(VALID_CONDITIONS as readonly string[]).includes(condition)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `condition must be one of: ${VALID_CONDITIONS.join(', ')}`));
      return;
    }
    if (availability && !(VALID_AVAILABILITIES as readonly string[]).includes(availability)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `availability must be one of: ${VALID_AVAILABILITIES.join(', ')}`));
      return;
    }
    if (tags && (!Array.isArray(tags) || tags.some((t: unknown) => typeof t !== 'string'))) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'tags must be an array of strings'));
      return;
    }

    const result = await createListing(config, storage, ownerName, ghiiRecord.ghii, {
      title, description, category, priceMorsels, condition, availability, location, tags,
    });

    if ('error' in result) {
      const status = result.code === 'INSUFFICIENT_MORSELS' ? 402 : 400;
      res.status(status).json(error(config.nodeId, result.code, result.error));
      return;
    }

    res.status(201).json(success(config.nodeId, {
      listingId: result.listing.id,
      memoryKey: result.listing.memoryKey,
      listingFee: result.listingFee,
      status: result.listing.status,
    }, [
      { description: 'View listing', method: 'GET', url: `/v1/marketplace/listings/${result.listing.id}` },
      { description: 'Browse all listings', method: 'GET', url: '/v1/marketplace/listings' },
    ]));
  });

  // ── GET /v1/marketplace/listings — Browse listings (public) ──
  router.get('/v1/marketplace/listings', async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const category = req.query.category as string | undefined;
    const city = req.query.city as string | undefined;
    const minPrice = req.query.min_price ? parseInt(req.query.min_price as string, 10) : undefined;
    const maxPrice = req.query.max_price ? parseInt(req.query.max_price as string, 10) : undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page as string ?? '20', 10)));

    // Only show active, non-hidden listings
    const allListings = await storage.listListings({
      category,
      city,
      minPrice,
      maxPrice,
      status: 'active',
      page,
      perPage,
    });

    // Filter out hidden listings
    const listings = allListings.filter(l => l.status === 'active');

    // Get total count for pagination (re-query without pagination)
    const allActive = await storage.listListings({
      category,
      city,
      minPrice,
      maxPrice,
      status: 'active',
      page: 1,
      perPage: 10000,
    });
    const total = allActive.filter(l => l.status === 'active').length;

    // Sort by price if requested
    const sort = req.query.sort as string | undefined;
    if (sort === 'price_morsels') {
      listings.sort((a, b) => a.priceMorsels - b.priceMorsels);
    } else if (sort === 'price_morsels_desc') {
      listings.sort((a, b) => b.priceMorsels - a.priceMorsels);
    }

    res.json(success(config.nodeId, {
      listings,
      total,
      page,
    }, [
      { description: 'Create a listing', method: 'POST', url: '/v1/marketplace/listings' },
    ], { page, per_page: perPage, total }));
  });

  // ── GET /v1/marketplace/my-listings — Seller's own listings ──
  router.get('/v1/marketplace/my-listings', requireAuth(), async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const ownerName = req.auth!.owner;
    const listings = await storage.listListings({ sellerOwner: ownerName, page: 1, perPage: 1000 });

    res.json(success(config.nodeId, { listings }, [
      { description: 'Create a listing', method: 'POST', url: '/v1/marketplace/listings' },
    ]));
  });

  // ── GET /v1/marketplace/my-purchases — Buyer's purchase history ──
  router.get('/v1/marketplace/my-purchases', requireAuth(), async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const ownerName = req.auth!.owner;
    const purchases = await storage.listPurchasesByBuyer(ownerName);

    res.json(success(config.nodeId, { purchases }));
  });

  // ── GET /v1/marketplace/listings/:id — Single listing detail ──
  router.get('/v1/marketplace/listings/:id', async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const id = param(req.params.id);
    const listing = await storage.getListing(id);
    if (!listing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Listing not found'));
      return;
    }

    // Enrich with schema.org semantic annotation — Phase 2.7
    const enrichedListing = {
      ...listing,
      semantic: listing.semantic ?? {
        '@context': { schema: 'https://schema.org/' },
        '@type': 'schema:Offer',
        'schema:priceCurrency': 'MORSEL',
        'schema:price': listing.priceMorsels,
        'schema:availability': listing.status === 'active' ? 'schema:InStock' : 'schema:Discontinued',
        'schema:seller': { '@type': 'schema:Person', 'schema:identifier': listing.sellerGhii },
        'schema:category': listing.category,
      },
    };

    res.json(success(config.nodeId, { listing: enrichedListing }, [
      { description: 'Purchase this listing', method: 'POST', url: `/v1/marketplace/listings/${id}/purchase` },
      { description: 'Browse all listings', method: 'GET', url: '/v1/marketplace/listings' },
    ]));
  });

  // ── PUT /v1/marketplace/listings/:id — Update listing (seller only) ──
  router.put('/v1/marketplace/listings/:id', requireAuth(), async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const id = param(req.params.id);
    const ownerName = req.auth!.owner;

    const listing = await storage.getListing(id);
    if (!listing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Listing not found'));
      return;
    }
    if (listing.ownerName !== ownerName) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the seller can update this listing'));
      return;
    }

    const { title, description, category, priceMorsels, condition, availability, location, tags } = req.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (title !== undefined) {
      if (typeof title !== 'string' || title.length < 3 || title.length > 200) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'title must be 3-200 characters'));
        return;
      }
      updates.title = title;
    }
    if (description !== undefined) {
      if (typeof description !== 'string' || description.length < 10 || description.length > 5000) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'description must be 10-5000 characters'));
        return;
      }
      updates.description = description;
    }
    if (category !== undefined) {
      if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
          `category must be one of: ${VALID_CATEGORIES.join(', ')}`));
        return;
      }
      updates.category = category;
    }
    if (priceMorsels !== undefined) {
      if (typeof priceMorsels !== 'number' || priceMorsels < 1 || !Number.isInteger(priceMorsels)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'priceMorsels must be a positive integer'));
        return;
      }
      updates.priceMorsels = priceMorsels;
    }
    if (condition !== undefined) updates.condition = condition;
    if (availability !== undefined) updates.availability = availability;
    if (location !== undefined) updates.location = location;
    if (tags !== undefined) updates.tags = tags;

    const updated = await storage.updateListing(id, updates as any);
    res.json(success(config.nodeId, { listing: updated }));
  });

  // ── DELETE /v1/marketplace/listings/:id — Delist (seller only) ──
  router.delete('/v1/marketplace/listings/:id', requireAuth(), async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const id = param(req.params.id);
    const ownerName = req.auth!.owner;

    const listing = await storage.getListing(id);
    if (!listing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Listing not found'));
      return;
    }
    if (listing.ownerName !== ownerName) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the seller can delist this listing'));
      return;
    }

    await storage.updateListing(id, { status: 'delisted', updatedAt: new Date().toISOString() });
    res.json(success(config.nodeId, { listingId: id, status: 'delisted' }));
  });

  // ── POST /v1/marketplace/listings/:id/purchase — Buy (requireAuth) ──
  router.post('/v1/marketplace/listings/:id/purchase', requireAuth(), async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const id = param(req.params.id);
    const buyerOwner = req.auth!.owner;

    const result = await purchaseListing(config, storage, id, buyerOwner);
    if ('error' in result) {
      const status = result.code === 'INSUFFICIENT_MORSELS' ? 402
        : result.code === 'NOT_FOUND' ? 404
        : result.code === 'SELF_PURCHASE' ? 400
        : 400;
      res.status(status).json(error(config.nodeId, result.code, result.error));
      return;
    }

    res.status(201).json(success(config.nodeId, {
      purchaseId: result.purchase.id,
      totalCost: result.totalCost,
      breakdown: result.breakdown,
      status: result.purchase.status,
      trackingCode: result.purchase.trackingCode,
    }, [
      { description: 'View purchase', method: 'GET', url: `/v1/marketplace/purchases/${result.purchase.id}` },
      { description: 'Mark as delivered (seller)', method: 'POST', url: `/v1/marketplace/purchases/${result.purchase.id}/deliver` },
    ]));
  });

  // ── POST /v1/marketplace/purchases/:id/deliver — Seller marks delivery ──
  router.post('/v1/marketplace/purchases/:id/deliver', requireAuth(), async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const id = param(req.params.id);
    const sellerOwner = req.auth!.owner;

    const result = await deliverPurchase(config, storage, id, sellerOwner);
    if ('error' in result) {
      const status = result.code === 'NOT_FOUND' ? 404
        : result.code === 'FORBIDDEN' ? 403
        : 400;
      res.status(status).json(error(config.nodeId, result.code, result.error));
      return;
    }

    res.json(success(config.nodeId, { purchase: result.purchase }, [
      { description: 'Rate this purchase (buyer)', method: 'POST', url: `/v1/marketplace/purchases/${id}/rate` },
    ]));
  });

  // ── POST /v1/marketplace/purchases/:id/rate — Buyer rates purchase ──
  router.post('/v1/marketplace/purchases/:id/rate', requireAuth(), async (req, res) => {
    if (!config.marketplaceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Marketplace is disabled on this node'));
      return;
    }

    const id = param(req.params.id);
    const buyerOwner = req.auth!.owner;
    const { score, comment } = req.body ?? {};

    if (typeof score !== 'number') {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'score is required and must be a number'));
      return;
    }

    const result = await ratePurchase(storage, id, buyerOwner, score, comment);
    if ('error' in result) {
      const status = result.code === 'NOT_FOUND' ? 404
        : result.code === 'FORBIDDEN' ? 403
        : 400;
      res.status(status).json(error(config.nodeId, result.code, result.error));
      return;
    }

    res.json(success(config.nodeId, { purchase: result.purchase }));
  });

  return router;
}
