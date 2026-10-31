/**
 * @file src/commerce/beneficiary-payout-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A beneficiary payout whose x402 settlement did not answer: the facilitator's /settle
 *   call timed out, failed on the network or answered a server error, so the transfer from the
 *   provider to the beneficiary may or may not have gone out.
 *
 *   WHY. settleBeneficiaryPayout awaited the settle with no catch. The error left the route as a
 *   server error, nothing kept the nonce or the payer, and the entries stayed released, so the next
 *   quote offered the same balance for a new signature. A provider who signed again could pay the
 *   beneficiary twice, and the node had no record that a transfer may already have gone out
 *   (secaudit2026oct26, commerce/beneficiary-payout:settle-error-unrecorded-possible-payment). The
 *   checkout and A2A doors got the same treatment on 2026-10-25 (possible-payment.ts).
 *
 *   WHAT HAPPENS NOW. The node keeps a possible-payout record under the provider's GHII
 *   (`commerce.possible.payout.<nonce>`, the provider's own record: what they change in it only moves
 *   their own entries in or out of their own quote) with the
 *   nonce, the payer, the amount and the entries the signature covered; it logs at error level and
 *   notifies the beneficiary to look for the transfer. The provider is answered 502
 *   X402_SETTLE_UNKNOWN, in plain words: do not sign again yet. While the record is open, the quote
 *   leaves those entries out and names the record, so a new signature cannot cover them a second
 *   time; entries released later are quoted as before.
 *
 *   CLOSING IT. The provider checks their wallet. When the transfer did not arrive, they send
 *   `possible_payment_not_arrived: <nonce>` to POST /v1/commerce/beneficiary/payout (or the MCP
 *   tool), and the entries are quoted again. A transfer that did arrive keeps the record open and the
 *   entries out of the quote, so they are not paid twice.
 *
 *   ARRIVED. The operator, who reads the chain, marks a held payout as arrived with a reference (the
 *   transaction hash or the case number): GET and POST /v1/commerce/beneficiary/possible-payouts, the
 *   MCP tool aimeat_admin_possible_payouts and its CLI twin, and the Economy page. The covered entries
 *   are marked paid with that reference, the record closes as 'arrived', and the beneficiary and the
 *   provider are told (markPayoutHoldArrived). A record whose entries do not add up to its amount in
 *   the beneficiary's book is refused: the record lives in the provider's own namespace, so only the
 *   book says what was owed.
 * @structure PAYOUT_HOLD_PREFIX · PayoutHold · openPayoutHolds · heldTrackingCodes · keepPayoutHold ·
 *   closePayoutHoldNotArrived · listOpenPayoutHoldsOnNode · markPayoutHoldArrived
 * @usage const holds = await openPayoutHolds(storage, provider, beneficiary, currency);
 * @version-history
 *   v1.1.1 -- 2026-10-31 -- markPayoutHoldArrived closes a record the provider closed as not arrived
 *     between its check and its write as 'arrived', because the entries were already marked paid: the
 *     operator was answered CONFLICT, the record said not arrived, the book said paid, and nobody was
 *     told (secaudit 2026-10-31 inv-02).
 *   v1.1.0 -- 2026-10-29 -- The operator marks a held payout as arrived with a reference: the entries are
 *     paid, the record closes, the beneficiary and the provider are told (secaudit2026oct26 round 8c,
 *     commerce/beneficiary-payout:settle-error-unrecorded-possible-payment).
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26, commerce/beneficiary-payout:settle-error-unrecorded-possible-payment).
 */
import type { Storage } from '../storage/interface.js';
import { putRecord } from './platform-fee.js';
import { logger } from '../utils/logger.js';
import { notify } from '../services/notify.js';
import { updateRecord, UNCHANGED } from '../services/record-cas.js';
import { listAllMemoryPages } from '../storage/memory-pages.js';
import { listBeneficiaryEntries, markEntriesPaid } from './beneficiary-book.js';

/** Key prefix of the possible-payout record under the provider's GHII. */
export const PAYOUT_HOLD_PREFIX = 'commerce.possible.payout.';

export interface PayoutHold {
  type: 'aimeat:PossiblePayout';
  about: string;
  provider: string;
  beneficiary: string;
  currency: string;
  /** Micros of `currency`, as signed. */
  amount: number;
  nonce: string;
  payer: string;
  payTo: string;
  network: string;
  /** The beneficiary entries the signature covered. */
  trackingCodes: string[];
  reason: string;
  status: 'unconfirmed' | 'not-arrived' | 'arrived';
  createdAt: string;
  closedAt?: string;
  /** Set when the operator marked it arrived: the reference they gave, and who they are. */
  arrivedReference?: string;
  closedBy?: string;
}

/** The provider's open possible payouts to one beneficiary in one currency. */
export async function openPayoutHolds(
  storage: Storage, providerGhii: string, beneficiaryGhii: string, currency: string,
): Promise<PayoutHold[]> {
  const rows = await storage.listMemory(providerGhii, { prefix: PAYOUT_HOLD_PREFIX });
  return rows.map(r => r.value as unknown as PayoutHold)
    .filter(h => h && h.status === 'unconfirmed' && h.beneficiary === beneficiaryGhii && h.currency === currency);
}

/** The tracking codes an open possible payout covers. */
export function heldTrackingCodes(holds: PayoutHold[]): Set<string> {
  return new Set(holds.flatMap(h => h.trackingCodes));
}

/** Keep and announce a possible payout. Never throws; each failure is logged. */
export async function keepPayoutHold(
  storage: Storage, hold: Omit<PayoutHold, 'type' | 'about' | 'status' | 'createdAt'>,
): Promise<void> {
  const money = `${(hold.amount / 1_000_000).toFixed(2)} ${hold.currency}`;
  const record: PayoutHold = {
    type: 'aimeat:PossiblePayout',
    about: 'The payment service did not answer when this payout was settled, so it is not known whether the transfer went out. '
      + 'Check the wallet for a transfer with this nonce. While this record is open, these entries are left out of the payout quote. '
      + 'If the transfer did not arrive, send possible_payment_not_arrived with this nonce to POST /v1/commerce/beneficiary/payout.',
    ...hold,
    reason: hold.reason.slice(0, 300),
    status: 'unconfirmed',
    createdAt: new Date().toISOString(),
  };
  logger.error('[beneficiary-payout] x402 settlement outcome unknown: possible payout kept for the provider', {
    provider: hold.provider, beneficiary: hold.beneficiary, amount: hold.amount, currency: hold.currency, nonce: hold.nonce, payer: hold.payer, reason: record.reason,
  });
  try {
    await putRecord(storage, hold.provider, `${PAYOUT_HOLD_PREFIX}${hold.nonce}`, record);
  } catch (err) {
    logger.error('[beneficiary-payout] the possible-payout record could not be stored', { nonce: hold.nonce, error: String(err) });
  }
  // notify() is best-effort and never throws.
  await notify(storage, hold.beneficiary, {
    type: 'payout_possible',
    title: `A payout of ${money} may have arrived`,
    body: `The payment service did not answer when ${hold.provider} paid you, so it is not known whether the money arrived. Check your payout address for a transfer from ${hold.payer}. Reference: ${hold.nonce}.`,
    i18n: { key: 'payout_possible', vars: { amount: money, provider: hold.provider, payer: hold.payer, reference: hold.nonce } },
  });
}

/**
 * The provider says the transfer of `nonce` did not arrive: the record closes and its entries are
 * quoted again. Null when no open record of this provider and beneficiary has that nonce.
 */
export async function closePayoutHoldNotArrived(
  storage: Storage, providerGhii: string, beneficiaryGhii: string, nonce: string,
): Promise<PayoutHold | null> {
  const key = `${PAYOUT_HOLD_PREFIX}${nonce}`;
  let closed: PayoutHold | null = null;
  // On the record's version, so two closes at once close it once.
  await updateRecord<PayoutHold | null>(storage, providerGhii, key, v => (v ?? null) as PayoutHold | null, hold => {
    if (!hold || hold.status !== 'unconfirmed' || hold.beneficiary !== beneficiaryGhii) return UNCHANGED;
    closed = { ...hold, status: 'not-arrived', closedAt: new Date().toISOString() };
    return closed;
  }, { tag: 'commerce', visibility: 'owner', tags: ['commerce'] });
  if (!closed) return null;
  logger.info('[beneficiary-payout] possible payout closed: the provider says it did not arrive', { provider: providerGhii, beneficiary: beneficiaryGhii, nonce });
  return closed;
}

/** The parse of one stored record, or null when it is not a possible payout kept under its own provider. */
function holdOf(ownerGaii: string, value: unknown): PayoutHold | null {
  const h = value as PayoutHold | null | undefined;
  if (!h || h.type !== 'aimeat:PossiblePayout' || h.provider !== ownerGaii) return null;
  if (typeof h.nonce !== 'string' || typeof h.beneficiary !== 'string' || !Array.isArray(h.trackingCodes)) return null;
  return h;
}

/** Every open possible payout on this node, oldest first: what the operator checks against the chain. */
export async function listOpenPayoutHoldsOnNode(storage: Storage): Promise<PayoutHold[]> {
  const { items } = await listAllMemoryPages(storage, { prefix: PAYOUT_HOLD_PREFIX });
  return items.map(r => holdOf(r.ownerGaii, r.value))
    .filter((h): h is PayoutHold => !!h && h.status === 'unconfirmed')
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/** One possible payout as the operator reads it (REST, MCP and the Economy page). */
export function possiblePayoutView(h: PayoutHold): Record<string, unknown> {
  return {
    provider: h.provider, beneficiary: h.beneficiary, nonce: h.nonce, amount: h.amount, currency: h.currency,
    payer: h.payer, pay_to: h.payTo, network: h.network, entries: h.trackingCodes.length, reason: h.reason,
    status: h.status, created_at: h.createdAt, closed_at: h.closedAt ?? null, reference: h.arrivedReference ?? null,
  };
}

export type MarkArrivedResult =
  | { ok: true; hold: PayoutHold; entries: number }
  | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT'; message: string };

/**
 * The operator saw the transfer of a held payout arrive: its entries are marked paid with `reference`,
 * the record closes as 'arrived', and the beneficiary and the provider are told. The entries are paid
 * first and the record closed after, so a failure between the two leaves the entries out of every
 * quote (they read paid) rather than payable a second time; two presses at once pay the entries once
 * (markEntriesPaid moves only released entries) and close the record once. A not-arrived close from
 * the provider that lands between the check and the close is overwritten as 'arrived', because the
 * entries it would quote again are already paid.
 */
export async function markPayoutHoldArrived(
  storage: Storage, args: { providerGhii: string; nonce: string; reference: string; by: string },
): Promise<MarkArrivedResult> {
  const reference = args.reference.trim().slice(0, 300);
  if (!reference) return { ok: false, code: 'INVALID_INPUT', message: 'Give the reference that shows the transfer arrived: the transaction hash or your own case number.' };
  const key = `${PAYOUT_HOLD_PREFIX}${args.nonce}`;
  const rec = await storage.getMemory(args.providerGhii, key);
  const hold = holdOf(args.providerGhii, rec?.value);
  if (!hold) return { ok: false, code: 'NOT_FOUND', message: 'This provider has no possible payout with that nonce.' };
  if (hold.status !== 'unconfirmed') return { ok: false, code: 'CONFLICT', message: `This possible payout is closed already (${hold.status}).` };

  // The record is the provider's own, so the beneficiary's book says what the signature covered.
  const codes = new Set(hold.trackingCodes);
  const covered = (await listBeneficiaryEntries(storage, hold.beneficiary))
    .filter(e => codes.has(e.trackingCode) && e.fromGhii === hold.provider && e.currency === hold.currency
      && (e.status === 'released' || e.status === 'paid'));
  const sum = covered.reduce((s, e) => s + e.amount, 0);
  if (!covered.length || sum !== hold.amount) {
    return { ok: false, code: 'CONFLICT', message: `The beneficiary's book does not show ${hold.amount} owed for these entries (it shows ${sum}), so nothing was marked paid.` };
  }

  const paid = await markEntriesPaid(storage, {
    beneficiaryGhii: hold.beneficiary, fromGhii: hold.provider, trackingCodes: hold.trackingCodes,
    rail: `x402:${hold.network}`, reference,
  });
  let closed: PayoutHold | null = null;
  await updateRecord<PayoutHold | null>(storage, args.providerGhii, key, v => (v ?? null) as PayoutHold | null, cur => {
    // 'not-arrived' here means the provider's close landed after the check above and before this
    // write: the entries are already paid on the operator's reading of the chain, so the record
    // says what the book says. A second press finds 'arrived' and changes nothing.
    if (!cur || (cur.status !== 'unconfirmed' && cur.status !== 'not-arrived')) return UNCHANGED;
    closed = { ...cur, status: 'arrived', closedAt: new Date().toISOString(), arrivedReference: reference, closedBy: args.by };
    return closed;
  }, { tag: 'commerce', visibility: 'owner', tags: ['commerce'] });
  if (!closed) return { ok: false, code: 'CONFLICT', message: 'Someone closed this possible payout at the same moment.' };
  const done = closed as PayoutHold;
  logger.info('[beneficiary-payout] possible payout marked arrived by the operator', {
    provider: done.provider, beneficiary: done.beneficiary, nonce: done.nonce, amount: done.amount, currency: done.currency, reference, by: args.by, entries: paid,
  });

  const money = `${(done.amount / 1_000_000).toFixed(2)} ${done.currency}`;
  await notify(storage, done.beneficiary, {
    type: 'payout_arrived',
    title: `The payment of ${money} arrived`,
    body: `The people who run this server checked that the payment of ${money} from ${done.provider} arrived. It is now recorded as paid. Reference: ${reference}.`,
    i18n: { key: 'payout_arrived', vars: { amount: money, provider: done.provider, reference } },
  });
  await notify(storage, done.provider, {
    type: 'payout_arrived_provider',
    title: `Your payment of ${money} arrived`,
    body: `The people who run this server checked that your payment of ${money} to ${done.beneficiary} arrived. It is now recorded as paid, and you do not need to pay it again. Reference: ${reference}.`,
    i18n: { key: 'payout_arrived_provider', vars: { amount: money, beneficiary: done.beneficiary, reference } },
  });
  return { ok: true, hold: done, entries: paid };
}
