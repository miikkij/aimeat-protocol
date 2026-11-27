/**
 * @file public/js/connection-wait.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Waiting for a connect round at a provider to finish, for every page that starts one
 *   (Email, Access). Two signals, and no timer that asks the server again:
 *   - the done page (connection-done.html) announces on the same-origin BroadcastChannel
 *     'aimeat-connect', which the node's Cross-Origin-Opener-Policy does not cut;
 *   - the node announces every change to the owner's connections on the `connections` live domain
 *     (src/services/connections/live.ts), which the page hears as the `aimeat-live-update` event; the
 *     list is then read once and compared with the list before the round (connectionChanged). This
 *     covers a person who closes the pop-up before it reaches the done page.
 *   A new sign-in to a mailbox that needed one repairs its row in place (same id, status back to
 *   'active'), so the comparison reads the states as well as the ids.
 * @structure connectionChanged(before, now) · needsSignIn(conn) · snapshot(list) · waitForConnection(before, listFn, opts)
 * @usage
 *   const before = snapshot(connections);
 *   window.open(url, 'aimeat-connect');
 *   const ok = await waitForConnection(before, () => email.mailConnections(providers));
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial: one wait for the Email and Access pages, which each polled the list every
 *     1.2 s and noticed only a new row, never a renewed sign-in.
 */
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';

/** A connection that needs a new sign-in at its provider (src/models/connection-schemas.ts ConnectionStatus). */
export function needsSignIn(conn) {
  return !!conn && conn.status === 'needs_reauth';
}

/** The part of a list the comparison reads: each row's id and status. */
export function snapshot(list) {
  return (list || []).map((c) => ({ id: c.id, status: c.status }));
}

/**
 * Did a connect round finish, read from the list before and after it: a row that was not there (a
 * first connection, or a sign-in with another account), or a row that was there and not active and
 * is active now (a renewed sign-in).
 * @param {Array<{ id: string, status?: string }>} before
 * @param {Array<{ id: string, status?: string }>} now
 */
export function connectionChanged(before, now) {
  const was = new Map((before || []).map((c) => [c.id, c.status]));
  return (now || []).some((c) => !was.has(c.id) || (c.status === 'active' && was.get(c.id) !== 'active'));
}

/**
 * Resolves true when the round finished, false when nothing was heard within `timeoutMs` (a
 * cancelled round). `listFn` reads the list again; it is called only when the node says the
 * connections changed.
 * @param {Array<{ id: string, status?: string }>} before
 * @param {() => Promise<Array<{ id: string, status?: string }>>} listFn
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<boolean>}
 */
export function waitForConnection(before, listFn, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let channel = null;
    let stopLive = () => {};
    let timer = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stopLive();
      try { channel?.close(); } catch (err) { swallowed('connection-wait: close', err); }
      resolve(ok);
    };
    stopLive = onLiveUpdate(['connections'], () => {
      listFn().then((now) => { if (connectionChanged(before, now)) finish(true); })
        .catch((err) => swallowed('connection-wait: list', err));
    });
    try {
      channel = new BroadcastChannel('aimeat-connect');
      channel.onmessage = () => finish(true);
    } catch (err) {
      // Not fatal: the live domain still says when the list changed.
      swallowed('connection-wait: broadcast', err);
    }
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}
