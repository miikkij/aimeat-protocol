/**
 * @file src/routes/extensions/metered-response.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.1.0 — 2026-08-10 — PaywallResponder + createRefusalRecorder: a refusal can be captured
 *                         instead of sent, for a caller that answers in another protocol.
 */
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
    case 'scope_required':
      return { status: 403, code: 'SCOPE_DENIED',
        message: `This app may not spend on your behalf. It needs the "${outcome.scope}" permission, `
          + 'which you can grant it from Profile > Access. Reading your data and buying with your '
          + 'money are separate permissions.' };
    case 'app_cap_reached':
      return { status: 402, code: 'APP_SPEND_CAP',
        message: `This app has spent the ${outcome.capMorsels}-morsel limit you set for it `
          + `(${outcome.spentMorsels} used). Raise or clear the limit in Profile > Access to let it `
          + 'keep buying on your behalf.' };
    case 'settlement_failed':
      return { status: 500, code: 'SETTLEMENT_FAILED',
        message: `Payment for ${label} could not be settled (${outcome.reason}); you were not charged.` };
  }
}

/**
 * Where a refusal is written. An Express `Response` satisfies this as it stands, so an HTTP door
 * passes `res` unchanged; a door with no HTTP response of its own passes a recorder and renders the
 * same refusal in its own shape.
 *
 * This exists so the paywall stays ONE implementation. It was Express-shaped, the MCP tool could not
 * call it, and so the MCP tool called none of it: a priced action invoked over MCP was free of
 * charge, and the entitlement check for a cross-owner call was skipped along with it. Which door a
 * caller knocked at should not decide whether they pay.
 */
export interface PaywallResponder {
  status(code: number): { json(body: unknown): unknown };
}

/** A PaywallResponder for a door with no HTTP response: it keeps the refusal instead of sending it,
 *  so the caller can render the same status and message in its own protocol. */
export function createRefusalRecorder(): PaywallResponder & { refusal: { status: number; body: unknown } | null } {
  const rec = {
    refusal: null as { status: number; body: unknown } | null,
    status(code: number) {
      return { json(body: unknown) { rec.refusal = { status: code, body }; return body; } };
    },
  };
  return rec;
}

/** Human-readable text for a recorded refusal, for a door that answers in prose rather than JSON. */
export function refusalText(refusal: { status: number; body: unknown }): string {
  const b = refusal.body as { error?: { code?: string; message?: string } } | undefined;
  const code = b?.error?.code ?? 'REFUSED';
  const message = b?.error?.message ?? 'The call was refused.';
  return `${code} (${refusal.status}): ${message}`;
}

/** Send a refusal. Payment-shaped refusals carry the x402 challenge; a rate limit and a failure do not. */
export function respondMeteredRefusal(config: AimeatConfig, res: PaywallResponder, outcome: Refusal, label: string): void {
  const { status, code, message } = meteredRefusalText(outcome, label);
  const body = error(config.nodeId, code, message);
  res.status(status).json(status === 402 ? { ...body, ...paymentChallenge(config) } : body);
}
