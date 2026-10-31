/**
 * @file src/routes/extensions/pacing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pacing charge on an uncontracted call: morsels per use that bound the RATE at which a
 *   capability can be consumed, independent of how it is paid for.
 *
 *   Morsels and money are two different things doing two different jobs. Money moves value to the
 *   provider. Morsels regenerate on a daily allowance with a hard ceiling, so charging them per use puts
 *   an absolute floor under how fast anything can be consumed — which is the one property money does not
 *   have. A runaway loop against a money-priced capability drains a budget at machine speed and stops
 *   only when the money runs out; the same loop against a paced capability stops at the daily ceiling.
 *
 *   WHY THIS FILE EXISTS. The toll used to live inside `enforcePaywall`, which guards exactly one of the
 *   four metered call paths (raw extension invokes). App-tool calls, exchange runs, agent work and the
 *   MCP run tools all reach settlement through `settleMeteredCoordinate` directly and were never paced at
 *   all. The rule this file encodes: money, metering and abuse limits belong at the chokepoint EVERY path
 *   shares, never on one surface. Adding a new metered surface must not mean re-deriving this.
 * @structure resolvePacingToll (re-exported) · burnPacingToll (express wrapper over chargePacing) ·
 *   refusePacingShortfall (the same 402, asked before a money price without charging)
 * @usage
 *   const paced = await burnPacingToll({ config, storage, callerGaii, providerOwner, label, toll, res });
 *   if (!paced.ok) return { ok: false };   // 402 already sent
 * @version-history
 *   v1.6.0 — 2026-10-31 — refusePacingShortfall: the raw-invoke paywall asks whether the caller covers
 *     the pacing before it asks a money-priced call for its pay token, so a caller short of morsels is
 *     told so before paying money for a call the pacing would refuse (secaudit 2026-10-31 inv-08).
 *   v1.5.0 — 2026-10-11 — Pacing is no longer a pure burn (decision-morseli-on-tahdistus-ei-hinta-
 *     tarjouksen-kaksi-arvoa): the burn rate's share burns and the rest is credited to the provider's
 *     owner, through chargePacing in services/metered-settlement.ts. The 402 says how to get more
 *     morsels: the daily allowance, or buying pacing capacity from the operator (commerce/pacing-pack.ts).
 *     A legacy morsel price (an extension's `commercial.payMorsels`) is folded into the toll by the
 *     caller with resolvePacingToll, so one use is one pacing charge.
 *   v1.4.1 — 2026-09-26 — The own-capability exemption names the caller's account with localAccountName
 *     (utils/gaii.ts), which keeps an identity of another node whole, so a visitor is never taken for
 *     the local namesake (secaudit 2026-09, F-1).
 *   v1.4.0 — 2026-08-10 — res widened to PaywallResponder (Express Response still satisfies it).
 *     money-only contract is paced too (it previously had no morsel brake of any kind).
 *   v1.3.0 — 2026-07-28 — The burn moved to services/metered-settlement.ts so the chokepoint can
 *     reach it without an Express response; this is a wrapper over it, not a second implementation.
 *   v1.2.0 — 2026-07-27 — The burn is filed under the OWNER whose balance moved, with the caller named
 *     as initiator — an agent's toll used to land in a ledger its payer never reads.
 *   v1.1.0 — 2026-07-27 — `payerGaii`: on an EXCHANGE grant the PROVIDER burns the toll, because a
 *     member carried by a provider is not paying half a price they were told was covered — and dropping
 *     the burn instead would hand them the one thing a money budget cannot bound.
 *   v1.0.0 — 2026-07-25 — Extracted from the extension paywall and moved to the shared chokepoint, so a
 */
import type { PaywallResponder } from './metered-response.js';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { error } from '../../middleware/envelope.js';
import { paymentChallenge } from '../../commerce/x402.js';
import { insufficientMorselsMessage } from '../../commerce/pacing-pack.js';
import { chargePacing, type PacingCharge } from '../../services/metered-settlement.js';
import { localAccountName, ownerGhiiOf } from '../../utils/gaii.js';

export { resolvePacingToll } from '../../services/metered-settlement.js';

/**
 * Charge the pacing amount of one uncontracted use. The caller's own calls to their own capability are
 * free: pacing protects a provider from a consumer, and the provider is not a consumer of themselves.
 *
 * Returns `{ ok: false }` after sending 402 when the caller cannot cover it. The caller of this function
 * must not have moved any money yet: pacing is deliberately the first thing charged, so a paced-out
 * call costs the consumer nothing rather than a settled payment that must be refunded.
 */
export async function burnPacingToll(args: {
  config: AimeatConfig; storage: Storage; callerGaii: string; providerOwner: string | null;
  label: string; toll: number; res: PaywallResponder;
}): Promise<{ ok: boolean; charge?: PacingCharge }> {
  const { config, storage, callerGaii, providerOwner, label, toll, res } = args;
  if (toll <= 0) return { ok: true };
  if (providerOwner && localAccountName(callerGaii) === providerOwner) return { ok: true };

  const charge = await chargePacing({
    config, storage, caller: callerGaii, label, amount: toll,
    providerGhii: providerOwner ? `${providerOwner}@${config.nodeId}` : null,
  });
  if (!charge) {
    res.status(402).json({
      ...error(config.nodeId, 'INSUFFICIENT_MORSELS', insufficientMorselsMessage(config, toll)),
      ...paymentChallenge(config),
    });
    return { ok: false };
  }
  return { ok: true, charge };
}

/**
 * Ask, without charging, whether the caller can cover the pacing burnPacingToll will charge, with the
 * same exemptions. A money-priced call asks it before it asks for a pay token, so a caller short of
 * morsels learns that first and does not pay money for a call the pacing then refuses.
 *
 * Returns `{ ok: false }` after sending the same 402 burnPacingToll sends. The charge itself stays in
 * burnPacingToll, whose atomic debit is still the decision; this is only the earlier answer.
 */
export async function refusePacingShortfall(args: {
  config: AimeatConfig; storage: Storage; callerGaii: string; providerOwner: string | null;
  toll: number; res: PaywallResponder;
}): Promise<{ ok: boolean }> {
  const { config, storage, callerGaii, providerOwner, toll, res } = args;
  if (toll <= 0) return { ok: true };
  if (providerOwner && localAccountName(callerGaii) === providerOwner) return { ok: true };
  const balance = Number((await storage.getGHII(ownerGhiiOf(callerGaii)))?.morselBalance ?? 0);
  if (balance >= Math.trunc(toll)) return { ok: true };
  res.status(402).json({
    ...error(config.nodeId, 'INSUFFICIENT_MORSELS', insufficientMorselsMessage(config, toll)),
    ...paymentChallenge(config),
  });
  return { ok: false };
}
