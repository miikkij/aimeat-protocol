/**
 * @file src/commerce/payable-book.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The seller's payable book: one memory record per settled money sale
 *   (`commerce.payable.{trackingCode}` under the seller's GHII) listing what they are owed or have
 *   received and on which rail. AIMEAT never holds the money — this is bookkeeping the receipt and
 *   the Wallet tab read, shared by every money handler so one sale is booked one way.
 * @structure PayableEntry · bookPayable · listPayables
 * @usage await bookPayable(ctx, sellerGhii, trackingCode, { amount, currency, method: 'stripe', status: 'settled' });
 * @version-history
 *   2026-10-18 — bookPayable appends on the record's version (services/record-cas.ts), so two entries
 *     booked under one tracking code at the same moment both persist
 *     (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *   v1.0.0 — 2026-07-28 — Extracted into core when the ee/ module was removed; both money handlers
 *     (Stripe, invoice) and the Wallet tab now read one shape.
 */
import type { Storage } from '../storage/interface.js';
import type { PaymentContext } from './types.js';
import { updateRecord } from '../services/record-cas.js';

/** One line in a seller's payable book. `settled` = the money already reached them. */
export interface PayableEntry {
  amount: number;
  currency: string;
  reference?: string;
  buyerGhii?: string;
  method: string;
  status: 'settled' | 'pending';
  at: string;
}

const payableKey = (trackingCode: string): string => `commerce.payable.${trackingCode}`;

/** Append one entry to the seller's payable book, creating the record on first use. */
export async function bookPayable(
  ctx: PaymentContext, toGhii: string, trackingCode: string, entry: Omit<PayableEntry, 'at'>,
): Promise<void> {
  const at = new Date().toISOString();
  await updateRecord(ctx.storage, toGhii, payableKey(trackingCode),
    v => ({ ...((v as { items?: unknown[] } | null | undefined) ?? {}) }),
    value => ({ ...value, items: [...(Array.isArray(value.items) ? value.items : []), { ...entry, at }] }),
    { tag: 'commerce', visibility: 'owner' });
}

/** Every payable entry booked for a seller, newest record first. */
export async function listPayables(
  storage: Storage, sellerGhii: string, limit = 200,
): Promise<Array<PayableEntry & { trackingCode: string }>> {
  const { items } = await storage.listAllMemory({ prefix: 'commerce.payable.', ownerPrefix: sellerGhii, limit });
  const out: Array<PayableEntry & { trackingCode: string }> = [];
  for (const rec of items) {
    const trackingCode = rec.key.slice('commerce.payable.'.length);
    const entries = (rec.value as { items?: PayableEntry[] } | undefined)?.items ?? [];
    for (const e of entries) out.push({ ...e, trackingCode });
  }
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}
