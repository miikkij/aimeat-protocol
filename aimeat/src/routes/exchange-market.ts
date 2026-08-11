/**
 * @file src/routes/exchange-market.ts
 * @description The two-sided EXCHANGE MARKETPLACE surface (TARGET-045 Phase C): supply (OFFERINGs), demand
 *   (NEEDs), and BIDs against needs — the browse/post/bid/accept flow above the metered entitlement. Pricing
 *   is always AUTHORITATIVE from the provider extension action (resolveActionPricing), so listings and bids
 *   cannot undercut the provider. Accepting a bid mints the durable entitlement (same primitive as the
 *   direct acceptance route). Records are public (browsable); writes are owner-authorised. The heavy
 *   orchestration (agent negotiation, composite assembly) lives in the marketplace app/agent — this router
 *   is the generic store + capability match.
 * @structure exchangeMarketRouter — offerings (POST/GET/GET :id detail/GET :id/odps(.yaml)/GET :id/consumers/
 *   DELETE) · needs (POST/GET/close) · bids (POST/GET/accept) · offeringContext (shared detail/ODPS builder)
 * @usage import { exchangeMarketRouter } from './routes/exchange-market.js'; app.use(exchangeMarketRouter(config, storage));
 * @version-history
 *   v1.5.0 — 2026-07-25 — ODPS v4.1 (TARGET-045 §4): GET /v1/exchange/offerings/{id}/odps(.yaml) projects the
 *     listing as an Open Data Product Specification document; `provenance` is now VALIDATED (400
 *     INVALID_PROVENANCE) instead of cast, and a new `odps` authoring block carries the standard fields the
 *     node cannot derive (400 INVALID_ODPS). Detail + ODPS share one context builder.
 *   v1.4.0 — 2026-07-21 — Needs are app-bound (app_id required → 400 NEED_APP_REQUIRED) + carry an I/O
 *     interface spec (inputSchema/outputSchema) — the emergent app-to-app data-API request.
 *   v1.3.0 — 2026-07-21 — Cross-app selling (Gap 1): `kind: 'app-tool'` listing branch (a provider app sells a
 *     tool as a pinned-interface metered offering) + app-tool offering DETAIL (frozen schema + WebMCP recipe).
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
import { resolvePacingToll } from './extensions/pacing.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';
import {
  type Offering, type Need, type Bid, type ActionCommercial, type UsageTerms, type OfferingPlan,
  resolveActionPricing, newOfferingId, newNeedId, newBidId, appToolCoordinate, agentWorkCoordinate,
  putOffering, getOffering, listOfferings, deleteOffering, matchOfferings, filterOfferings,
  putNeed, getNeed, parseNeedSpec, listNeeds, putBid, listBids, getBid, acceptBid,
  offeringStats, offeringConsumers, enrichNeeds,
} from '../services/exchange-market.js';
import { ProvenanceSchema, OdpsExtrasSchema, type Provenance, type OdpsExtras } from '../models/odps-schemas.js';
import { offeringToOdps, odpsToYaml, ODPS_VERSION } from '../services/exchange-odps.js';
import { AppToolsDocSchema, appToolsKey } from '../models/app-tool-schemas.js';
import { ensureInterfaceVersion, getInterfaceVersion } from '../services/app-tool-interfaces.js';
import { reconcileOwnerOfferings, reconcileOwnerOfferingsThrottled, migrateLegacyOfferings } from '../services/exchange-projection.js';
import { logger } from '../utils/logger.js';

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

/**
 * Parse the provider's provenance attestation. Validated (not cast) because it lands in a PUBLIC record and
 * is republished as ODPS: an unchecked object here would let a provider write arbitrary keys into the market.
 * The node stamps `odpsVersion` so the descriptor always says which ODPS version it follows.
 */
function parseProvenance(v: unknown): { ok: true; value: Provenance | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  const parsed = ProvenanceSchema.safeParse(v);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map(i => `${i.path.join('.') || 'provenance'}: ${i.message}`).join('; ') };
  const value = parsed.data;
  if (!Object.keys(value).length) return { ok: true, value: null };
  return { ok: true, value: { ...value, odpsVersion: value.odpsVersion ?? ODPS_VERSION } };
}

/** Parse the provider's ODPS authoring block (the standard fields the node cannot derive). */
function parseOdpsExtras(v: unknown): { ok: true; value: OdpsExtras | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  const parsed = OdpsExtrasSchema.safeParse(v);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map(i => `${i.path.join('.') || 'odps'}: ${i.message}`).join('; ') };
  return { ok: true, value: Object.keys(parsed.data).length ? parsed.data : null };
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
  /** List a supply offering. Two kinds: an extension action (the raw data-service surface, default) or an
   *  `app-tool` (a method a provider app sells cross-app — a pinned interface version). Pricing is always
   *  authoritative from the provider. Both require a published I/O schema + usage terms (the legibility gate). */
  router.post('/v1/exchange/offerings', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;

    /**
     * Refuse a second listing of a capability this provider already sells.
     *
     * `ext:laake-fi:getPackage` was on the marketplace twice: once as the raw ext-action and once
     * as the app-tool bound to it. Two titles, two descriptors, two completeness scores (77% and
     * 31%) for one call, and nothing telling a buyer they were the same thing — or telling the
     * provider that authoring one left the other bare.
     *
     * Same-kind republishing is untouched: this only fires when the SAME capability would appear
     * under two listings at once, and it names the one that already exists.
     */
    const refuseDuplicate = async (binding: string, kind: Offering['kind']): Promise<Response | null> => {
      if (!binding) return null;
      const mine = (await listOfferings(storage)).filter(
        o => o.providerOwner === owner && o.state === 'listed');
      for (const o of mine) {
        // Re-listing the SAME surface is how a listing is changed — the interface freeze is
        // idempotent and the ODPS block is attached by re-listing — so only a listing of a
        // DIFFERENT kind is a duplicate. That is the case that produced two live records.
        if (o.kind === kind) continue;
        const theirs = o.capabilityBinding
          || (o.kind === 'ext-action' && o.ext && o.action ? `ext:${o.ext}:${o.action}` : null);
        if (theirs && theirs === binding) {
          return res.status(409).json(error(config.nodeId, 'CAPABILITY_ALREADY_LISTED',
            `"${binding}" is already on the marketplace as "${o.title}" (${o.offeringId}, ${o.kind}). `
            + 'One capability, one listing: a second one splits the description, the usage terms and the '
            + 'ODPS descriptor across two records that have to be kept in step, and a buyer cannot tell '
            + 'they are the same call. Take that listing down first, or sell this capability through it.'));
        }
      }
      return null;
    };

    // Provenance + the ODPS authoring block are validated once, before any kind branch: both are provider
    // promises that get republished as an ODPS document, so a malformed one fails the listing loudly (400).
    const prov = parseProvenance(b.provenance);
    if (!prov.ok) return res.status(400).json(error(config.nodeId, 'INVALID_PROVENANCE', `provenance is malformed — ${prov.message}`));
    const odps = parseOdpsExtras(b.odps);
    if (!odps.ok) return res.status(400).json(error(config.nodeId, 'INVALID_ODPS', `odps is malformed — ${odps.message}`));

    // ── kind: app-tool — a provider app sells one of its tools (cross-app selling, Gap 1) ──
    if (b.kind === 'app-tool') {
      const appId = str(b.app_id), toolName = str(b.tool);
      if (!appId || !toolName) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'app_id and tool are required for an app-tool offering'));
      const providerGhii = resolveIdentity(req.auth!, config.nodeId);
      const manifestRec = await storage.getMemory(providerGhii, appToolsKey(appId));
      if (!manifestRec) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${appId}" declares no tool manifest (${appToolsKey(appId)}) under your account`));
      const parsed = AppToolsDocSchema.safeParse(manifestRec.value);
      if (!parsed.success) return res.status(422).json(error(config.nodeId, 'INVALID_TOOL_MANIFEST', `App "${appId}" has a malformed tool manifest: ${parsed.error.message}`));
      const tool = parsed.data.tools.find(t => t.name === toolName);
      if (!tool) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Tool "${toolName}" not found on app "${appId}"`));
      // Gap 1 = synchronous metered calls → the tool MUST be bound to a capability. Unbound (task) tools are
      // agent-work (metered-per-task, Gap 2) and are offered through the agent-work path, not here.
      if (!tool.action_id) return res.status(400).json(error(config.nodeId, 'TOOL_UNBOUND', `Tool "${toolName}" has no capability binding (action_id); only callable tools can be offered as a metered service today`));
      // LEGIBILITY GATE (same as ext-action): input + output schema + usage terms are mandatory to list.
      if (!hasSchema(tool.inputSchema) || !hasSchema(tool.outputSchema)) {
        return res.status(400).json(error(config.nodeId, 'SCHEMA_REQUIRED',
          `Tool "${appId}/${toolName}" must declare a non-empty inputSchema AND outputSchema before it can be offered on EXCHANGE (a consumer must know what to send and receive)`));
      }
      const usageTerms = parseUsageTerms(b.usage_terms);
      if (!usageTerms) return res.status(400).json(error(config.nodeId, 'USAGE_TERMS_REQUIRED',
        'usage_terms is required to list an offering — state { derivatives, resale, attribution, note? } so a consumer knows how they may use the output'));
      // Authoritative pricing from the tool's own price/plans.
      const commercial: ActionCommercial = {
        payMorsels: tool.price && tool.price.morsels > 0 ? tool.price.morsels : undefined,
        payMoney: tool.priceMoney ?? undefined,
        plans: tool.plans as OfferingPlan[] | undefined,
      };
      const priced = resolveActionPricing(commercial, null);
      if (!priced.ok) return res.status(400).json(error(config.nodeId, priced.code, `Tool "${appId}/${toolName}": ${priced.message}`));
      // Snapshot / pin the interface version (idempotent when unchanged; a schema/binding change mints v+1).
      const iface = await ensureInterfaceVersion(storage, providerGhii, appId, toolName, {
        inputSchema: tool.inputSchema ?? {}, outputSchema: tool.outputSchema ?? {}, binding: tool.action_id,
      });
      const dup = await refuseDuplicate(tool.action_id, 'app-tool');
      if (dup) return dup;
      const coord = appToolCoordinate(owner, appId, toolName);
      const now = new Date().toISOString();
      const offering: Offering = {
        offeringId: newOfferingId(), providerGhii, providerOwner: owner,
        kind: 'app-tool', ext: coord.ext, action: coord.action,
        capabilityBinding: tool.action_id,
        surface: { kind: 'app-tool', ownerName: owner, appId, tool: toolName, ifaceVersion: iface.ifaceVersion },
        title: str(b.title) || `${appId} · ${toolName}`,
        description: str(b.description) || tool.description || '',
        unit: priced.unit, basePrice: priced.pricePerCall, currency: priced.currency,
        plans: commercial.plans ?? [],
        provenance: prov.value, odps: odps.value,
        usageTerms,
        tags: Array.isArray(b.tags) ? (b.tags as unknown[]).filter(t => typeof t === 'string') as string[] : [],
        state: 'listed', createdAt: now, updatedAt: now,
      };
      await putOffering(storage, offering);
      return res.status(201).json(success(config.nodeId, { offering }));
    }

    // ── kind: agent-work — a provider AGENT sells a task type it performs (metered per delivered task, Gap 2) ──
    if (b.kind === 'agent-work') {
      const agentName = str(b.agent_name), taskType = str(b.task_type);
      if (!agentName || !taskType) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'agent_name and task_type are required for an agent-work offering'));
      const agentGaii = `${agentName}#${owner}@${config.nodeId}`;
      const agent = await storage.getAgent(agentGaii);
      if (!agent) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent "${agentName}" not found under your account`));
      // Legibility gate: the task interface (what you send / what the agent delivers) + usage terms are mandatory.
      const inSchema = (b.input_schema && typeof b.input_schema === 'object') ? b.input_schema as Record<string, unknown> : {};
      const outSchema = (b.output_schema && typeof b.output_schema === 'object') ? b.output_schema as Record<string, unknown> : {};
      if (!hasSchema(inSchema) || !hasSchema(outSchema)) {
        return res.status(400).json(error(config.nodeId, 'SCHEMA_REQUIRED',
          `Agent-work "${agentName}:${taskType}" must declare a non-empty input_schema AND output_schema (a consumer must know what to send and what the agent delivers)`));
      }
      const usageTerms = parseUsageTerms(b.usage_terms);
      if (!usageTerms) return res.status(400).json(error(config.nodeId, 'USAGE_TERMS_REQUIRED',
        'usage_terms is required to list an offering — state { derivatives, resale, attribution, note? }'));
      // Pricing is authoritative from the provider (set on the listing): per-task morsels or money + optional plans.
      const commercial: ActionCommercial = {
        payMorsels: typeof b.price_morsels === 'number' && b.price_morsels > 0 ? Math.floor(b.price_morsels) : undefined,
        payMoney: (b.price_money && typeof b.price_money === 'object') ? b.price_money as ActionCommercial['payMoney'] : undefined,
        plans: Array.isArray(b.plans) ? b.plans as OfferingPlan[] : undefined,
      };
      const priced = resolveActionPricing(commercial, null);
      if (!priced.ok) return res.status(400).json(error(config.nodeId, priced.code, `Agent-work "${agentName}:${taskType}": ${priced.message}`));
      const providerGhii = resolveIdentity(req.auth!, config.nodeId);
      const coord = agentWorkCoordinate(owner, agentName, taskType);
      const now = new Date().toISOString();
      const offering: Offering = {
        offeringId: newOfferingId(), providerGhii, providerOwner: owner,
        kind: 'agent-work', ext: coord.ext, action: coord.action,
        surface: { kind: 'agent-work', ownerName: owner, agentName, taskType },
        title: str(b.title) || `${agentName}: ${taskType}`,
        description: str(b.description) || agent.description || '',
        unit: priced.unit, basePrice: priced.pricePerCall, currency: priced.currency,
        plans: commercial.plans ?? [],
        taskSpec: { inputSchema: inSchema, outputSchema: outSchema },
        provenance: prov.value, odps: odps.value,
        usageTerms,
        tags: Array.isArray(b.tags) ? (b.tags as unknown[]).filter(t => typeof t === 'string') as string[] : [],
        state: 'listed', createdAt: now, updatedAt: now,
      };
      await putOffering(storage, offering);
      return res.status(201).json(success(config.nodeId, { offering }));
    }

    // ── kind: ext-action (default) — the raw data-service surface ──
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
    const dupExt = await refuseDuplicate(`ext:${ext}:${action}`, 'ext-action');
    if (dupExt) return dupExt;
    const now = new Date().toISOString();
    const offering: Offering = {
      offeringId: newOfferingId(),
      providerGhii: resolveIdentity(req.auth!, config.nodeId),
      providerOwner: owner,
      kind: 'ext-action', surface: null,
      ext, action,
      capabilityBinding: `ext:${ext}:${action}`,
      title: str(b.title) || `${ext}/${action}`,
      description: str(b.description),
      unit: priced.unit, basePrice: priced.pricePerCall, currency: priced.currency,
      plans: (act.commercial as ActionCommercial | undefined)?.plans ?? [],
      provenance: prov.value, odps: odps.value,
      usageTerms,
      tags: Array.isArray(b.tags) ? (b.tags as unknown[]).filter(t => typeof t === 'string') as string[] : [],
      state: 'listed', createdAt: now, updatedAt: now,
    };
    await putOffering(storage, offering);
    return res.status(201).json(success(config.nodeId, { offering }));
  });

  /**
   * The full decision + integration context for one offering: the capability's I/O SCHEMA, the CALL RECIPE
   * (the contract IS the access — you call as yourself, no API key) and the usage STATS. Shared by the JSON
   * detail route and the ODPS projection, so the two can never describe the same offering differently.
   */
  async function offeringContext(o: Offering): Promise<{
    capability: Record<string, unknown> | null;
    iface: { inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> } | null;
    callRecipe: Record<string, unknown> & { method: string; url: string; mcp?: string; note?: string };
    stats: Awaited<ReturnType<typeof offeringStats>>;
    /** The provider's declared pacing burn, read live from the source (null = the node's default). */
    tollMorsels: number | null;
  }> {
    const stats = await offeringStats(storage, o);
    // The listing is the source for app-tool and agent-work (the provider authored it there); a raw ext
    // action is read live from the extension below, the same way its price is.
    const tollMorsels = o.tollMorsels ?? null;

    // app-tool: the capability schema is the PINNED interface snapshot; the call goes to the WebMCP invoke
    // endpoint (the accepted contract meters it). This is the freeze made visible — the version is explicit.
    if (o.kind === 'app-tool' && o.surface && o.surface.kind === 'app-tool') {
      const s = o.surface;
      const iface = await getInterfaceVersion(storage, o.providerGhii, s.appId, s.tool, s.ifaceVersion);
      return {
        capability: iface ? {
          kind: 'app-tool', app: `${s.ownerName}/${s.appId}`, tool: s.tool, iface_version: s.ifaceVersion,
          input_schema: iface.inputSchema, output_schema: iface.outputSchema,
        } : null,
        iface: iface ? { inputSchema: iface.inputSchema, outputSchema: iface.outputSchema } : null,
        callRecipe: {
          method: 'POST',
          url: `/v1/apps/${encodeURIComponent(s.ownerName)}/${encodeURIComponent(s.appId)}/webmcp/tools/${encodeURIComponent(s.tool)}`,
          auth: 'Your own AIMEAT token — the accepted contract (metered entitlement) authorises the call; no separate API key is issued.',
          note: `Each call is metered + charged to your budget at the provider price. The contract is pinned to interface v${s.ifaceVersion}; the provider may ship newer app versions without breaking your integration.`,
          body: '{ "input": { … } }',
        },
        stats, tollMorsels,
      };
    }

    // agent-work: the "capability" is the task interface; the call recipe is "start work → agent delivers".
    if (o.kind === 'agent-work' && o.surface && o.surface.kind === 'agent-work') {
      const s = o.surface;
      return {
        capability: o.taskSpec ? { kind: 'agent-work', agent: `${s.ownerName}/${s.agentName}`, task_type: s.taskType,
          input_schema: o.taskSpec.inputSchema, output_schema: o.taskSpec.outputSchema } : null,
        iface: o.taskSpec ? { inputSchema: o.taskSpec.inputSchema, outputSchema: o.taskSpec.outputSchema } : null,
        callRecipe: {
          method: 'POST', url: '/v1/exchange/work',
          body: `{ "offering_id": "${o.offeringId}", "input": { … } }`,
          auth: 'Your own AIMEAT token — the accepted contract authorises starting work; no separate API key.',
          note: `Async: you START a task, the provider agent (${s.agentName}) DELIVERS, and you are charged the per-task price ON DELIVERY (metered + rake against your budget).`,
        },
        stats, tollMorsels,
      };
    }

    // ext-action: schema comes live from the provider's extension action.
    const extRec = await storage.getExtension(o.ext);
    const act = extRec?.actions.find(a => a.id === o.action);
    return {
      capability: act ? {
        input_schema: act.inputSchema ?? {},
        output_schema: act.outputSchema ?? {},
        toll_morsels: act.tollMorsels ?? 0,
      } : null,
      iface: act ? { inputSchema: (act.inputSchema ?? {}) as Record<string, unknown>, outputSchema: (act.outputSchema ?? {}) as Record<string, unknown> } : null,
      callRecipe: {
        method: 'POST',
        url: `/v1/ext/${o.ext}/${o.action}`,
        auth: 'Your own AIMEAT token — the accepted contract (metered entitlement) authorises the call; no separate API key is issued.',
        note: 'Each call is metered + charged to your budget at the provider price; the provider’s own upstream keys stay server-side.',
        mcp: `aimeat_extension_invoke { "name": "${o.ext}", "action": "${o.action}", "input": { … } }`,
      },
      stats, tollMorsels: act?.tollMorsels ?? null,
    };
  }

  /**
   * Offering DETAIL (public) — everything a human or agent needs to decide + integrate: the I/O SCHEMA of
   * the underlying action, the CALL RECIPE (the contract IS the access — you call as yourself, no API key),
   * usage terms, provenance, and usage STATS (reputation). One call, so the app/agent needn't stitch it.
   */
  router.get('/v1/exchange/offerings/:id', async (req: Request, res: Response) => {
    const o = await getOffering(storage, str(req.params.id));
    if (!o) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such offering'));
    const ctx = await offeringContext(o);
    return res.json(success(config.nodeId, {
      offering: o, capability: ctx.capability, call_recipe: ctx.callRecipe, stats: ctx.stats,
      // Stated before the contract is signed, because it changes what a call costs the CONSUMER even
      // though it moves nothing to the provider. `source` says who set it: the seller, or the node.
      pacing: {
        toll_morsels: resolvePacingToll(config, ctx.tollMorsels),
        source: typeof ctx.tollMorsels === 'number' && ctx.tollMorsels >= 0 ? 'capability' : 'node',
        note: 'Morsels burned per call to bound consumption rate. A burn, not revenue: nobody is credited it, '
          + 'and calling your own capability is free.',
      },
      odps: { version: ODPS_VERSION, url: `/v1/exchange/offerings/${o.offeringId}/odps.yaml` },
    }));
  });

  /**
   * The offering as an **Open Data Product Specification v4.1** document (opendataproducts.org, Linux
   * Foundation) — the interoperable descriptor an outside catalogue or a negotiating agent can read without
   * knowing anything about AIMEAT. Public, like the listing itself. Derived on read (never stored in ODPS
   * form), so it cannot drift from the offering it describes. `.yaml` serves the spec's native format;
   * `/odps` serves the same document as JSON inside the standard AIMEAT envelope (`?format=yaml` for raw).
   * AIMEAT-specific truth (metered coordinate, pinned interface, provenance, observed usage) travels under
   * `product.x-aimeat`, which keeps the document valid against the official schema.
   */
  async function serveOdps(req: Request, res: Response, format: 'yaml' | 'json'): Promise<Response> {
    const o = await getOffering(storage, str(req.params.id));
    if (!o) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such offering'));
    const ctx = await offeringContext(o);
    const doc = offeringToOdps({
      offering: o, iface: ctx.iface, callRecipe: ctx.callRecipe, stats: ctx.stats,
      rakePercent: commerceFeePercent(config), baseUrl: config.baseUrl, nodeId: config.nodeId,
    });
    if (format === 'json') return res.json(success(config.nodeId, { odps_version: ODPS_VERSION, odps: doc }));
    res.type('text/yaml; charset=utf-8');
    return res.send(odpsToYaml(doc));
  }

  router.get('/v1/exchange/offerings/:id/odps.yaml', (req: Request, res: Response) => serveOdps(req, res, 'yaml'));
  router.get('/v1/exchange/offerings/:id/odps', (req: Request, res: Response) =>
    serveOdps(req, res, str(req.query.format) === 'yaml' ? 'yaml' : 'json'));

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
    // Safety net for the source-of-truth model: bring the CALLER's own projections up to date before
    // they read the market (bounded to one owner — a browse never reconciles the whole node).
    if (req.auth) {
      await reconcileOwnerOfferingsThrottled(storage, resolveIdentity(req.auth, config.nodeId))
        .catch(err => { logger.warn('GET /v1/exchange/offerings: a stale projection must never break browsing', { error: String(err) }); });
    }
    const ext = str(req.query.ext), action = str(req.query.action), q = str(req.query.q);
    // ANY supplied filter routes to the matcher. Requiring ext AND action together meant
    // `?ext=` alone fell through to "list everything", which reads as "this provider sells the
    // whole market". A filter the server accepts and drops is worse than one it rejects.
    const offerings = ext || action || q
      ? await filterOfferings(storage, { ext: ext || null, action: action || null, text: q || null })
      : await listOfferings(storage);
    if (str(req.query.stats) === '1') {
      const withStats = await Promise.all(offerings.map(async o => ({ ...o, stats: await offeringStats(storage, o) })));
      return res.json(success(config.nodeId, { offerings: withStats, count: withStats.length }));
    }
    return res.json(success(config.nodeId, { offerings, count: offerings.length }));
  });

  /**
   * Delist an offering (owner only). A PROJECTED listing (`auto`) exists because its source says so, so
   * delisting it by hand would come straight back on the next reconcile — the honest answer is to turn the
   * source's `exchange` flag off, and that is what this reports (409) instead of lying about the outcome.
   */
  router.delete('/v1/exchange/offerings/:id', requireAuth(), async (req: Request, res: Response) => {
    const o = await getOffering(storage, str(req.params.id));
    if (!o || o.providerOwner !== req.auth!.owner) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such offering of yours'));
    if (o.auto && str(req.query.force) !== '1') {
      return res.status(409).json(error(config.nodeId, 'SOURCE_MANAGED',
        `This listing is projected from its source (${o.ext}/${o.action}). Turn "exchange" off there (app-catalog → app details → app tools, the extension action, or the agent offer) and it is removed. Pass ?force=1 to delist until the next reconcile.`));
    }
    await deleteOffering(storage, o.offeringId);
    return res.json(success(config.nodeId, { offeringId: o.offeringId, state: 'delisted' }));
  });

  /**
   * Reconcile the caller's own listings against their sources (TARGET-050). Normally automatic — writing a
   * tool manifest, an extension or an offer projects it — this is the explicit handle: a `dry_run` report
   * before anything changes, and `migrate` to adopt hand-authored listings into the projection model
   * (flag their source, keep their offeringId so existing contracts keep resolving).
   */
  router.post('/v1/exchange/reconcile', requireAuth(), async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const dryRun = b.dry_run === true || str(req.query.dry_run) === '1';
    const migrate = b.migrate === true || str(req.query.migrate) === '1';
    const ownerGhii = resolveIdentity(req.auth!, config.nodeId);
    const report = migrate
      ? await migrateLegacyOfferings(storage, ownerGhii, { dryRun })
      : await reconcileOwnerOfferings(storage, ownerGhii, {
          dryRun,
          ...(str(b.app_id) ? { appId: str(b.app_id) } : {}),
          ...(str(b.ext) ? { extName: str(b.ext) } : {}),
          ...(str(b.agent) ? { agentName: str(b.agent) } : {}),
        });
    return res.json(success(config.nodeId, report, [
      { description: 'Browse the marketplace', method: 'GET', url: '/v1/exchange/offerings' },
    ]));
  });

  // ── NEEDS (demand) ──────────────────────────────────────────────────────────
  /** Post an open need. Providers browse open needs and bid. */
  router.post('/v1/exchange/needs', requireAuth(), async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const description = str(b.description);
    if (!description) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'description is required'));
    // A need is ALWAYS posted on behalf of a specific app — the app that needs data/a method it can't produce
    // itself. This binds the demand to a requester a provider can judge (per the emergent app-to-app market).
    const appId = str(b.app_id);
    if (!appId) return res.status(400).json(error(config.nodeId, 'NEED_APP_REQUIRED',
      'app_id is required — a need is posted on behalf of the specific app that needs the data (owner/filename)'));
    const budgetUnit = b.budget_unit === 'money' || b.budget_unit === 'morsels' ? b.budget_unit : null;
    const now = new Date().toISOString();
    const need: Need = {
      needId: newNeedId(),
      requesterGaii: resolveIdentity(req.auth!, config.nodeId),
      requesterOwner: req.auth!.owner,
      appId,
      ext: str(b.ext) || null, action: str(b.action) || null,
      description,
      spec: parseNeedSpec(b.spec),
      usageIntent: str(b.usage_intent) || null,
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
    const needs = await enrichNeeds(storage, await listNeeds(storage, { openOnly, owner }));
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

    const out = await acceptBid({ storage, config }, {
      needId: n.needId, bidId: bid.bidId, consumerGaii, owner,
      capUnits: posOrNull((req.body ?? {})?.cap_units),
    });
    if (!out.ok) return res.status(out.status).json(error(config.nodeId, out.code, out.message));
    return res.status(201).json(success(config.nodeId,
      { entitlement_id: out.entitlementId, ext: out.ext, action: out.action, unit: out.unit, pricing: out.pricing }, [
        { description: 'This app’s cost & contracts', method: 'GET', url: n.appId ? `/v1/apps/cost?app_id=${encodeURIComponent(n.appId)}` : '/v1/exchange/entitlements' },
      ]));
  });

  return router;
}
