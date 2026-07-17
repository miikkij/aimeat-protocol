/**
 * @file src/services/ext-pay-token.ts
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
 *   v1.0.0 — 2026-07-17 — Initial (Phase 3 — money-channel one-time token, D1/D3)
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

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
 * Verify + CONSUME a token. Single-use: the record is deleted first and the delete result is the
 * atomicity gate — a concurrent replay that loses the delete race is rejected. Also checks expiry
 * and that the token was minted for exactly this buyer + ext + action.
 */
export async function consumeExtPayToken(
  storage: Storage,
  token: string | undefined,
  expect: { buyerOwner: string; ext: string; action: string },
): Promise<{ ok: boolean; reason?: string }> {
  if (!token) return { ok: false, reason: 'missing' };
  const rec = await storage.getMemory(NS, token);
  if (!rec) return { ok: false, reason: 'invalid_or_used' };
  // Single-use gate: whoever deletes it wins; a racing replay gets deleted=false.
  const deleted = await storage.deleteMemory(NS, token);
  if (!deleted) return { ok: false, reason: 'replayed' };
  const g = rec.value as ExtPayGrant & { expiresAt: string };
  if (!g || typeof g.expiresAt !== 'string' || new Date(g.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (g.buyerOwner !== expect.buyerOwner || g.ext !== expect.ext || g.action !== expect.action) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}
