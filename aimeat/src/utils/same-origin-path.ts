/**
 * @file src/utils/same-origin-path.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is this address a path of THIS node, the way a browser reads it? The one place that
 *   answers, for every address a request names and a person's browser is then sent to or follows:
 *   the return address of a sign-in round, and the link on a notification or an account event.
 *
 *   A browser does not read an address the way startsWith('/') does. It turns a backslash into a
 *   slash, and drops a tab or a line break before it looks, so `/\evil.example` and
 *   `/<tab>/evil.example` are both `//evil.example` to it: another site. The test was written inline
 *   in seven places as `startsWith('/') && !startsWith('//')`, which admits both, and two of those
 *   did not have the second half at all.
 *
 *   A leaf module, so the notification services can ask it without importing the sign-in tree it
 *   used to live in (services/external-login.ts).
 * @structure isSameOriginPath · safeRedirectPath · withQueryParam
 * @usage res.redirect(safeRedirectPath(returnUrl, '/profile#access'));
 * @version-history
 *   v1.1.0 — 2026-11-10 — withQueryParam: adds a query parameter before the fragment. A return
 *     address keeps the page's `#` part, and a marker appended after it was part of the fragment,
 *     so location.search never saw it: a first sign-in from a link ending in `#/` looped back to
 *     the sign-in dialog instead of asking for a username.
 *   v1.0.0 — 2026-09-24 — Moved out of services/external-login.ts and hardened: a backslash or a
 *     control character anywhere refuses the address, and a caller names its own fallback.
 */

/**
 * True when `raw` is a path of this node: it starts with exactly one slash, and it holds no
 * backslash and no control character anywhere, since no path of this node has either.
 */
export function isSameOriginPath(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    // 0x5C is the backslash; below 0x20, and 0x7F, are the control characters.
    if (c === 0x5c || c < 0x20 || c === 0x7f) return false;
  }
  return true;
}

/**
 * A return address this node will send a browser to: `raw` when it is a path of this node, and
 * `fallback` otherwise. An empty fallback lets a caller tell "no safe address" apart from the root.
 */
export function safeRedirectPath(raw: unknown, fallback = '/'): string {
  return isSameOriginPath(raw) ? raw : fallback;
}

/**
 * `path` with `name=value` added to its query, before any fragment. Everything after the first `#`
 * is the fragment, which a browser keeps out of location.search, so a parameter appended to the
 * end of `/app.html#/` would be invisible to the page that reads it.
 */
export function withQueryParam(path: string, name: string, value: string): string {
  const hashAt = path.indexOf('#');
  const head = hashAt < 0 ? path : path.slice(0, hashAt);
  const fragment = hashAt < 0 ? '' : path.slice(hashAt);
  const param = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  const sep = !head.includes('?') ? '?' : head.endsWith('?') || head.endsWith('&') ? '' : '&';
  return `${head}${sep}${param}${fragment}`;
}
