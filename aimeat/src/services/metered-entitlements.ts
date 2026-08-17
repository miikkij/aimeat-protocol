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
 *   v1.7.0 — 2026-07-27 — A right is keyed to the OWNER, not to the exact caller, because the wallet
 *     already is: `debitBalance` collapses every GAII to its owner, so keying the right per-principal
 *     made one person hold two contracts for one product (measured on production: an agent's contract
 *     carried 118 calls and 17.70 EUR while its owner's sat unused). Who CALLED is kept instead as a
 *     per-caller breakdown, which is what agents having identities is for. `mergeOwnerEntitlements`
 *     folds the pre-existing duplicates together.
 *   v1.6.0 — 2026-07-27 — GRANTS: a provider may carry a consumer's access themselves (`grant` block,
 *     price 0, its own key space). A grant never overwrites a paid contract and wins over one while it is
 *     active, so "I approved you" is access rather than a bill — and what the provider is carrying is
 *     counted (`carriedUnits`) instead of vanishing into a zero meter.
 *   v1.5.0 — 2026-07-27 — A re-mint on a DIFFERENT rail starts a fresh meter. `spentUnits` is denominated
 *     in the entitlement's own unit, and a capability priced on both rails projects two offerings against
 *     one (consumer, ext, action) triple, so accepting the second re-minted the first and carried a EUR
 *     micro-unit balance onto a morsel contract — 0.22 EUR read back as 220 000 morsels on a live listing.
 *     Spend, calls and a bundle's callsRemaining now carry only when unit + currency are unchanged.
 *   v1.4.0 — 2026-07-25 — Contracts capture `tollMorsels` at signature: raising the pacing burn later
 *     governs new contracts, never ones already agreed.
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
import { ownerGhiiOf } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { recordAccountEvent } from './account-events.js';

/** System namespace — server-side only, never surfaced to a client (mirrors `ext-pay-token`). */
export const NS_ENTITLEMENT = 'metered-entitlement';
const NS = NS_ENTITLEMENT;
/** History namespace — superseded (renegotiated) contracts are archived here so the record survives the
 *  live-key overwrite; the consumer/provider "past contracts" views read it. Append-only. */
const NS_HISTORY = 'metered-entitlement-history';
/**
 * GRANT namespace — access a PROVIDER carries for someone instead of billing them.
 *
 * Deliberately its own key space rather than a zero-priced contract in the ordinary slot. One
 * `(consumer, ext, action)` triple has exactly one entitlement, so writing a grant there would
 * overwrite whatever contract the consumer had bought — a provider could destroy a paying customer's
 * terms by being generous, and revoking the gift would leave them with nothing rather than with what
 * they paid for. Two slots, and the grant wins while it is active.
 */
export const NS_GRANT_PUBLIC = 'metered-grant';
const NS_GRANT = NS_GRANT_PUBLIC;

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
  /**
   * Set only when the listing was projected from an APP-TOOL manifest's unbound (task-shape) tool
   * rather than from the agent's own offers doc. It is what lets a reconcile scoped to that app find
   * this listing again: the metered coordinate is `agentwork:{owner}/{agent}`, which carries no trace
   * of the app, so without this the source could create a listing it could never retire.
   */
  appId?: string;
}

/** The sellable surface a contract binds to when it is not a raw ext-action. */
export type SellableSurface = AppToolSurface | AgentWorkSurface;

/**
 * What makes an entitlement a GRANT rather than a purchase: the provider decided this consumer may
 * call, and the provider carries it. Present only on grants — its absence is what "this is a bought
 * contract" means, on every read path.
 *
 * `pricePerCall` on a grant is 0, so nothing settles and the consumer is billed in neither half of the
 * price. That would also make the provider's cost invisible (a zero meter reads the same at one call
 * and at a million), so the LIST price is kept here and accumulated per call: `carriedUnits` is what
 * the provider gave away, in the listing's own unit.
 */
export interface EntitlementGrant {
  /** The provider owner who issued it — the only principal who may revoke it. */
  grantedBy: string;
  /** What one call WOULD have cost at the listing price, in the entitlement's `unit`. */
  listPricePerCall: number;
  /** Accumulated `listPricePerCall` across the calls this grant has served. The carried cost. */
  carriedUnits: number;
  /** Ceiling on `carriedUnits` — how much the provider is willing to carry. `null` = no ceiling. */
  capCarriedUnits: number | null;
  /** Free-text reason the provider recorded (e.g. the app role this represents). */
  note: string;
  /** The app + role this grant stands for, when an app issued it on an approval. Lets a demotion in
   *  that app find and withdraw exactly the grants the approval created. */
  reason: { appId: string; role: string } | null;
  issuedAt: string;
}

/**
 * What ONE principal did under a right that belongs to their owner.
 *
 * The bill goes to the human either way — they hold the balance — but "who used this" is a different
 * question from "who pays for it", and collapsing the two throws away the answer to the first. An
 * owner looking at 118 calls should be able to see that their composer agent made all of them.
 */
export interface CallerUsage {
  calls: number;
  /** Settled in the entitlement's unit. Always 0 under a grant, where nothing settles. */
  spentUnits: number;
  /** List price this caller consumed under a grant — the provider's carried cost, attributed. */
  carriedUnits: number;
  lastUsedAt: string;
}

/**
 * How many distinct callers are tracked before the rest are folded into one bucket. A fleet owner can
 * run more agents than anyone wants inside a single memory record; the total is never wrong, only the
 * attribution of the long tail.
 */
export const CALLER_ROWS_MAX = 100;
/** Where callers past {@link CALLER_ROWS_MAX} are counted, so the rows still sum to the total. */
export const CALLER_OVERFLOW = 'other';

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
  /** Set when the provider carries this access instead of billing it — see {@link EntitlementGrant}. */
  grant?: EntitlementGrant | null;
  /** Per-principal breakdown of {@link EntitlementBudget}. Keyed by the exact caller GAII/GHII. */
  callers?: Record<string, CallerUsage>;
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
  return `entitlement.${coordinateHash(consumerGaii, ext, action)}`;
}

/** The same coordinate in the GRANT key space — a separate slot, so a gift never overwrites a purchase. */
export function grantKey(consumerGaii: string, ext: string, action: string): string {
  return `entgrant.${coordinateHash(consumerGaii, ext, action)}`;
}

/**
 * The slot a right lives in: the OWNER behind the caller, plus the coordinate.
 *
 * Keyed on the owner rather than the exact principal because that is who pays. An owner's agent, app
 * grant and ecosystem app all draw on the one balance, so giving each of them a separate right meant
 * the same human buying the same product more than once and holding meters that never met.
 */
function coordinateHash(consumerGaii: string, ext: string, action: string): string {
  const owner = ownerGhiiOf(consumerGaii);
  return createHash('sha256').update(`${owner}|${ext}|${action}`).digest('hex').slice(0, 32);
}

/** Read the grant covering this exact call, whatever state it is in (revoked ones still read back). */
export async function readGrantForCall(
  storage: Storage, consumerGaii: string, ext: string, action: string,
): Promise<MeteredEntitlement | null> {
  const rec = await storage.getMemory(NS_GRANT, grantKey(consumerGaii, ext, action));
  return rec ? (rec.value as MeteredEntitlement) : null;
}

/** Read the bought contract for this call, ignoring any grant. */
export async function readContractForCall(
  storage: Storage, consumerGaii: string, ext: string, action: string,
): Promise<MeteredEntitlement | null> {
  const rec = await storage.getMemory(NS, entitlementKey(consumerGaii, ext, action));
  return rec ? (rec.value as MeteredEntitlement) : null;
}

/**
 * Look up whatever authorises this exact call, or null.
 *
 * An ACTIVE grant wins over a bought contract: the provider said they would carry this consumer, and
 * billing them anyway while a grant is live is the one outcome an approval must never produce. A
 * revoked or exhausted grant steps aside and the consumer's own contract (if any) answers again — so
 * withdrawing a gift returns someone to what they bought rather than cutting them off.
 *
 * Every metered surface reaches this one function, which is why the grant needs no per-route wiring:
 * app-tool REST, the MCP twin, the raw extension door and agent-work delivery all read it.
 *
 * COST: two keyed `getMemory` lookups per metered call instead of one, on the busiest path EXCHANGE
 * has. Both are O(1) by key, and the alternative — teaching every surface to ask twice — is how the
 * free-door bugs above got in. Use {@link readContractForCall} on paths that only ever mean the
 * bought contract (minting, renegotiation, the consumer's off-switch); they pay for one read and,
 * more importantly, cannot mistake a gift for terms.
 */
export async function readEntitlementForCall(
  storage: Storage, consumerGaii: string, ext: string, action: string,
): Promise<MeteredEntitlement | null> {
  const granted = await readGrantForCall(storage, consumerGaii, ext, action);
  if (granted && granted.state === 'active') return granted;
  return readContractForCall(storage, consumerGaii, ext, action);
}

/**
 * Every live entitlement on the node — bought contracts AND grants.
 *
 * Both are read, because every surface built on these lists is answering a question a grant is part
 * of: what does this app cost me, who is using my capability, what am I carrying. A list that quietly
 * skipped grants would show a provider a customer roster with their guests missing from it.
 */
async function listAllEntitlements(storage: Storage): Promise<MeteredEntitlement[]> {
  const [bought, granted] = await Promise.all([
    storage.listAllMemory({ prefix: 'entitlement.', limit: 5000 }),
    storage.listAllMemory({ prefix: 'entgrant.', limit: 5000 }),
  ]);
  return [...bought.items, ...granted.items].map(r => r.value as MeteredEntitlement).filter(Boolean);
}

/** Every entitlement a consumer holds (for the app cost/contract surface, G3). Filtered prefix scan. */
export async function listEntitlementsByConsumer(storage: Storage, consumerGaii: string): Promise<MeteredEntitlement[]> {
  return (await listAllEntitlements(storage)).filter(v => v.consumerGaii === consumerGaii);
}

/** Every entitlement a provider sells or carries (for the provider/earnings view). Filtered prefix scan. */
export async function listEntitlementsByProvider(storage: Storage, providerGhii: string): Promise<MeteredEntitlement[]> {
  return (await listAllEntitlements(storage)).filter(v => v.providerGhii === providerGhii);
}

/** Every entitlement a consuming app holds (the per-app cost/contract surface, G3). Filtered prefix scan. */
export async function listEntitlementsByApp(storage: Storage, appId: string): Promise<MeteredEntitlement[]> {
  return (await listAllEntitlements(storage)).filter(v => v.appId === appId);
}

/** Every grant a provider has issued — "who am I carrying, and what has it cost me?". */
export async function listGrantsByProvider(storage: Storage, providerGhii: string): Promise<MeteredEntitlement[]> {
  const { items } = await storage.listAllMemory({ prefix: 'entgrant.', limit: 5000 });
  return items.map(r => r.value as MeteredEntitlement).filter(v => v && !!v.grant && v.providerGhii === providerGhii);
}

/** Mint (or overwrite) an entitlement — called by the contract-acceptance flow after both sides agree.
 *  One `(consumer, ext, action)` triple has one entitlement; re-minting replaces it (e.g. renegotiated price),
 *  carrying spend forward only when explicitly asked — and only when the rail is unchanged (see below). */
export async function createEntitlement(
  storage: Storage,
  input: {
    consumerGaii: string; appId?: string | null; providerGhii: string; ext: string; action: string; capabilityLabel?: string;
    unit: EntitlementUnit; pricePerCall: number; currency?: string | null; pricing?: PricingSpec | null;
    capUnits?: number | null; rakePercent?: number | null; contractRef: string; surface?: SellableSurface | null;
    tollMorsels?: number | null;
    escrowParty?: 'consumer' | 'provider' | null; createdBy: string; carrySpend?: MeteredEntitlement | null;
  },
): Promise<MeteredEntitlement> {
  const now = new Date().toISOString();
  // `spentUnits` is denominated in the entitlement's OWN unit, so it only means anything while the
  // rail stays the same. A capability priced on both rails projects two offerings against one
  // `(consumer, ext, action)` triple, so accepting the second one re-mints the first — and carrying
  // a money balance onto a morsel contract multiplies it by a million. Measured on a live listing:
  // 22 calls that settled 220 000 EUR micro-units (0.22 EUR) came back as 220 000 morsels next to a
  // "1 morsel per call" price. A rail change is a new meter, the same reading exchange-proposals
  // already applies to a renegotiation.
  const prev = input.carrySpend ?? null;
  const sameRail = !!prev && prev.unit === input.unit
    && (input.unit !== 'money' || (prev.currency ?? 'EUR') === (input.currency ?? 'EUR'));
  if (prev && !sameRail) {
    logger.info('Entitlement re-minted on a different rail: spend meter reset', {
      ext: input.ext, action: input.action, consumer: input.consumerGaii,
      from: `${prev.unit}${prev.currency ? ':' + prev.currency : ''}`,
      to: `${input.unit}${input.currency ? ':' + input.currency : ''}`,
      droppedSpentUnits: prev.budget.spentUnits, droppedCalls: prev.budget.calls,
    });
  }
  const carried = sameRail ? prev.budget : { spentUnits: 0, calls: 0 };
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
    // A bundle's callsRemaining was bought in the old unit, so it does not survive a rail change either.
    pricing: input.pricing ?? (sameRail ? prev.pricing : null) ?? { model: 'per_call' },
    surface: input.surface ?? input.carrySpend?.surface ?? null,
    budget: {
      capUnits: input.capUnits ?? null,
      spentUnits: carried.spentUnits,
      calls: carried.calls,
    },
    rakePercent: input.rakePercent ?? null,
    // Captured at signature, like the price: a provider raising their pacing later governs NEW contracts.
    tollMorsels: input.tollMorsels ?? input.carrySpend?.tollMorsels ?? null,
    contractRef: input.contractRef,
    escrowParty: input.escrowParty ?? null,
    state: 'active',
    createdAt: input.carrySpend?.createdAt || now,
    createdBy: input.carrySpend?.createdBy || input.createdBy,
    updatedAt: now,
  };
  await persistEntitlement(storage, value);
  // Both parties to the contract. A contract is an agreement between two accounts and each of them
  // acquired an obligation; telling only the buyer would leave the seller to notice they had sold
  // something by watching their balance.
  const contractLabel = value.capabilityLabel || `${value.ext}/${value.action}`;
  for (const side of new Set([ownerGhiiOf(value.consumerGaii), value.providerGhii])) {
    void recordAccountEvent(storage, {
      ownerGhii: side, kind: 'contract_started', actorGaii: value.createdBy,
      subject: value.entitlementId, link: '/v1/profile?tab=usage',
      data: { name: contractLabel },
    });
  }
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
      await persistEntitlement(storage, ent);
    }
    return { ok: false, reason: 'budget_exhausted' };
  }
  ent.budget.spentUnits = nextSpent;
  ent.budget.calls += 1;
  if (ent.budget.capUnits !== null && nextSpent >= ent.budget.capUnits) ent.state = 'exhausted';
  ent.updatedAt = new Date().toISOString();
  await persistEntitlement(storage, ent);
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
export async function commitSpend(
  storage: Storage, ent: MeteredEntitlement, chargeUnits: number, pricing?: PricingSpec,
  /** The exact principal that made this call. The bill is the owner's; the call is theirs. */
  callerGaii?: string,
): Promise<MeteredEntitlement> {
  const charged = Math.max(0, chargeUnits);
  const carried = ent.grant ? Math.max(0, ent.grant.listPricePerCall) : 0;
  ent.budget.spentUnits += charged;
  ent.budget.calls += 1;
  // A grant settles nothing, so its spend meter never moves; the provider's cost is the list price
  // they chose not to charge, accumulated here. Without it "what is this costing me?" has no answer.
  if (ent.grant) ent.grant.carriedUnits += carried;
  if (callerGaii) recordCaller(ent, callerGaii, 1, charged, carried);
  if (pricing) ent.pricing = pricing;
  if (ent.budget.capUnits !== null && ent.budget.spentUnits >= ent.budget.capUnits) ent.state = 'exhausted';
  ent.updatedAt = new Date().toISOString();
  await persistEntitlement(storage, ent);
  return ent;
}

/** Roll back one call's spend by `chargeUnits` (the gate calls this when the sandbox script throws AFTER
 *  settlement, in lockstep with the money refund). Floors at 0 and un-exhausts if this frees headroom. Does
 *  NOT rewind the pricing quota/window (a thrown call still consumed its slot — conservative). No-op if gone. */
export async function refundSpend(
  storage: Storage, consumerGaii: string, ext: string, action: string, chargeUnits: number,
  callerGaii?: string,
): Promise<void> {
  const e = await readEntitlementForCall(storage, consumerGaii, ext, action);
  if (!e) return;
  const charged = Math.max(0, chargeUnits);
  const carried = e.grant ? Math.max(0, e.grant.listPricePerCall) : 0;
  e.budget.spentUnits = Math.max(0, e.budget.spentUnits - charged);
  e.budget.calls = Math.max(0, e.budget.calls - 1);
  // Undelivered work costs the provider nothing to carry either.
  if (e.grant) e.grant.carriedUnits = Math.max(0, e.grant.carriedUnits - carried);
  // The caller's own row rolls back in lockstep, or the breakdown stops summing to the total.
  if (callerGaii) recordCaller(e, callerGaii, -1, -charged, -carried);
  if (e.state === 'exhausted' && (e.budget.capUnits === null || e.budget.spentUnits < e.budget.capUnits)) {
    e.state = 'active';
  }
  e.updatedAt = new Date().toISOString();
  await persistEntitlement(storage, e);
}

/** Pause (owner off-switch) — stops authorising without losing the record/spend history. */
export async function pauseEntitlement(storage: Storage, consumerGaii: string, ext: string, action: string): Promise<boolean> {
  return flip(storage, consumerGaii, ext, action, 'paused');
}

/** Revoke — terminal; the entitlement no longer authorises and must be re-minted to resume. */
export async function revokeEntitlement(storage: Storage, consumerGaii: string, ext: string, action: string): Promise<boolean> {
  return flip(storage, consumerGaii, ext, action, 'revoked');
}

/**
 * Issue (or re-issue) a grant: the provider carries this consumer's calls instead of billing them.
 *
 * Writes only the grant slot, so a consumer who was already paying keeps their contract untouched
 * underneath — and gets it back the moment the grant is withdrawn. Re-issuing carries the accumulated
 * `carriedUnits` forward, because what a provider has already given away does not un-happen when they
 * raise the ceiling.
 */
export async function issueGrant(
  storage: Storage,
  input: {
    consumerGaii: string; appId?: string | null; providerGhii: string; ext: string; action: string;
    capabilityLabel?: string; unit: EntitlementUnit; currency?: string | null; surface?: SellableSurface | null;
    tollMorsels?: number | null; listPricePerCall: number; capCarriedUnits?: number | null;
    note?: string; reason?: { appId: string; role: string } | null; grantedBy: string;
  },
): Promise<MeteredEntitlement> {
  const now = new Date().toISOString();
  const prev = await readGrantForCall(storage, input.consumerGaii, input.ext, input.action);
  const carriedForward = prev?.grant && prev.unit === input.unit ? prev.grant.carriedUnits : 0;
  const value: MeteredEntitlement = {
    entitlementId: prev?.entitlementId || randomUUID(),
    consumerGaii: input.consumerGaii,
    appId: input.appId ?? prev?.appId ?? null,
    providerGhii: input.providerGhii,
    ext: input.ext,
    action: input.action,
    capabilityLabel: input.capabilityLabel || `${input.ext}/${input.action}`,
    unit: input.unit,
    // Zero by construction: this is the whole point. A grant that charged anything would be a discount.
    pricePerCall: 0,
    currency: input.unit === 'money' ? (input.currency ?? 'EUR') : null,
    pricing: { model: 'per_call' },
    surface: input.surface ?? prev?.surface ?? null,
    budget: { capUnits: null, spentUnits: 0, calls: prev?.budget.calls ?? 0 },
    rakePercent: null,
    tollMorsels: input.tollMorsels ?? null,
    grant: {
      grantedBy: input.grantedBy,
      listPricePerCall: Math.max(0, Math.floor(input.listPricePerCall)),
      carriedUnits: carriedForward,
      capCarriedUnits: input.capCarriedUnits ?? null,
      note: (input.note ?? '').slice(0, 500),
      reason: input.reason ?? null,
      issuedAt: prev?.grant?.issuedAt || now,
    },
    contractRef: `grant:${input.grantedBy}`,
    escrowParty: null,
    state: 'active',
    createdAt: prev?.createdAt || now,
    createdBy: input.grantedBy,
    updatedAt: now,
  };
  await persistEntitlement(storage, value);
  return value;
}

/**
 * Withdraw a grant. Terminal and immediate: the next call reads `state !== 'active'` and falls back to
 * whatever the consumer bought for themselves, which for most of them is nothing.
 */
export async function revokeGrant(storage: Storage, consumerGaii: string, ext: string, action: string): Promise<boolean> {
  const g = await readGrantForCall(storage, consumerGaii, ext, action);
  if (!g || !g.grant) return false;
  g.state = 'revoked';
  g.updatedAt = new Date().toISOString();
  await persistEntitlement(storage, g);
  return true;
}

/** The consumer's own off-switch acts on what the consumer BOUGHT — a grant is the provider's to withdraw. */
async function flip(
  storage: Storage, consumerGaii: string, ext: string, action: string, state: MeteredEntitlement['state'],
): Promise<boolean> {
  const ent = await readContractForCall(storage, consumerGaii, ext, action);
  if (!ent) return false;
  ent.state = state;
  ent.updatedAt = new Date().toISOString();
  await persistEntitlement(storage, ent);
  return true;
}

/**
 * Attribute one call (or roll one back, with negative deltas) to the principal that made it.
 *
 * A right belongs to the owner and the bill goes to their balance; this is the other half of the
 * question. Rows are capped so one owner's fleet cannot grow a memory record without bound — past
 * {@link CALLER_ROWS_MAX} distinct callers the rest accumulate under {@link CALLER_OVERFLOW}, so the
 * rows still sum to `budget`, only the long tail loses its name.
 */
function recordCaller(ent: MeteredEntitlement, callerGaii: string, calls: number, spent: number, carried: number): void {
  const rows = (ent.callers ??= {});
  const key = rows[callerGaii] || Object.keys(rows).length < CALLER_ROWS_MAX ? callerGaii : CALLER_OVERFLOW;
  const row = rows[key] ?? { calls: 0, spentUnits: 0, carriedUnits: 0, lastUsedAt: '' };
  row.calls = Math.max(0, row.calls + calls);
  row.spentUnits = Math.max(0, row.spentUnits + spent);
  row.carriedUnits = Math.max(0, row.carriedUnits + carried);
  row.lastUsedAt = new Date().toISOString();
  rows[key] = row;
}

export async function persistEntitlement(storage: Storage, value: MeteredEntitlement): Promise<void> {
  // A grant lives in its own slot; writing it to the contract key is what would destroy a purchase.
  const isGrant = !!value.grant;
  await storage.setMemory({
    key: isGrant
      ? grantKey(value.consumerGaii, value.ext, value.action)
      : entitlementKey(value.consumerGaii, value.ext, value.action),
    ownerGaii: isGrant ? NS_GRANT : NS,
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
  // A SUPERSEDED contract is not an ending: the same arrangement continues on new terms, and saying
  // "a contract ended" about a renegotiation would read as a loss. Only a revocation ends anything.
  if (reason === 'revoked') {
    const endedLabel = ent.capabilityLabel || `${ent.ext}/${ent.action}`;
    for (const side of new Set([ownerGhiiOf(ent.consumerGaii), ent.providerGhii])) {
      void recordAccountEvent(storage, {
        ownerGhii: side, kind: 'contract_ended', subject: ent.entitlementId,
        link: '/v1/profile?tab=usage', data: { name: endedLabel },
      });
    }
  }
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
