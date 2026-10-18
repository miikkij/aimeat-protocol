/**
 * @file src/services/ext-pay-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One-time invoke token for the priced-raw-call MONEY channel (design notes
 *   doc-r6tyr3o, decisions D1/D3). After a buyer settles `commercial.payMoney` through a checkout
 *   (kind 'ext-call'), the node mints a token bound to (buyerOwner, ext, action, currency, amount);
 *   the buyer then RETRIES the raw call with `x-aimeat-pay-token: <token>` and the paywall verifies
 *   + consumes it. Single-use (deleted on consume — the delete is the atomicity gate, so a replay
 *   loses the race) with a 5-minute TTL (storage auto-expiry). Money settlement itself is the EE
 *   payment rail; this generic token is the seam the paywall honours regardless of the rail.
 * @structure ExtPayGrant · mintExtPayToken · consumeExtPayToken · EXT_PAY_TOKEN_TTL_MS
 * @usage
 *   const { token } = await mintExtPayToken(storage, { buyerOwner, ext, action, currency, amount });
 *   const r = await consumeExtPayToken(storage, token, { buyerOwner, ext, action });
 * @version-history
 *   v1.2.0 — 2026-10-18 — A token may carry the seller's net of its sale (`share`), and a spent token
 *     returns its grant, so the paywall splits that net by the payees the call names (Comicland v3 A-6).
 *   v1.1.0 — 2026-10-09 — consumeExtPayToken compares buyer, extension and action before it deletes,
 *     so a refused presentation leaves the buyer's token spendable (secrets audit 2026-10-09, S-3).
 *   v1.0.0 — 2026-07-17 — Initial (Phase 3 — money-channel one-time token, D1/D3)
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { readSplit, computeSplit, type DynamicDesignation, type SplitResult } from '../commerce/beneficiary-split.js';
import { bookBeneficiaryShares } from '../commerce/beneficiary-book.js';
import { logger } from '../utils/logger.js';

/** Token namespace (system-owned memory; server-side only, never client-readable). */
const NS = 'ext-pay-token';
export const EXT_PAY_TOKEN_TTL_MS = 5 * 60 * 1000;

/** What a token authorises: one call of `action` on `ext` by `buyerOwner`, paid `amount` `currency`. */
export interface ExtPayGrant {
  buyerOwner: string;
  ext: string;
  action: string;
  currency: string;
  amount: number;
  /**
   * The seller's net of this sale, when the action's split names its payees per call: it is split
   * when the token is spent, by the payees the action's result names (Comicland v3 A-6).
   */
  share?: { net: number; sellerGhii: string; buyerGhii: string; reference: string };
}

/**
 * Split the seller's net a spent token carries, by the payees the paid call named (a dynamic split:
 * one series' creators and translators out of one extension's sales). Out of the seller's net, never
 * added to what the buyer paid, and booked once per token (the token is the tracking code). Never
 * throws: the money moved at the checkout and the call delivered; a booking failure is logged.
 */
export async function accrueTokenShare(
  storage: Storage, grant: ExtPayGrant, token: string, designations: DynamicDesignation[] = [],
): Promise<SplitResult | null> {
  const share = grant.share;
  if (!share || share.net <= 0) return null;
  try {
    const split = await readSplit(storage, share.sellerGhii, grant.ext, grant.action);
    const result = computeSplit(share.net, split, designations);
    if (!result.lines.length) return result;
    await bookBeneficiaryShares(storage, {
      lines: result.lines, trackingCode: `chk_tok_${token}`, fromGhii: share.sellerGhii,
      currency: grant.currency, buyerGhii: share.buyerGhii, reference: share.reference,
    });
    return result;
  } catch (err) {
    logger.error('[ext-pay-token] the paid call\'s revenue split was not booked; the seller keeps the whole cut', {
      ext: grant.ext, action: grant.action, error: String(err),
    });
    return null;
  }
}

/** Mint a single-use token for a settled money payment. Returns the token + its expiry. */
export async function mintExtPayToken(storage: Storage, grant: ExtPayGrant): Promise<{ token: string; expiresAt: string }> {
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXT_PAY_TOKEN_TTL_MS).toISOString();
  await storage.setMemory({
    key: token,
    ownerGaii: NS,
    value: { ...grant, expiresAt },
    visibility: 'private',
    tags: [],
    ttlHours: EXT_PAY_TOKEN_TTL_MS / 3_600_000,
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return { token, expiresAt };
}

/**
 * Verify + CONSUME a token. The binding is checked FIRST: a token presented by anybody but its buyer,
 * or for another extension or action, is refused and left exactly as it was, so whoever holds the
 * string cannot burn the call the buyer paid for (secrets audit 2026-10-09, S-3). Only a matching
 * token is deleted, and the delete result is the single-use gate: a concurrent replay that loses the
 * delete race is refused. An expired token is deleted on sight, since nobody can spend it any more.
 */
export async function consumeExtPayToken(
  storage: Storage,
  token: string | undefined,
  expect: { buyerOwner: string; ext: string; action: string },
): Promise<{ ok: boolean; reason?: string; grant?: ExtPayGrant }> {
  if (!token) return { ok: false, reason: 'missing' };
  const rec = await storage.getMemory(NS, token);
  if (!rec) return { ok: false, reason: 'invalid_or_used' };
  const g = rec.value as ExtPayGrant & { expiresAt: string };
  if (!g || typeof g.expiresAt !== 'string' || new Date(g.expiresAt).getTime() < Date.now()) {
    await storage.deleteMemory(NS, token);
    return { ok: false, reason: 'expired' };
  }
  if (g.buyerOwner !== expect.buyerOwner || g.ext !== expect.ext || g.action !== expect.action) {
    return { ok: false, reason: 'mismatch' };
  }
  // Single-use gate: whoever deletes it wins; a racing replay gets deleted=false.
  const deleted = await storage.deleteMemory(NS, token);
  if (!deleted) return { ok: false, reason: 'replayed' };
  return { ok: true, grant: g };
}
