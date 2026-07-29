/**
 * @file src/services/exchange-market.ts
 * @description The two-sided EXCHANGE marketplace records (TARGET-045 Phase C) — the DEMAND + SUPPLY sides
 *   that sit above the metered entitlement (the contract). Three public, memory-backed record types the
 *   marketplace app + agents read/write; matching + negotiation live in the app/agent layer (this service
 *   is the generic store + a simple capability match, per "node holds refined data, not orchestration"):
 *     - OFFERING — a provider's public supply listing: a capability (ext/action) + pricing (base + plans) +
 *       provenance + an optional ODPS authoring block. Discoverable by any consumer, and projectable into
 *       a full ODPS v4.1 document (services/exchange-odps.ts).
 *     - NEED — a consumer/app's open demand: a wanted capability + budget + autonomy. Providers browse open
 *       needs and BID.
 *     - BID — a provider's offer against a NEED (links an OFFERING + proposed terms). The requester accepts
 *       one → the acceptance flow mints the entitlement.
 *   Keys: `exchange.offering.{id}` / `exchange.need.{id}` / `exchange.bid.{needId}.{id}` — public so the
 *   marketplace is browsable; ownership is the record's provider/requester GHII (authorised by the routes).
 * @structure Offering·Need·Bid types · UsageTerms·NeedSpec · put/get/list/delete for each · matchOfferings ·
 *   offeringStats (reputation) · offeringConsumers (provider data-lineage)
 * @usage import { putOffering, listOfferings, matchOfferings, putNeed, listOpenNeeds, putBid } from './exchange-market.js';
 * @version-history
 *   v1.10.0 — 2026-07-27 — A consumer row carries its `callers` breakdown: the row is the human who
 *     pays, and underneath it their agents, apps and their own direct calls.
 *   v1.9.0 — 2026-07-27 — Consumer lineage marks GRANTS (`granted`, `carriedUnits`): a guest belongs on
 *     the same list as a customer, or a provider reads a consumption log with the consumption they are
 *     paying for missing from it.
 *   v1.8.0 — 2026-07-27 — Usage stats and consumer lineage match on the RAIL as well as the coordinate.
 *     A dual-priced capability projects two offerings over one (provider, ext, action), so each listing
 *     was showing the other's contracts and `totalSettledUnits` summed morsels and EUR micro-units into
 *     one figure documented as "in the offering's unit".
 *   v1.7.0 — 2026-07-25 — Pacing is per capability: Offering carries `tollMorsels` and the pricing
 *     resolver hands it to the contract, so a provider — not only the node — sets the brake.
 *   v1.6.0 — 2026-07-25 — ODPS v4.1 adoption (TARGET-045 §4 / addendum Q2+Q3): Provenance (now with
 *     transformations + SHA-256 snapshot hash + lineage) and the new `odps` authoring block move to
 *     models/odps-schemas.ts as validated schemas; Offering gains `odps`.
 *   v1.5.0 — 2026-07-21 — Agent-work surface (Gap 2): Offering.kind gains 'agent-work' + AgentWorkSurface +
 *     agentWorkCoordinate + Offering.taskSpec; resolveOfferingPricing covers agent-work (DATA/SERVICES/AGENT WORK).
 *   v1.4.0 — 2026-07-21 — Demand side as an emergent interface request: NeedSpec gains input/outputSchema
 *     (the shape the app sends/expects — a provider builds a matching app-tool). A need is app-bound.
 *   v1.3.0 — 2026-07-21 — Needs app-context: Need.usageIntent + enrichNeeds (resolve the requesting app's
 *     name/description so a provider can judge who they'd serve before offering).
 *   v1.2.0 — 2026-07-21 — Cross-app selling (Gap 1): Offering.kind ('ext-action'|'app-tool') + AppToolSurface
 *     (pinned interface); appToolCoordinate + offeringToCommercial + resolveOfferingPricing (shared mint path).
 *   v1.1.0 — 2026-07-20 — Legibility layer: UsageTerms + NeedSpec on records; offeringStats (usage/reputation)
 *     + offeringConsumers (provider lineage) derived from entitlements (no metrics table).
 *   v1.0.0 — 2026-07-20 — Initial marketplace records (offering/need/bid) + capability matching (Phase C).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { listEntitlementsByProvider, type EntitlementUnit, type PricingSpec, type AppToolSurface, type AgentWorkSurface, type SellableSurface } from './metered-entitlements.js';
import type { Provenance, OdpsExtras } from '../models/odps-schemas.js';
import { readCallTiming } from './call-timing.js';
import { logger } from '../utils/logger.js';

export type { AppToolSurface, AgentWorkSurface, SellableSurface };

/** The action `commercial` block an offering/contract prices against. */
export interface ActionCommercial {
  payMorsels?: number;
  payMoney?: { amount: number; currency: string };
  plans?: OfferingPlan[];
}

/**
 * Resolve the AUTHORITATIVE unit + per-call price + (optional plan) pricing spec from a provider action's
 * commercial block — the single source of truth shared by the acceptance route AND bid-accept, so a
 * consumer can never undercut the provider. Money (payMoney) takes precedence over morsels.
 */
export function resolveActionPricing(
  comm: ActionCommercial | undefined, planId: string | null,
): { ok: true; unit: EntitlementUnit; pricePerCall: number; currency: string | null; pricing: PricingSpec | null }
  | { ok: false; code: string; message: string } {
  const money = comm?.payMoney;
  let unit: EntitlementUnit; let pricePerCall: number; let currency: string | null = null;
  if (money && typeof money.amount === 'number' && Number.isInteger(money.amount) && money.amount > 0) {
    unit = 'money'; pricePerCall = money.amount; currency = money.currency;
  } else if (typeof comm?.payMorsels === 'number' && Number.isInteger(comm.payMorsels) && comm.payMorsels > 0) {
    unit = 'morsels'; pricePerCall = comm.payMorsels;
  } else {
    return { ok: false, code: 'NOT_PRICED', message: 'Action has no price; only priced actions are contractable' };
  }
  let pricing: PricingSpec | null = null;
  if (planId) {
    const plan = (comm?.plans ?? []).find(p => p.id === planId);
    if (!plan) return { ok: false, code: 'PLAN_NOT_FOUND', message: `No plan "${planId}" on this action` };
    if (plan.model === 'bundle') {
      pricing = { model: 'bundle', blockSize: plan.blockSize, blockPrice: plan.blockPrice, callsRemaining: 0 };
    } else if (plan.model === 'subscription') {
      const epoch = new Date(0).toISOString();
      pricing = { model: 'subscription', periodSeconds: plan.periodSeconds, periodPrice: plan.periodPrice, callsPerWindow: plan.callsPerWindow, windowSeconds: plan.windowSeconds, validUntil: epoch, windowStart: epoch, windowCount: 0 };
    }
  }
  return { ok: true, unit, pricePerCall, currency, pricing };
}

/** A provider pricing plan surfaced on an offering (mirrors the action's commercial.plans). */
export type OfferingPlan =
  | { id: string; model: 'per_call' }
  | { id: string; model: 'bundle'; blockSize: number; blockPrice: number }
  | { id: string; model: 'subscription'; periodSeconds: number; periodPrice: number; callsPerWindow: number; windowSeconds: number };

/**
 * Provenance attestation + the ODPS authoring block. Both are defined (and validated) in
 * `models/odps-schemas.ts` and re-exported here so the offering record stays the single import site.
 * A PROMISE by the provider, not a platform guarantee — but structured, attributed and projectable
 * into the ODPS v4.1 document served at `/v1/exchange/offerings/{id}/odps.yaml`.
 */
export type { Provenance, OdpsExtras };

/**
 * How a consumer may use the delivered data — the consent-forward half of provenance. A provider PROMISE
 * surfaced to the consumer BEFORE they contract, so "may I refine and resell this downstream?" is answered
 * up front (it is not enforced by the node — it is the stated licence the contract is accepted under).
 */
export interface UsageTerms {
  derivatives: boolean;        // may the consumer build derivative works from the output?
  resale: boolean;             // may the consumer resell / redistribute the raw or derived output?
  attribution: boolean;        // must the consumer attribute the source?
  note?: string;               // free-text nuance (e.g. "internal analytics only")
}

/**
 * The interface a requesting app is WAITING to call — what makes a NEED an emergent, machine-matchable
 * data-API request rather than a wish. The app declares the exact shape it will SEND and the shape it EXPECTS
 * back; a provider builds a matching app-tool (or extension) whose I/O satisfies it. `inputSchema`/`outputSchema`
 * are the precise contract (like an offering's); `requiredFields`/`format`/`sample` are the light human hints.
 */
export interface NeedSpec {
  requiredFields: string[];    // fields the output MUST contain to be acceptable (light hint)
  format?: string;             // desired shape, e.g. 'JSON array of { name, businessId }' (light hint)
  sample?: string;             // an example of an acceptable response (illustrative)
  notes?: string;              // constraints (freshness, coverage, rate) the fulfilment must meet
  inputSchema?: Record<string, unknown>;   // the shape the app will SEND on each call (the request contract)
  outputSchema?: Record<string, unknown>;  // the shape the app EXPECTS back (the response contract to match)
}

/** A public supply listing. `kind` distinguishes a raw extension action (the original surface) from an
 *  app-tool (a method a provider app sells cross-app). For BOTH, `ext`/`action` hold the metered COORDINATE
 *  (app-tool uses `apptool:{owner}/{appId}` + the tool name) so the entitlement + stats machinery is shared. */
export interface Offering {
  offeringId: string;
  providerGhii: string;
  providerOwner: string;
  kind: 'ext-action' | 'app-tool' | 'agent-work';
  ext: string;
  action: string;
  surface: SellableSurface | null;   // app-tool (pinned interface) or agent-work (task type); null for ext-action
  title: string;
  description: string;
  unit: EntitlementUnit;
  basePrice: number;            // per-call/task, in `unit` (micros for money, morsels otherwise)
  currency: string | null;
  plans: OfferingPlan[];
  /** For kind==='agent-work': the task interface (what the consumer sends / the agent delivers). */
  taskSpec?: { inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> } | null;
  /**
   * The underlying capability this listing sells, as `ext:<extension>:<action>`.
   *
   * An ext-action listing and an app-tool listing can resolve to the SAME call — the tool's
   * `action_id` binding IS that action — and until this was recorded nothing connected them. The
   * marketplace showed one capability twice, under two titles, with two descriptors that had to be
   * authored and kept in step separately. Buyers cannot tell they are the same call.
   *
   * Absent on offerings listed before this existed, and on agent-work, which has no extension
   * behind it.
   */
  capabilityBinding?: string | null;
  provenance: Provenance | null;
  /**
   * Morsels burned per call on top of whatever this offering is paid in — the provider's own pacing.
   * Projected from the source and captured into the contract at accept, so changing it later governs
   * new contracts while existing ones keep the terms they were signed at.
   */
  tollMorsels?: number | null;
  usageTerms: UsageTerms | null;   // how the consumer may use the output (derivatives/resale/attribution)
  /**
   * The provider's ODPS authoring block — the Open Data Product Specification fields the node cannot derive
   * (value proposition, categories, standards, use cases, sample, SLA + data-quality COMMITMENTS, the legal
   * data holder, jurisdiction/exit terms). Optional: without it the listing still projects a valid, thinner
   * ODPS v4.1 document at `/v1/exchange/offerings/{id}/odps.yaml`.
   */
  odps?: OdpsExtras | null;
  tags: string[];
  state: 'listed' | 'delisted';
  /**
   * TARGET-050 — this listing is a PROJECTION of its source (the app-tool manifest, the extension action
   * or the agent's offer), not a hand-authored snapshot: the source's `exchange` flag put it here and the
   * source's price/labels flow into it. `sourceHash` is the content identity of that source at the last
   * reconcile, so a change is detectable without re-writing every listing. A CONTRACT is never a
   * projection — it stays pinned to the interface version and price it was signed at.
   */
  auto?: boolean;
  sourceHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The metered coordinate for an app-tool surface — the (ext, action) pair the entitlement + gate key on. */
export function appToolCoordinate(ownerName: string, appId: string, tool: string): { ext: string; action: string } {
  return { ext: `apptool:${ownerName}/${appId}`, action: tool };
}

/** The metered coordinate for an agent-work surface (a provider agent's task type; settled per delivered task). */
export function agentWorkCoordinate(ownerName: string, agentName: string, taskType: string): { ext: string; action: string } {
  return { ext: `agentwork:${ownerName}/${agentName}`, action: taskType };
}

/** Build an ActionCommercial from an offering's stored price/plans, so the shared pricing resolver
 *  (resolveActionPricing) works for app-tool offerings too — the offering's listing IS the authoritative price. */
export function offeringToCommercial(o: Offering): ActionCommercial {
  return {
    payMorsels: o.unit === 'morsels' ? o.basePrice : undefined,
    payMoney: o.unit === 'money' ? { amount: o.basePrice, currency: o.currency ?? 'EUR' } : undefined,
    plans: o.plans,
  };
}

/**
 * Resolve the authoritative pricing + metered coordinate to mint a contract from an offering — shared by the
 * REST and MCP accept flows, for BOTH kinds. For app-tool the price comes from the offering's own listing;
 * for ext-action it comes LIVE from the provider's extension action (so the provider's current price wins).
 */
export async function resolveOfferingPricing(
  storage: Storage, o: Offering, planId: string | null,
): Promise<
  | { ok: true; unit: EntitlementUnit; pricePerCall: number; currency: string | null; pricing: PricingSpec | null;
      providerGhii: string; ext: string; action: string; capabilityLabel: string; surface: SellableSurface | null;
      tollMorsels: number | null }
  | { ok: false; status: number; code: string; message: string }
> {
  // app-tool + agent-work both price from the offering's own listing (the provider authored it).
  if ((o.kind === 'app-tool' || o.kind === 'agent-work') && o.surface) {
    const priced = resolveActionPricing(offeringToCommercial(o), planId);
    if (!priced.ok) return { ok: false, status: 400, code: priced.code, message: priced.message };
    const label = o.surface.kind === 'app-tool'
      ? `${o.surface.appId}/${o.surface.tool} v${o.surface.ifaceVersion}`
      : `${o.surface.agentName}:${o.surface.taskType}`;
    return {
      ok: true, unit: priced.unit, pricePerCall: priced.pricePerCall, currency: priced.currency, pricing: priced.pricing,
      providerGhii: o.providerGhii, ext: o.ext, action: o.action, capabilityLabel: label, surface: o.surface,
      tollMorsels: o.tollMorsels ?? null,
    };
  }
  // ext-action: authoritative LIVE price from the provider's extension action.
  const extRec = await storage.getExtension(o.ext);
  const act = extRec?.actions.find(a => a.id === o.action);
  if (!extRec || !act) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Offering capability no longer exists' };
  const priced = resolveActionPricing(act.commercial as ActionCommercial | undefined, planId);
  if (!priced.ok) return { ok: false, status: 400, code: priced.code, message: priced.message };
  return {
    ok: true, unit: priced.unit, pricePerCall: priced.pricePerCall, currency: priced.currency, pricing: priced.pricing,
    providerGhii: o.providerGhii, ext: o.ext, action: o.action, capabilityLabel: `${o.ext}/${o.action}`, surface: null,
    // The action is the live source for a raw ext offering — its declared toll, not the listing's copy.
    tollMorsels: act.tollMorsels ?? null,
  };
}

/** A public demand posting. */
export interface Need {
  needId: string;
  requesterGaii: string;
  requesterOwner: string;
  appId: string | null;
  ext: string | null;           // desired capability (may be null when only a description is known)
  action: string | null;
  description: string;
  spec: NeedSpec | null;        // the minimum shape a fulfilment must return (makes the need answerable)
  usageIntent: string | null;   // how the requester will USE the data — lets a provider judge before serving
  budgetUnit: EntitlementUnit | null;
  budgetCap: number | null;
  autonomy: 'supervised' | 'auto';
  state: 'open' | 'matched' | 'closed';
  createdAt: string;
  updatedAt: string;
}

/** A need enriched with the requesting app's identity + purpose, so a provider knows WHO/WHAT they'd serve. */
export interface NeedWithContext extends Need {
  appContext: { app: string; name: string; description: string } | null;
}

/**
 * Attach app context to needs: when a need names a requesting app (`appId` = "owner/filename" or a bare
 * filename under the requester), resolve that app's published name + description so a provider can judge the
 * consumer before offering (per "do I even want to serve an app that misuses the data?"). Best-effort — a
 * need without a resolvable app gets `appContext: null` and is grouped under its requester instead.
 */
export async function enrichNeeds(storage: Storage, needs: Need[]): Promise<NeedWithContext[]> {
  const cache = new Map<string, { app: string; name: string; description: string } | null>();
  const out: NeedWithContext[] = [];
  for (const n of needs) {
    let appContext: NeedWithContext['appContext'] = null;
    if (n.appId) {
      const ref = n.appId.includes('/') ? n.appId : `${n.requesterOwner}/${n.appId}`;
      if (cache.has(ref)) { appContext = cache.get(ref) ?? null; }
      else {
        const [owner, filename] = ref.split('/');
        let resolved: NeedWithContext['appContext'] = null;
        try {
          const rec = owner && filename ? await storage.getAppByOwnerName(owner, filename) : null;
          const m = (rec?.manifest ?? {}) as { name?: string; description?: string };
          if (rec) resolved = { app: ref, name: m.name || filename, description: m.description || '' };
        } catch (err) { logger.warn('m: unresolved app → null context', { error: String(err) }); }
        cache.set(ref, resolved); appContext = resolved;
      }
    }
    out.push({ ...n, appContext });
  }
  return out;
}

/** A provider's bid against a NEED. */
export interface Bid {
  bidId: string;
  needId: string;
  bidderGhii: string;
  bidderOwner: string;
  offeringId: string | null;
  ext: string;
  action: string;
  planId: string | null;
  note: string;
  state: 'open' | 'accepted' | 'withdrawn';
  createdAt: string;
}

const OFFERING_PREFIX = 'exchange.offering.';
const NEED_PREFIX = 'exchange.need.';
const bidPrefix = (needId: string) => `exchange.bid.${needId}.`;

async function putPublic(storage: Storage, ownerGhii: string, key: string, value: unknown, tag: string): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({ key, ownerGaii: ownerGhii, value, visibility: 'public', tags: [tag], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
}

// ── OFFERING ────────────────────────────────────────────────────────────────
export function newOfferingId(): string { return `off-${randomUUID().slice(0, 12)}`; }

export async function putOffering(storage: Storage, o: Offering): Promise<Offering> {
  await putPublic(storage, o.providerGhii, OFFERING_PREFIX + o.offeringId, o, 'exchange-offering');
  return o;
}
export async function getOffering(storage: Storage, id: string): Promise<Offering | null> {
  const { items } = await storage.listAllMemory({ prefix: OFFERING_PREFIX + id, limit: 2 });
  const rec = items.find(r => r.key === OFFERING_PREFIX + id);
  return rec ? (rec.value as Offering) : null;
}
export async function listOfferings(storage: Storage): Promise<Offering[]> {
  const { items } = await storage.listAllMemory({ prefix: OFFERING_PREFIX, limit: 5000 });
  return items.map(r => r.value as Offering).filter(v => v && v.offeringId && v.state === 'listed');
}
/** Every offering including delisted ones — the reconcile needs to revive a listing rather than duplicate it. */
export async function listAllOfferings(storage: Storage): Promise<Offering[]> {
  const { items } = await storage.listAllMemory({ prefix: OFFERING_PREFIX, limit: 5000 });
  return items.map(r => r.value as Offering).filter(v => v && v.offeringId);
}
export async function deleteOffering(storage: Storage, id: string): Promise<boolean> {
  const o = await getOffering(storage, id);
  if (!o) return false;
  o.state = 'delisted'; o.updatedAt = new Date().toISOString();
  await putOffering(storage, o);
  return true;
}

/** Rank listed offerings that satisfy a capability. Match = exact (ext,action) when given, else a text
 *  contains over title/description/tags. Cheapest base price first (a proxy; agents refine with plans/trust). */
export async function matchOfferings(
  storage: Storage, q: { ext?: string | null; action?: string | null; text?: string | null },
): Promise<Offering[]> {
  const all = await listOfferings(storage);
  const text = (q.text || '').trim().toLowerCase();
  // A NEED's ext/action are a WISH, not a filter: an exact coordinate hit wins, and otherwise the
  // description still surfaces near-matches, which is the whole point of posting a need. Browsing
  // wants the opposite (narrow to what was asked) and gets it from filterOfferings below.
  const hits = all.filter(o => {
    if (q.ext && q.action) return o.ext === q.ext && o.action === q.action;
    if (!text) return true;
    return [o.title, o.description, o.ext, o.action, ...(o.tags || [])].join(' ').toLowerCase().includes(text);
  });
  return hits.sort((a, b) => a.basePrice - b.basePrice);
}

/**
 * BROWSE filter — every supplied term NARROWS, independently. Distinct from {@link matchOfferings},
 * whose ext/action are a need's WISH (an exact coordinate hit, else a text near-match). Browsing
 * asked the wish matcher for one app's listings and got the whole market back, because `ext` only
 * counted alongside `action`: the app showed a moon-phase service and a Rick & Morty lookup beside
 * its own tools. A filter the server accepts and drops is worse than one it rejects.
 */
export async function filterOfferings(
  storage: Storage, q: { ext?: string | null; action?: string | null; text?: string | null },
): Promise<Offering[]> {
  const all = await listOfferings(storage);
  const text = (q.text || '').trim().toLowerCase();
  return all
    .filter(o => {
      if (q.ext && o.ext !== q.ext) return false;
      if (q.action && o.action !== q.action) return false;
      if (!text) return true;
      return [o.title, o.description, o.ext, o.action, ...(o.tags || [])].join(' ').toLowerCase().includes(text);
    })
    .sort((a, b) => a.basePrice - b.basePrice);
}

// ── NEED ────────────────────────────────────────────────────────────────────
export function newNeedId(): string { return `need-${randomUUID().slice(0, 12)}`; }

export async function putNeed(storage: Storage, n: Need): Promise<Need> {
  await putPublic(storage, n.requesterGaii, NEED_PREFIX + n.needId, n, 'exchange-need');
  return n;
}
export async function getNeed(storage: Storage, id: string): Promise<Need | null> {
  const { items } = await storage.listAllMemory({ prefix: NEED_PREFIX + id, limit: 2 });
  const rec = items.find(r => r.key === NEED_PREFIX + id);
  return rec ? (rec.value as Need) : null;
}
export async function listNeeds(storage: Storage, opts?: { openOnly?: boolean; owner?: string }): Promise<Need[]> {
  const { items } = await storage.listAllMemory({ prefix: NEED_PREFIX, limit: 5000 });
  return items.map(r => r.value as Need).filter(v =>
    v && v.needId &&
    (!opts?.openOnly || v.state === 'open') &&
    (!opts?.owner || v.requesterOwner === opts.owner));
}

// ── BID ─────────────────────────────────────────────────────────────────────
export function newBidId(): string { return `bid-${randomUUID().slice(0, 12)}`; }

export async function putBid(storage: Storage, b: Bid): Promise<Bid> {
  await putPublic(storage, b.bidderGhii, bidPrefix(b.needId) + b.bidId, b, 'exchange-bid');
  return b;
}
export async function listBids(storage: Storage, needId: string): Promise<Bid[]> {
  const { items } = await storage.listAllMemory({ prefix: bidPrefix(needId), limit: 2000 });
  return items.map(r => r.value as Bid).filter(v => v && v.bidId);
}
export async function getBid(storage: Storage, needId: string, bidId: string): Promise<Bid | null> {
  const rec = (await storage.listAllMemory({ prefix: bidPrefix(needId) + bidId, limit: 2 })).items.find(r => r.key === bidPrefix(needId) + bidId);
  return rec ? (rec.value as Bid) : null;
}

// ── METRICS / REPUTATION (the measurability layer) ───────────────────────────
/**
 * Usage/reputation for an offering — the "is this API actually used, and successful?" signal that was in
 * the original measurability spec. Derived entirely from the entitlements against it (each carries its own
 * call + spend counters), so it needs no separate metrics table: a real, tamper-resistant record of demand.
 */
export interface OfferingStats {
  activeContracts: number;     // live entitlements (state === 'active')
  totalContracts: number;      // every entitlement ever minted against this capability
  totalCalls: number;          // metered calls served across all contracts
  totalSettledUnits: number;   // value settled to the provider, in the offering's unit
  consumers: number;           // distinct consuming identities
  listedAt: string;            // when the offering was first listed
  lastUsedAt: string | null;   // most recent contract activity (proxy: latest entitlement update with calls)
  /** Observed delivery time, so a service commitment can be proposed from evidence rather than guessed.
   *  Null until the capability has actually served calls (call-timing.ts). */
  timing: { count: number; p50Ms: number; p95Ms: number; maxMs: number } | null;
}

/**
 * True when an entitlement was minted on THIS offering's rail. A capability priced in both morsels and
 * money projects two offerings over one (provider, ext, action) coordinate, so matching on the coordinate
 * alone showed each listing the other's contracts — and summed two units into one `totalSettledUnits`
 * that claims to be "in the offering's unit". A morsel listing then reported a EUR balance beside a
 * "1 morsel per call" price.
 */
function sameRail(e: { unit: EntitlementUnit; currency?: string | null }, o: Offering): boolean {
  if (e.unit !== o.unit) return false;
  return o.unit !== 'money' || (e.currency ?? 'EUR') === (o.currency ?? 'EUR');
}

/** Compute an offering's usage stats from the entitlements minted against its (provider, ext, action, rail). */
export async function offeringStats(storage: Storage, o: Offering): Promise<OfferingStats> {
  const ents = (await listEntitlementsByProvider(storage, o.providerGhii))
    .filter(e => e.ext === o.ext && e.action === o.action && sameRail(e, o));
  const consumers = new Set(ents.map(e => e.consumerGaii));
  let totalCalls = 0, totalSettledUnits = 0, activeContracts = 0, lastUsedAt: string | null = null;
  for (const e of ents) {
    totalCalls += e.budget.calls;
    totalSettledUnits += e.budget.spentUnits;
    if (e.state === 'active') activeContracts += 1;
    if (e.budget.calls > 0 && (!lastUsedAt || e.updatedAt > lastUsedAt)) lastUsedAt = e.updatedAt;
  }
  // Observed delivery time comes from the timing record, not from the entitlements: a contract knows what
  // it paid, only the call itself knows how long it took.
  const t = await readCallTiming(storage, o.providerGhii, o.ext, o.action);
  return {
    activeContracts, totalContracts: ents.length, totalCalls, totalSettledUnits,
    consumers: consumers.size, listedAt: o.createdAt, lastUsedAt,
    timing: t ? { count: t.count, p50Ms: t.p50Ms, p95Ms: t.p95Ms, maxMs: t.maxMs } : null,
  };
}

/**
 * The provider's DATA-LINEAGE view: who holds a contract against this offering, how much they have consumed,
 * and when they last used it — answering "where is my data used, by whom, and how much?". One row per live
 * or historical contract. Provider-only (the route authorises); the consuming identity is shown so the
 * provider can see (and, via the off-switch, react to) each relationship.
 */
export interface ConsumerRow {
  consumerGaii: string;
  appId: string | null;
  contractRef: string;
  unit: EntitlementUnit;
  calls: number;
  settledUnits: number;
  /** The pacing burn this contract carries, per call — the morsel half of a combined price. */
  tollMorsels: number;
  /** Morsels burned across this contract's calls: `calls * tollMorsels`. */
  burnedMorsels: number;
  /** True when the PROVIDER carries this consumer rather than billing them (an EXCHANGE grant). */
  granted: boolean;
  /**
   * WHO under that consumer actually called, and how much each of them used. The row above is the
   * human who pays; this is their agents, apps and ecosystem apps, plus the human's own direct calls.
   * Empty on contracts that predate the breakdown — the totals are still right, only unattributed.
   */
  callers: Array<{ gaii: string; calls: number; settledUnits: number; carriedUnits: number; lastUsedAt: string }>;
  /**
   * What a granted consumer's calls have cost the provider, in the listing's unit — the list price
   * they chose not to charge, accumulated. Zero on a paying contract, where `settledUnits` is the
   * figure that means something.
   */
  carriedUnits: number;
  state: string;
  lastUsedAt: string;
}

/**
 * List the consumers holding contracts against an offering (provider lineage/consumption log).
 *
 * `settledUnits` is REVENUE in the contract's own unit; the pacing morsels a combined price also
 * burns are a wallet transaction and appear nowhere on the entitlement's meter. A provider reading
 * only `settledUnits` therefore sees half of what their price charges, and cannot derive the other
 * half either: a contract signed before its listing carried a toll has calls but no burn, so
 * `calls * (the listing's toll today)` would invent morsels that were never taken. The toll is read
 * from the CONTRACT, which froze it at accept, so the figure is what that consumer actually paid.
 */
export async function offeringConsumers(storage: Storage, o: Offering): Promise<ConsumerRow[]> {
  const ents = (await listEntitlementsByProvider(storage, o.providerGhii))
    .filter(e => e.ext === o.ext && e.action === o.action && sameRail(e, o));
  return ents
    .map(e => {
      const toll = typeof e.tollMorsels === 'number' && e.tollMorsels > 0 ? e.tollMorsels : 0;
      return {
        consumerGaii: e.consumerGaii, appId: e.appId, contractRef: e.contractRef, unit: e.unit,
        calls: e.budget.calls, settledUnits: e.budget.spentUnits,
        tollMorsels: toll, burnedMorsels: toll * e.budget.calls,
        // A guest belongs on the same list as a customer, marked as one. Leaving grants out would
        // show a provider a consumption log with the consumption they are paying for missing.
        granted: !!e.grant, carriedUnits: e.grant?.carriedUnits ?? 0,
        callers: Object.entries(e.callers ?? {})
          .map(([gaii, u]) => ({ gaii, calls: u.calls, settledUnits: u.spentUnits, carriedUnits: u.carriedUnits ?? 0, lastUsedAt: u.lastUsedAt }))
          .sort((x, y) => y.calls - x.calls),
        state: e.state, lastUsedAt: e.updatedAt,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}
