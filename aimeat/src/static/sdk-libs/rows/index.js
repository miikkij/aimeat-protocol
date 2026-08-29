/**
 * @file rows/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT.rows: an app's door to an organism ROW space — the append-only, indexed
 *   table a group accumulates (an event log, an audit trail, readings). Served as
 *   /v1/libs/aimeat-rows.js; needs aimeat-auth.js loaded first.
 *
 *   Two hands open the door, and this library is only ever the second: the ORGANISM names the app
 *   in the space's manifest (`objectTypes[].apps: ["owner/filename"]`), and the PERSON approves the
 *   `organism:rows` scope at sign-in (declare it in `<meta name="aimeat-scopes">`). With both, the
 *   app appends to and reads back that one space while the person is an active member. Nothing
 *   else on the organism opens. A space that does not name the app answers 403 with a sentence
 *   that says so; surface it, do not swallow it.
 *
 *   Rows are the group's, charged to the workspace, never rewritten by anyone: write what
 *   happened, with `occurredAt` when it happened, and a stable `rowId` when re-sending the same
 *   event must not duplicate it.
 * @usage
 *   <meta name="aimeat-scopes" content="memory:read memory:write organism:rows">
 *   <script src="https://aimeat.io/v1/libs/aimeat-auth.js"></script>
 *   <script src="https://aimeat.io/v1/libs/aimeat-rows.js"></script>
 *   await AIMEAT.rows.append(orgId, ws, 'event', { app: 'shop.html', kind: 'order', actor, at, detail });
 *   const { rows } = await AIMEAT.rows.read(orgId, ws, 'event', { limit: 50 });
 *   const stats = await AIMEAT.rows.stats(orgId, ws, 'event');
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial, for the legal-pages demo's audit trail.
 */
import { makeSession } from '../_core/session.js';
import { attach } from '../_core/namespace.js';
const { authFetch } = makeSession('aimeat-rows.js');

function base(orgId, ws, space) {
  return '/v1/organisms/' + encodeURIComponent(orgId) + '/workspace/rows/' + encodeURIComponent(space)
    + '?ws=' + encodeURIComponent(ws);
}

function fail(res, fallback) {
  // The node's own sentence, and its code beside it: a 403 from a space that does not name the
  // app is one the app should show, not swallow.
  throw Object.assign(new Error((res && res.error && res.error.message) || fallback),
    { code: res && res.error ? res.error.code : undefined });
}

const rows = {
  /**
   * Append one row (`body` an object) or many (`opts.rows`, each `{ body, rowId?, occurredAt? }`).
   * Returns `{ written, row_ids, pruned }`.
   */
  async append(orgId, ws, space, body, opts) {
    const payload = opts && Array.isArray(opts.rows)
      ? { rows: opts.rows.map(function (r) { return { row_id: r.rowId, occurred_at: r.occurredAt, body: r.body }; }) }
      : { body: body, row_id: opts && opts.rowId, occurred_at: opts && opts.occurredAt };
    const res = await authFetch(base(orgId, ws, space), { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) fail(res, 'Failed to append rows');
    return res.data;
  },

  /**
   * Read rows by `occurredAt`. `opts`: `limit`, `since` / `until` (ISO, on occurredAt), `order`
   * ('asc' | 'desc'), `cursor` (from a previous answer), and `where` — one value per indexed
   * field (`{ where: { kind: 'order' } }`). Returns `{ rows, cursor, indexed }`; `cursor` is set
   * when there is more.
   */
  async read(orgId, ws, space, opts) {
    let url = base(orgId, ws, space);
    const o = opts || {};
    for (const k of ['limit', 'since', 'until', 'order', 'cursor']) {
      if (o[k] !== undefined && o[k] !== null && o[k] !== '') url += '&' + k + '=' + encodeURIComponent(o[k]);
    }
    if (o.where) for (const k of Object.keys(o.where)) url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(o.where[k]);
    const res = await authFetch(url);
    if (!res.ok) fail(res, 'Failed to read rows');
    return res.data;
  },

  /** What the space holds without reading a row: `{ rows, bytes, oldest, newest, lastWriteAt }`. */
  async stats(orgId, ws, space) {
    const res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId) + '/workspace/rows/'
      + encodeURIComponent(space) + '/stats?ws=' + encodeURIComponent(ws));
    if (!res.ok) fail(res, 'Failed to read row stats');
    return res.data && res.data.stats ? res.data.stats : res.data;
  },
};

attach('rows', rows);
export default rows;
