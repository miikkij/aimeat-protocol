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
 *   (`commerce.possible.payout.<nonce>`, a service-owned prefix no memory route rewrites) with the
 *   nonce, the payer, the amount and the entries the signature covered; it logs at error level and
 *   notifies the beneficiary to look for the transfer. The provider is answered 502
 *   X402_SETTLE_UNKNOWN, in plain words: do not sign again yet. While the record is open, the quote
 *   leaves those entries out and names the record, so a new signature cannot cover them a second
 *   time; entries released later are quoted as before.
 *
 *   CLOSING IT. The provider checks their wallet. When the transfer did not arrive, they send
 *   `possible_payment_not_arrived: <nonce>` to POST /v1/commerce/beneficiary/payout (or the MCP
 *   tool), and the entries are quoted again. A transfer that did arrive keeps the record open and the
 *   entries out of the quote, so they are not paid twice; marking them paid from chain evidence is
 *   not done here.
 * @structure PAYOUT_HOLD_PREFIX · PayoutHold · openPayoutHolds · heldTrackingCodes · keepPayoutHold · closePayoutHoldNotArrived
 * @usage const holds = await openPayoutHolds(storage, provider, beneficiary, currency);
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26, commerce/beneficiary-payout:settle-error-unrecorded-possible-payment).
 */
import type { Storage } from '../storage/interface.js';
import { putRecord } from './platform-fee.js';
import { logger } from '../utils/logger.js';
import { notify } from '../services/notify.js';

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
  status: 'unconfirmed' | 'not-arrived';
  createdAt: string;
  closedAt?: string;
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
  const rec = await storage.getMemory(providerGhii, key);
  const hold = rec?.value as unknown as PayoutHold | undefined;
  if (!hold || hold.status !== 'unconfirmed' || hold.beneficiary !== beneficiaryGhii) return null;
  const closed: PayoutHold = { ...hold, status: 'not-arrived', closedAt: new Date().toISOString() };
  await putRecord(storage, providerGhii, key, closed);
  logger.info('[beneficiary-payout] possible payout closed: the provider says it did not arrive', { provider: providerGhii, beneficiary: beneficiaryGhii, nonce });
  return closed;
}
