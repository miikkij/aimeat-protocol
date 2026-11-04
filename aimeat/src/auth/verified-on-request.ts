/**
 * @file src/auth/verified-on-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-in check optionalAuth made for this request's Bearer JWT, so a later door of
 *   the same request (the MCP endpoint's authenticate()) takes it instead of checking the same token
 *   again.
 *
 *   WHY. Global optionalAuth verifies the token and asks every revocation question
 *   (credentialRevoked) for every request. The MCP endpoint then did both again for the same token in
 *   the same request: one more signature check and the same storage reads (codebase analysis
 *   2026-11-03, item C2; efficiency.md E4).
 *
 *   WHAT IS KEPT. Only a JWT that optionalAuth verified AND found not revoked, together with the exact
 *   token string, keyed by the request object, so it lives exactly as long as the request. The MCP
 *   door takes it only for the same token string; anything else (no note, another token, a personal
 *   access token, which optionalAuth resolves by another path) is checked as before.
 * @structure noteVerifiedJwt(req, token, verified) · verifiedJwtOf(req, token)
 * @usage
 *   noteVerifiedJwt(req, token, verified);           // optionalAuth, after credentialRevoked said no
 *   const earlier = verifiedJwtOf(req, token);       // the MCP endpoint
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C2).
 */
import type { VerifiedToken } from './jwt.js';

const checked = new WeakMap<object, { token: string; verified: VerifiedToken }>();

/** Note that `token` was verified and is not revoked, for the rest of this request. */
export function noteVerifiedJwt(req: object, token: string, verified: VerifiedToken): void {
  checked.set(req, { token, verified });
}

/** The verified token optionalAuth noted for this exact token string on this request, else null. */
export function verifiedJwtOf(req: object, token: string): VerifiedToken | null {
  const note = checked.get(req);
  return note && note.token === token ? note.verified : null;
}
