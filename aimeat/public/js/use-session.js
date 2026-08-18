/**
 * @file public/js/use-session.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one Preact hook for "who is signed in". Wraps the session service
 *   (/js/services/auth.js) so a view never keeps its own copy of the session, and never writes its
 *   own subscribe/unsubscribe effect — the two habits that let stale sessions render (a header
 *   showing the notification bell and the "Me" menu next to a "Sign In" button, 2026-08-07).
 *
 *   It lives apart from the service because the service is framework-free and is imported by
 *   non-Preact code (js/api.js, the plain-JS service layer); only this file pulls in preact/hooks.
 *
 * @structure
 *   - useSession(): the active session object, or null when signed out. Re-renders on real changes.
 * @usage
 *   import { useSession } from '/js/use-session.js';
 *   const session = useSession();
 *   return html`${session ? html`<${Bell} />` : null}`;
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial: single session hook for every view.
 */
import { useState, useEffect } from 'preact/hooks';
import { getSession, onAuthChange } from '/js/services/auth.js';

/**
 * The active session, or null when signed out. Updates on sign-in, sign-out, token refresh and
 * profile-metadata edits.
 * @returns {any}
 */
export function useSession() {
  const [session, setSession] = useState(() => getSession());
  useEffect(() => {
    // The auth lib is injected during boot and may have finished (or restored a session) between
    // this component's first render and this effect — re-read before subscribing so a session that
    // arrived in that gap is not missed.
    setSession(getSession());
    return onAuthChange(setSession);
  }, []);
  return session;
}
