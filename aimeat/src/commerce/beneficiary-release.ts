/**
 * @file src/commerce/beneficiary-release.ts
 * @description The gate between "owed" and "paid" for a beneficiary share, and the release itself.
 *
 *   ACCRUING AND PAYING ARE DIFFERENT ACTS, and only one of them is safe to do automatically. A share
 *   booked to a GHII that turns out to represent nobody is a wrong number in a book, correctable. The
 *   same share PAID is money gone to whoever claimed loudest. So accrual is unconditional — it must
 *   never block a call, never wait on paperwork, and never silently vanish — while release refuses
 *   until an operator has recorded an approval for that beneficiary.
 *
 *   THE APPROVAL IS A RECORD, NOT A CONVENTION. `BeneficiaryApproval` lives in a system namespace no
 *   principal can write, is set only by an operator role, and defaults to `unverified` by ABSENCE — so
 *   a beneficiary nobody has checked cannot be paid by anyone forgetting to check. Its `subject` field
 *   carries the external identity the approval attests to (a company register id, a bank reference)
 *   without the core ever interpreting it: what a `fi-ytunnus:` means, and what evidence is good enough
 *   for one, is the application's business and the operator's judgement, not this file's.
 *
 *   WHAT RELEASE ACTUALLY DOES, per rail, and it is deliberately not the same thing. Note what the
 *   difference is NOT: it is not "one rail is real and the other is not". Morsels are the node's own
 *   PACING meter, a consumption budget that bounds how fast a capability can be called; they are not
 *   currency, and a morsel share is capacity rather than income. EUR and USD are the real money. Both
 *   are recorded in the ledger; what differs is whether settlement COMPLETES here.
 *     - `morsels` — an atomic in-repo `transferBalance` from the provider to the beneficiary. It
 *       completes here, because the meter is ours to move.
 *     - `money`   — books the amount onto the beneficiary's own payable book as `pending`. The node
 *       does not push fiat, because pushing fiat means first holding it. This is the same accrual
 *       every money sale on this node already settles through, and it is what makes the obligation
 *       invoiceable: the beneficiary bills the PROVIDER, one aggregate invoice per period, with a VAT
 *       chain that matches who actually supplied whom.
 *
 *   A beneficiary with no PSP configured is therefore never blocked and never a special case. A PSP
 *   is how fiat eventually reaches them OUTSIDE this node; it has no bearing on whether the obligation
 *   can be recorded, released, or read.
 * @structure BeneficiaryApproval · readApproval · putApproval · beneficiaryEligibility ·
 *   releaseBeneficiaryShare
 * @usage
 *   const gate = await beneficiaryEligibility(storage, config, beneficiaryGhii);
 *   if (!gate.eligible) return res.status(409).json(error(nodeId, gate.reason, gate.message));
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial: the verification gate and the two release rails.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { bookPayable } from './payable-book.js';
import { settleEntryStatus, readAccruedEntry, type BeneficiaryEntry } from './beneficiary-book.js';
import { logger } from '../utils/logger.js';

/** System namespace — an approval is a server-trusted fact, so never in a principal-writable space. */
export const NS_BENEFICIARY_APPROVAL = 'beneficiary-approval';

/** What an operator has established about a party before money may reach them. */
export interface BeneficiaryApproval {
  approvalId: string;
  /** The beneficiary owner GHII this approval is about. */
  ghii: string;
  /** `unverified` is also what ABSENCE means — an unwritten approval is not a permissive one. */
  state: 'unverified' | 'verified' | 'rejected';
  /**
   * How representation was established, in the operator's own words — e.g. `suomifi-valtuudet`,
   * `manual-operator`, `contract-on-file`. Free text: the core does not maintain a list of acceptable
   * methods, because which evidence is sufficient is a legal judgement that varies by jurisdiction and
   * by what is being claimed.
   */
  method: string;
  /**
   * The external identity this approval attests the GHII may act for, namespaced by the application
   * that cares (`fi-ytunnus:3323553-5`). Opaque here. Null when the approval is about the account only.
   */
  subject: string | null;
  /** Free-text evidence pointer — a case number, a document reference, a mandate id. */
  evidence: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const approvalKey = (ghii: string): string =>
  `benapproval.${createHash('sha256').update(ghii).digest('hex').slice(0, 32)}`;

/** The approval on file, or null when nobody has looked at this beneficiary yet. */
export async function readApproval(storage: Storage, ghii: string): Promise<BeneficiaryApproval | null> {
  const rec = await storage.getMemory(NS_BENEFICIARY_APPROVAL, approvalKey(ghii));
  return rec ? (rec.value as BeneficiaryApproval) : null;
}

/** Record an operator's finding about a beneficiary. The route above this enforces the operator role. */
export async function putApproval(
  storage: Storage,
  input: {
    ghii: string; state: BeneficiaryApproval['state']; method?: string; subject?: string | null;
    evidence?: string; verifiedBy: string;
  },
): Promise<BeneficiaryApproval> {
  const now = new Date().toISOString();
  const prev = await readApproval(storage, input.ghii);
  const value: BeneficiaryApproval = {
    approvalId: prev?.approvalId || randomUUID(),
    ghii: input.ghii,
    state: input.state,
    method: (input.method ?? '').slice(0, 120),
    subject: input.subject ? input.subject.slice(0, 200) : null,
    evidence: (input.evidence ?? '').slice(0, 500),
    // Stamped only when this is an affirmative finding — a rejection is not a verification date.
    verifiedBy: input.state === 'verified' ? input.verifiedBy : (prev?.verifiedBy ?? null),
    verifiedAt: input.state === 'verified' ? now : (prev?.verifiedAt ?? null),
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  await storage.setMemory({
    key: approvalKey(value.ghii), ownerGaii: NS_BENEFICIARY_APPROVAL, value,
    visibility: 'private', tags: ['beneficiary-approval'], ttlHours: null, version: 1,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  });
  return value;
}

/** Whether a release to this beneficiary may proceed, and the reason when it may not. */
export interface EligibilityVerdict {
  eligible: boolean;
  state: BeneficiaryApproval['state'];
  reason: string;
  message: string;
}

/**
 * May a share be released to this beneficiary?
 *
 * Two conditions, both about whether there is a real party at the other end: the GHII resolves to an
 * owner on this node, and an operator has recorded a `verified` approval for it. Absence of an
 * approval fails closed.
 */
export async function beneficiaryEligibility(
  storage: Storage, config: AimeatConfig, beneficiaryGhii: string,
): Promise<EligibilityVerdict> {
  const [name, node] = splitGhii(beneficiaryGhii);
  if (!name || node !== config.nodeId || !await storage.getOwner(name)) {
    return {
      eligible: false, state: 'unverified', reason: 'BENEFICIARY_UNKNOWN',
      message: 'This beneficiary is not an account on this node, so there is nobody here to pay',
    };
  }
  const approval = await readApproval(storage, beneficiaryGhii);
  const state = approval?.state ?? 'unverified';
  if (state === 'verified') {
    return { eligible: true, state, reason: 'OK', message: 'Verified. The share may be released' };
  }
  return {
    eligible: false, state, reason: 'BENEFICIARY_UNVERIFIED',
    message: state === 'rejected'
      ? 'This beneficiary was checked and rejected; the share stays accrued and unpaid'
      : 'Nobody has verified that this beneficiary may be paid. The share stays accrued until an '
        + 'operator records an approval. Accruing to an unverified party is fine, paying them is not',
  };
}

/**
 * What a release attempt produced. `settledHere` says whether the release COMPLETED on this node or
 * left an off-node leg still to do. It is NOT a claim about which rail carries real money: the morsel
 * rail completes here because morsels are the node's own pacing meter, and the money rail does not
 * because the node will not hold fiat. The rail that settles instantly is the one that is not currency.
 */
export type ReleaseResult =
  | { ok: true; entry: BeneficiaryEntry; method: string; settledHere: boolean }
  | { ok: false; reason: string; message: string };

/**
 * Release ONE accrued share, on whichever rail it was accrued in.
 *
 * The gate is re-checked here rather than trusted from the route, because this is the last point
 * before anything is paid out and it is reachable from more than one door. The entry is flipped to `released`
 * BEFORE the morsel transfer and rolled back if the transfer fails, so a crash between the two leaves
 * an unpaid obligation (recoverable) rather than a paid one marked unpaid (payable twice).
 */
export async function releaseBeneficiaryShare(
  storage: Storage,
  config: AimeatConfig,
  args: { providerGhii: string; beneficiaryGhii: string; trackingCode: string },
): Promise<ReleaseResult> {
  const gate = await beneficiaryEligibility(storage, config, args.beneficiaryGhii);
  if (!gate.eligible) return { ok: false, reason: gate.reason, message: gate.message };

  // Learn the RAIL before writing the status, so the entry records how it was actually released
  // rather than a placeholder. Reading it afterwards means the status is written before the truth
  // about it, and every released entry then claims a method of "pending".
  const nothing: ReleaseResult = {
    ok: false, reason: 'NOTHING_ACCRUED',
    message: 'No accrued share from you to this beneficiary under that tracking code. It may already be released',
  };
  const pending = await readAccruedEntry(storage, args.beneficiaryGhii, args.trackingCode, args.providerGhii);
  if (!pending) return nothing;
  const method = pending.unit === 'morsels' ? 'morsel-transfer' : 'payable-booked';

  const entry = await settleEntryStatus(storage, {
    beneficiaryGhii: args.beneficiaryGhii, trackingCode: args.trackingCode,
    fromGhii: args.providerGhii, to: 'released', releaseMethod: method,
  });
  if (!entry) return nothing;

  if (entry.unit === 'morsels') {
    const moved = await storage.transferBalance(args.providerGhii, args.beneficiaryGhii, entry.amount);
    if (!moved) {
      // Put it back. An obligation that reads `released` while the balance never moved is the one
      // outcome that cannot be corrected by looking at the ledger.
      await revertRelease(storage, args, entry);
      return {
        ok: false, reason: 'INSUFFICIENT_BALANCE',
        message: `Releasing this share needs ${entry.amount} morsels and your balance does not cover it`,
      };
    }
    await storage.addTransaction({
      id: `benef-${randomUUID()}`, gaii: args.beneficiaryGhii, type: 'commerce_earn', amount: entry.amount,
      counterpartyGaii: args.providerGhii, trackingCode: `beneficiary:${args.trackingCode}`,
      initiatorGaii: args.providerGhii, timestamp: new Date().toISOString(),
    });
    return { ok: true, entry, method, settledHere: true };
  }

  // Money: book it onto the beneficiary's own payable book, where `/v1/exchange/earnings` reads it.
  // The node moves no fiat — this makes the obligation invoiceable against the provider.
  await bookPayable({ config, storage }, args.beneficiaryGhii, `benef_${args.trackingCode}`, {
    amount: entry.amount, currency: entry.currency ?? 'EUR', buyerGhii: args.providerGhii,
    reference: entry.reference, method: 'beneficiary-share', status: 'pending',
  });
  return { ok: true, entry, method, settledHere: false };
}

/** Undo a status flip after a failed transfer, so the obligation stays visible and payable. */
async function revertRelease(
  storage: Storage,
  args: { beneficiaryGhii: string; trackingCode: string; providerGhii: string },
  entry: BeneficiaryEntry,
): Promise<void> {
  const key = `commerce.benefit.${args.trackingCode}`;
  const rec = await storage.getMemory(args.beneficiaryGhii, key);
  if (!rec) return;
  const value = rec.value as { items?: BeneficiaryEntry[] };
  const row = (value.items ?? []).find(i => i.fromGhii === args.providerGhii && i.status === 'released');
  if (!row) return;
  row.status = 'accrued';
  delete row.releasedAt;
  delete row.releaseMethod;
  await storage.setMemory({
    key, ownerGaii: args.beneficiaryGhii, value, visibility: 'owner', tags: ['commerce', 'beneficiary'],
    ttlHours: null, version: (rec.version ?? 0) + 1, createdAt: rec.createdAt, updatedAt: new Date().toISOString(),
  });
  logger.warn('[beneficiary-release] transfer failed; the obligation was returned to accrued', {
    beneficiary: args.beneficiaryGhii, amount: entry.amount,
  });
}

function splitGhii(ghii: string): [string, string] {
  const at = ghii.lastIndexOf('@');
  return at > 0 ? [ghii.slice(0, at), ghii.slice(at + 1)] : ['', ''];
}
