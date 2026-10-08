/**
 * @file src/routes/visibility-feed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's product feeds over REST (layer E): read and change the feed, push the
 *   catalog into the owner's own Stripe, and the two public feed files Merchant Center and anybody
 *   with the address fetch. The MCP tool aimeat_visibility_feed calls the same service functions
 *   (services/visibility/merchant-feed-settings.ts).
 *
 *   THE PUBLIC FILES ANSWER ONE 404 for every failure: an unknown owner, a feed that is off, a node
 *   that switched feeds off. The address must not tell a stranger which accounts exist or sell.
 * @structure visibilityFeedRouter
 * @usage router.use(visibilityFeedRouter(config, storage)); // from visibilityRouter
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (layer E).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { callerOf } from '../middleware/caller.js';
import { localAccountOf } from '../utils/gaii.js';
import {
  getFeedSettings, setFeedSettings, syncStripeCatalog, describeFeed, nodeAllowsFeeds, FeedSettingsError,
} from '../services/visibility/merchant-feed-settings.js';
import { listOwnerProducts, merchantCenterTsv, stripeCatalogCsv } from '../services/visibility/merchant-feed.js';

const FeedSchema = z.object({
  enabled: z.boolean().optional(),
  brand: z.string().max(70).nullable().optional(),
  return_policy_label: z.string().max(50).nullable().optional(),
  store_url: z.string().max(2048).nullable().optional(),
  stripe_profile_id: z.string().max(80).nullable().optional(),
  product_links: z.record(z.string().max(300), z.string().max(2048).nullable()).optional(),
}).strict();

const SyncSchema = z.object({ check_only: z.boolean().optional() }).strict();

export function visibilityFeedRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const publicLimit = rateLimit({ windowMs: 60_000, max: 60, keyBy: 'ip' });

  /** The account whose feed this is, with its name. A visitor from another node has none here. */
  function ownerOf(req: Request, res: Response): { ghii: string; name: string } | null {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.visitor) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'A session from another node has no product feed here.'));
      return null;
    }
    return { ghii: caller.ownerGhii, name: caller.owner };
  }
  const fail = (res: Response, e: unknown): void => {
    if (e instanceof FeedSettingsError) { res.status(e.statusCode).json(error(config.nodeId, e.code, e.message)); return; }
    throw e;
  };

  router.get('/v1/visibility/feed', requireAuth(), requireScope('signals:read'), async (req, res) => {
    const owner = ownerOf(req, res);
    if (!owner) return;
    res.json(success(config.nodeId, await describeFeed(storage, config, owner.ghii, owner.name)));
  });

  router.put('/v1/visibility/feed', requireAuth(), requireScope('signals:write'), async (req, res) => {
    const parsed = FeedSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message)); return; }
    const owner = ownerOf(req, res);
    if (!owner) return;
    try {
      await setFeedSettings(storage, owner.ghii, {
        enabled: parsed.data.enabled, brand: parsed.data.brand, returnPolicyLabel: parsed.data.return_policy_label,
        storeUrl: parsed.data.store_url, productLinks: parsed.data.product_links, stripeProfileId: parsed.data.stripe_profile_id,
      });
    } catch (e) { fail(res, e); return; }
    res.json(success(config.nodeId, await describeFeed(storage, config, owner.ghii, owner.name), [
      { description: 'Push the catalog into your own Stripe', method: 'POST', url: '/v1/visibility/feed/stripe-sync' },
    ]));
  });

  router.post('/v1/visibility/feed/stripe-sync', requireAuth(), requireScope('signals:write'), async (req, res) => {
    const parsed = SyncSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message)); return; }
    const owner = ownerOf(req, res);
    if (!owner) return;
    if (!nodeAllowsFeeds(config)) { res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Product feeds are switched off on this node.')); return; }
    try {
      res.json(success(config.nodeId, { stripe: await syncStripeCatalog(storage, config, owner.ghii, { checkOnly: parsed.data.check_only }) }));
    } catch (e) { fail(res, e); }
  });

  // ── The public feed files ──────────────────────────────────────────────────────────────────

  async function publicFeed(req: Request, res: Response, kind: 'merchant-center' | 'stripe'): Promise<void> {
    const notFound = (): void => { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Unknown feed', undefined, undefined, [])); };
    const name = String(req.params.owner ?? '');
    if (!/^[a-z0-9_-]{1,60}$/i.test(name) || !nodeAllowsFeeds(config)) return notFound();
    const ghii = `${name}@${config.nodeId}`;
    if (!localAccountOf(ghii) || !(await storage.getOwner(name))) return notFound();
    const feed = await getFeedSettings(storage, ghii);
    if (!feed.enabled) return notFound();
    const listing = await listOwnerProducts(storage, config, ghii, feed);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (kind === 'merchant-center') {
      res.type('text/plain; charset=utf-8').send(merchantCenterTsv(listing, feed));
    } else {
      res.type('text/csv; charset=utf-8').send(stripeCatalogCsv(listing));
    }
  }

  router.get('/v1/visibility/feeds/:owner/merchant-center.txt', publicLimit, (req, res) => publicFeed(req, res, 'merchant-center'));
  router.get('/v1/visibility/feeds/:owner/stripe-catalog.csv', publicLimit, (req, res) => publicFeed(req, res, 'stripe'));

  return router;
}
