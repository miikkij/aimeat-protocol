/**
 * @file agent-gaii.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The GAII of an agent this daemon holds a credential for, read from the credential
 *   itself.
 *
 *   WHY THIS EXISTS. A bare agent name is the ACCOUNT layer's shorthand: `concierge` means
 *   something only once you already know whose. The connector's registry, its channels and its
 *   invoke queues were all keyed by that shorthand while holding several identities, so a second
 *   owner's `concierge` silently replaced the first — no error, no warning, load order deciding
 *   which one a task reached. The basic-agents button hands every owner the same three names, so
 *   this is the first thing that happens when two people share a daemon.
 *
 *   NO FOURTH SPELLING. There is exactly one identifier for this and the system already carries it
 *   everywhere else: `agent#owner@node`. `agent@owner` is a filename convention in the keychain and
 *   it stays there; it does not become a key in a map, because a fourth spelling of one fact is how
 *   the third one went wrong.
 *
 *   WHERE IT COMES FROM, per credential family, and neither is a guess:
 *     - v2: written beside the key material. `agent-key.ts` stores `gaii` in the key file at
 *       enrolment, so it is read, not derived.
 *     - v1: the `sub` claim of the bearer this daemon already holds. Decoding is READING OUR OWN
 *       CREDENTIAL — the node signed it, we are not verifying anything and we must not pretend to.
 *       A token whose `sub` is missing or is not a GAII means a credential this daemon cannot
 *       place, and that is reported rather than papered over with the filename.
 *
 * @structure isGaii · gaiiFromToken · gaiiParts
 * @usage const gaii = gaiiFromToken(cred.token);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the registry re-key.
 */

import { logger } from '../../utils/logger.js';

/** `agent#owner@node`. The one spelling. */
const GAII_RE = /^[^#@\s]+#[^#@\s]+@[^#@\s]+$/;

export function isGaii(value: unknown): value is string {
  return typeof value === 'string' && GAII_RE.test(value);
}

/**
 * The agent, owner and node inside a GAII, or null when it is not one.
 *
 * Used for DISPLAY and for matching a bare name against loaded identities. Nothing keys off the
 * pieces; the whole string is the key.
 */
export function gaiiParts(gaii: string): { agent: string; owner: string; node: string } | null {
  if (!isGaii(gaii)) return null;
  const hash = gaii.indexOf('#');
  const at = gaii.indexOf('@', hash);
  return { agent: gaii.slice(0, hash), owner: gaii.slice(hash + 1, at), node: gaii.slice(at + 1) };
}

/**
 * The `sub` of a bearer this daemon holds, when it is a GAII.
 *
 * NOT A VERIFICATION, and the name says so rather than the comment alone: no signature is checked
 * and none should be. This is the connector reading a credential it was given, to find out which
 * identity it belongs to. A caller that needs to TRUST a token asks the node.
 */
export function gaiiFromToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as { sub?: unknown };
    return isGaii(claims.sub) ? claims.sub : null;
  } catch (err) {
    // Not thrown: one unreadable file in the keychain must not take the daemon down. Not silent
    // either — the caller reports which credential it skipped, and this says why it could not be
    // read at all, which is a different fact from "the claim was not a GAII".
    logger.warn('agent-gaii: a stored token payload could not be read', { error: String(err) });
    return null;
  }
}
