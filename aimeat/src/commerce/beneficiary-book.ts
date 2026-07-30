/**
 * @file src/commerce/beneficiary-book.ts
 * @description The beneficiary's book: one memory record per settled call that owed a third party
 *   (`commerce.benefit.{trackingCode}` under the BENEFICIARY's own GHII), listing what they are owed,
 *   by whom, and whether it has been released yet.
 *
 *   This is a book of OBLIGATIONS, not a pot of money. The provider was paid their whole cut by the
 *   settlement path and is holding it; an entry here says "and of that, this much is yours". AIMEAT
 *   never took custody at any point, which is exactly what keeps a three-party split out of regulated
 *   payment-institution territory — see the pocket argument in `beneficiary-split.ts`.
 *
 *   ONE RECORD, TWO READERS. The entry lives under the beneficiary because it is their receivable, and
 *   the provider's "what do I owe" view is a filtered prefix scan on `fromGhii` rather than a second
 *   mirrored copy. Two copies of one obligation is two things that can disagree about money.
 * @structure BeneficiaryEntry · bookBeneficiaryShares · listBeneficiaryEntries ·
 *   listBeneficiaryObligations · markReleased · reverseAccrual
 * @usage
 *   await bookBeneficiaryShares(storage, { lines, trackingCode, fromGhii, unit, currency, ... });
 *   const owed = await listBeneficiaryEntries(storage, beneficiaryGhii);
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial: the accrual half of multi-beneficiary revenue splitting.
 */
import type { Storage } from '../storage/interface.js';
import type { SplitLine } from './beneficiary-split.js';

/** One line in a beneficiary's book — a share of one settled call. */
export interface BeneficiaryEntry {
  /** Amount in `unit`: integer micro-units for money, whole morsels for morsels. Never mixed. */
  amount: number;
  unit: 'money' | 'morsels';
  /** ISO code when `unit === 'money'`; null for morsels. */
  currency: string | null;
  /** The DEBTOR — the provider whose cut this came out of, and who releases it. */
  fromGhii: string;
  /** Who paid for the call. Context for the beneficiary, never a party to this obligation. */
  buyerGhii?: string;
  reference?: string;
  /** Relative weight this beneficiary held in the pool, so an amount can be explained. */
  weight: number;
  /** Whether the provider's standing configuration named them, or this particular call did. */
  kind: 'static' | 'dynamic';
  note?: string;
  /** `accrued` — owed, unpaid. `released` — the provider has paid or invoiced it. `reversed` — the
   *  call it came from was refunded, so the obligation never matured. */
  status: 'accrued' | 'released' | 'reversed';
  releasedAt?: string;
  /** How it was released: a morsel transfer, or booked onto the beneficiary's payable book. */
  releaseMethod?: string;
  at: string;
}

const benefitKey = (trackingCode: string): string => `commerce.benefit.${trackingCode}`;

/**
 * Book every line of one call's split, each under its own beneficiary.
 *
 * Idempotent per `(trackingCode, beneficiary)`: a retried accrual finds its own entry and writes
 * nothing. A settlement path that books an obligation twice on a retry has invented money, and a
 * tracking code is the one identifier that is stable across the retry.
 */
export async function bookBeneficiaryShares(
  storage: Storage,
  args: {
    lines: SplitLine[];
    trackingCode: string;
    fromGhii: string;
    unit: 'money' | 'morsels';
    currency: string | null;
    buyerGhii?: string;
    reference?: string;
  },
): Promise<number> {
  let booked = 0;
  for (const line of args.lines) {
    if (line.amount <= 0) continue;
    const key = benefitKey(args.trackingCode);
    const existing = await storage.getMemory(line.ghii, key);
    const value = (existing?.value as { items?: BeneficiaryEntry[] } | undefined) ?? {};
    const items = Array.isArray(value.items) ? value.items : [];
    if (items.some(i => i.fromGhii === args.fromGhii)) continue;   // already booked — a retry, not a second sale
    items.push({
      amount: line.amount,
      unit: args.unit,
      currency: args.currency,
      fromGhii: args.fromGhii,
      buyerGhii: args.buyerGhii,
      reference: args.reference,
      weight: line.weight,
      kind: line.kind,
      note: line.note || undefined,
      status: 'accrued',
      at: new Date().toISOString(),
    });
    const now = new Date().toISOString();
    await storage.setMemory({
      key, ownerGaii: line.ghii, value: { ...value, items }, visibility: 'owner', tags: ['commerce', 'beneficiary'],
      ttlHours: null, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    booked += 1;
  }
  return booked;
}

/** What a beneficiary is owed and has been paid, newest first. */
export async function listBeneficiaryEntries(
  storage: Storage, beneficiaryGhii: string, limit = 200,
): Promise<Array<BeneficiaryEntry & { trackingCode: string }>> {
  const { items } = await storage.listAllMemory({ prefix: 'commerce.benefit.', ownerPrefix: beneficiaryGhii, limit });
  return flatten(items);
}

/**
 * What a PROVIDER owes, across every beneficiary.
 *
 * A prefix scan filtered on `fromGhii` rather than a mirrored per-provider record: the obligation has
 * one authoritative row, and both parties read the same one. Same shape `listAllEntitlements` already
 * uses, and the same cost — bounded by the scan limit, not by the provider's own volume.
 */
export async function listBeneficiaryObligations(
  storage: Storage, providerGhii: string, limit = 1000,
): Promise<Array<BeneficiaryEntry & { trackingCode: string; beneficiaryGhii: string }>> {
  const { items } = await storage.listAllMemory({ prefix: 'commerce.benefit.', limit });
  const out: Array<BeneficiaryEntry & { trackingCode: string; beneficiaryGhii: string }> = [];
  for (const rec of items) {
    const trackingCode = rec.key.slice('commerce.benefit.'.length);
    for (const e of entriesOf(rec.value)) {
      if (e.fromGhii === providerGhii) out.push({ ...e, trackingCode, beneficiaryGhii: rec.ownerGaii });
    }
  }
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}

/**
 * The still-accrued entry owed by one provider under one tracking code, or null.
 *
 * Exists so a caller can learn the RAIL before it flips the status. Deciding how a share will be
 * released needs to know whether it is denominated in the pacing meter or in currency, and that fact
 * lives on the entry — so reading it after the flip means writing the status first and the truth
 * about it second, which is how `release_method` came to be stored as the literal string "pending".
 */
export async function readAccruedEntry(
  storage: Storage, beneficiaryGhii: string, trackingCode: string, fromGhii: string,
): Promise<BeneficiaryEntry | null> {
  const rec = await storage.getMemory(beneficiaryGhii, benefitKey(trackingCode));
  if (!rec) return null;
  return entriesOf(rec.value).find(i => i.fromGhii === fromGhii && i.status === 'accrued') ?? null;
}

/**
 * Flip one accrued entry to a terminal state, in place.
 *
 * Only ever moves `accrued` onwards, so a double release cannot pay twice and a reversal cannot undo
 * money that has already left. Returns the entry it changed, or null when there was nothing in that
 * state to change — which is how the caller learns not to move any funds.
 */
export async function settleEntryStatus(
  storage: Storage,
  args: {
    beneficiaryGhii: string; trackingCode: string; fromGhii: string;
    to: 'released' | 'reversed'; releaseMethod?: string;
  },
): Promise<(BeneficiaryEntry & { beneficiaryGhii: string }) | null> {
  const key = benefitKey(args.trackingCode);
  const rec = await storage.getMemory(args.beneficiaryGhii, key);
  if (!rec) return null;
  const value = rec.value as { items?: BeneficiaryEntry[] };
  const items = Array.isArray(value.items) ? value.items : [];
  const entry = items.find(i => i.fromGhii === args.fromGhii && i.status === 'accrued');
  if (!entry) return null;
  entry.status = args.to;
  entry.releasedAt = new Date().toISOString();
  if (args.releaseMethod) entry.releaseMethod = args.releaseMethod;
  await storage.setMemory({
    key, ownerGaii: args.beneficiaryGhii, value: { ...value, items }, visibility: 'owner',
    tags: ['commerce', 'beneficiary'], ttlHours: null, version: (rec.version ?? 0) + 1,
    createdAt: rec.createdAt, updatedAt: new Date().toISOString(),
  });
  return { ...entry, beneficiaryGhii: args.beneficiaryGhii };
}

/**
 * Unwind every accrual booked against one call, because the call was refunded.
 *
 * Reverses only what is still `accrued`. An entry the provider already released is real money that
 * has left their hands, and a refund of the underlying call cannot reach into a third party's account
 * to claw it back — the provider carries that, which is the cost of releasing before the dust settles.
 */
export async function reverseAccrual(
  storage: Storage, trackingCode: string, fromGhii: string,
): Promise<number> {
  const { items } = await storage.listAllMemory({ prefix: benefitKey(trackingCode), limit: 200 });
  let reversed = 0;
  for (const rec of items) {
    const changed = await settleEntryStatus(storage, {
      beneficiaryGhii: rec.ownerGaii, trackingCode, fromGhii, to: 'reversed',
    });
    if (changed) reversed += 1;
  }
  return reversed;
}

function entriesOf(value: unknown): BeneficiaryEntry[] {
  return (value as { items?: BeneficiaryEntry[] } | undefined)?.items ?? [];
}

function flatten(
  records: Array<{ key: string; value: unknown }>,
): Array<BeneficiaryEntry & { trackingCode: string }> {
  const out: Array<BeneficiaryEntry & { trackingCode: string }> = [];
  for (const rec of records) {
    const trackingCode = rec.key.slice('commerce.benefit.'.length);
    for (const e of entriesOf(rec.value)) out.push({ ...e, trackingCode });
  }
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}
