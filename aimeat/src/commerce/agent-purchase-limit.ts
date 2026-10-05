/**
 * @file src/commerce/agent-purchase-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How much money each of the owner's agents may spend on purchases in a day, and what it
 *   has spent today (decision D5 of the user-journey review, ruled by Jouni 2026-10-02: "Agentin
 *   ostoille päiväraja: sinä asetat rajan agentin kortilla" → "rakenna").
 *
 *   WHY. An agent completing a checkout charged the owner with no limit at all: appSpendRefusal fences
 *   granted APPS (contract:spend and a per-app morsel cap), and nothing fenced an agent. Now an agent
 *   pays in money only within the daily limit its owner set, signed in themselves, on the agent's
 *   card. With no limit set the agent does not spend money: the safe answer to a question nobody has
 *   answered yet. A person's own purchases are untouched, and so are morsel prices, which pace and
 *   buy nothing.
 *
 *   TWO RECORDS, BOTH THE OWNER'S, NEITHER GROWS. `commerce.agent-limits` holds the limits, per agent
 *   GAII and currency, in the currency's 6-decimal micro-units. `commerce.agent-spend` holds today's
 *   spending and starts over when the UTC day changes, so it is one key forever.
 *
 *   ORDER. completeSession and createHold ask agentPurchaseRefusal early, then reserveAgentPurchase
 *   right before the money is collected or authorized: one compare-and-swap on today's record that
 *   checks the limit and counts the amount together, so two completions in the same instant cannot
 *   both pass. A collect or an authorization that fails, and a fulfilment that is refunded, give the
 *   amount back with releaseAgentPurchase.
 * @structure LIMITS_KEY · SPEND_KEY · readPurchaseLimits · setPurchaseLimit · spentToday ·
 *   agentPurchaseRefusal · reserveAgentPurchase · releaseAgentPurchase
 * @usage const refusal = await reserveAgentPurchase(storage, config, session, caller); if (refusal) throw refusal;
 * @version-history
 *   v1.2.0 — 2026-10-05 — reserveAgentPurchase and releaseAgentPurchase replace recordAgentPurchase: the
 *     check and the count were two steps, and concurrent completions each passed the limit (secaudit
 *     2026-10, PKG-6).
 *   v1.1.0 — 2026-10-02 — A hold for a bid counts too (commerce/hold-book.ts createHold): it is refused past
 *     the limit like a purchase, and its amount counts toward today when it is authorized. A release
 *     does not give the amount back the same day: the limit guards what the agent committed to.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { CommerceError } from './errors.js';
import { isMoneyCurrency } from './money.js';
import { updateRecord, UNCHANGED } from '../services/record-cas.js';

export const LIMITS_KEY = 'commerce.agent-limits';
export const SPEND_KEY = 'commerce.agent-spend';

/** agent GAII → currency → micro-units per day. */
export type PurchaseLimits = Record<string, Record<string, number>>;
/** What the limit is asked about: a checkout session, or a hold for a bid (kind 'hold'). Amounts in micro-units. */
export interface Spend { buyerGhii: string; currency: string; total: number; kind?: 'purchase' | 'hold' }
interface SpendRecord { day: string; spent: Record<string, Record<string, number>> }

const today = () => new Date().toISOString().slice(0, 10);

async function putOwnerRecord(storage: Storage, ownerGhii: string, key: string, value: unknown): Promise<void> {
  const existing = await storage.getMemory(ownerGhii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: ownerGhii, value: value as Record<string, unknown>, visibility: 'owner', tags: ['commerce'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

export async function readPurchaseLimits(storage: Storage, ownerGhii: string): Promise<PurchaseLimits> {
  const v = (await storage.getMemory(ownerGhii, LIMITS_KEY))?.value as { limits?: PurchaseLimits } | undefined;
  return v?.limits && typeof v.limits === 'object' ? v.limits : {};
}

/** Set or clear one agent's limit in one currency. `micros` null removes it, which means no spending. */
export async function setPurchaseLimit(storage: Storage, ownerGhii: string, agentGaii: string, currency: string, micros: number | null): Promise<PurchaseLimits> {
  const limits = await readPurchaseLimits(storage, ownerGhii);
  const mine = { ...(limits[agentGaii] ?? {}) };
  if (micros === null) delete mine[currency]; else mine[currency] = micros;
  if (Object.keys(mine).length) limits[agentGaii] = mine; else delete limits[agentGaii];
  await putOwnerRecord(storage, ownerGhii, LIMITS_KEY, { limits });
  return limits;
}

/** What each agent has spent today, per currency. Yesterday's record reads as nothing spent. */
export async function spentToday(storage: Storage, ownerGhii: string): Promise<SpendRecord['spent']> {
  const v = (await storage.getMemory(ownerGhii, SPEND_KEY))?.value as SpendRecord | undefined;
  return v && v.day === today() && v.spent && typeof v.spent === 'object' ? v.spent : {};
}

/** The caller, when it is an agent: the principal the limit is about. Anyone else is not limited here. */
function agentOf(caller: { sub?: string; roles: string[] } | null | undefined): string | null {
  if (!caller?.sub || !caller.roles.includes('agent') || caller.roles.includes('owner')) return null;
  return caller.sub;
}

/** The Wallet-style link the refusal gives: the agent's own card on the Agents page. */
const cardUrl = (config: AimeatConfig, gaii: string) =>
  `${config.baseUrl.replace(/\/+$/, '')}/v1/profile?tab=agents&agent=${encodeURIComponent(gaii.split('#')[0] ?? gaii)}`;

/** Null when the purchase may go ahead; otherwise the refusal to throw, before anything is collected. */
export async function agentPurchaseRefusal(
  storage: Storage, config: AimeatConfig, session: Spend,
  caller: { sub?: string; roles: string[] } | null | undefined,
): Promise<CommerceError | null> {
  const gaii = agentOf(caller);
  if (!gaii || !isMoneyCurrency(session.currency) || session.total <= 0) return null;
  const limit = (await readPurchaseLimits(storage, session.buyerGhii))[gaii]?.[session.currency];
  if (limit === undefined) {
    return new CommerceError('PURCHASE_LIMIT_NOT_SET', 403,
      `This agent has no daily purchase limit in ${session.currency}, so it cannot spend money. The owner sets one, signed in themselves, on the agent's card: ${cardUrl(config, gaii)}`);
  }
  const spent = (await spentToday(storage, session.buyerGhii))[gaii]?.[session.currency] ?? 0;
  if (spent + session.total > limit) {
    return new CommerceError('PURCHASE_LIMIT_REACHED', 403,
      `This ${session.kind === 'hold' ? 'hold' : 'purchase'} would take the agent past its daily limit in ${session.currency} (spent today ${spent / 1e6}, this ${session.kind === 'hold' ? 'hold' : 'purchase'} ${session.total / 1e6}, limit ${limit / 1e6}). The owner can change the limit on the agent's card: ${cardUrl(config, gaii)}`);
  }
  return null;
}

/**
 * Check the limit and count the amount in ONE compare-and-swap on today's record, right before the
 * money is collected: null when the agent may spend it (and it is now counted), the refusal otherwise.
 * The check and the record were two steps, so two completions in the same instant both passed and the
 * agent spent twice its limit (secaudit 2026-10, PKG-6). A collect that fails gives the amount back
 * with releaseAgentPurchase.
 */
export async function reserveAgentPurchase(
  storage: Storage, config: AimeatConfig, session: Spend,
  caller: { sub?: string; roles: string[] } | null | undefined,
): Promise<CommerceError | null> {
  const gaii = agentOf(caller);
  if (!gaii || !isMoneyCurrency(session.currency) || session.total <= 0) return null;
  const limit = (await readPurchaseLimits(storage, session.buyerGhii))[gaii]?.[session.currency];
  let refusal: CommerceError | null = null;
  await updateRecord<SpendRecord>(storage, session.buyerGhii, SPEND_KEY,
    v => { const r = v as SpendRecord | undefined; return r && r.day === today() && r.spent && typeof r.spent === 'object' ? r : { day: today(), spent: {} }; },
    cur => {
      refusal = null;
      const spent = cur.spent[gaii]?.[session.currency] ?? 0;
      if (limit === undefined) {
        refusal = new CommerceError('PURCHASE_LIMIT_NOT_SET', 403,
          `This agent has no daily purchase limit in ${session.currency}, so it cannot spend money. The owner sets one, signed in themselves, on the agent's card: ${cardUrl(config, gaii)}`);
        return UNCHANGED;
      }
      if (spent + session.total > limit) {
        refusal = new CommerceError('PURCHASE_LIMIT_REACHED', 403,
          `This ${session.kind === 'hold' ? 'hold' : 'purchase'} would take the agent past its daily limit in ${session.currency} (spent today ${spent / 1e6}, this ${session.kind === 'hold' ? 'hold' : 'purchase'} ${session.total / 1e6}, limit ${limit / 1e6}). The owner can change the limit on the agent's card: ${cardUrl(config, gaii)}`);
        return UNCHANGED;
      }
      return { day: cur.day, spent: { ...cur.spent, [gaii]: { ...(cur.spent[gaii] ?? {}), [session.currency]: spent + session.total } } };
    },
    { tag: 'commerce', visibility: 'owner' });
  return refusal;
}

/** Give back a reservation whose money did not move (a declined card, a refunded fulfilment). */
export async function releaseAgentPurchase(
  storage: Storage, session: Spend, caller: { sub?: string; roles: string[] } | null | undefined,
): Promise<void> {
  const gaii = agentOf(caller);
  if (!gaii || !isMoneyCurrency(session.currency) || session.total <= 0) return;
  await updateRecord<SpendRecord>(storage, session.buyerGhii, SPEND_KEY,
    v => { const r = v as SpendRecord | undefined; return r && r.spent && typeof r.spent === 'object' ? r : { day: today(), spent: {} }; },
    cur => {
      // Yesterday's reservation is gone with yesterday's record.
      if (cur.day !== today()) return UNCHANGED;
      const spent = cur.spent[gaii]?.[session.currency] ?? 0;
      return { day: cur.day, spent: { ...cur.spent, [gaii]: { ...(cur.spent[gaii] ?? {}), [session.currency]: Math.max(0, spent - session.total) } } };
    },
    { tag: 'commerce', visibility: 'owner' });
}
