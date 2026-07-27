/**
 * @file src/routes/extensions/metered-response.ts
 * @description Turning one {@link MeteredOutcome} into an HTTP response.
 *
 *   The decision is made once, in `services/metered-access.ts`. This is the other side of that split:
 *   status codes and wording, which are genuinely a door's business and differ between them — the raw
 *   route names the listings to contract, the app-tool route offers a checkout, MCP renders text. What
 *   must NOT differ is whether the call was allowed and what it cost, and keeping that out of here is
 *   the point.
 *
 *   `no_right` is deliberately absent: it is the one outcome every door answers differently, and a
 *   default would let a door skip saying anything useful.
 * @structure respondMeteredRefusal · meteredRefusalText
 * @version-history
 *   v1.0.0 — 2026-07-28 — Split out when the metered chokepoint stopped writing HTTP itself.
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import { error } from '../../middleware/envelope.js';
import { paymentChallenge } from '../../commerce/x402.js';
import { formatMoneyMajor } from '../../commerce/money.js';
import type { MeteredOutcome } from '../../services/metered-access.js';

/** A refusal is anything that is neither a settled call, a free one, nor "you hold no right". */
type Refusal = Exclude<MeteredOutcome, { kind: 'settled' } | { kind: 'free_owner' } | { kind: 'no_right' }>;

/** The status + code + human sentence for one refusal, without deciding how to transmit it. */
export function meteredRefusalText(outcome: Refusal, label: string): { status: number; code: string; message: string } {
  switch (outcome.kind) {
    case 'inactive': {
      const e = outcome.entitlement;
      return { status: 402, code: 'ENTITLEMENT_INACTIVE',
        message: `Your EXCHANGE entitlement for ${label} is ${e.state} (contract ${e.contractRef}).` };
    }
    case 'refused_rate': {
      const e = outcome.entitlement;
      return { status: 429, code: 'RATE_LIMITED',
        message: `Your EXCHANGE subscription for ${label} is over its rate limit — retry shortly (contract ${e.contractRef}).` };
    }
    case 'refused_budget': {
      const e = outcome.entitlement;
      const cap = e.unit === 'money'
        ? `${formatMoneyMajor(e.budget.capUnits ?? 0)} ${e.currency ?? ''}`.trim()
        : `${e.budget.capUnits} morsel`;
      return { status: 402, code: 'BUDGET_EXHAUSTED',
        message: `Your EXCHANGE entitlement for ${label} has spent its ${cap} budget (contract ${e.contractRef}).` };
    }
    case 'refused_grant_cap': {
      const g = outcome.entitlement.grant!;
      const unit = outcome.entitlement.unit === 'money' ? (outcome.entitlement.currency ?? '') : 'morsel';
      return { status: 402, code: 'GRANT_EXHAUSTED',
        message: `Your access to ${label} is carried by the provider, and that grant has reached the `
          + `${g.capCarriedUnits} ${unit} ceiling they set. Ask them to extend it, or take a contract of your own.` };
    }
    case 'insufficient':
      return { status: 402, code: 'INSUFFICIENT_MORSELS',
        message: outcome.carried
          ? `This call burns a ${outcome.needed}-morsel pacing toll, which the provider carries for you `
            + 'under their grant, and their balance does not cover it right now. Morsels replenish daily.'
          : `This call needs ${outcome.needed} morsels and the balance does not cover it. Morsels replenish `
            + 'daily; the pacing toll bounds how fast a capability can be called, whatever it is paid in.' };
    case 'settlement_failed':
      return { status: 500, code: 'SETTLEMENT_FAILED',
        message: `Payment for ${label} could not be settled (${outcome.reason}); you were not charged.` };
  }
}

/** Send a refusal. Payment-shaped refusals carry the x402 challenge; a rate limit and a failure do not. */
export function respondMeteredRefusal(config: AimeatConfig, res: Response, outcome: Refusal, label: string): void {
  const { status, code, message } = meteredRefusalText(outcome, label);
  const body = error(config.nodeId, code, message);
  res.status(status).json(status === 402 ? { ...body, ...paymentChallenge(config) } : body);
}
