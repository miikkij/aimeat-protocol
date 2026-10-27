/**
 * @file src/commerce/beneficiary-payout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The last leg: money actually reaching a beneficiary, onchain, without the node ever
 *   holding it.
 *
 *   WHY THIS COULD NOT JUST CALL AN EXISTING PAYOUT LEG. Neither money handler can push. Stripe's
 *   `payout` is a book entry because there is no Connect platform here by design — a seller charges
 *   on their own credentials and cannot move funds to a stranger's bank. x402's `payout` is a no-op
 *   because the money already moved buyer→seller at collect time. A provider→beneficiary transfer is
 *   a DIFFERENT payment, from a different payer, and the payer has to authorise it.
 *
 *   So the node orchestrates and the PROVIDER signs. Same x402 exact-scheme machinery the checkout
 *   already uses, pointed the other way: this builds the requirements for what the provider owes,
 *   the provider signs an EIP-3009 authorisation with their own wallet, and the facilitator settles
 *   it onchain into the beneficiary's own address. The node holds no key and no funds at any
 *   instant; it knows what is owed and can prove what settled.
 *
 *   THE BENEFICIARY'S ADDRESS IS THEIR OWN. It is read from their `commerce.psp` — the same record
 *   they would use to sell — so nobody registers where somebody else gets paid, and a beneficiary
 *   who has set nothing simply cannot be pushed to. That is not a failure: the obligation stays
 *   released-and-unpaid, which is exactly what an unpaid invoice is.
 * @structure BeneficiaryPayoutQuote · quoteBeneficiaryPayout · settleBeneficiaryPayout
 * @usage
 *   const q = await quoteBeneficiaryPayout(storage, config, { providerGhii, beneficiaryGhii });
 *   // provider signs q.accepts[0] → X-PAYMENT
 *   const r = await settleBeneficiaryPayout(storage, config, { ...same, payload });
 * @version-history
 *   2026-10-27 — A settle that throws is kept as a possible payout (beneficiary-payout-hold.ts): the
 *     answer is X402_SETTLE_UNKNOWN, the covered entries leave the quote until the provider sends
 *     notArrivedNonce, and the beneficiary is notified (secaudit2026oct26,
 *     commerce/beneficiary-payout:settle-error-unrecorded-possible-payment).
 *   2026-10-16 — The payout quote sums every released entry, not those in the first 1000 records (QA audit S8-10).
 *   v1.0.0 — 2026-07-30 — Initial: the provider-signed x402 leg that pays a beneficiary for real.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { listBeneficiaryEntries, markEntriesPaid, type BeneficiaryEntry } from './beneficiary-book.js';
import {
  getX402Network, getX402Asset, buildExactRequirements, extractPayTo, httpFacilitator, testFacilitator,
  type X402PaymentPayload, type X402PaymentRequirements,
} from './x402-facilitator.js';
import { logger } from '../utils/logger.js';
import { openPayoutHolds, heldTrackingCodes, keepPayoutHold, closePayoutHoldNotArrived } from './beneficiary-payout-hold.js';

/** What one provider owes one beneficiary right now, and how to pay it. */
export interface BeneficiaryPayoutQuote {
  ok: boolean;
  reason?: string;
  message?: string;
  /** The released-but-unpaid entries this quote covers, oldest first. */
  entries: Array<BeneficiaryEntry & { trackingCode: string }>;
  amount: number;
  currency: string;
  /** The beneficiary's own onchain address, from their own record. */
  payTo?: string;
  /** x402 exact-scheme requirements for the provider to sign. */
  requirements?: X402PaymentRequirements;
  /** Earlier payouts whose settlement did not answer; their entries are left out (beneficiary-payout-hold.ts). */
  possiblePayments?: Array<{ nonce: string; amount: number; createdAt: string }>;
}

const facilitatorFor = (config: AimeatConfig) =>
  config.x402TestFacilitator ? testFacilitator() : httpFacilitator(config.x402FacilitatorUrl);

/**
 * Everything a provider still owes one beneficiary in one currency, plus the requirements to settle
 * it in a single onchain transfer.
 *
 * AGGREGATED on purpose. A share is a fraction of a sub-euro call; paying each one separately would
 * cost more in gas than the share is worth, and would ask the provider to sign hundreds of times.
 * One signature clears the whole outstanding balance, which is also how an invoice period works.
 */
export async function quoteBeneficiaryPayout(
  storage: Storage,
  config: AimeatConfig,
  args: { providerGhii: string; beneficiaryGhii: string; currency?: string },
): Promise<BeneficiaryPayoutQuote> {
  const currency = (args.currency ?? 'EUR').toUpperCase();
  // Every entry: the payout amount is a sum, and a window of 1000 made it short (QA audit S8-10).
  const all = await listBeneficiaryEntries(storage, args.beneficiaryGhii);
  // A payout whose settlement did not answer may have moved the money: the entries it covered stay
  // out of the quote until the provider says it did not arrive (beneficiary-payout-hold.ts).
  const holds = await openPayoutHolds(storage, args.providerGhii, args.beneficiaryGhii, currency);
  const held = heldTrackingCodes(holds);
  const possiblePayments = holds.length ? holds.map(h => ({ nonce: h.nonce, amount: h.amount, createdAt: h.createdAt })) : undefined;
  // `released` is the payable state: accrued means the provider has not agreed to pay it yet, and
  // paid means it already left. Anything else is not owed today.
  const entries = all
    .filter(e => e.fromGhii === args.providerGhii && e.currency === currency && e.status === 'released' && !held.has(e.trackingCode))
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const amount = entries.reduce((sum, e) => sum + e.amount, 0);

  if ((!entries.length || amount <= 0) && possiblePayments) {
    return { ok: false, reason: 'POSSIBLE_PAYMENT_OPEN', entries: [], amount: 0, currency, possiblePayments,
      message: 'An earlier payout to this beneficiary may already have gone out: the payment service did not answer. '
        + 'Check your wallet for that transfer. If it did not arrive, send possible_payment_not_arrived with its nonce, and the amount is quoted again.' };
  }
  if (!entries.length || amount <= 0) {
    return { ok: false, reason: 'NOTHING_OWED', entries: [], amount: 0, currency,
      message: `You owe this beneficiary nothing released and unpaid in ${currency}` };
  }

  const network = getX402Network(config.x402Network);
  if (!network) {
    return { ok: false, reason: 'X402_NETWORK_UNKNOWN', entries, amount, currency,
      message: `The node's x402 network is not in the registry: ${config.x402Network}` };
  }
  const asset = getX402Asset(network, currency);
  if (!asset) {
    return { ok: false, reason: 'X402_CURRENCY_UNSUPPORTED', entries, amount, currency,
      message: `x402 cannot settle ${currency} on ${network.id}: no settlement asset for that pair` };
  }
  // The beneficiary's own address, from their own record. Nobody sets where somebody else is paid.
  const payTo = extractPayTo((await storage.getMemory(args.beneficiaryGhii, 'commerce.psp'))?.value);
  if (!payTo) {
    return { ok: false, reason: 'BENEFICIARY_NO_ADDRESS', entries, amount, currency,
      message: 'This beneficiary has no stablecoin payout address configured, so they cannot be paid '
        + 'onchain. The obligation stays released and unpaid until they set one, or you settle it '
        + 'off-node and record it.' };
  }

  return {
    ok: true, entries, amount, currency, payTo, ...(possiblePayments ? { possiblePayments } : {}),
    requirements: buildExactRequirements({
      network, asset, payTo, amountMicros: amount,
      resource: `${config.baseUrl}/v1/commerce/beneficiary/payout`,
      description: `AIMEAT beneficiary share ${args.providerGhii} → ${args.beneficiaryGhii}`,
    }),
  };
}

/** What settling produced. */
export type BeneficiaryPayoutResult =
  | { ok: true; amount: number; currency: string; entries: number; txHash: string | null; payTo: string }
  | { ok: true; closed: true; nonce: string; amount: number; currency: string }
  | { ok: false; reason: string; message: string };

/**
 * Settle the whole outstanding balance with the provider's signed authorisation.
 *
 * The quote is rebuilt here rather than trusted from the request, so a signature can only ever move
 * what is actually owed at this instant — a stale or hand-edited amount verifies against the current
 * requirements and fails. Entries flip to `paid` only AFTER the facilitator confirms, so a failed
 * settlement leaves them payable rather than marking money delivered that never was.
 */
export async function settleBeneficiaryPayout(
  storage: Storage,
  config: AimeatConfig,
  args: { providerGhii: string; beneficiaryGhii: string; currency?: string; payload?: X402PaymentPayload; notArrivedNonce?: string },
): Promise<BeneficiaryPayoutResult> {
  // The provider checked the wallet and the transfer of an earlier unanswered settlement did not
  // arrive: its entries are quoted again (beneficiary-payout-hold.ts).
  if (args.notArrivedNonce) {
    const closed = await closePayoutHoldNotArrived(storage, args.providerGhii, args.beneficiaryGhii, args.notArrivedNonce);
    if (!closed) return { ok: false, reason: 'NOT_FOUND', message: 'No open possible payout to this beneficiary has that nonce.' };
    return { ok: true, closed: true, nonce: closed.nonce, amount: closed.amount, currency: closed.currency };
  }
  const quote = await quoteBeneficiaryPayout(storage, config, args);
  if (!quote.ok || !quote.requirements || !quote.payTo) {
    return { ok: false, reason: quote.reason ?? 'NOT_PAYABLE', message: quote.message ?? 'Not payable' };
  }
  if (!args.payload?.payload?.authorization?.nonce) {
    return { ok: false, reason: 'PAYMENT_REQUIRED', message: 'Sign the exact-scheme requirements and retry with the signed payload' };
  }

  const facilitator = facilitatorFor(config);
  const verified = await facilitator.verify(args.payload, quote.requirements);
  if (!verified.isValid) {
    return { ok: false, reason: 'X402_VERIFY_FAILED', message: `The authorisation did not verify: ${verified.invalidReason ?? 'unknown reason'}` };
  }
  // A settle that throws (a timeout, a network failure, a non-2xx answer) has an UNKNOWN outcome: the
  // transfer may have gone out. The node keeps it and the provider is told not to sign again yet.
  let settled: Awaited<ReturnType<typeof facilitator.settle>>;
  try {
    settled = await facilitator.settle(args.payload, quote.requirements);
  } catch (err) {
    const auth = args.payload.payload.authorization;
    await keepPayoutHold(storage, {
      provider: args.providerGhii, beneficiary: args.beneficiaryGhii, currency: quote.currency, amount: quote.amount,
      nonce: auth.nonce, payer: auth.from ?? '', payTo: quote.payTo, network: quote.requirements.network,
      trackingCodes: quote.entries.map(e => e.trackingCode), reason: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false, reason: 'X402_SETTLE_UNKNOWN',
      message: 'The payment service did not answer in time, so it is not known whether your transfer went through. Do not sign again yet. '
        + `Check your wallet for the transfer with nonce ${auth.nonce}; the beneficiary was told too. These entries stay out of the next quote. `
        + 'If the transfer did not arrive, send possible_payment_not_arrived with that nonce, and the amount is quoted again.',
    };
  }
  if (!settled.success) {
    return { ok: false, reason: 'X402_SETTLE_FAILED', message: `Settlement failed (replay or onchain error): ${settled.errorReason ?? 'unknown reason'}` };
  }

  const txHash = settled.transaction ?? null;
  const paid = await markEntriesPaid(storage, {
    beneficiaryGhii: args.beneficiaryGhii, fromGhii: args.providerGhii,
    trackingCodes: quote.entries.map(e => e.trackingCode),
    rail: `x402:${quote.requirements.network}`, reference: txHash ?? '',
  });
  logger.info('[beneficiary-payout] settled onchain', {
    provider: args.providerGhii, beneficiary: args.beneficiaryGhii,
    amount: quote.amount, currency: quote.currency, entries: paid, txHash,
  });
  return { ok: true, amount: quote.amount, currency: quote.currency, entries: paid, txHash, payTo: quote.payTo };
}
