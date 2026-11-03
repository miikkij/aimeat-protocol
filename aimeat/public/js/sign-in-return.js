/**
 * @file sign-in-return.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent connect pages approve an agent for an account and do nothing else. A person
 *   with no session goes to the front page (/v1/portal), signs in or registers the way this node is
 *   configured, and returns to the approval.
 *
 *   WHY. Both connect pages carried a sign-in form of their own, and neither could register anyone.
 *   Someone without an account typed an address, was told a link may have been sent, and no mail ever
 *   came (Jouni, 2026-11-04: "tuossa vain rekisteröidään agentti sille tilille ja sillä selvä"). The
 *   front page's dialog already follows the node's settings: the password policy, the emailed link,
 *   passkeys, SSO, and whether the node takes registrations.
 *
 *   The return address stays in the front page's own address, so every sign-in method that returns to
 *   the page it started from reaches the approval as well: an OIDC or SAML round, a first-time
 *   sign-up, and an emailed link opened from the dialog's own page.
 *
 *   Only the two connect pages are accepted as a return address. Neither approves anything without a
 *   press by the signed-in person, so a crafted link gets no further than a link to the page itself.
 *
 *   No imports: the standalone connect pages load this file with no importmap, and the unit test
 *   loads it in node. The SPA passes its auth service in.
 * @structure signInAddress(path, lang) · signInReturnTarget(search, origin) · refreshedSession() ·
 *   startSignInReturn(deps)
 * @usage import { signInAddress, refreshedSession } from '/js/sign-in-return.js';
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */

const PARAM = 'sign_in_return';
/** The only pages the front page sends a person back to. */
const RETURN_PATHS = ['/v1/oauth/consent', '/v1/agents/verify'];
/** Marks a forward in this tab, so a connect page that cannot read the session cannot cause a loop. */
const SENT_KEY = 'aimeat_sign_in_return_sent';
const BOUNCE_MS = 30_000;

/**
 * Where a connect page sends a person with no session.
 * @param {string} path the connect page's own path and query
 * @param {string} [lang] the language the connect page was asked in (OAuth's ui_locales)
 * @returns {string}
 */
export function signInAddress(path, lang) {
  const language = lang ? `&lang=${encodeURIComponent(lang)}` : '';
  return `/v1/portal?${PARAM}=${encodeURIComponent(path)}${language}`;
}

/**
 * The connect page this address returns to, or null when it names none or names any other place.
 * The address is parsed the way a browser parses it, so a backslash or a control character cannot
 * turn it into another host.
 * @param {string} search
 * @param {string} origin
 * @returns {string|null} a path and query on this origin
 */
export function signInReturnTarget(search, origin) {
  const raw = new URLSearchParams(search).get(PARAM);
  if (!raw || !raw.startsWith('/')) return null;
  let url;
  try {
    url = new URL(raw, origin);
  } catch (err) {
    console.warn('[aimeat] the sign-in return address does not parse:', err);
    return null;
  }
  if (url.origin !== origin || !RETURN_PATHS.includes(url.pathname)) return null;
  return url.pathname + url.search;
}

/**
 * The browser's session, from the httpOnly refresh cookie. POST /v1/auth/refresh is the
 * session-restore endpoint. Null when this browser holds no session.
 * @returns {Promise<{ jwt: string, owner: string }|null>}
 */
export async function refreshedSession() {
  try {
    const r = await fetch('/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-AIMEAT-Refresh': '1' },
    });
    const d = await r.json();
    const jwt = d.ok && d.data?.token;
    if (!jwt) return null;
    // The owner's name lives in the JWT payload.
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.owner ? { jwt, owner: payload.owner } : null;
  } catch (err) {
    console.warn('[aimeat] the session could not be read:', err);
    return null;
  }
}

function markSent(target) {
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify({ target, at: Date.now() }));
  } catch (err) {
    console.warn('[aimeat] the sign-in return could not be marked:', err);
  }
}

function sentJustNow(target) {
  try {
    const mark = JSON.parse(sessionStorage.getItem(SENT_KEY) || 'null');
    return !!mark && mark.target === target && Date.now() - mark.at < BOUNCE_MS;
  } catch (err) {
    console.warn('[aimeat] the sign-in return mark could not be read:', err);
    return false;
  }
}

/**
 * On the front page, when its address names a connect page: go there at once with a session, open
 * the sign-in dialog without one, and go there as soon as a session appears.
 *
 * A session the front page holds and the connect page cannot read (a session from another node has
 * no refresh cookie here) would otherwise send the person back and forth without end. A connect page
 * that returns the person within BOUNCE_MS gets the dialog instead of another forward.
 * @param {{ getSession: () => any, onAuthChange: (cb: (session: any) => void) => any,
 *   showLoginModal: (opts: object) => boolean, modalOptions: () => object }} deps
 * @returns {boolean} true when the page is on its way to the connect page
 */
export function startSignInReturn({ getSession, onAuthChange, showLoginModal, modalOptions }) {
  const current = () => signInReturnTarget(location.search, location.origin);
  const target = current();
  if (!target) return false;
  const go = (to) => {
    markSent(to);
    location.replace(to);
  };
  // Read again on each change: a person who left for another page has left this round as well.
  onAuthChange((session) => {
    const to = current();
    if (session && to) go(to);
  });
  if (getSession() && !sentJustNow(target)) {
    go(target);
    return true;
  }
  // onLogin as well: signing in again as the same person is no change for onAuthChange.
  showLoginModal({ ...modalOptions(), redirect: target, onLogin: () => go(target) });
  return false;
}
