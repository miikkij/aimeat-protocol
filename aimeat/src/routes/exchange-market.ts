/**
 * @file src/routes/exchange-market.ts
 * @description The two-sided EXCHANGE MARKETPLACE surface (TARGET-045 Phase C): supply (OFFERINGs), demand
 *   (NEEDs), and BIDs against needs — the browse/post/bid/accept flow above the metered entitlement. Pricing
 *   is always AUTHORITATIVE from the provider extension action (resolveActionPricing), so listings and bids
 *   cannot undercut the provider. Accepting a bid mints the durable entitlement (same primitive as the
 *   direct acceptance route). Records are public (browsable); writes are owner-authorised. The heavy
 *   orchestration (agent negotiation, composite assembly) lives in the marketplace app/agent — this router
 *   is the generic store + capability match.
 * @structure exchangeMarketRouter — offerings (POST/GET/GET :id detail/GET :id/consumers/DELETE) ·
 *   needs (POST/GET/close) · bids (POST/GET/accept)
 * @usage import { exchangeMarketRouter } from './routes/exchange-market.js'; app.use(exchangeMarketRouter(config, storage));
 * @version-history
 *   v1.2.0 — 2026-07-20 — Legibility GATE: listing an offering now REQUIRES a published input+output schema
 *     (400 SCHEMA_REQUIRED) and usage_terms (400 USAGE_TERMS_REQUIRED) — every listing integrable + governed.
 *   v1.1.0 — 2026-07-20 — Legibility: offering detail (I/O schema + call-recipe + stats), provider consumers
 *     (lineage), usage_terms on offerings, spec on needs, ?stats=1 on the list.
 *   v1.0.0 — 2026-07-20 — Initial marketplace: offerings, needs, bids, capability match, accept-bid → mint (Phase C).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';
import { createEntitlement, readEntitlementForCall } from '../services/metered-entitlements.js';
import {
  type Offering, type Need, type Bid, type ActionCommercial, type UsageTerms, type NeedSpec,
  resolveActionPricing, newOfferingId, newNeedId, newBidId,
  putOffering, getOffering, listOfferings, deleteOffering, matchOfferings,
  putNeed, getNeed, listNeeds, putBid, listBids, getBid,
  offeringStats, offeringConsumers,
} from '../services/exchange-market.js';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const posOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
/** A publishable schema is a non-empty object (an empty `{}` counts as "not published"). */
const hasSchema = (v: unknown): boolean => !!v && typeof v === 'object' && Object.keys(v as Record<string, unknown>).length > 0;

/** Parse a provider-declared usage licence from a request body (all fields optional; defaults are permissive-but-attributed). */
function parseUsageTerms(v: unknown): UsageTerms | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    derivatives: o.derivatives !== false,
    resale: o.resale === true,
    attribution: o.attribution !== false,
    note: typeof o.note === 'string' ? o.note : undefined,
  };
}

/** Parse a need's minimum-spec (required output fields + desired shape) from a request body. */
function parseNeedSpec(v: unknown): NeedSpec | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const requiredFields = Array.isArray(o.requiredFields) ? (o.requiredFields as unknown[]).filter(f => typeof f === 'string') as string[] : [];
  const spec: NeedSpec = { requiredFields };
  if (typeof o.format === 'string') spec.format = o.format;
  if (typeof o.sample === 'string') spec.sample = o.sample;
  if (typeof o.notes === 'string') spec.notes = o.notes;
  return (requiredFields.length || spec.format || spec.sample || spec.notes) ? spec : null;
}

export function exchangeMarketRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── INFO — the marketplace's public economics (rake, currencies) ─────────────
  /** Public: what the platform takes on each metered call + the units in play. */
  router.get('/v1/exchange/info', (_req: Request, res: Response) => {
    return res.json(success(config.nodeId, {
      rake_percent: commerceFeePercent(config),
      rake_note: 'Platform fee applied to each metered call (provider keeps the rest). Set by the node operator.',
      units: ['morsels', 'EUR', 'USD'],
      morsel_note: 'Morsels are the node’s throttle unit (plain integers); real money settles in EUR/USD.',
    }));
  });

  // ── OFFERINGS (supply) ─────────────────────────────────────────────────────
  /** List a supply offering for an action the caller's extension owns. Pricing is read from the action. */
  router.post('/v1/exchange/offerings', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ext = str(b.ext), action = str(b.action);
    if (!ext || !action) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'ext and action are required'));
    const extRec = await storage.getExtension(ext);
    if (!extRec) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${ext}" not found`));
    if (extRec.installedBy !== owner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the extension owner may list it'));
    const act = extRec.actions.find(a => a.id === action);
    if (!act) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Action "${action}" not found on "${ext}"`));
    const priced = resolveActionPricing(act.commercial as ActionCommercial | undefined, null);
    if (!priced.ok) return res.status(400).json(error(config.nodeId, priced.code, priced.message));
    // LEGIBILITY GATE: an offering must be integrable + governed to be listed. The action MUST publish an
    // input AND output schema (so a consumer/agent knows what to send and gets back), and the listing MUST
    // state usage terms (so a consumer knows if they may refine/resell). Enforced at the supply source.
    if (!hasSchema(act.inputSchema) || !hasSchema(act.outputSchema)) {
      return res.status(400).json(error(config.nodeId, 'SCHEMA_REQUIRED',
        `Action "${ext}/${action}" must publish a non-empty input AND output schema before it can be offered on EXCHANGE (a consumer must know what to send and receive)`));
    }
    const usageTerms = parseUsageTerms(b.usage_terms);
    if (!usageTerms) {
      return res.status(400).json(error(config.nodeId, 'USAGE_TERMS_REQUIRED',
        'usage_terms is required to list an offering — state { derivatives, resale, attribution, note? } so a consumer knows how they may use the output'));
    }
    const now = new Date().toISOString();
    const offering: Offering = {
      offeringId: newOfferingId(),
      providerGhii: resolveIdentity(req.auth!, config.nodeId),
      providerOwner: owner,
      ext, action,
      title: str(b.title) || `${ext}/${action}`,
      description: str(b.description),
      unit: priced.unit, basePrice: priced.pricePerCall, currency: priced.currency,
      plans: (act.commercial as ActionCommercial | undefined)?.plans ?? [],
      provenance: (b.provenance && typeof b.provenance === 'object') ? b.provenance as Offering['provenance'] : null,
      usageTerms,
      tags: Array.isArray(b.tags) ? (b.tags as unknown[]).filter(t => typeof t === 'string') as string[] : [],
      state: 'listed', createdAt: now, updatedAt: now,
    };
    await putOffering(storage, offering);
    return res.status(201).json(success(config.nodeId, { offering }));
  });

  /**
   * Offering DETAIL (public) — everything a human or agent needs to decide + integrate: the I/O SCHEMA of
   * the underlying action, the CALL RECIPE (the contract IS the access — you call as yourself, no API key),
   * usage terms, provenance, and usage STATS (reputation). One call, so the app/agent needn't stitch it.
   */
  router.get('/v1/exchange/offerings/:id', async (req: Request, res: Response) => {
    const o = await getOffering(storage, str(req.params.id));
    if (!o) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such offering'));
    const extRec = await storage.getExtension(o.ext);
    const act = extRec?.actions.find(a => a.id === o.action);
    const stats = await offeringStats(storage, o);
    return res.json(success(config.nodeId, {
      offering: o,
      capability: act ? {
        input_schema: act.inputSchema ?? {},
        output_schema: act.outputSchema ?? {},
        toll_morsels: act.tollMorsels ?? 0,
      } : null,
      call_recipe: {
        method: 'POST',
        url: `/v1/ext/${o.ext}/${o.action}`,
        auth: 'Your own AIMEAT token — the accepted contract (metered entitlement) authorises the call; no separate API key is issued.',
        note: 'Each call is metered + charged to your budget at the provider price; the provider’s own upstream keys stay server-side.',
        mcp: `aimeat_extension_invoke { "name": "${o.ext}", "action": "${o.action}", "input": { … } }`,
      },
      stats,
    }));
  });

  /**
   * Offering CONSUMERS (provider lineage) — who holds a contract against my offering, how much they consumed,
   * when they last used it. Provider-only: "where is my data used, by whom?".
   */
  router.get('/v1/exchange/offerings/:id/consumers', requireAuth(), async (req: Request, res: Response) => {
    const o = await getOffering(storage, str(req.params.id));
    if (!o || o.providerOwner !== req.auth!.owner) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such offering of yours'));
    const consumers = await offeringConsumers(storage, o);
    return res.json(success(config.nodeId, { offeringId: o.offeringId, consumers, count: consumers.length }));
  });

  /** Browse listed offerings (matching a capability or free text). Public. `?stats=1` folds in usage/reputation. */
  router.get('/v1/exchange/offerings', async (req: Request, res: Response) => {
    const ext = str(req.query.ext), action = str(req.query.action), q = str(req.query.q);
    const offerings = (ext && action) || q
      ? await matchOfferings(storage, { ext: ext || null, action: action || null, text: q || null })
      : await listOfferings(storage);
    if (str(req.query.stats) === '1') {
      const withStats = await Promise.all(offerings.map(async o => ({ ...o, stats: await offeringStats(storage, o) })));
      return res.json(success(config.nodeId, { offerings: withStats, count: withStats.length }));
    }
    return res.json(success(config.nodeId, { offerings, count: offerings.length }));
  });

  /** Delist an offering (owner only). */
  router.delete('/v1/exchange/offerings/:id', requireAuth(), async (req: Request, res: Response) => {
    const o = await getOffering(storage, str(req.params.id));
    if (!o || o.providerOwner !== req.auth!.owner) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such offering of yours'));
    await deleteOffering(storage, o.offeringId);
    return res.json(success(config.nodeId, { offeringId: o.offeringId, state: 'delisted' }));
  });

  // ── NEEDS (demand) ──────────────────────────────────────────────────────────
  /** Post an open need. Providers browse open needs and bid. */
  router.post('/v1/exchange/needs', requireAuth(), async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const description = str(b.description);
    if (!description) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'description is required'));
    const budgetUnit = b.budget_unit === 'money' || b.budget_unit === 'morsels' ? b.budget_unit : null;
    const now = new Date().toISOString();
    const need: Need = {
      needId: newNeedId(),
      requesterGaii: resolveIdentity(req.auth!, config.nodeId),
      requesterOwner: req.auth!.owner,
      appId: str(b.app_id) || null,
      ext: str(b.ext) || null, action: str(b.action) || null,
      description,
      spec: parseNeedSpec(b.spec),
      budgetUnit, budgetCap: posOrNull(b.budget_cap),
      autonomy: b.autonomy === 'auto' ? 'auto' : 'supervised',
      state: 'open', createdAt: now, updatedAt: now,
    };
    await putNeed(storage, need);
    // Surface offerings that already satisfy it (so the requester can accept directly, no bid needed).
    const matches = await matchOfferings(storage, { ext: need.ext, action: need.action, text: need.description });
    return res.status(201).json(success(config.nodeId, { need, matches: matches.slice(0, 10) }));
  });

  /** Browse needs. `?open=1` for open only; `?mine=1` for the caller's own (auth then). */
  router.get('/v1/exchange/needs', async (req: Request, res: Response) => {
    const openOnly = str(req.query.open) === '1';
    const mine = str(req.query.mine) === '1';
    const owner = mine ? (req.auth?.owner ?? undefined) : undefined;
    const needs = await listNeeds(storage, { openOnly, owner });
    return res.json(success(config.nodeId, { needs, count: needs.length }));
  });

  /** Close a need (requester only). */
  router.post('/v1/exchange/needs/:id/close', requireAuth(), async (req: Request, res: Response) => {
    const n = await getNeed(storage, str(req.params.id));
    if (!n || n.requesterOwner !== req.auth!.owner) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such need of yours'));
    n.state = 'closed'; n.updatedAt = new Date().toISOString();
    await putNeed(storage, n);
    return res.json(success(config.nodeId, { needId: n.needId, state: 'closed' }));
  });

  // ── BIDS ────────────────────────────────────────────────────────────────────
  /** A provider bids on an open need (must own the bid's extension). */
  router.post('/v1/exchange/needs/:id/bids', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const n = await getNeed(storage, str(req.params.id));
    if (!n) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such need'));
    if (n.state !== 'open') return res.status(409).json(error(config.nodeId, 'NEED_CLOSED', `Need is ${n.state}`));
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ext = str(b.ext), action = str(b.action);
    if (!ext || !action) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'ext and action are required'));
    const extRec = await storage.getExtension(ext);
    if (!extRec || extRec.installedBy !== owner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Bid only with an action your extension owns'));
    if (!extRec.actions.find(a => a.id === action)) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Action "${action}" not found`));
    const bid: Bid = {
      bidId: newBidId(), needId: n.needId,
      bidderGhii: resolveIdentity(req.auth!, config.nodeId), bidderOwner: owner,
      offeringId: str(b.offering_id) || null, ext, action,
      planId: str(b.plan_id) || null, note: str(b.note),
      state: 'open', createdAt: new Date().toISOString(),
    };
    await putBid(storage, bid);
    return res.status(201).json(success(config.nodeId, { bid }));
  });

  /** List bids on a need (public). */
  router.get('/v1/exchange/needs/:id/bids', async (req: Request, res: Response) => {
    const bids = await listBids(storage, str(req.params.id));
    return res.json(success(config.nodeId, { bids, count: bids.length }));
  });

  /** The requester accepts a bid → mints the entitlement (consumer = requester, provider = bidder). */
  router.post('/v1/exchange/needs/:id/bids/:bidId/accept', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const n = await getNeed(storage, str(req.params.id));
    if (!n || n.requesterOwner !== owner) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such need of yours'));
    const bid = await getBid(storage, n.needId, str(req.params.bidId));
    if (!bid || bid.state !== 'open') return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such open bid'));

    const extRec = await storage.getExtension(bid.ext);
    const act = extRec?.actions.find(a => a.id === bid.action);
    if (!extRec || !act) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Bid capability no longer exists'));
    const priced = resolveActionPricing(act.commercial as ActionCommercial | undefined, bid.planId);
    if (!priced.ok) return res.status(400).json(error(config.nodeId, priced.code, priced.message));

    const capCap = posOrNull((req.body ?? {})?.cap_units) ?? n.budgetCap;
    const existing = await readEntitlementForCall(storage, consumerGaii, bid.ext, bid.action);
    const ent = await createEntitlement(storage, {
      consumerGaii, appId: n.appId, providerGhii: `${extRec.installedBy}@${config.nodeId}`,
      ext: bid.ext, action: bid.action, capabilityLabel: `${bid.ext}/${bid.action}`,
      unit: priced.unit, pricePerCall: priced.pricePerCall, currency: priced.currency, pricing: priced.pricing,
      capUnits: capCap, contractRef: `bid:${bid.bidId}`, createdBy: owner, carrySpend: existing,
    });
    // Mark the bid accepted + the need matched (append updates; other bids stay for the record).
    bid.state = 'accepted'; await putBid(storage, bid);
    n.state = 'matched'; n.updatedAt = new Date().toISOString(); await putNeed(storage, n);
    return res.status(201).json(success(config.nodeId, { entitlement_id: ent.entitlementId, ext: ent.ext, action: ent.action, unit: ent.unit, pricing: ent.pricing }, [
      { description: 'This app’s cost & contracts', method: 'GET', url: n.appId ? `/v1/apps/cost?app_id=${encodeURIComponent(n.appId)}` : '/v1/exchange/entitlements' },
    ]));
  });

  return router;
}
