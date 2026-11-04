/**
 * @file src/services/request-nonce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time value a node puts in a signed request, and the record of the ones this
 *   node has already accepted. A signature checked only against a five-minute window could be sent
 *   again inside it, to the same node or to another that knows the same group and seller (secaudit
 *   2026-10, PKG-10). A request now names the node it is for (its audience) and a nonce, and a nonce
 *   is accepted once per source node inside the window.
 *
 *   IN THE NODE'S STORAGE (services/ephemeral-claims.ts, kind 'request-nonce'), for one window: a
 *   nonce accepted on one process is refused on every other, and after a restart. Page 18 of the IT
 *   adoption guide says a request between nodes is accepted once; with a Map per process it was once
 *   per process (codebase analysis 2026-11-03, high-availability report section 2c).
 *   nonceAcceptedHere answers from this process's memory only, for the one caller that cannot wait
 *   (signed-node-request.ts signedMessageRefusal, whose node-wide form awaits nonceAccepted).
 * @structure NONCE_WINDOW_MS · newNonce() · nonceAccepted(source, nonce, now, rememberUntil?) ·
 *   nonceAcceptedHere(source, nonce, now, rememberUntil?)
 * @usage if (!await nonceAccepted(sourceNode, nonce)) return refuse('REPLAYED');
 * @version-history
 *   v1.2.0 — 2026-11-04 — nonceAccepted spends in the node's storage and is async; nonceAcceptedHere
 *     keeps the in-process answer (codebase analysis 2026-11-03, HA stage 2).
 *   v1.1.0 — 2026-10-06 — rememberUntil: a record can outlive one window from now, for a message
 *     signed ahead of this node's clock (secaudit 2026-10 follow-up audit, finding 3).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, PKG-10).
 */
import { randomBytes } from 'node:crypto';
import { spendOnce, spendOnceHere } from './ephemeral-claims.js';

/** The window a signed request is accepted in, and so how long its nonce is remembered. */
export const NONCE_WINDOW_MS = 5 * 60 * 1000;

const NONCE_RE = /^[a-f0-9]{32}$/;
const KIND = 'request-nonce';

/** A fresh nonce: 16 random bytes as hex. */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * True the first time `source` presents `nonce` inside the window, on any process of the node, and
 * records it until `rememberUntil`; false for a malformed nonce or one already accepted. A caller
 * whose message stays valid past one window from now (signed ahead of this node's clock) passes the
 * time it stops being valid, so the record outlives the message.
 */
export async function nonceAccepted(source: string, nonce: string, now = Date.now(), rememberUntil = now + NONCE_WINDOW_MS): Promise<boolean> {
  if (!NONCE_RE.test(nonce)) return false;
  return spendOnce(KIND, `${source}\u0000${nonce}`, Math.max(rememberUntil, now + NONCE_WINDOW_MS), now);
}

/** nonceAccepted in this process's memory only: the same rule, for a caller that cannot wait. */
export function nonceAcceptedHere(source: string, nonce: string, now = Date.now(), rememberUntil = now + NONCE_WINDOW_MS): boolean {
  if (!NONCE_RE.test(nonce)) return false;
  return spendOnceHere(KIND, `${source}\u0000${nonce}`, Math.max(rememberUntil, now + NONCE_WINDOW_MS), now);
}
