/**
 * @file src/routes/apps-cost.ts
 * @description G3 — the per-app COST & CONTRACTS surface for EXCHANGE (TARGET-045). One owner-scoped read
 *   that composes an app's priced dependencies so the app-catalog can show, per app: its active EXCHANGE
 *   contracts (entitlements), live consumption (spend + calls against each budget), an estimated
 *   per-call/per-remaining cost, and the billing posture (does the app recoup from end-users, and the
 *   platform rake). Read-only and generic — any app with priced dependencies uses it, not just EXCHANGE.
 *   Attribution is by the entitlement's `appId`; the caller only ever sees entitlements whose consumer is
 *   their own owner (strictly cross-owner, per resolveIdentity).
 *
 *   LLM-usage attribution (ledger) is intentionally out of scope for slice-1: the usage ledger has no
 *   appId dimension yet, so this composes the entitlement spend (which IS the per-app metered consumption
 *   record). The ledger fold is a later addition (an appId dimension on usage events).
 * @structure appsCostRouter — GET /v1/apps/:appId/cost
 * @usage
 *   import { appsCostRouter } from './routes/apps-cost.js';
 *   app.use(appsCostRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial per-app cost/contract surface (EXCHANGE G3): entitlements + budgets + rake.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';
import { percentFee } from '../commerce/money.js';
import { listEntitlementsByApp, type MeteredEntitlement } from '../services/metered-entitlements.js';

/** Owner (bare name) behind any principal form in a `consumerGaii` (owner GHII / GAII / bare). */
function ownerOf(gaii: string): string {
  return gaii.split('@')[0].split('#').pop() ?? gaii;
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

export function appsCostRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * GET /v1/apps/:appId/cost — the app's EXCHANGE cost & contracts, for its OWNER. Composes every
   * entitlement attributed to this appId whose consumer is the requesting owner, plus roll-up totals.
   */
  router.get('/v1/apps/:appId/cost', requireAuth(), async (req: Request, res: Response) => {
    const appId = String(req.params.appId);
    const owner = req.auth!.owner;
    const ownerGhii = resolveIdentity(req.auth!, config.nodeId);

    // Only surface entitlements whose CONSUMER is this owner (strictly cross-owner).
    const all = await listEntitlementsByApp(storage, appId);
    const mine = all.filter(e => ownerOf(e.consumerGaii) === owner);

    const contracts = mine.map(e => toContractView(config, e));

    // Roll-up totals, split by unit (morsels vs money never mix).
    const totals = { morsels: spendTotals(mine, 'morsels'), money: spendTotals(mine, 'money') };
    const active = mine.filter(e => e.state === 'active').length;

    res.json(success(config.nodeId, {
      app_id: appId,
      owner_ghii: ownerGhii,
      active_contracts: active,
      total_contracts: mine.length,
      totals,
      contracts,
      // Billing posture is declared by the app's own tool manifest (apps.{appId}.tools) — the catalog
      // reads that alongside this; here we surface only the sourcing cost the app incurs.
      note: 'EXCHANGE sourcing cost; end-user billing/recoup posture lives in the app tool manifest.',
    }, [
      { description: 'App tool pricing manifest (recoup posture)', method: 'GET', url: `/v1/memory/apps.${appId}.tools` },
      { description: 'Owner LLM usage ledger', method: 'GET', url: '/v1/ledger/usage' },
    ]));
  });

  return router;
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
