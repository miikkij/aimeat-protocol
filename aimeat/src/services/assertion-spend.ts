/**
 * @file src/services/assertion-spend.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One signed assertion is worth ONE call. This is the one place that decides it.
 *
 *   WHY IT IS A MODULE AND NOT TWO INLINE LINES. Two doors take a caller-signed proof of possession
 *   — `/v1/agents/v2/token` for this account's own agents, and the A2A door for agents from
 *   somewhere else — and each of them independently has to hash the assertion the same way and put
 *   it in the same table. When that was two inline expressions, one of them was written and the
 *   other was not, and the door that skipped it was the one where money moves. A shared function is
 *   also the only way the two doors can share a namespace, which is what makes an assertion worth
 *   one call ACROSS them rather than one call each.
 *
 *   THE REVOKED-TOKEN TABLE IS THE RIGHT STORE AND THE WRONG NAME. It holds hashes that must not
 *   authenticate again, keyed to an expiry, with a sweep already running — which is exactly what a
 *   spent assertion needs and exactly what nobody wants to build a second time.
 *
 *   SPEND BEFORE YOU DISPATCH. `spendAssertion` records first and answers second, so a failure
 *   anywhere downstream burns the assertion rather than handing a replayable one back to the
 *   caller. Refusing before you write is the usual rule; this is its mirror, and the reason is the
 *   same — the expensive mistake is the one that leaves a credential alive.
 *
 * @structure spendAssertion()
 * @usage
 *   const spend = await spendAssertion(storage, assertion, claims.exp);
 *   if (!spend.ok) return refuse(401, 'ASSERTION_REPLAYED', spend.message);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Extracted from routes/agents-v2/token.ts when the A2A foreign door was
 *     found to have claimed this behaviour in its header without having it (Agent v2, V6a).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

/**
 * The namespace both doors share.
 *
 * Deliberately ONE prefix rather than one per door: an assertion is a proof that its signer holds a
 * key right now, and that fact does not become two facts because two routes can read it. A caller
 * that could spend the same string once at each door would get exactly the second call this whole
 * mechanism exists to deny.
 */
const SPENT_PREFIX = 'agent-v2-assertion:';

/** The hash a spent assertion is filed under. Exported so a test can assert the two doors agree. */
export function assertionSpendHash(assertion: string): string {
  return createHash('sha256').update(`${SPENT_PREFIX}${assertion}`).digest('hex');
}

export type SpendResult = { ok: true } | { ok: false; message: string };

/**
 * Claim this assertion, or say it was already claimed.
 *
 * `expiresAt` is the assertion's own `exp`, in epoch seconds, so the record ages out exactly when
 * the assertion would have stopped being usable anyway. Filing it for longer would grow the table
 * for nothing; filing it for less would reopen the window it exists to close.
 */
export async function spendAssertion(storage: Storage, assertion: string, expiresAt: number): Promise<SpendResult> {
  const hash = assertionSpendHash(assertion);
  if (await storage.isTokenRevoked(hash)) {
    return { ok: false, message: 'That assertion has already been used. Sign a new one.' };
  }
  await storage.revokeToken(hash, expiresAt);
  return { ok: true };
}
