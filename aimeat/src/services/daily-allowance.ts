/**
 * @file src/services/daily-allowance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The day's morsels: once per person per day, to the person and never per agent, with a
 *   ledger row every time. Morsels accrue to the human on their own, idle or not, and an agent's
 *   balance is always 0 (CLAUDE.md, Identity). Both doors that add the day's morsels call this: the
 *   daily job and POST /v1/wallet/request.
 *
 *   WHAT IT REPLACED (feature-list audit 135). The daily job credited once per AGENT, and a credit
 *   resolves to the owner, so a person with three agents got three days' worth and a person with none
 *   got nothing; it wrote no ledger row. The request route had no daily limit at all: every call
 *   added the day's amount until the balance reached the cap.
 *
 *   ONE A DAY, BY THE LEDGER. The day's grant carries the tracking code `allowance-YYYY-MM-DD` (UTC),
 *   and a second grant on the same day finds it (findTransactionByTrackingCode) and adds nothing.
 *   One person's grants run one after another on this node, so two requests at the same moment
 *   cannot both pass that check.
 * @structure allowanceDayCode(now) · grantDailyAllowance(storage, config, ghii, amount?) ·
 *   runDailyAllowance(storage, config)
 * @usage const { credited, already } = await grantDailyAllowance(storage, config, ghii);
 * @version-history
 *   v1.0.1 — 2026-10-25 — One person's grants run one at a time, so overlapping requests credit the
 *     day once (secaudit2026oct22).
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 135).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/** The tracking code of one day's grant, by the UTC date. */
export function allowanceDayCode(now: Date = new Date()): string {
  return `allowance-${now.toISOString().slice(0, 10)}`;
}

/**
 * Add the day's morsels to this person, once a day and up to the cap. `already` says today's grant
 * was made before, so nothing was added; `credited` 0 without `already` means the balance is at the cap.
 */
export async function grantDailyAllowance(
  storage: Storage, config: AimeatConfig, ghii: string, amount: number = config.dailyAllowance,
): Promise<{ credited: number; already: boolean }> {
  // The check, the credit and the ledger row are three storage calls. Two requests for one person
  // that overlapped both passed the check and both credited (secaudit2026oct22), so the grants of one
  // person run one after another on this node, as recordAiUsage does for the usage record.
  let pending = grantsInFlight.get(storage);
  if (!pending) { pending = new Map(); grantsInFlight.set(storage, pending); }
  const previous = pending.get(ghii) ?? Promise.resolve();
  const run = (): Promise<{ credited: number; already: boolean }> => grantOnce(storage, config, ghii, amount);
  const next = previous.then(run, run);
  pending.set(ghii, next);
  try { return await next; } finally { if (pending.get(ghii) === next) pending.delete(ghii); }
}

/** The grants in flight, per storage and person, so they run one at a time. */
const grantsInFlight = new WeakMap<Storage, Map<string, Promise<unknown>>>();

async function grantOnce(
  storage: Storage, config: AimeatConfig, ghii: string, amount: number,
): Promise<{ credited: number; already: boolean }> {
  const code = allowanceDayCode();
  if (await storage.findTransactionByTrackingCode(ghii, code, 'allowance')) return { credited: 0, already: true };
  const credited = await storage.creditBalanceCapped(ghii, Math.min(amount, config.dailyAllowance), config.dailyAllowanceCap);
  if (credited > 0) {
    await storage.addTransaction({
      id: `tx-${randomUUID()}`, gaii: ghii, type: 'allowance', amount: credited,
      trackingCode: code, timestamp: new Date().toISOString(),
    });
  }
  return { credited, already: false };
}

/** The daily job: every person once, whether or not they have an agent. */
export async function runDailyAllowance(storage: Storage, config: AimeatConfig): Promise<{ people: number; credited: number }> {
  let people = 0;
  let credited = 0;
  for (const owner of await storage.listOwners()) {
    if (owner.name === 'anonymous') continue;
    const ghii = (await storage.getGHIIByOwner(owner.name))?.ghii;
    if (!ghii) continue;
    const out = await grantDailyAllowance(storage, config, ghii);
    if (out.credited > 0) { people++; credited += out.credited; }
  }
  return { people, credited };
}
