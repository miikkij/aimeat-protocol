/**
 * @file auth/pkce.js
 * @description PKCE helpers for the H-2 app-grant consent code flow (RFC 7636): base64url encoding
 *   and the verifier/challenge pair. Pure and stateless — they touch no module state, which is why
 *   they live outside session.js (that file's rule is that every reassignment of the mutable session
 *   state stays in ONE module; these do not participate in it).
 * @structure
 *   - b64url(buf): ArrayBuffer/TypedArray buffer → base64url string
 *   - pkce(): { verifier, challenge, method } — S256, or 'plain' where crypto.subtle is unavailable
 * @usage import { b64url, pkce } from './pkce.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Extracted from session.js (pure helpers, no session state).
 */

/** Base64url-encode a buffer (no padding), the encoding PKCE and the state parameter use. */
export function b64url(buf) {
  var bytes = new Uint8Array(buf), s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh PKCE verifier + challenge. */
export async function pkce() {
  var verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  if (crypto.subtle && crypto.subtle.digest) {
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier: verifier, challenge: b64url(digest), method: 'S256' };
  }
  // Non-secure context (http on a non-localhost host): crypto.subtle is unavailable. Fall back to
  // PKCE "plain". Acceptable — such transport is already non-confidential; real app origins are https.
  return { verifier: verifier, challenge: verifier, method: 'plain' };
}
