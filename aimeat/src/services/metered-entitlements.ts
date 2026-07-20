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
 *   v1.0.0 — 2026-07-20 — Initial G1 entitlement object (EXCHANGE slice-1): create / lookup-by-call /
 *     authorize+charge (budget decrement) / pause / revoke. Read-modify-write budget counter — see the
 *     concurrency note on authorizeAndCharge (a dedicated atomic counter is deferred to G5).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

/** System namespace — server-side only, never surfaced to a client (mirrors `ext-pay-token`). */
const NS = 'metered-entitlement';

/** The unit an entitlement is priced + budgeted in. Kept single-unit-per-entitlement so money micros and
 *  morsels are NEVER conflated (commerce `money.ts` micros ≠ morsel counts). `money` prices are integer
 *  6-decimal MICRO-units; `morsels` prices are whole morsels. Slice-1 uses `morsels` (fully in-repo,
 *  atomic settlement); the `money` rail (Stripe Connect, EE) is the identical seam. */
export type EntitlementUnit = 'money' | 'morsels';

/** Per-entitlement spend ceiling, expressed in the entitlement's `unit`. `capUnits: null` = uncapped. */
export interface EntitlementBudget {
  capUnits: number | null;
  spentUnits: number;
  calls: number;
}

/** The stored shape of one entitlement (the `value` of the memory record). */
export interface MeteredEntitlement {
  entitlementId: string;
  /** Who may call: an app GEAI, an owner GHII, or a full GAII. Verified against the caller on every charge. */
  consumerGaii: string;
  /** Who gets paid (the seller GHII). */
  providerGhii: string;
  /** Provider capability coordinates. Slice-1 = an extension action; a hop = one (ext, action) pair. */
  ext: string;
  action: string;
  /** Human/machine label, e.g. `fi.ytunnus.validate`. */
  capabilityLabel: string;
  /** The unit price + budget are expressed in. */
  unit: EntitlementUnit;
  /** Price for ONE call, in `unit` (micros for money, whole morsels for morsels). */
  pricePerCall: number;
  /** Currency when `unit === 'money'` (e.g. EUR/USD); ignored for morsels. */
  currency: string | null;
  budget: EntitlementBudget;
  /** Platform cut override (0–100). `null` = use the node's configured marketplace fee. */
  rakePercent: number | null;
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

/** Mint (or overwrite) an entitlement — called by the contract-acceptance flow after both sides agree.
 *  One `(consumer, ext, action)` triple has one entitlement; re-minting replaces it (e.g. renegotiated price),
 *  carrying spend forward only when explicitly asked. */
export async function createEntitlement(
  storage: Storage,
  input: {
    consumerGaii: string; providerGhii: string; ext: string; action: string; capabilityLabel?: string;
    unit: EntitlementUnit; pricePerCall: number; currency?: string | null;
    capUnits?: number | null; rakePercent?: number | null; contractRef: string;
    escrowParty?: 'consumer' | 'provider' | null; createdBy: string; carrySpend?: MeteredEntitlement | null;
  },
): Promise<MeteredEntitlement> {
  const now = new Date().toISOString();
  const value: MeteredEntitlement = {
    entitlementId: input.carrySpend?.entitlementId || randomUUID(),
    consumerGaii: input.consumerGaii,
    providerGhii: input.providerGhii,
    ext: input.ext,
    action: input.action,
    capabilityLabel: input.capabilityLabel || `${input.ext}/${input.action}`,
    unit: input.unit,
    pricePerCall: input.pricePerCall,
    currency: input.unit === 'money' ? (input.currency ?? 'EUR') : null,
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

/** Peek: would ONE more call fit under the cap right now? (No mutation — the G2 gate checks this BEFORE
 *  moving money, then calls {@link commitSpend} only after settlement succeeds, so a failed debit never
 *  leaves a phantom spend.) */
export function budgetAllows(ent: MeteredEntitlement): boolean {
  if (ent.state !== 'active') return false;
  const price = Math.max(0, ent.pricePerCall);
  return ent.budget.capUnits === null || ent.budget.spentUnits + price <= ent.budget.capUnits;
}

/** Commit one call's spend AFTER settlement succeeded: increment spent + calls, flip to `exhausted` when
 *  the cap is reached. (Read-modify-write — see the concurrency note on {@link authorizeAndCharge}.) */
export async function commitSpend(storage: Storage, ent: MeteredEntitlement): Promise<MeteredEntitlement> {
  ent.budget.spentUnits += Math.max(0, ent.pricePerCall);
  ent.budget.calls += 1;
  if (ent.budget.capUnits !== null && ent.budget.spentUnits >= ent.budget.capUnits) ent.state = 'exhausted';
  ent.updatedAt = new Date().toISOString();
  await persist(storage, ent);
  return ent;
}

/** Roll back one call's spend (the G2 gate calls this when the sandbox script throws AFTER settlement, in
 *  lockstep with the money refund). Decrements spent + calls (floored at 0) and un-exhausts if this frees
 *  headroom. No-op if the entitlement vanished. */
export async function refundSpend(storage: Storage, consumerGaii: string, ext: string, action: string): Promise<void> {
  const e = await readEntitlementForCall(storage, consumerGaii, ext, action);
  if (!e) return;
  e.budget.spentUnits = Math.max(0, e.budget.spentUnits - Math.max(0, e.pricePerCall));
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
