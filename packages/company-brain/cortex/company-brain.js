/**
 * @file company-brain.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The company brain's browser surface: `AIMEAT.brain.*`. The app in this package talks
 *   to the caretaker extension through here and never to `/v1/ext/` itself.
 *
 *   WHY THIS LAYER EXISTS AT ALL, rather than the app calling the extension directly: an app may
 *   only ask for the scopes in the node's app-grant vocabulary, and there is no `ext:` word in it.
 *   Reaching an extension is cortex's job — the app trusts cortex, cortex trusts the extension, and
 *   no layer skips the one below.
 *
 *   EVERY CALL NEEDS A SESSION. A shop has a public half and a private one; a company brain has
 *   only the private one. What a company knows, and more to the point what it does not, is not a
 *   document for passers-by, so there is no getPublic path in this file at all.
 *
 *   THE KNOWLEDGE DOES NOT COME THROUGH HERE. Facts, entities, gaps and findings live in the
 *   owner's own workspace and the app reads them with aimeat-organism, so they can be exported,
 *   shared and taken elsewhere without this extension existing. What this file reaches is the
 *   machinery: which feeds run, when each last delivered, and what the caretaker said last week.
 *
 *   The short name `company-brain` below is rewritten to the per-instance registered name when the
 *   package is installed, in this file as in the app. Leave it exactly as it is.
 * @structure AIMEAT.brain: state · configure · putSource · removeSource · touchSource · sweep · staleness
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-071).
 */
(function (AIMEAT) {
  'use strict';

  var ACTION = '/v1/ext/company-brain/';

  /** POST one extension action with the caller's session. */
  function call(session, action, body) {
    if (!session || typeof session.fetch !== 'function') {
      return Promise.reject(new Error('sign in first'));
    }
    // session.fetch RESOLVES TO THE PARSED ENVELOPE, not to a Response. Calling .json() on it is the
    // mistake that looks right: it throws "res.json is not a function" from inside a lib, one frame
    // away from the button the person pressed.
    return session.fetch(ACTION + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (envelope) {
      // The action's own answer is inside the node's envelope. A refusal from the brain (not yours,
      // no such source) arrives as ok:false in there rather than as an HTTP error, so it is handed
      // back as it is: "no such source" is an answer the caller renders, not an exception.
      var out = (envelope && envelope.data) ? envelope.data : envelope;
      if (out && typeof out === 'object' && 'result' in out) return out.result;
      return out;
    });
  }

  /** Which company this brain is for, what feeds it, and what the caretaker last said. One read. */
  function state(session) { return call(session, 'admin', { op: 'state' }); }

  /** Name the company and the workspace this brain writes its knowledge into. */
  function configure(session, opts) {
    var o = opts || {};
    return call(session, 'admin', { op: 'configure', company: o.company, org: o.org, ws: o.ws });
  }

  /**
   * Add or replace one feed, by its id.
   *
   * `coverage_note` is the field worth filling in even when it feels obvious. A source whose limits
   * are unwritten is the one that quietly becomes "everything we know", and the caretaker names any
   * source that has none rather than counting them.
   */
  function putSource(session, source) { return call(session, 'admin', { op: 'put_source', source: source }); }

  function removeSource(session, id) { return call(session, 'admin', { op: 'remove_source', id: id }); }

  /** This feed delivered just now, or failed with a reason. A reason marks it broken. */
  function touchSource(session, id, error) {
    return call(session, 'admin', { op: 'touch_source', id: id, error: error || undefined });
  }

  /** Run the weekly check by hand. Same code the schedule runs, and it costs the same: nothing. */
  function sweep(session) { return call(session, 'admin', { op: 'sweep' }); }

  /**
   * How a fact stands right now. A PURE FUNCTION: no network, no schedule, no stored verdict.
   *
   *   anchored — points at a document the owner holds. Never falls due, however old it is.
   *   fresh    — observed, and its review_after has not arrived.
   *   due      — observed, and the day it was to be checked again has passed.
   *   unknown  — observed with no review_after, which is a fact nobody set a life span for.
   *
   * Ageing is decided here, when the page renders, rather than by anything that sweeps. It costs
   * nothing, it cannot drift out of step with the data, and there is no job to notice it broke.
   */
  function staleness(fact, today) {
    if (!fact) return 'unknown';
    if (fact.kind === 'anchored') return 'anchored';
    if (!fact.review_after) return 'unknown';
    var when = String(today || new Date().toISOString().slice(0, 10));
    // Both are ISO dates, and ISO dates compare correctly as strings.
    return String(fact.review_after).slice(0, 10) < when ? 'due' : 'fresh';
  }

  var exports = {
    state: state,
    configure: configure,
    putSource: putSource,
    removeSource: removeSource,
    touchSource: touchSource,
    sweep: sweep,
    staleness: staleness,
  };

  if (AIMEAT.register) AIMEAT.register('company-brain', exports);
  if (!AIMEAT.brain) AIMEAT.brain = exports;

})(window.AIMEAT || (window.AIMEAT = {}));
