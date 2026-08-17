/**
 * @file events/index.js
 * @description The aimeat-events library. Exposes AIMEAT.events: an app records what happened in
 *   it, onto its owner's own account record, and reads that record back.
 *
 *   WHY AN APP GETS TO WRITE HERE AT ALL. The account's feed answers "what has happened", and if it
 *   only ever carried what the NODE did it would answer a smaller question than the one people ask.
 *   An order placed, a game finished, a document signed — those happened to the person, in the app
 *   they were using, and nothing else in the system is in a position to say so.
 *
 *   THE NAMESPACE IS THE SERVER'S, NOT YOURS. Whatever kind you record arrives as
 *   `app:{yourAppId}:{kind}`, stamped from your grant. You cannot claim `payment_received`, cannot
 *   write in another app's name, and cannot collide with the node's own vocabulary. That is a
 *   guarantee rather than a convention, which is why it is not a parameter.
 *
 *   A KIND IS A KEY, NOT A SENTENCE. Record `order_placed`, not "Your order was placed" — the app
 *   decides how to say it, in whichever language the person reads, at the moment it renders. A
 *   sentence stored is a translation that became a data migration.
 *
 *   `data` IS FOR WHAT THE LINE INTERPOLATES. A dozen short values, nothing longer than a label.
 *   Anything bigger belongs behind `link`; the server truncates rather than argues.
 * @structure imports authFetch (session), attach (namespace);
 *   events.record(kind, data, opts); events.list(opts); events.archive(opts).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-events.js"></script>
 *   await AIMEAT.events.record('order_placed', { total: '24.90' }, { link: '/orders/9' });
 *   const { events } = await AIMEAT.events.list({ limit: 20 });
 * @version-history
 *   v1.1.0 — 2026-08-17 — Moved to /v1/account/events. /v1/events is the SSE stream and matched
 *     first, so reading the window answered MISSING_TICKET rather than the record.
 *   v1.0.0 — 2026-08-17 — Initial: an app writes its own history into its owner's record.
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-events.js');
import { attach } from '../_core/namespace.js';

/**
 * Record one thing that happened in this app.
 *
 * Needs the `memory:write` grant — an app holding it can already write into the owner's memory, and
 * one line of its own history is strictly less than that, so it asks for no separate permission.
 *
 * Fire-and-forget is the intended use: recording that something happened must never be able to stop
 * it from having happened. It resolves either way and throws only on a refusal you should see (no
 * grant, a kind the server will not accept).
 *
 * @param {string} kind    A key, 2-40 chars of a-z, 0-9 and _. Namespaced by the server.
 * @param {Record<string, string|number|boolean>} [data]  Values the rendered line interpolates.
 * @param {{link?: string, subject?: string}} [opts]
 *   link    — where the row goes when clicked. Must be a path on this node.
 *   subject — what it is about, so you can group or find rows later without parsing `data`.
 * @returns {Promise<{recorded: boolean, kind: string}>}
 */
async function record(kind, data, opts = {}) {
  const res = await authFetch('/v1/account/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      data: data || {},
      ...(opts.link ? { link: opts.link } : {}),
      ...(opts.subject ? { subject: opts.subject } : {}),
    }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message || 'Could not record the event');
  return body.data;
}

/**
 * The owner's live window, newest first — every app's events and the node's own, together, because
 * that is what "what has happened" means to the person whose account it is.
 *
 * Needs `memory:read`. Filter by prefix in your own code if you only want your app's rows; the
 * server does not, deliberately, because an app showing only its own history would be showing a
 * smaller truth than the one it has access to.
 *
 * @param {{limit?: number}} [opts]
 * @returns {Promise<{events: Array<object>, count: number, window: number}>}
 */
async function list(opts = {}) {
  const qs = opts.limit ? `?limit=${encodeURIComponent(String(opts.limit))}` : '';
  const res = await authFetch(`/v1/account/events${qs}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message || 'Could not read the events');
  return body.data;
}

/**
 * Everything that has fallen out of the window. Slower by design and paged: this is the archive, and
 * a person asking what happened lately should not page through a year to find out.
 *
 * @param {{limit?: number, offset?: number, from?: string, to?: string}} [opts]
 * @returns {Promise<{events: Array<object>, count: number, total: number}>}
 */
async function archive(opts = {}) {
  const params = new URLSearchParams();
  for (const key of ['limit', 'offset', 'from', 'to']) {
    if (opts[key] !== undefined && opts[key] !== null) params.set(key, String(opts[key]));
  }
  const qs = params.toString();
  const res = await authFetch(`/v1/account/events/archive${qs ? `?${qs}` : ''}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message || 'Could not read the archive');
  return body.data;
}

attach('events', { record, list, archive });
