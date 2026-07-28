/**
 * @file exchange/client.js
 * @description Shared fetch plumbing for the aimeat-exchange library. EXCHANGE is a two-sided market
 *   whose read surface is deliberately PUBLIC (browsing a listing, its ODPS document and its stats
 *   needs no account) while every write and every "mine" read is authorised. So there are three call
 *   shapes rather than one: `pub` (never sends a session), `authed` (requires one — the auth guard
 *   names this library in its error) and `maybe` (sends the session when there is one). `maybe` is not
 *   a convenience: GET /v1/exchange/offerings reconciles the CALLER's own projections before it
 *   answers, so a signed-in seller browsing the market sees their own listings up to date, and a
 *   signed-out visitor still gets the market.
 *   SECURITY: this file carries no credentials of its own. It sends the aimeat-auth session and
 *   renders what comes back — who may see what is the server's decision, never this library's.
 * @structure exchangeError(res, fallback) · qs(params) · pub(path) · authed(path, opts) ·
 *   maybe(path) · hasSession()
 * @usage import { authed, pub, qs, exchangeError } from './client.js';
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 */
import { APEX_URL } from '../_core/config.js';
import { makeSession } from '../_core/session.js';

const NODE_URL = APEX_URL;
const { authFetch } = makeSession('aimeat-exchange.js');

/**
 * Build an Error from a failed envelope, preserving the machine-readable code so callers can branch
 * on it (`SOURCE_MANAGED`, `SCHEMA_REQUIRED`, `USAGE_TERMS_REQUIRED`, `NOT_PRICED`, `BUDGET_TOO_LOW`
 * …) instead of matching on message text. EXCHANGE refusals are mostly *actionable* — they say which
 * field the provider must publish — so the message is kept verbatim.
 * @param {any} res            The parsed envelope.
 * @param {string} fallback    Message to use when the envelope carries none.
 * @returns {Error & { code?: string, details?: unknown }}
 */
export function exchangeError(res, fallback) {
  const e = /** @type {Error & { code?: string, details?: unknown }} */ (
    new Error((res && res.error && res.error.message) || fallback));
  e.code = res && res.error && res.error.code;
  e.details = res && res.error && res.error.details;
  return e;
}

/**
 * Serialise a query object, dropping null/undefined/'' so an unset filter is not sent as an empty
 * one (the offerings route treats every supplied filter as a NARROWING term).
 * @param {Record<string, string|number|boolean|null|undefined>} [params]
 * @returns {string}  `?a=1&b=2`, or '' when nothing is set.
 */
export function qs(params) {
  const parts = [];
  for (const k of Object.keys(params || {})) {
    const v = params[k];
    if (v === null || v === undefined || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** True when aimeat-auth is loaded AND someone is signed in — never throws. */
export function hasSession() {
  try {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    return !!(auth && auth.getSession());
  } catch { return false; }
}

/**
 * A PUBLIC read — no session, ever. Used for the browse surface so a signed-out visitor sees the
 * market exactly as the node publishes it.
 * @param {string} path
 * @param {string} fallback  Error message when the envelope carries none.
 * @returns {Promise<any>}   The envelope's `data`.
 */
export async function pub(path, fallback) {
  const r = await fetch(NODE_URL + path);
  const res = await r.json();
  if (!res.ok) throw exchangeError(res, fallback);
  return res.data;
}

/** A PUBLIC read that returns raw text rather than an envelope (the ODPS `.yaml` projection). */
export async function pubText(path, fallback) {
  const r = await fetch(NODE_URL + path);
  const text = await r.text();
  if (!r.ok) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* a non-envelope error body — fall through */ }
    throw exchangeError(parsed, fallback);
  }
  return text;
}

/**
 * An AUTHORISED call — the session's own fetch (bearer token, refresh on 401, scope self-heal).
 * @param {string} path
 * @param {RequestInit} [opts]
 * @param {string} [fallback]
 * @returns {Promise<any>}  The envelope's `data`.
 */
export async function authed(path, opts, fallback) {
  const res = await authFetch(path, opts);
  if (!res.ok) throw exchangeError(res, fallback || 'EXCHANGE request failed');
  return res.data;
}

/**
 * A public read that SENDS the session when there is one. Signed in, the offerings route brings the
 * caller's own projections up to date before answering; signed out, the same call still returns the
 * public market.
 * @param {string} path
 * @param {string} fallback
 * @returns {Promise<any>}
 */
export async function maybe(path, fallback) {
  if (!hasSession()) return pub(path, fallback);
  try {
    return await authed(path, undefined, fallback);
  } catch (e) {
    // A stale or scope-short session must never turn a PUBLIC surface into an error page.
    if (e && (e.code === 'UNAUTHORIZED' || e.code === 'FORBIDDEN')) return pub(path, fallback);
    throw e;
  }
}

/** POST/DELETE helper: JSON body, authorised. */
export function send(path, method, body, fallback) {
  const opts = /** @type {RequestInit} */ ({ method });
  if (body !== undefined) opts.body = JSON.stringify(body);
  return authed(path, opts, fallback);
}

export { NODE_URL };
