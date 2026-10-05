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
 *   IN-PROCESS. The record lives in this process for one window and is pruned as it goes, the way
 *   the rate limiter keeps its counts. A restart forgets it, and the timestamp window is what holds
 *   a request older than the restart.
 * @structure NONCE_WINDOW_MS · newNonce() · nonceAccepted(source, nonce, now)
 * @usage if (!nonceAccepted(sourceNode, nonce)) return refuse('REPLAYED');
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, PKG-10).
 */
import { randomBytes } from 'node:crypto';

/** The window a signed request is accepted in, and so how long its nonce is remembered. */
export const NONCE_WINDOW_MS = 5 * 60 * 1000;

const NONCE_RE = /^[a-f0-9]{32}$/;
const seen = new Map<string, number>();

/** A fresh nonce: 16 random bytes as hex. */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * True the first time `source` presents `nonce` inside the window, and records it; false for a
 * malformed nonce or one already accepted.
 */
export function nonceAccepted(source: string, nonce: string, now = Date.now()): boolean {
  if (!NONCE_RE.test(nonce)) return false;
  if (seen.size > 50_000) {
    for (const [k, until] of seen) if (until <= now) seen.delete(k);
  }
  const id = `${source}\u0000${nonce}`;
  const until = seen.get(id);
  if (until !== undefined && until > now) return false;
  seen.set(id, now + NONCE_WINDOW_MS);
  return true;
}
