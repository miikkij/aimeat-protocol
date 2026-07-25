/**
 * @file src/services/metered-entitlements.ts
 * @description G1 — the durable METERED ENTITLEMENT primitive (EXCHANGE / TARGET-045). Generalises the
 *   single-use `ext-pay-token` into a lasting, budget-capped, contract-bound right: "consumer C may call
 *   provider P's capability (ext/action) at price X, under contract K, until budget B is spent." This is
 *   the object app-grants deliberately do NOT provide — a grant confers scopes (capability *classes*),
 *   never a priced call-right to a specific provider. An entitlement is server-minted by the
 *   contract-acceptance flow (a human in an MCP chat, or a closed negotiation agent) and consulted by the
 *   metered-call gateway (G2) on every call. Memory-backed (no new table — per
 *   docs/coding-guidelines/memory-contracts.md; keeps the node holding only refined data, EXCHANGE's
 *   design principle), stored under a system namespace and never client-readable.
 * @structure MeteredEntitlement · entitlementKey · readEntitlementForCall · listEntitlementsByConsumer /
 *   ByProvider · createEntitlement · authorizeAndCharge · pauseEntitlement · revokeEntitlement
 * @usage
 *   await createEntitlement(storage, { consumerGaii, providerGhii, ext, action, priceMoney, budget, contractRef, ... });
 *   const gate = await authorizeAndCharge(storage, consumerGaii, ext, action, priceMicros);
 *   if (!gate.ok) return res.status(402)...;
 * @version-history
 *   v1.3.0 — 2026-07-21 — Contract history: archiveEntitlement + listEntitlementHistoryByConsumer/ByProvider
 *     (superseded contracts survive the live-key overwrite for the "past contracts" view — renegotiation).
 *   v1.2.0 — 2026-07-21 — Add optional `surface` (AppToolSurface) so a contract can bind an app-tool's pinned
 *     interface version (Gap 1 cross-app selling); the (ext, action) coordinate stays the shared key.
 *   v1.1.0 — 2026-07-20 — Add `appId` dimension + listEntitlementsByApp for the per-app cost surface (G3)
 *   v1.0.0 — 2026-07-20 — Initial G1 entitlement object (EXCHANGE slice-1): create / lookup-by-call /
 *     authorize+charge (budget decrement) / pause / revoke. Read-modify-write budget counter — see the
 *     concurrency note on authorizeAndCharge (a dedicated atomic counter is deferred to G5).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

/** System namespace — server-side only, never surfaced to a client (mirrors `ext-pay-token`). */
const NS = 'metered-entitlement';
/** History namespace — superseded (renegotiated) contracts are archived here so the record survives the
 *  live-key overwrite; the consumer/provider "past contracts" views read it. Append-only. */
const NS_HISTORY = 'metered-entitlement-history';

/** The unit an entitlement is priced + budgeted in. Kept single-unit-per-entitlement so money micros and
 *  morsels are NEVER conflated (commerce `money.ts` micros ≠ morsel counts). `money` prices are integer
 *  6-decimal MICRO-units; `morsels` prices are whole morsels. Slice-1 uses `morsels` (fully in-repo,
 *  atomic settlement); the `money` rail (Stripe Connect, EE) is the identical seam. */
export type EntitlementUnit = 'money' | 'morsels';

/**
 * The PRICING MODEL — what triggers a charge, orthogonal to the settlement rail (unit). Carries its own
 * mutable state so the gateway can advance it per call. Amounts are in the entitlement's `unit`.
 *   - `per_call`      — charge `pricePerCall` every call (the base model).
 *   - `bundle`        — buy a block of `blockSize` calls for `blockPrice`; each call draws down
 *     `callsRemaining`; hitting 0 refills (charges another `blockPrice`).
 *   - `subscription`  — pay `periodPrice` per `periodSeconds` window; within the period calls are free but
 *     rate-limited to `callsPerWindow` per `windowSeconds`; period expiry renews (charges again).
 */
export type PricingSpec =
  | { model: 'per_call' }
  | { model: 'bundle'; blockSize: number; blockPrice: number; callsRemaining: number }
  | {
      model: 'subscription'; periodSeconds: number; periodPrice: number;
      callsPerWindow: number; windowSeconds: number;
      validUntil: string; windowStart: string; windowCount: number;
    };

/** What to charge for ONE call + the advanced pricing state to persist (computed by {@link computeCharge}). */
export interface ChargeDecision {
  allowed: boolean;
  reason?: string;      // when !allowed, e.g. 'rate_limited'
  chargeUnits: number;  // amount to settle for THIS call (0 within a bundle quota / subscription period)
  pricing: PricingSpec; // updated state to persist on commit
}

/** Per-entitlement spend ceiling, expressed in the entitlement's `unit`. `capUnits: null` = uncapped. */
export interface EntitlementBudget {
  capUnits: number | null;
  spentUnits: number;
  calls: number;
}

/**
 * The sellable surface a contract binds to when it is NOT a raw extension action — an app-tool a provider
 * app sells cross-app (TARGET-045 Gap 1). The metered coordinate (`ext`/`action`) stays the shared key; this
 * pins the immutable INTERFACE VERSION so the metered call routes to the frozen snapshot's binding even after
 * the provider ships a new app version. `null`/absent = the classic ext-action surface.
 */
export interface AppToolSurface {
  kind: 'app-tool';
  ownerName: string;
  appId: string;
  tool: string;
  ifaceVersion: number;
}

/**
 * The sellable surface for AGENT WORK (TARGET-045 Gap 2) — a provider agent sells a TASK TYPE it performs.
 * Unlike a data/app-tool call (synchronous), agent work is ASYNC: a task is started, the agent delivers, and
 * the per-task price is metered ON DELIVERY. The metered coordinate is `agentwork:{owner}/{agent}` + taskType.
 */
export interface AgentWorkSurface {
  kind: 'agent-work';
  ownerName: string;
  agentName: string;
  taskType: string;
}

/** The sellable surface a contract binds to when it is not a raw ext-action. */
export type SellableSurface = AppToolSurface | AgentWorkSurface;

/** The stored shape of one entitlement (the `value` of the memory record). */
export interface MeteredEntitlement {
  entitlementId: string;
  /** Who may call: an app GEAI, an owner GHII, or a full GAII. Verified against the caller on every charge. */
  consumerGaii: string;
  /** The consuming app id ("owner/filename") when the consumer is an app — powers the per-app cost surface (G3). */
  appId: string | null;
  /** Who gets paid (the seller GHII). */
  providerGhii: string;
  /** Provider capability coordinates. Slice-1 = an extension action; a hop = one (ext, action) pair. */
  ext: string;
  action: string;
  /** Human/machine label, e.g. `fi.ytunnus.validate`. */
  capabilityLabel: string;
  /** The unit price + budget are expressed in. */
  unit: EntitlementUnit;
  /** Base per-call price, in `unit` (micros for money, whole morsels for morsels). Charged directly for
   *  `per_call`; the reference/base for other models (bundle/subscription set their own amounts). */
  pricePerCall: number;
  /** Currency when `unit === 'money'` (e.g. EUR/USD); ignored for morsels. */
  currency: string | null;
  /** The pricing model + its mutable state. Defaults to `{ model: 'per_call' }`. */
  pricing: PricingSpec;
  budget: EntitlementBudget;
  /** Platform cut override (0–100). `null` = use the node's configured marketplace fee. */
  rakePercent: number | null;
  /**
   * Morsels burned per call to PACE this contract, pinned at accept time like the price is. Null
   * means the capability declared none and the node's default applies. A burn, never revenue: it
   * bounds the call RATE, which is the one thing a money budget cannot do.
   */
  tollMorsels?: number | null;
  /** The sellable surface when this contract is for an app-tool (Gap 1) or agent-work (Gap 2); absent for a
   *  raw ext-action. App-tool calls route to the pinned interface binding; agent-work settles on delivery. */
  surface?: SellableSurface | null;
  /** The contract this entitlement was minted under (an EXCHANGE contract or a `wsengage.*` id). */
  contractRef: string;
  /** Who carries the trust-ramp / escrow risk, per the contract. */
  escrowParty: 'consumer' | 'provider' | null;
  state: 'active' | 'paused' | 'exhausted' | 'revoked';
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** Deterministic, dot-safe key: a call `(consumer, ext, action)` maps to exactly one entitlement, so the
 *  gateway does an O(1) `getMemory` lookup (no scan). GAII contains `@`/`#` — hashing sidesteps key-segment
 *  rules while staying reproducible. The full identifiers live in the value for verification. */
export function entitlementKey(consumerGaii: string, ext: string, action: string): string {
  const h = createHash('sha256').update(`${consumerGaii}|${ext}|${action}`).digest('hex').slice(0, 32);
  return `entitlement.${h}`;
}

/** Look up the live entitlement authorising this exact call, or null. */
export async function readEntitlementForCall(
  storage: Storage, consumerGaii: string, ext: string, action: string,
): Promise<MeteredEntitlement | null> {
  const rec = await storage.getMemory(NS, entitlementKey(consumerGaii, ext, action));
  return rec ? (rec.value as MeteredEntitlement) : null;
}

/** Every entitlement a consumer holds (for the app cost/contract surface, G3). Filtered prefix scan. */
export async function listEntitlementsByConsumer(storage: Storage, consumerGaii: string): Promise<MeteredEntitlement[]> {
  const { items } = await storage.listAllMemory({ prefix: 'entitlement.', limit: 5000 });
  return items.map(r => r.value as MeteredEntitlement).filter(v => v && v.consumerGaii === consumerGaii);
}

/** Every entitlement a provider sells (for the provider/earnings view). Filtered prefix scan. */
export async function listEntitlementsByProvider(storage: Storage, providerGhii: string): Promise<MeteredEntitlement[]> {
  const { items } = await storage.listAllMemory({ prefix: 'entitlement.', limit: 5000 });
  return items.map(r => r.value as MeteredEntitlement).filter(v => v && v.providerGhii === providerGhii);
}

/** Every entitlement a consuming app holds (the per-app cost/contract surface, G3). Filtered prefix scan. */
export async function listEntitlementsByApp(storage: Storage, appId: string): Promise<MeteredEntitlement[]> {
  const { items } = await storage.listAllMemory({ prefix: 'entitlement.', limit: 5000 });
  return items.map(r => r.value as MeteredEntitlement).filter(v => v && v.appId === appId);
}

/** Mint (or overwrite) an entitlement — called by the contract-acceptance flow after both sides agree.
 *  One `(consumer, ext, action)` triple has one entitlement; re-minting replaces it (e.g. renegotiated price),
 *  carrying spend forward only when explicitly asked. */
export async function createEntitlement(
  storage: Storage,
  input: {
    consumerGaii: string; appId?: string | null; providerGhii: string; ext: string; action: string; capabilityLabel?: string;
    unit: EntitlementUnit; pricePerCall: number; currency?: string | null; pricing?: PricingSpec | null;
    capUnits?: number | null; rakePercent?: number | null; contractRef: string; surface?: SellableSurface | null;
    escrowParty?: 'consumer' | 'provider' | null; createdBy: string; carrySpend?: MeteredEntitlement | null;
  },
): Promise<MeteredEntitlement> {
  const now = new Date().toISOString();
  const value: MeteredEntitlement = {
    entitlementId: input.carrySpend?.entitlementId || randomUUID(),
    consumerGaii: input.consumerGaii,
    appId: input.appId ?? input.carrySpend?.appId ?? null,
    providerGhii: input.providerGhii,
    ext: input.ext,
    action: input.action,
    capabilityLabel: input.capabilityLabel || `${input.ext}/${input.action}`,
    unit: input.unit,
    pricePerCall: input.pricePerCall,
    currency: input.unit === 'money' ? (input.currency ?? 'EUR') : null,
    pricing: input.pricing ?? input.carrySpend?.pricing ?? { model: 'per_call' },
    surface: input.surface ?? input.carrySpend?.surface ?? null,
    budget: {
      capUnits: input.capUnits ?? null,
      spentUnits: input.carrySpend?.budget.spentUnits ?? 0,
      calls: input.carrySpend?.budget.calls ?? 0,
    },
    rakePercent: input.rakePercent ?? null,
    contractRef: input.contractRef,
    escrowParty: input.escrowParty ?? null,
    state: 'active',
    createdAt: input.carrySpend?.createdAt || now,
    createdBy: input.carrySpend?.createdBy || input.createdBy,
    updatedAt: now,
  };
  await persist(storage, value);
  return value;
}

/**
 * Authorize a single metered call and record its spend against the budget.
 *
 * Returns `{ ok: true, entitlement }` when the entitlement is `active` and the (money) price fits under the
 * remaining cap; the caller (the G2 gateway) then executes and settles. The budget counter is incremented
 * here so an exhausted entitlement flips to `exhausted` and stops authorising.
 *
 * CONCURRENCY: this is a read-modify-write on a memory record — under heavy simultaneous calls on the SAME
 * entitlement the cap can be marginally overshot. The cap is an *authorization ceiling*, not a fund gate:
 * every actual payment still moves through the atomic debit/credit settle path per call, so no funds are
 * lost — only the ceiling can be exceeded by a few in-flight calls. A dedicated atomic counter (or table)
 * is deferred to G5. The per-call price is read from the entitlement itself (`pricePerCall`, in its `unit`).
 */
export async function authorizeAndCharge(
  storage: Storage, consumerGaii: string, ext: string, action: string,
): Promise<{ ok: true; entitlement: MeteredEntitlement } | { ok: false; reason: string }> {
  const ent = await readEntitlementForCall(storage, consumerGaii, ext, action);
  if (!ent) return { ok: false, reason: 'no_entitlement' };
  if (ent.state !== 'active') return { ok: false, reason: ent.state }; // paused | exhausted | revoked
  const price = Math.max(0, ent.pricePerCall);
  const nextSpent = ent.budget.spentUnits + price;
  if (ent.budget.capUnits !== null && nextSpent > ent.budget.capUnits) {
    // Freeze it so the surface reflects the exhaustion; this call is denied.
    if (ent.state === 'active') {
      ent.state = 'exhausted';
      ent.updatedAt = new Date().toISOString();
      await persist(storage, ent);
    }
    return { ok: false, reason: 'budget_exhausted' };
  }
  ent.budget.spentUnits = nextSpent;
  ent.budget.calls += 1;
  if (ent.budget.capUnits !== null && nextSpent >= ent.budget.capUnits) ent.state = 'exhausted';
  ent.updatedAt = new Date().toISOString();
  await persist(storage, ent);
  return { ok: true, entitlement: ent };
}

/**
 * Compute what THIS call costs + the advanced pricing state, per the entitlement's pricing model. Pure —
 * no mutation, no I/O (`nowMs` is passed in so it stays testable). The gate uses the result to check the
 * budget, settle `chargeUnits`, and then {@link commitSpend} the advanced `pricing`. `allowed:false` means
 * the call is refused without charge (a subscription rate-limit window is full).
 */
export function computeCharge(ent: MeteredEntitlement, nowMs: number): ChargeDecision {
  const p = ent.pricing ?? { model: 'per_call' };
  if (p.model === 'bundle') {
    if (p.callsRemaining > 0) {
      return { allowed: true, chargeUnits: 0, pricing: { ...p, callsRemaining: p.callsRemaining - 1 } };
    }
    // Quota drained → refill: charge one more block and consume a call from it.
    return { allowed: true, chargeUnits: Math.max(0, p.blockPrice), pricing: { ...p, callsRemaining: Math.max(0, p.blockSize - 1) } };
  }
  if (p.model === 'subscription') {
    const nowIso = new Date(nowMs).toISOString();
    let validUntil = p.validUntil, windowStart = p.windowStart, windowCount = p.windowCount, charge = 0;
    if (nowMs >= new Date(validUntil).getTime()) {           // period expired → renew (charge the period fee)
      charge = Math.max(0, p.periodPrice);
      validUntil = new Date(nowMs + p.periodSeconds * 1000).toISOString();
      windowStart = nowIso; windowCount = 0;
    }
    if (nowMs >= new Date(windowStart).getTime() + p.windowSeconds * 1000) { // rate window rolled over
      windowStart = nowIso; windowCount = 0;
    }
    if (windowCount >= p.callsPerWindow) {                   // rate limit hit — refuse without charge
      return { allowed: false, reason: 'rate_limited', chargeUnits: 0, pricing: { ...p, validUntil, windowStart, windowCount } };
    }
    return { allowed: true, chargeUnits: charge, pricing: { ...p, validUntil, windowStart, windowCount: windowCount + 1 } };
  }
  return { allowed: true, chargeUnits: Math.max(0, ent.pricePerCall), pricing: { model: 'per_call' } };
}

/** Peek: would a charge of `chargeUnits` fit under the cap right now? (No mutation — the G2 gate checks this
 *  BEFORE moving money, then calls {@link commitSpend} only after settlement succeeds, so a failed debit
 *  never leaves a phantom spend.) */
export function budgetAllows(ent: MeteredEntitlement, chargeUnits: number): boolean {
  if (ent.state !== 'active') return false;
  return ent.budget.capUnits === null || ent.budget.spentUnits + Math.max(0, chargeUnits) <= ent.budget.capUnits;
}

/** Commit one call AFTER settlement succeeded: add `chargeUnits` to spend, bump calls, advance the pricing
 *  state, flip to `exhausted` at the cap. (Read-modify-write — see the concurrency note on {@link authorizeAndCharge}.) */
export async function commitSpend(storage: Storage, ent: MeteredEntitlement, chargeUnits: number, pricing?: PricingSpec): Promise<MeteredEntitlement> {
  ent.budget.spentUnits += Math.max(0, chargeUnits);
  ent.budget.calls += 1;
  if (pricing) ent.pricing = pricing;
  if (ent.budget.capUnits !== null && ent.budget.spentUnits >= ent.budget.capUnits) ent.state = 'exhausted';
  ent.updatedAt = new Date().toISOString();
  await persist(storage, ent);
  return ent;
}

/** Roll back one call's spend by `chargeUnits` (the gate calls this when the sandbox script throws AFTER
 *  settlement, in lockstep with the money refund). Floors at 0 and un-exhausts if this frees headroom. Does
 *  NOT rewind the pricing quota/window (a thrown call still consumed its slot — conservative). No-op if gone. */
export async function refundSpend(storage: Storage, consumerGaii: string, ext: string, action: string, chargeUnits: number): Promise<void> {
  const e = await readEntitlementForCall(storage, consumerGaii, ext, action);
  if (!e) return;
  e.budget.spentUnits = Math.max(0, e.budget.spentUnits - Math.max(0, chargeUnits));
  e.budget.calls = Math.max(0, e.budget.calls - 1);
  if (e.state === 'exhausted' && (e.budget.capUnits === null || e.budget.spentUnits < e.budget.capUnits)) {
    e.state = 'active';
  }
  e.updatedAt = new Date().toISOString();
  await persist(storage, e);
}

/** Pause (owner off-switch) — stops authorising without losing the record/spend history. */
export async function pauseEntitlement(storage: Storage, consumerGaii: string, ext: string, action: string): Promise<boolean> {
  return flip(storage, consumerGaii, ext, action, 'paused');
}

/** Revoke — terminal; the entitlement no longer authorises and must be re-minted to resume. */
export async function revokeEntitlement(storage: Storage, consumerGaii: string, ext: string, action: string): Promise<boolean> {
  return flip(storage, consumerGaii, ext, action, 'revoked');
}

async function flip(
  storage: Storage, consumerGaii: string, ext: string, action: string, state: MeteredEntitlement['state'],
): Promise<boolean> {
  const ent = await readEntitlementForCall(storage, consumerGaii, ext, action);
  if (!ent) return false;
  ent.state = state;
  ent.updatedAt = new Date().toISOString();
  await persist(storage, ent);
  return true;
}

async function persist(storage: Storage, value: MeteredEntitlement): Promise<void> {
  await storage.setMemory({
    key: entitlementKey(value.consumerGaii, value.ext, value.action),
    ownerGaii: NS,
    value,
    visibility: 'private',
    tags: ['metered-entitlement'],
    ttlHours: null,
    version: 1,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

/** An archived (past) contract — a superseded entitlement snapshot kept for the history view. */
export interface EntitlementHistoryEntry extends MeteredEntitlement {
  archivedId: string;
  archivedAt: string;
  archiveReason: 'superseded' | 'revoked';
  supersededByProposal: string | null;
}

/**
 * Archive a copy of an entitlement to history (append-only) before the live record is overwritten by a
 * renegotiation (supersede) — so the old terms + final spend/period survive for the "past contracts" view.
 * Does NOT touch the live record. The `from → to` period is `createdAt → archivedAt`.
 */
export async function archiveEntitlement(
  storage: Storage, ent: MeteredEntitlement, reason: 'superseded' | 'revoked', proposalId?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const archivedId = randomUUID();
  const entry: EntitlementHistoryEntry = {
    ...ent, archivedId, archivedAt: now, archiveReason: reason, supersededByProposal: proposalId ?? null,
  };
  await storage.setMemory({
    key: `me-hist.${archivedId}`, ownerGaii: NS_HISTORY, value: entry,
    visibility: 'private', tags: ['metered-entitlement-history'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
}

/** Past (archived) contracts a consumer held — newest first. */
export async function listEntitlementHistoryByConsumer(storage: Storage, consumerGaii: string): Promise<EntitlementHistoryEntry[]> {
  const { items } = await storage.listAllMemory({ prefix: 'me-hist.', limit: 5000 });
  return items.map(r => r.value as EntitlementHistoryEntry)
    .filter(v => v && v.archivedId && v.consumerGaii === consumerGaii)
    .sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1));
}

/** Past (archived) contracts a provider sold — newest first. */
export async function listEntitlementHistoryByProvider(storage: Storage, providerGhii: string): Promise<EntitlementHistoryEntry[]> {
  const { items } = await storage.listAllMemory({ prefix: 'me-hist.', limit: 5000 });
  return items.map(r => r.value as EntitlementHistoryEntry)
    .filter(v => v && v.archivedId && v.providerGhii === providerGhii)
    .sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1));
}
