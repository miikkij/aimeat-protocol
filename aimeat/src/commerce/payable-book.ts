/**
 * @file src/commerce/payable-book.ts
 * @description The seller's payable book: one memory record per settled money sale
 *   (`commerce.payable.{trackingCode}` under the seller's GHII) listing what they are owed or have
 *   received and on which rail. AIMEAT never holds the money — this is bookkeeping the receipt and
 *   the Wallet tab read, shared by every money handler so one sale is booked one way.
 * @structure PayableEntry · bookPayable · listPayables
 * @usage await bookPayable(ctx, sellerGhii, trackingCode, { amount, currency, method: 'stripe', status: 'settled' });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Extracted into core when the ee/ module was removed; both money handlers
 *     (Stripe, invoice) and the Wallet tab now read one shape.
 */
import type { Storage } from '../storage/interface.js';
import type { PaymentContext } from './types.js';

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
  const key = payableKey(trackingCode);
  const existing = await ctx.storage.getMemory(toGhii, key);
  const value = (existing?.value as { items?: unknown[] } | undefined) ?? {};
  const items = Array.isArray(value.items) ? value.items : [];
  items.push({ ...entry, at: new Date().toISOString() });
  const now = new Date().toISOString();
  await ctx.storage.setMemory({
    key, ownerGaii: toGhii, value: { ...value, items }, visibility: 'owner', tags: ['commerce'],
    ttlHours: null, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
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
