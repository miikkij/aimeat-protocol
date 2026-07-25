/**
 * @file src/routes/extensions/pacing.ts
 * @description The pacing burn: morsels spent per metered call to bound the RATE at which a capability
 *   can be consumed, independent of how it is paid for.
 *
 *   Morsels and money are two different things doing two different jobs. Money moves value to the
 *   provider. Morsels regenerate on a daily allowance with a hard ceiling, so burning them per call puts
 *   an absolute floor under how fast anything can be consumed — which is the one property money does not
 *   have. A runaway loop against a money-priced capability drains a budget at machine speed and stops
 *   only when the money runs out; the same loop against a paced capability stops at the daily ceiling.
 *
 *   WHY THIS FILE EXISTS. The toll used to live inside `enforcePaywall`, which guards exactly one of the
 *   four metered call paths (raw extension invokes). App-tool calls, exchange runs, agent work and the
 *   MCP run tools all reach settlement through `settleMeteredCoordinate` directly and were never paced at
 *   all. The rule this file encodes: money, metering and abuse limits belong at the chokepoint EVERY path
 *   shares, never on one surface. Adding a new metered surface must not mean re-deriving this.
 * @structure resolvePacingToll · burnPacingToll
 * @usage
 *   const paced = await burnPacingToll({ config, storage, callerGaii, providerOwner, label, toll, res });
 *   if (!paced.ok) return { ok: false };   // 402 already sent
 * @version-history
 *   v1.0.0 — 2026-07-25 — Extracted from the extension paywall and moved to the shared chokepoint, so a
 *     money-only contract is paced too (it previously had no morsel brake of any kind).
 */
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { error } from '../../middleware/envelope.js';
import { paymentChallenge } from '../../commerce/x402.js';

/**
 * How many morsels this call burns. A per-capability value wins when the source declares one; otherwise
 * the node's default applies, so pacing is a property of the NODE rather than of each seller's memory.
 * Zero disables it — which is the shipped default, because switching it on changes what existing
 * consumers are charged and that is an operator's decision, not a silent upgrade.
 */
export function resolvePacingToll(config: AimeatConfig, declared: number | undefined | null): number {
  const value = typeof declared === 'number' && Number.isInteger(declared) && declared >= 0
    ? declared
    : config.pacingTollDefault;
  if (!Number.isInteger(value) || value <= 0) return 0;
  return Math.min(value, config.extensionMaxDebitPerCall);
}

/**
 * Burn the pacing toll from the caller. A BURN, never revenue: the provider is not credited (invariant
 * M1), and the caller's own calls to their own capability are free — pacing protects a provider from a
 * consumer, and the provider is not a consumer of themselves.
 *
 * Returns `{ ok: false }` after sending 402 when the caller cannot cover it. The caller of this function
 * must not have moved any money yet: the toll is deliberately the first thing charged, so a paced-out
 * call costs the consumer one morsel-sized attempt rather than a settled payment that must be refunded.
 */
export async function burnPacingToll(args: {
  config: AimeatConfig; storage: Storage; callerGaii: string; providerOwner: string | null;
  label: string; toll: number; res: Response;
}): Promise<{ ok: boolean }> {
  const { config, storage, callerGaii, providerOwner, label, toll, res } = args;
  if (toll <= 0) return { ok: true };

  const callerOwner = callerGaii.split('@')[0]?.split('#').pop() ?? callerGaii;
  if (providerOwner && callerOwner === providerOwner) return { ok: true };   // own capability, no pacing

  const burned = await storage.debitBalance(callerGaii, toll);
  if (!burned) {
    res.status(402).json({
      ...error(config.nodeId, 'INSUFFICIENT_MORSELS',
        `This call burns a ${toll}-morsel pacing toll and your balance does not cover it. Morsels replenish `
        + 'daily; the toll bounds how fast a capability can be called, whatever it is paid in.'),
      ...paymentChallenge(config),
    });
    return { ok: false };
  }
  await storage.addTransaction({
    id: `pacing-${randomUUID()}`, gaii: callerGaii, type: 'extension_toll', amount: -toll,
    trackingCode: `pacing:${label}`, timestamp: new Date().toISOString(),
  });
  return { ok: true };
}
