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
 *   one call ACROSS them rather than one call each. The relay door files its claims here too.
 *
 *   AN ASSERTION IS SPENT BY WHAT IT IS, NOT BY HOW IT IS SPELLED. The key is the signer, the node
 *   it was written for and its own `jti`: the three fields every door already requires and checks.
 *   It used to be the raw string, and one assertion has many strings. An Ed25519 signature is 64
 *   bytes in 86 base64url characters, so the last character carries four bits nobody reads, and the
 *   verifier accepts all sixteen spellings. A relay claim is worse, because base64url decoding skips
 *   characters outside its alphabet. Keyed on the spelling, each copy was a new assertion, so one
 *   captured proof bought sixteen calls or more (audit A4-3).
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
 *   ONLY AFTER THE SIGNATURE. Every caller verifies the signature before it spends, so only the
 *   holder of the key can burn one of its own ids.
 *
 * @structure
 *   - AssertionIdentity: the signer, the audience and the jti
 *   - assertionIdentityOf(): read those three out of a compact JWS
 *   - spendAssertion(): spend a compact JWS assertion (the token door and the A2A door)
 *   - spendAssertionIdentity(): spend by identity (the relay door, and the one place that files)
 * @usage
 *   const spend = await spendAssertion(storage, assertion, claims.exp);
 *   if (!spend.ok) return refuse(401, 'ASSERTION_REPLAYED', spend.message);
 * @version-history
 *   v1.1.0 — 2026-09-24 — The spend is keyed on the assertion's identity (sub, aud and jti; the
 *     relay door's relay, aud and jti) instead of its raw bytes, so a re-spelled copy is the same
 *     spend (audit A4-3). spendAssertionIdentity for a claim that is not a JWS.
 *   v1.0.0 — 2026-09-01 — Extracted from routes/agents-v2/token.ts when the A2A foreign door was
 *     found to have claimed this behaviour in its header without having it (Agent v2, V6a).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

/**
 * The namespace every door shares.
 *
 * Deliberately ONE prefix rather than one per door: an assertion is a proof that its signer holds a
 * key right now, and that fact does not become two facts because two routes can read it. A caller
 * that could spend the same assertion once at each door would get exactly the second call this
 * whole mechanism exists to deny.
 */
const SPENT_PREFIX = 'agent-v2-assertion:';

/** What one assertion IS, whatever bytes carried it. */
export interface AssertionIdentity {
  /** Whose key signed it: the agent named in `sub`, or the node named in a relay claim's `relay`. */
  issuer: string;
  /** The node it was written for. Every door has refused one written for another node already. */
  audience: string;
  /** The signer's own id for this one assertion. */
  jti: string;
}

/**
 * The hash a spent assertion is filed under. Exported so a test can assert the doors agree.
 *
 * The three fields go in as a JSON array rather than joined with a separator, so no value can
 * contain the separator and shift a character from one field into the next.
 */
export function assertionSpendHash(identity: AssertionIdentity): string {
  const parts = JSON.stringify([identity.issuer, identity.audience, identity.jti]);
  return createHash('sha256').update(`${SPENT_PREFIX}${parts}`).digest('hex');
}

/**
 * Read the identity out of a compact JWS assertion: `sub`, `aud` and `jti` from its payload, the
 * same bytes the door read them from. The payload segment is covered by the signature, so it has
 * one spelling; only the signature segment has several. Null when any of the three is missing.
 */
export function assertionIdentityOf(jws: string): AssertionIdentity | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: not an assertion
    return null;
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  const { sub, aud, jti } = claims as { sub?: unknown; aud?: unknown; jti?: unknown };
  if (typeof sub !== 'string' || !sub || typeof aud !== 'string' || !aud || typeof jti !== 'string' || !jti) return null;
  return { issuer: sub, audience: aud, jti };
}

export type SpendResult = { ok: true } | { ok: false; message: string };

/**
 * Claim this assertion, or say it was already claimed.
 *
 * `expiresAt` is the assertion's own `exp`, in epoch seconds, so the record ages out exactly when
 * the assertion would have stopped being usable anyway. Filing it for longer would grow the table
 * for nothing; filing it for less would reopen the window it exists to close.
 *
 * An assertion that does not name its signer, its node and itself cannot be spent once, so it is
 * refused rather than filed. Every door checks those fields first, so this is a backstop.
 */
export async function spendAssertion(storage: Storage, assertion: string, expiresAt: number): Promise<SpendResult> {
  const identity = assertionIdentityOf(assertion);
  if (!identity) {
    return { ok: false, message: 'That assertion does not carry sub, aud and jti, so it cannot be spent once. Sign a complete one.' };
  }
  return spendAssertionIdentity(storage, identity, expiresAt);
}

/** Claim an assertion by its identity, or say it was already claimed. The one place that files. */
export async function spendAssertionIdentity(
  storage: Storage, identity: AssertionIdentity, expiresAt: number,
): Promise<SpendResult> {
  const hash = assertionSpendHash(identity);
  if (await storage.isTokenRevoked(hash)) {
    return { ok: false, message: 'That assertion has already been used. Sign a new one.' };
  }
  await storage.revokeToken(hash, expiresAt);
  return { ok: true };
}
