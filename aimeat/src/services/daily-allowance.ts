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
 * @structure allowanceDayCode(now) · grantDailyAllowance(storage, config, ghii, amount?) ·
 *   runDailyAllowance(storage, config)
 * @usage const { credited, already } = await grantDailyAllowance(storage, config, ghii);
 * @version-history
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
