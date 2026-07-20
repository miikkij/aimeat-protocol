/**
 * @file src/routes/exchange.ts
 * @description EXCHANGE contract-acceptance surface (TARGET-045) — the WRITE side of the G1 metered
 *   entitlement. When a negotiation concludes (a human in an MCP chat, or a closed negotiation agent),
 *   the CONSUMER's owner accepts the contract here, which mints the durable entitlement the G2 gateway
 *   then honours on every call. Safety by construction: the consumer chooses only the BUDGET (their own
 *   spend cap) and the contract ref — the per-call PRICE is read authoritatively from the provider's
 *   extension action (`commercial.payMorsels`), so a consumer can neither undercut the provider nor be
 *   charged a price they did not accept. The entitlement's consumer is always the caller's own owner
 *   (strictly cross-owner via resolveIdentity), so accepting a contract authorises only one's own spend.
 *
 *   Slice-1 covers the `morsels` unit (fully in-repo); the money unit rides the same acceptance flow once
 *   the Stripe/EE drawdown is wired. Dynamic agent-negotiated pricing (a signed price quote that differs
 *   from the list price) is a later addition — slice-1 accepts the provider's listed price + a budget.
 * @structure exchangeRouter — POST /v1/exchange/entitlements · GET /v1/exchange/entitlements ·
 *   POST /v1/exchange/entitlements/off
 * @usage
 *   import { exchangeRouter } from './routes/exchange.js';
 *   app.use(exchangeRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial acceptance surface: mint (authoritative price) / list mine / pause+revoke.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';
import { percentFee } from '../commerce/money.js';
import {
  createEntitlement, readEntitlementForCall, listEntitlementsByConsumer,
  pauseEntitlement, revokeEntitlement, type MeteredEntitlement,
} from '../services/metered-entitlements.js';

function ownerOf(gaii: string): string {
  return gaii.split('@')[0].split('#').pop() ?? gaii;
}

function view(config: AimeatConfig, e: MeteredEntitlement) {
  const rakePct = e.rakePercent ?? commerceFeePercent(config);
  return {
    entitlement_id: e.entitlementId,
    consumer_gaii: e.consumerGaii,
    app_id: e.appId,
    provider: e.providerGhii,
    ext: e.ext,
    action: e.action,
    capability: e.capabilityLabel,
    unit: e.unit,
    currency: e.currency,
    price_per_call: e.pricePerCall,
    rake_percent: rakePct,
    rake_per_call: percentFee(e.pricePerCall, rakePct),
    contract_ref: e.contractRef,
    escrow_party: e.escrowParty,
    state: e.state,
    budget: {
      cap_units: e.budget.capUnits,
      spent_units: e.budget.spentUnits,
      remaining_units: e.budget.capUnits === null ? null : Math.max(0, e.budget.capUnits - e.budget.spentUnits),
      calls: e.budget.calls,
    },
  };
}

export function exchangeRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * POST /v1/exchange/entitlements — accept a contract → mint a durable entitlement for the caller's
   * owner. Body: { ext, action, contract_ref, cap_units?, app_id?, escrow_party? }. The per-call price
   * is taken from the provider's ext action (authoritative), never the request.
   */
  router.post('/v1/exchange/entitlements', requireAuth(), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ext = typeof b.ext === 'string' ? b.ext : '';
    const action = typeof b.action === 'string' ? b.action : '';
    const contractRef = typeof b.contract_ref === 'string' ? b.contract_ref : '';
    if (!ext || !action || !contractRef) {
      return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'ext, action and contract_ref are required'));
    }
    const capUnits = typeof b.cap_units === 'number' && Number.isFinite(b.cap_units) && b.cap_units >= 0
      ? Math.floor(b.cap_units) : null;
    const appId = typeof b.app_id === 'string' && b.app_id ? b.app_id : null;
    const escrowParty = b.escrow_party === 'consumer' || b.escrow_party === 'provider' ? b.escrow_party : null;

    // Resolve the provider + AUTHORITATIVE price from the extension action.
    const extRec = await storage.getExtension(ext);
    if (!extRec) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${ext}" not found`));
    const act = extRec.actions.find(a => a.id === action);
    if (!act) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Action "${action}" not found on "${ext}"`));
    const price = act.commercial?.payMorsels;
    if (typeof price !== 'number' || !Number.isInteger(price) || price <= 0) {
      return res.status(400).json(error(config.nodeId, 'NOT_PRICED',
        `Action "${ext}/${action}" has no morsel price; only morsel-priced actions are contractable in slice-1`));
    }
    if (capUnits !== null && capUnits < price) {
      return res.status(400).json(error(config.nodeId, 'BUDGET_TOO_LOW',
        `Budget cap (${capUnits}) is below the ${price}-morsel price of a single call`));
    }
    const providerGhii = `${extRec.installedBy}@${config.nodeId}`;

    // Carry spend forward on re-acceptance (renegotiation) so a new contract does not reset the meter.
    const existing = await readEntitlementForCall(storage, consumerGaii, ext, action);
    const ent = await createEntitlement(storage, {
      consumerGaii, appId, providerGhii, ext, action, capabilityLabel: `${ext}/${action}`,
      unit: 'morsels', pricePerCall: price, capUnits, contractRef, escrowParty, createdBy: owner,
      carrySpend: existing,
    });
    return res.status(201).json(success(config.nodeId, { entitlement: view(config, ent) }, [
      { description: 'This app’s cost & contracts', method: 'GET', url: appId ? `/v1/apps/cost?app_id=${encodeURIComponent(appId)}` : '/v1/exchange/entitlements' },
    ]));
  });

  /** GET /v1/exchange/entitlements — every entitlement the caller's owner holds (as consumer). */
  router.get('/v1/exchange/entitlements', requireAuth(), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const mine = await listEntitlementsByConsumer(storage, consumerGaii);
    return res.json(success(config.nodeId, { entitlements: mine.map(e => view(config, e)) }));
  });

  /**
   * POST /v1/exchange/entitlements/off — the consumer's off-switch. Body: { ext, action, mode }
   * with mode `pause` (reversible) or `revoke` (terminal). Only the entitlement's own consumer may.
   */
  router.post('/v1/exchange/entitlements/off', requireAuth(), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ext = typeof b.ext === 'string' ? b.ext : '';
    const action = typeof b.action === 'string' ? b.action : '';
    const mode = b.mode === 'revoke' ? 'revoke' : 'pause';
    if (!ext || !action) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'ext and action are required'));

    const ent = await readEntitlementForCall(storage, consumerGaii, ext, action);
    if (!ent || ownerOf(ent.consumerGaii) !== owner) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No entitlement of yours for that capability'));
    }
    const ok = mode === 'revoke'
      ? await revokeEntitlement(storage, consumerGaii, ext, action)
      : await pauseEntitlement(storage, consumerGaii, ext, action);
    return res.json(success(config.nodeId, { ext, action, mode, applied: ok }));
  });

  return router;
}
