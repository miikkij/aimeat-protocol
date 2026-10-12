/**
 * @file src/services/exchange-action-pricing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The price of an EXCHANGE contract read from its source: an action's `commercial` block
 *   (resolveActionPricing), an extension action as the node stores it (resolveExtActionPricing, which
 *   reads the 4.0.0 form, the action's own tollMorsels), the toll a live detail states beside the
 *   per-call amount (extActionDeclaredToll), and the plan shape an offering carries. Moved out of
 *   services/exchange-market.ts unchanged, which re-exports every name, when that file passed 800 lines.
 * @structure ActionCommercial · resolveActionPricing · resolveExtActionPricing · extActionDeclaredToll · OfferingPlan
 * @usage
 *   import { resolveExtActionPricing } from './exchange-market.js';   // or from this file
 *   const priced = resolveExtActionPricing(act, planId);
 * @version-history
 *   v1.0.0 — 2026-10-13 — Pure extraction from services/exchange-market.ts (v1.12.1).
 */
import type { EntitlementUnit, PricingSpec } from './metered-entitlements.js';

/** The action `commercial` block an offering/contract prices against. */
export interface ActionCommercial {
  /** The pacing amount per call on the morsel rail. Never a price. */
  tollMorsels?: number;
  /**
   * Deprecated (3.x): an extension manifest's old morsel price, as stored. Read as the pacing amount
   * when `tollMorsels` is absent, so a 3.26.1 record keeps working; nothing new writes it here.
   */
  payMorsels?: number;
  payMoney?: { amount: number; currency: string };
  plans?: OfferingPlan[];
}

/**
 * Resolve the AUTHORITATIVE unit + per-call price + (optional plan) pricing spec from a provider action's
 * commercial block — the single source of truth shared by the acceptance route AND bid-accept, so a
 * consumer can never undercut the provider. Money (payMoney) takes precedence over morsels.
 *
 * `unit: 'morsels'` names the contract's RAIL, not a currency: a morsel-rail contract is free, and its
 * per-call amount is charged as pacing (services/metered-settlement.ts settleMorsels, through
 * chargePacing). Responses present that amount as `toll_morsels` (presentOffering).
 */
export function resolveActionPricing(
  comm: ActionCommercial | undefined, planId: string | null,
): { ok: true; unit: EntitlementUnit; pricePerCall: number; currency: string | null; pricing: PricingSpec | null }
  | { ok: false; code: string; message: string } {
  const money = comm?.payMoney;
  const pacing = comm?.tollMorsels ?? comm?.payMorsels;
  // `perCall` is the money price on the money rail and the pacing amount on the morsel rail.
  let unit: EntitlementUnit; let perCall: number; let currency: string | null = null;
  if (money && typeof money.amount === 'number' && Number.isInteger(money.amount) && money.amount > 0) {
    unit = 'money'; perCall = money.amount; currency = money.currency;
  } else if (typeof pacing === 'number' && Number.isInteger(pacing) && pacing > 0) {
    unit = 'morsels'; perCall = pacing;
  } else {
    return { ok: false, code: 'NOT_PRICED', message: 'Neither a money price nor a pacing amount is set, so this is not offered to other owners' };
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
  return { ok: true, unit, pricePerCall: perCall, currency, pricing };
}

/**
 * The contract terms of an extension ACTION: resolveActionPricing over its `commercial` block, and the
 * pacing toll the contract carries beside the per-call amount. The 4.0.0 form of a morsel-rail action
 * is its own `tollMorsels` with no `commercial.payMorsels` (the manifest refuses payMorsels from 4.0.0,
 * services/extension-manifest.ts stores tollMorsels on the action). Such an action was NOT_PRICED here,
 * so it could be listed by the projection but never contracted. Read as listingTerms reads it: with no
 * money price and no 3.x payMorsels, the toll IS the per-call pacing amount and the toll beside it is
 * 0, so a tollMorsels of 10 charges 10 per call, not 20. A 3.x record (payMorsels, with or without a
 * separate toll) and a money-priced action price exactly as before.
 */
export function resolveExtActionPricing(
  act: { commercial?: unknown; tollMorsels?: number | null }, planId: string | null,
): (Extract<ReturnType<typeof resolveActionPricing>, { ok: true }> & { tollMorsels: number | null })
  | Extract<ReturnType<typeof resolveActionPricing>, { ok: false }> {
  const comm = act.commercial as ActionCommercial | undefined;
  const priced = resolveActionPricing(comm, planId);
  if (priced.ok) return { ...priced, tollMorsels: act.tollMorsels ?? null };
  const toll = act.tollMorsels;
  if (priced.code !== 'NOT_PRICED' || typeof toll !== 'number' || !Number.isInteger(toll) || toll <= 0) return priced;
  const paced = resolveActionPricing({ ...(comm ?? {}), tollMorsels: toll }, planId);
  return paced.ok ? { ...paced, tollMorsels: 0 } : paced;
}

/**
 * The toll an extension action's offering states beside its per-call amount, for a response that reads
 * the action live (the offering detail, the ODPS document, aimeat_exchange_offering_get): the toll
 * resolveExtActionPricing gives a contract, so a toll-only action is not stated as its toll twice.
 */
export function extActionDeclaredToll(act: { commercial?: unknown; tollMorsels?: number | null }): number | null {
  const priced = resolveExtActionPricing(act, null);
  return priced.ok ? priced.tollMorsels : (act.tollMorsels ?? null);
}

/** A provider pricing plan surfaced on an offering (mirrors the action's commercial.plans). */
export type OfferingPlan =
  | { id: string; model: 'per_call' }
  | { id: string; model: 'bundle'; blockSize: number; blockPrice: number }
  | { id: string; model: 'subscription'; periodSeconds: number; periodPrice: number; callsPerWindow: number; windowSeconds: number };

