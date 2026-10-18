/**
 * @file src/commerce/beneficiary-book.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-10-18 — bookBeneficiaryShares, settleEntryStatus and markEntriesPaid write the record on its
 *     version (updateBook, services/record-cas.ts) and decide on the stored entries, re-read when
 *     another writer wrote in between (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *   2026-10-16 — Both reads return every entry, newest first, and `limit` caps what is returned, not
 *     what is read. The earnings read took the beneficiary's first N records in key order, and the
 *     obligations read the first 1000 records of every beneficiary on the node before filtering on the
 *     provider, so totals and payouts were short past those counts (QA audit S8-10).
 *   v1.0.0 — 2026-07-30 — Initial: the accrual half of multi-beneficiary revenue splitting.
 */
import type { Storage } from '../storage/interface.js';
import { listAllMemoryPages } from '../storage/memory-pages.js';
import { updateRecord, UNCHANGED } from '../services/record-cas.js';
import type { SplitLine } from './beneficiary-split.js';

/** One line in a beneficiary's book — a share of one settled call. */
export interface BeneficiaryEntry {
  /**
   * Integer 6-decimal micro-units of `currency`. ALWAYS money.
   *
   * Morsels never appear in this book. They are the node's pacing meter — they bound how often a
   * capability may be called — and are neither money nor a proportion of it, so a morsel-priced call
   * has nothing here to divide. A beneficiary share is revenue or it is not a share.
   */
  amount: number;
  currency: string;
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
  /**
   * `accrued` — owed, and the provider has not agreed to pay it yet.
   * `released` — the provider owns the debt: payable, and on the beneficiary's book.
   * `paid` — the money actually reached them, with the rail and the external reference that proves it.
   * `reversed` — the call it came from was refunded, so the obligation never matured.
   *
   * `released` and `paid` are deliberately separate. Collapsing them would mean a book that cannot
   * tell an agreed debt from a settled one, which is the difference a beneficiary actually cares about.
   */
  status: 'accrued' | 'released' | 'paid' | 'reversed';
  releasedAt?: string;
  /** How it was released: a morsel transfer, or booked onto the beneficiary's payable book. */
  releaseMethod?: string;
  /** When the money actually landed. */
  paidAt?: string;
  /** The rail that moved it, e.g. `x402:base-sepolia` or `invoice`. */
  payoutRail?: string;
  /** What proves it: an onchain transaction hash, a bank reference, an invoice number. */
  payoutReference?: string;
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
    currency: string;
    buyerGhii?: string;
    reference?: string;
  },
): Promise<number> {
  let booked = 0;
  for (const line of args.lines) {
    if (line.amount <= 0) continue;
    let added = false;
    await updateBook(storage, line.ghii, args.trackingCode, (value, items) => {
      added = !items.some(i => i.fromGhii === args.fromGhii);   // already booked — a retry, not a second sale
      if (!added) return UNCHANGED;
      return { ...value, items: [...items, {
        amount: line.amount,
        currency: args.currency,
        fromGhii: args.fromGhii,
        buyerGhii: args.buyerGhii,
        reference: args.reference,
        weight: line.weight,
        kind: line.kind,
        note: line.note || undefined,
        status: 'accrued',
        at: new Date().toISOString(),
      }] };
    });
    if (added) booked += 1;
  }
  return booked;
}

type Book = { items?: BeneficiaryEntry[] } & Record<string, unknown>;
const parseBook = (v: unknown): Book => ({ ...((v as Book | null | undefined) ?? {}) });

/**
 * Change one beneficiary's record of one tracking code on its version (services/record-cas.ts):
 * `change` gets the stored value and a copy of its entries, and runs again on the fresh record when
 * another writer wrote it in between, so a check it makes is made on what is stored.
 */
function updateBook(
  storage: Storage, beneficiaryGhii: string, trackingCode: string,
  change: (value: Book, items: BeneficiaryEntry[]) => Book | typeof UNCHANGED,
): Promise<Book> {
  return updateRecord(storage, beneficiaryGhii, benefitKey(trackingCode), parseBook,
    cur => change(cur, Array.isArray(cur.items) ? cur.items.map(i => ({ ...i })) : []),
    { tag: 'beneficiary', tags: ['commerce', 'beneficiary'], visibility: 'owner' });
}

/**
 * What a beneficiary is owed and has been paid, newest first. Every record of the beneficiary is
 * read, on their own identity; `limit` caps how many entries come back, after the sort.
 */
export async function listBeneficiaryEntries(
  storage: Storage, beneficiaryGhii: string, limit = Infinity,
): Promise<Array<BeneficiaryEntry & { trackingCode: string }>> {
  const items = await storage.listMemory(beneficiaryGhii, { prefix: 'commerce.benefit.' });
  return flatten(items).slice(0, limit);
}

/**
 * What a PROVIDER owes, across every beneficiary.
 *
 * A prefix scan filtered on `fromGhii` rather than a mirrored per-provider record: the obligation has
 * one authoritative row, and both parties read the same one. Same shape `listAllEntitlements` already
 * uses. The scan reads every record under the prefix, page by page (storage/memory-pages.ts): a
 * window of 1000 records across every beneficiary dropped this provider's entries past it.
 * `limit` caps how many entries come back, after the sort.
 */
export async function listBeneficiaryObligations(
  storage: Storage, providerGhii: string, limit = Infinity,
): Promise<Array<BeneficiaryEntry & { trackingCode: string; beneficiaryGhii: string }>> {
  const { items } = await listAllMemoryPages(storage, { prefix: 'commerce.benefit.' });
  const out: Array<BeneficiaryEntry & { trackingCode: string; beneficiaryGhii: string }> = [];
  for (const rec of items) {
    const trackingCode = rec.key.slice('commerce.benefit.'.length);
    for (const e of entriesOf(rec.value)) {
      if (e.fromGhii === providerGhii) out.push({ ...e, trackingCode, beneficiaryGhii: rec.ownerGaii });
    }
  }
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, limit);
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
  // Decided on the stored record: of two releases at the same moment, one changes the entry and the
  // other finds nothing accrued and answers null, so only one caller moves the money.
  let changed: BeneficiaryEntry | null = null;
  await updateBook(storage, args.beneficiaryGhii, args.trackingCode, (value, items) => {
    const entry = items.find(i => i.fromGhii === args.fromGhii && i.status === 'accrued');
    changed = entry ?? null;
    if (!entry) return UNCHANGED;
    entry.status = args.to;
    entry.releasedAt = new Date().toISOString();
    if (args.releaseMethod) entry.releaseMethod = args.releaseMethod;
    return { ...value, items };
  });
  return changed ? { ...(changed as BeneficiaryEntry), beneficiaryGhii: args.beneficiaryGhii } : null;
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

/**
 * Mark released entries as PAID, once a rail has confirmed the money moved.
 *
 * Only ever moves `released` onwards, so a confirmation that arrives twice cannot pay twice and a
 * still-accrued share cannot be marked settled without the provider first owning the debt. Returns
 * how many entries it actually changed, which is what the caller reports rather than what it asked for.
 */
export async function markEntriesPaid(
  storage: Storage,
  args: { beneficiaryGhii: string; fromGhii: string; trackingCodes: string[]; rail: string; reference: string },
): Promise<number> {
  const now = new Date().toISOString();
  let changed = 0;
  for (const trackingCode of args.trackingCodes) {
    let found = false;
    await updateBook(storage, args.beneficiaryGhii, trackingCode, (value, items) => {
      const entry = items.find(i => i.fromGhii === args.fromGhii && i.status === 'released');
      found = !!entry;
      if (!entry) return UNCHANGED;
      entry.status = 'paid';
      entry.paidAt = now;
      entry.payoutRail = args.rail;
      if (args.reference) entry.payoutReference = args.reference;
      return { ...value, items };
    });
    if (found) changed += 1;
  }
  return changed;
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

/** One currency's headline, split by the four states an entry can be in. */
export interface BeneficiaryTotals {
    accrued: number;
    released: number;
    paid: number;
    reversed: number;
    entries: number;
}

/**
 * Sum entries into the headline a reader actually wants: by status, and bucketed by CURRENCY.
 *
 * Money micros and morsels are different kinds of quantity, so they are never added together — and
 * there is no morsel bucket at all, because morsels pace usage and are never shared. Getting that
 * wrong produces a number that looks like money and is not.
 *
 * It lived twice, once per door. Two ways of totalling the same ledger is two answers to "what am I
 * owed", which is the one question this whole surface exists to answer.
 */
export function totalsOf(entries: BeneficiaryEntry[]): Record<string, BeneficiaryTotals> {
    const totals: Record<string, BeneficiaryTotals> = {};
    for (const e of entries) {
        const bucket = e.currency;
        const t = totals[bucket] ?? (totals[bucket] = { accrued: 0, released: 0, paid: 0, reversed: 0, entries: 0 });
        t[e.status] += e.amount;
        t.entries += 1;
    }
    return totals;
}
