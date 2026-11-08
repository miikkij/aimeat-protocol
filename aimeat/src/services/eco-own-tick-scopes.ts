/**
 * @file src/services/eco-own-tick-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which scopes an outside app's approval grants when the owner names none, and which
 *   words of its request the owner must tick one by one.
 *
 *   A word outside every wildcard (utils/scope-coverage.ts SCOPES_OUTSIDE_WILDCARD: receivers:manage,
 *   party:manage, share:manage, the read-as-owner words and the rest) is granted to an agent only
 *   when the owner ticks it. The outside app's approval took the app's own request when the body
 *   named no scopes, so such a word was granted without a tick. Now:
 *   - a body with `scopes` grants that list, as before: the owner chose it;
 *   - a body without `scopes` grants the request without its own-tick words, and keeps the own-tick
 *     words the app already holds from an earlier approval when the request still names them (an
 *     app already approved keeps working, purpose rule 6). The words held back are named in the
 *     answer so the owner's client can ask for them.
 *   GET /v1/ecosystem-apps/pending names the own-tick words of each request, and the Outside apps
 *   page shows them unticked (secaudit2026nov08 round 14, older item O5).
 * @structure ownTickWords · approvalScopes
 * @usage const { scopes, heldBack } = approvalScopes(body.scopes, request.scopes ?? defaults, existing?.scopes);
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14, older item O5).
 */
import { isOutsideWildcard } from '../utils/scope-coverage.js';

/** The words of `scopes` that only an exact, deliberate grant confers. */
export function ownTickWords(scopes: readonly unknown[] | null | undefined): string[] {
  return [...new Set((scopes ?? []).filter((s): s is string => typeof s === 'string' && isOutsideWildcard(s)))];
}

/**
 * The scopes an approval grants. `chosen` is the approve body's `scopes` (undefined when it named
 * none), `requested` what the app asked for (or the node default), `held` the scopes of the app
 * already connected, if any. `heldBack` is every own-tick word of the request not granted.
 */
export function approvalScopes(
  chosen: readonly string[] | undefined, requested: readonly string[], held: readonly string[] | undefined,
): { scopes: string[]; heldBack: string[] } {
  if (chosen) return { scopes: [...chosen], heldBack: [] };
  const keep = new Set(held ?? []);
  const scopes = requested.filter(s => !isOutsideWildcard(s) || keep.has(s));
  const heldBack = ownTickWords(requested).filter(s => !scopes.includes(s));
  return { scopes, heldBack };
}
