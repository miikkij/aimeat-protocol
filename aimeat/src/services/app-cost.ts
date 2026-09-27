/**
 * @file src/services/app-cost.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-app COST & CONTRACTS view for EXCHANGE (TARGET-045), in one place for the
 *   REST route GET /v1/apps/cost and the MCP tool. Composes every entitlement attributed to an
 *   appId whose CONSUMER is the requesting owner (strictly cross-owner): contract terms, live
 *   consumption against each budget, the estimated calls the remaining budget buys, the platform
 *   rake, and roll-up totals split by unit (morsels and money never mix).
 *
 *   LLM-usage attribution (ledger) is out of scope: the usage ledger has no appId dimension yet, so
 *   this composes the entitlement spend, which IS the per-app metered consumption record.
 * @structure
 *   - appCostView() — the view GET /v1/apps/cost answers, plus its next-step links, or a refusal
 *   - AppCostRefusal — { ok: false, status, code, message }; the caller renders it
 * @usage
 *   const r = await appCostView(storage, config, { owner: req.auth!.owner, ownerGhii, appId });
 *   if (!r.ok) return res.status(r.status).json(error(config.nodeId, r.code, r.message));
 *   res.json(success(config.nodeId, r.view, r.links));
 * @version-history
 *   v1.0.0 — 2026-09-27 — Moved unchanged out of routes/apps-cost.ts (toContractView, spendTotals,
 *     the entitlement filter and the roll-up) so the MCP tool calls the same code as the route.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { commerceFeePercent } from './marketplace-fee.js';
import { percentFee } from '../commerce/money.js';
import { listEntitlementsByApp, type MeteredEntitlement } from './metered-entitlements.js';

/** A refusal the caller renders: REST as the envelope error, MCP as `CODE: message`. */
export interface AppCostRefusal {
  ok: false;
  status: 400;
  code: 'BAD_REQUEST';
  message: string;
}

/** A next-step link, the same shape as the envelope's HintAction. */
export interface AppCostLink {
  description: string;
  method: string;
  url: string;
}

/** Owner (bare name) behind any principal form in a `consumerGaii` (owner GHII / GAII / bare). */
function ownerOf(gaii: string): string {
  return localAccountName(gaii);
}

/** Shape one entitlement for the surface: contract terms + live consumption + the platform rake. */
function toContractView(config: AimeatConfig, e: MeteredEntitlement) {
  const rakePct = e.rakePercent ?? commerceFeePercent(config);
  const remaining = e.budget.capUnits === null ? null : Math.max(0, e.budget.capUnits - e.budget.spentUnits);
  return {
    entitlement_id: e.entitlementId,
    capability: e.capabilityLabel,
    provider: e.providerGhii,
    contract_ref: e.contractRef,
    state: e.state,
    unit: e.unit,
    currency: e.currency,
    price_per_call: e.pricePerCall,
    pricing: e.pricing ?? { model: 'per_call' },
    rake_percent: rakePct,
    rake_per_call: percentFee(e.pricePerCall, rakePct),
    escrow_party: e.escrowParty,
    budget: {
      cap_units: e.budget.capUnits,
      spent_units: e.budget.spentUnits,
      remaining_units: remaining,
      calls: e.budget.calls,
    },
    // Estimate of what the remaining budget still buys (0 when uncapped or price-free).
    estimated_calls_remaining: e.budget.capUnits === null || e.pricePerCall <= 0
      ? null
      : Math.floor((remaining ?? 0) / e.pricePerCall),
  };
}

/** Sum spend + calls for entitlements of one unit. */
function spendTotals(list: MeteredEntitlement[], unit: 'morsels' | 'money') {
  const of = list.filter(e => e.unit === unit);
  return {
    spent_units: of.reduce((s, e) => s + e.budget.spentUnits, 0),
    calls: of.reduce((s, e) => s + e.budget.calls, 0),
    contracts: of.length,
  };
}

/** One contract row of the view. */
export type AppCostContract = ReturnType<typeof toContractView>;

/** The body GET /v1/apps/cost answers. */
export interface AppCostViewBody {
  app_id: string;
  owner_ghii: string;
  active_contracts: number;
  total_contracts: number;
  totals: { morsels: ReturnType<typeof spendTotals>; money: ReturnType<typeof spendTotals> };
  contracts: AppCostContract[];
  note: string;
}

/**
 * The app's EXCHANGE cost & contracts, for its OWNER. `owner` is the principal's owner claim as the
 * token carries it (compared against localAccountName of each entitlement's consumer, as the route
 * always did); `ownerGhii` is resolveIdentity of the same principal and is echoed back. `appId` is
 * "owner/filename"; an empty one is refused.
 */
export async function appCostView(
  storage: Storage,
  config: AimeatConfig,
  args: { owner: string; ownerGhii: string; appId: string },
): Promise<{ ok: true; view: AppCostViewBody; links: AppCostLink[] } | AppCostRefusal> {
  const { owner, ownerGhii, appId } = args;
  if (!appId) return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'app_id query parameter is required' };

  // Only surface entitlements whose CONSUMER is this owner (strictly cross-owner).
  const all = await listEntitlementsByApp(storage, appId);
  const mine = all.filter(e => ownerOf(e.consumerGaii) === owner);

  const contracts = mine.map(e => toContractView(config, e));

  // Roll-up totals, split by unit (morsels vs money never mix).
  const totals = { morsels: spendTotals(mine, 'morsels'), money: spendTotals(mine, 'money') };
  const active = mine.filter(e => e.state === 'active').length;

  return {
    ok: true,
    view: {
      app_id: appId,
      owner_ghii: ownerGhii,
      active_contracts: active,
      total_contracts: mine.length,
      totals,
      contracts,
      // Billing posture is declared by the app's own tool manifest (apps.{appId}.tools) — the catalog
      // reads that alongside this; here we surface only the sourcing cost the app incurs.
      note: 'EXCHANGE sourcing cost; end-user billing/recoup posture lives in the app tool manifest.',
    },
    links: [
      { description: 'App tool pricing manifest (recoup posture)', method: 'GET', url: `/v1/memory/apps.${appId}.tools` },
      { description: 'Owner LLM usage ledger', method: 'GET', url: '/v1/ledger/usage' },
    ],
  };
}
