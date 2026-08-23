/**
 * @file businesslauncher-shop.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shop's browser surface: `AIMEAT.shop.*`. Both apps in this package talk to the
 *   extension through here and never to `/v1/ext/` themselves.
 *
 *   WHY THIS LAYER EXISTS AT ALL, rather than the apps calling the extension directly: an app may
 *   only ask for the scopes in the node's app-grant vocabulary, and there is no `ext:` word in it.
 *   Reaching an extension is cortex's job — the app trusts cortex, cortex trusts the extension, and
 *   no layer skips the one below.
 *
 *   THE READS TAKE NO SESSION. A shop has to be browsable by somebody who has never heard of this
 *   node, so the catalogue, the shelf numbers and the policy pages are read straight from the
 *   extension's public namespace with no auth at all. Only the writes need a session.
 *
 *   The short names `businesslauncher-shop` below are rewritten to the per-instance registered names
 *   when the package is installed, in this file as in the apps. Leave them exactly as they are.
 * @structure AIMEAT.shop: catalog · availability · pages · reserve · release · admin
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */
(function (AIMEAT) {
  'use strict';

  var EXT = 'ext:businesslauncher-shop';
  var ACTION = '/v1/ext/businesslauncher-shop/';

  /** One public record, or null. Never throws: an empty shop is a state, not an error. */
  function readPublic(key) {
    if (!AIMEAT.data || !AIMEAT.data.getPublic) {
      return Promise.reject(new Error('aimeat-data is not loaded — add /v1/libs/aimeat-data.js'));
    }
    return AIMEAT.data.getPublic(EXT, key).catch(function () { return null; });
  }

  /** The shop's own record: who owns it and which currency it prices in. */
  function shop() { return readPublic('shop'); }

  /** What is for sale, as the owner last published it. `{ currency, updated, items: [...] }`. */
  function catalog() { return readPublic('catalog'); }

  /**
   * How many of each sku are on the shelf: `{ units: { sku: n }, updated }`.
   *
   * A DISPLAY number. The record that decides a sale is private and is read inside the same
   * compare-and-swap that takes the units, so a stale number here cannot oversell — it can only be
   * a moment out of date. Show it as availability, never as a promise.
   */
  function availability() { return readPublic('availability'); }

  /** Privacy, terms and delivery as the owner published them, each carrying who wrote it. */
  function pages() { return readPublic('pages'); }

  /** POST one extension action with the caller's session. */
  function call(session, action, body) {
    if (!session || typeof session.fetch !== 'function') {
      return Promise.reject(new Error('sign in first'));
    }
    return session.fetch(ACTION + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().then(function (envelope) {
        // The action's own answer is inside the node's envelope. A refusal from the shop (sold out,
        // not yours) arrives as ok:false in there, not as an HTTP error, so it is handed back as it
        // is rather than thrown: "sold out" is an answer the caller renders, not an exception.
        var out = (envelope && envelope.data) ? envelope.data : envelope;
        if (out && typeof out === 'object' && 'result' in out) return out.result;
        return out;
      });
    });
  }

  /**
   * Hold units while the buyer pays. The caller owns the id and the expiry, so a retry after a
   * dropped connection is the same hold rather than a second one.
   */
  function reserve(session, opts) {
    var minutes = (opts && opts.minutes) || 15;
    var id = (opts && opts.reservationId) || newId();
    return call(session, 'reserve', {
      sku: opts.sku,
      qty: opts.qty || 1,
      reservationId: id,
      expiresAt: new Date(Date.now() + minutes * 60000).toISOString(),
    });
  }

  /** Give a hold back. The person who took it may do this, and so may the shop owner. */
  function release(session, reservationId) {
    return call(session, 'release', { reservationId: reservationId });
  }

  /** Owner operations: claim, publish_catalog, publish_pages, set_stock, commit, sweep. */
  function admin(session, op, payload) {
    var body = { op: op };
    for (var k in (payload || {})) { if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k]; }
    return call(session, 'admin', body);
  }

  /** A reservation id the buyer's own browser generates. */
  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  var exports = {
    shop: shop,
    catalog: catalog,
    availability: availability,
    pages: pages,
    reserve: reserve,
    release: release,
    admin: admin,
    newId: newId,
  };

  if (AIMEAT.register) AIMEAT.register('businesslauncher-shop', exports);
  if (!AIMEAT.shop) AIMEAT.shop = exports;

})(window.AIMEAT || (window.AIMEAT = {}));
