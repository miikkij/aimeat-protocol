/**
 * @file src/routes/agents/purchase-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET and PUT /v1/agents/:name/purchase-limit: how much money one agent may spend on
 *   purchases in a day, per currency, and what it spent today (commerce/agent-purchase-limit.ts).
 *
 *   SETTING IT IS THE OWNER'S, SIGNED IN THEMSELVES (decision D5, Jouni 2026-10-02). A limit on
 *   spending the person's money is a right the person gives; an agent raising its own limit would
 *   make the limit decorative. So PUT is requireOwnerPrincipal, as the other screen-only doors are.
 *   Reading it is open to every principal of the same owner: an agent can see its limit and what is
 *   left before it opens a checkout, which is how it avoids the refusal.
 * @structure registerPurchaseLimitRoutes(router, config, storage)
 * @usage registerPurchaseLimitRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { requireOwnerPrincipal } from '../../auth/account-security.js';
import { success, error } from '../../middleware/envelope.js';
import { agentGaiiFromIdentifier, ownerCoordinate } from '../../utils/gaii.js';
import { isSupportedMoneyCurrency, MONEY_CURRENCIES } from '../../commerce/money.js';
import { readPurchaseLimits, setPurchaseLimit, spentToday } from '../../commerce/agent-purchase-limit.js';
import { emitChange } from '../../services/event-bus.js';

const IN_PERSON = 'A daily limit on spending your money is yours to set, so only you, signed in yourself, can change it here.';

/** Micro-units as the amount a person reads: 20000000 → 20. */
const major = (micros: number) => micros / 1e6;

export function registerPurchaseLimitRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  /** The agent, when it is the caller's owner's; null answers 404 without saying whose it is. */
  async function ownAgent(req: Parameters<Parameters<Router['get']>[1]>[0]) {
    const gaii = agentGaiiFromIdentifier(decodeURIComponent(req.params.name as string), req.auth!.owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    return agent && agent.owner === req.auth!.owner ? agent : null;
  }

  const view = async (ownerGhii: string, gaii: string) => {
    const limits = (await readPurchaseLimits(storage, ownerGhii))[gaii] ?? {};
    const spent = (await spentToday(storage, ownerGhii))[gaii] ?? {};
    const currencies = [...new Set([...Object.keys(limits), ...Object.keys(spent)])].sort();
    return {
      agent: gaii,
      limits: currencies.map(c => ({
        currency: c,
        per_day: limits[c] === undefined ? null : major(limits[c]),
        spent_today: major(spent[c] ?? 0),
      })),
      note: 'Amounts in the currency\'s major unit. With no limit in a currency, the agent does not spend money in it.',
    };
  };

  // commerce:buy: the agent that buys holds it; an owner session passes on its role; an app grant
  // approved for something else does not read the owner's spending.
  router.get('/v1/agents/:name/purchase-limit', requireAuth(), requireScope('commerce:buy'), async (req, res) => {
    const agent = await ownAgent(req);
    if (!agent) { res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', 'No such agent on this account.')); return; }
    res.json(success(config.nodeId, await view(ownerCoordinate(req.auth!, config.nodeId), agent.gaii)));
  });

  router.put('/v1/agents/:name/purchase-limit', requireAuth(), requireOwnerPrincipal(IN_PERSON), async (req, res) => {
    const agent = await ownAgent(req);
    if (!agent) { res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', 'No such agent on this account.')); return; }
    const body = (req.body ?? {}) as { currency?: unknown; per_day?: unknown };
    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    if (!isSupportedMoneyCurrency(currency)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `currency must be one of ${MONEY_CURRENCIES.join(', ')}. Morsel prices have no limit: they pace, and buy nothing.`));
      return;
    }
    const perDay = body.per_day;
    if (perDay !== null && !(typeof perDay === 'number' && Number.isFinite(perDay) && perDay >= 0 && perDay <= 1_000_000)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'per_day must be a number from 0 to 1000000 in the currency\'s major unit, or null to remove the limit.'));
      return;
    }
    const ownerGhii = ownerCoordinate(req.auth!, config.nodeId);
    await setPurchaseLimit(storage, ownerGhii, agent.gaii, currency, perDay === null ? null : Math.round(perDay * 1e6));
    emitChange('agents');
    res.json(success(config.nodeId, await view(ownerGhii, agent.gaii)));
  });
}
