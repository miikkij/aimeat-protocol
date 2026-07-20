/**
 * @file src/services/exchange-market.ts
 * @description The two-sided EXCHANGE marketplace records (TARGET-045 Phase C) — the DEMAND + SUPPLY sides
 *   that sit above the metered entitlement (the contract). Three public, memory-backed record types the
 *   marketplace app + agents read/write; matching + negotiation live in the app/agent layer (this service
 *   is the generic store + a simple capability match, per "node holds refined data, not orchestration"):
 *     - OFFERING — a provider's public supply listing: a capability (ext/action) + pricing (base + plans) +
 *       ODPS-style provenance. Discoverable by any consumer.
 *     - NEED — a consumer/app's open demand: a wanted capability + budget + autonomy. Providers browse open
 *       needs and BID.
 *     - BID — a provider's offer against a NEED (links an OFFERING + proposed terms). The requester accepts
 *       one → the acceptance flow mints the entitlement.
 *   Keys: `exchange.offering.{id}` / `exchange.need.{id}` / `exchange.bid.{needId}.{id}` — public so the
 *   marketplace is browsable; ownership is the record's provider/requester GHII (authorised by the routes).
 * @structure Offering·Need·Bid types · put/get/list/delete for each · matchOfferings
 * @usage import { putOffering, listOfferings, matchOfferings, putNeed, listOpenNeeds, putBid } from './exchange-market.js';
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial marketplace records (offering/need/bid) + capability matching (Phase C).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { EntitlementUnit, PricingSpec } from './metered-entitlements.js';

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

/** ODPS-style provenance attestation (a PROMISE by the provider, not a platform guarantee). */
export interface Provenance {
  source?: string;
  legalBasis?: string;
  consentStatus?: string;
  retention?: string;
  odpsVersion?: string;
}

/** A public supply listing. */
export interface Offering {
  offeringId: string;
  providerGhii: string;
  providerOwner: string;
  ext: string;
  action: string;
  title: string;
  description: string;
  unit: EntitlementUnit;
  basePrice: number;            // per-call, in `unit` (micros for money, morsels otherwise)
  currency: string | null;
  plans: OfferingPlan[];
  provenance: Provenance | null;
  tags: string[];
  state: 'listed' | 'delisted';
  createdAt: string;
  updatedAt: string;
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
  budgetUnit: EntitlementUnit | null;
  budgetCap: number | null;
  autonomy: 'supervised' | 'auto';
  state: 'open' | 'matched' | 'closed';
  createdAt: string;
  updatedAt: string;
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
  const hits = all.filter(o => {
    if (q.ext && q.action) return o.ext === q.ext && o.action === q.action;
    if (!text) return true;
    return [o.title, o.description, o.ext, o.action, ...(o.tags || [])].join(' ').toLowerCase().includes(text);
  });
  return hits.sort((a, b) => a.basePrice - b.basePrice);
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
