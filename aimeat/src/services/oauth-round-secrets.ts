/**
 * @file oauth-round-secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts of an outside sign-in round (an outbound connection's, a remote MCP
 *   server's) that bind it to one browser and keep its secrets sealed while it waits.
 *
 *   THE DEFECT THIS CLOSES (secrets audit 2026-10-09, chapter 2). Both callbacks are
 *   unauthenticated, because the provider redirects a browser to them, and both took the single-use
 *   `state` as their whole gate. The state says who STARTED the round, not who approved at the
 *   provider. So a principal could hand its authorize URL to somebody else, that person approved,
 *   and their mailbox or their upstream account landed under the starter's identity.
 *
 *   THE BINDING. A random value goes to the browser as a cookie (middleware/oauth-round-cookie.ts)
 *   and its SHA-256 goes into the round's stored payload as `bind`. The callback hands the cookie
 *   value to the service, which compares the two here in constant time and refuses on any
 *   difference, absence included. A round with no `bind` was started outside the owner's browser
 *   (an agent, a CLI, an MCP tool): it waits on the node's confirmation page (roundApprovalUrl) until
 *   the owner signs in there and confirms, which binds it to their browser.
 *
 *   THE ROUND'S SECRETS ARE SEALED. The PKCE verifier and a dynamic client registration's secret
 *   are encrypted with the node key and bound to the round's state and their role (encryptBound),
 *   so the verification_nonces table holds no usable secret while a round waits.
 * @structure bindingHash · bindingMatches · RoundBindCookie · RoundCookies · roundBindingHeld · roundApprovalUrl · sealRoundSecret · openRoundSecret
 * @usage if (!roundBindingHeld(input, payload.bind, payload.bindCookie)) return refuse();
 * @version-history
 *   v1.1.0 — 2026-10-31 — roundBindingHeld: a round bound over https finishes only with the `__Host-`
 *     cookie, which a same-site page cannot write; the payload records which cookie it set
 *     (secaudit2026oct31w2 round 10, W2-19).
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import { encryptBound, decryptBound } from './encryption.js';
import { logger } from '../utils/logger.js';

/** What a round stores for a binding value: its SHA-256, hex. The value itself stays in the cookie. */
export function bindingHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Whether `value` (the cookie the callback request carried) is the one the round was bound to. A
 * round with no stored binding is never matched: nobody confirmed it in a browser.
 */
export function bindingMatches(value: string | null | undefined, storedHash: unknown): boolean {
  if (!value || typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const got = Buffer.from(bindingHash(value), 'hex');
  const want = Buffer.from(storedHash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Which cookie carries a round's binding: `host` is the `__Host-` cookie set over https, which a
 * same-site app, portfolio or company page cannot write; `plain` is the old name, set over plain http.
 * The round's payload records it as `bindCookie` beside `bind`.
 */
export type RoundBindCookie = 'host' | 'plain';

/** The round cookies a callback request carried, and whether it came over https. */
export interface RoundCookies {
  /** The plain-name cookie's value, '' when absent. */
  binding: string;
  /** The `__Host-` cookie's value, '' or absent when absent. */
  hostBinding?: string;
  /** True when the request came over https (directly or through the node's proxy). */
  secure?: boolean;
}

/**
 * Whether the callback request belongs to the browser the round was bound to. A round bound with
 * the `__Host-` cookie finishes only with that cookie; a round bound with the plain cookie finishes
 * only over plain http, where it was started. A round written before `bindCookie` existed reads the
 * plain cookie, so a round in flight across the deploy finishes (secaudit2026oct31w2, W2-19).
 */
export function roundBindingHeld(cookies: RoundCookies, storedHash: unknown, bindCookie: unknown): boolean {
  if (bindCookie === 'host') return bindingMatches(cookies.hostBinding, storedHash);
  if (bindCookie === 'plain' && cookies.secure) return false;
  return bindingMatches(cookies.binding, storedHash);
}

/** The node's confirmation page for a round started outside the owner's browser. */
export function roundApprovalUrl(config: AimeatConfig, state: string): string {
  return `${config.baseUrl.replace(/\/$/, '')}/v1/oauth-round?state=${encodeURIComponent(state)}`;
}

/** Seal a secret of a waiting round, bound to `context` (the round's state and the secret's role). */
export function sealRoundSecret(value: string, key: Buffer, context: string): string {
  return encryptBound(value, key, context);
}

/** Open a secret sealRoundSecret wrote for the same context, or null when it does not open. */
export function openRoundSecret(sealed: string, key: Buffer, context: string): string | null {
  try {
    return decryptBound(sealed, key, context);
  } catch {
    // The fact, never the exception: a failed decrypt's text can carry fragments of the ciphertext.
    logger.warn('oauth-round: a sealed round secret could not be opened (another round, or a rotated key)');
    return null;
  }
}
