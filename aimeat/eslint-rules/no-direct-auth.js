/**
 * @file no-direct-auth.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Custom ESLint rule: frontend code reads the session through /js/services/auth.js,
 *   not through window.AIMEAT.auth. Reports any member access of `.auth` on the AIMEAT global.
 *
 *   Why this rule exists. On 2026-08-07 the SPA header rendered the notification bell and the "Me"
 *   menu next to a "Sign In / Register" button — signed out, but still showing a signed-in header
 *   (and a dropdown of the previous account's notifications) until a reload. The cause was not the
 *   header: the login pill called its host's onLogout callback synchronously, before the un-awaited
 *   async logout() had cleared anything, so every listener that then read the session read the OLD
 *   one. Roughly thirty sites across public/ each reached into window.AIMEAT.auth their own way —
 *   `?.hasSession`, `?.getSession?.()?.jwt`, a private useState copy per view — so the same race had
 *   to be discovered and fixed thirty times. It was found once (portfolio.js, with an accurate
 *   comment describing it) and worked around inside that single view; the header inherited it clean.
 *
 *   A centralized service existed the whole time and even said "replaces direct window.AIMEAT.auth
 *   usage" in its own header. Nothing enforced it, so it decayed. That is what this rule fixes: not
 *   the bug, the ability of the bug to come back one bypass at a time.
 *
 *   The service is the single subscriber to the auth lib's own post-change events, so fixing an
 *   ordering bug there fixes it for every consumer at once. A view that reaches past it opts out of
 *   that guarantee silently — which is exactly the failure this reports.
 *
 *   Allowed by design: /js/services/auth.js itself carries a file-level disable (it is the wrapper),
 *   and a genuinely new lib capability can carry an `eslint-disable-next-line aimeat/no-direct-auth
 *   -- <reason>` while the wrapper method is added.
 * @structure
 *   - noDirectAuth: the rule module
 *   - isAimeatObject(): does this expression denote the AIMEAT global (bare or off window/globalThis)
 * @usage
 *   'aimeat/no-direct-auth': 'error'
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial implementation (session single-source cleanup).
 */

/**
 * True when `node` denotes the AIMEAT global: bare `AIMEAT`, or `window.AIMEAT` / `globalThis.AIMEAT`
 * (optional chaining included — `window?.AIMEAT` parses to the same member expression).
 * @param {any} node
 */
function isAimeatObject(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === 'AIMEAT';
  if (node.type === 'ChainExpression') return isAimeatObject(node.expression);
  if (node.type === 'MemberExpression') {
    const p = node.property;
    if (!node.computed) return p.type === 'Identifier' && p.name === 'AIMEAT';
    return p.type === 'Literal' && p.value === 'AIMEAT';
  }
  return false;
}

export const noDirectAuth = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Read the session through /js/services/auth.js instead of window.AIMEAT.auth',
    },
    schema: [],
    messages: {
      direct:
        'Read the session through /js/services/auth.js (or the useSession() hook in a Preact view) '
        + 'instead of window.AIMEAT.auth. The service subscribes to the auth lib\'s own post-change '
        + 'events, so it never hands out a session that has already been signed out. Available: '
        + 'getSession, hasSession, getJwt, authHeaders, getOwner, getGhii, getNodeUrl, onAuthChange, '
        + 'logout, showLoginModal, updateSessionMeta. Missing something? Add it to the service.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const p = node.property;
        const isAuthProp = node.computed
          ? (p.type === 'Literal' && p.value === 'auth')
          : (p.type === 'Identifier' && p.name === 'auth');
        if (!isAuthProp) return;
        if (!isAimeatObject(node.object)) return;
        context.report({ node, messageId: 'direct' });
      },
    };
  },
};
