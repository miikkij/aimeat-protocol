/**
 * @file parties/index.js
 * @description The aimeat-parties library — AIMEAT.parties. An app's own users without an AIMEAT
 *   account: they register with an e-mail address, sign in with a mailed link, and keep their own
 *   records in the app (plan doc-mvwxcas3dom3, D4.2). They are outside parties of the app's owner and
 *   never accounts of the node.
 *
 *   A THIN CLIENT. Who may register, the link, the session and whose data a request reaches are all
 *   decided by the node (routes/app-parties.ts, services/app-parties/). This library carries the calls
 *   and keeps the session token in sessionStorage for the tab, nothing else.
 *
 *   THE LINK COMES BACK TO THE APP. signUp(email) and signIn(email) mail a link to the app's own
 *   address with `?aimeat_party_link=`; on load the library finds it, opens it with the node, removes
 *   it from the address and holds the session. `ready()` resolves when that is done.
 * @structure call · AIMEAT.parties { signUp, signIn, me, signOut, ready, registration, signedIn, data { get, set, remove } }
 * @usage
 *   <script src="/v1/libs/aimeat-parties.js"></script>
 *   await AIMEAT.parties.ready();
 *   if (!AIMEAT.parties.signedIn()) await AIMEAT.parties.signUp('person@example.org');
 *   const me = await AIMEAT.parties.me();
 *   await AIMEAT.parties.data.set('cart', { items: [] });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.2).
 */
import { APEX_URL, NODE_URL } from '../_core/config.js';
import { appRef } from '../_core/app-ref.js';
import { attach } from '../_core/namespace.js';

const BASE = (APEX_URL || NODE_URL || '').replace(/\/+$/, '');
const STORE_KEY = 'aimeat-party-session';

/** @returns {{ owner: string, filename: string }} */
function app() {
  const ref = appRef();
  if (!ref) throw Object.assign(new Error('This page is not an app served by an AIMEAT node.'), { code: 'NOT_AN_APP' });
  return ref;
}

/** @returns {string} */
function path(suffix) {
  const ref = app();
  return `${BASE}/v1/apps/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.filename)}${suffix}`;
}

/** @returns {string|null} */
function token() {
  try { return sessionStorage.getItem(STORE_KEY); } catch (e) {
    // A private window without storage: the session lives in memory only.
    console.debug('[aimeat-parties] no session storage:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** @param {string|null} t */
function keep(t) {
  try {
    if (t) sessionStorage.setItem(STORE_KEY, t); else sessionStorage.removeItem(STORE_KEY);
  } catch (e) {
    // A private window without storage keeps the session in memory only.
    console.debug('[aimeat-parties] no session storage:', e instanceof Error ? e.message : e);
  }
  memory = t;
}
/** @type {string|null} */
let memory = null;

/**
 * One call to the node: the envelope unwrapped, a refusal thrown with `.code`.
 * @param {string} suffix
 * @param {{ method?: string, body?: unknown, auth?: boolean }} [opts]
 */
async function call(suffix, opts = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };
  const t = token() || memory;
  if (opts.auth && t) headers.Authorization = `Bearer ${t}`;
  const r = await fetch(path(suffix), {
    method: opts.method || (opts.body === undefined ? 'GET' : 'POST'),
    headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  /** @type {any} */
  let body;
  try { body = await r.json(); } catch (e) {
    // A proxy or a crash page answered with something that is not JSON: the status below says what failed.
    console.warn('[aimeat-parties] the node answer was not JSON:', r.status, e instanceof Error ? e.message : e);
    body = null;
  }
  if (!r.ok || !body || body.ok === false || body.error) {
    const err = (body && body.error) || { code: 'REQUEST_FAILED', message: `The node answered ${r.status}.` };
    if (r.status === 401 && opts.auth) keep(null);
    throw Object.assign(new Error(err.message || 'Request failed'), { code: err.code, status: r.status });
  }
  return body.data !== undefined ? body.data : body;
}

/** Open a link the page was loaded with, once. */
const linkOpened = (async () => {
  try {
    const url = new URL(location.href);
    const link = url.searchParams.get('aimeat_party_link');
    if (!link) return;
    url.searchParams.delete('aimeat_party_link');
    history.replaceState(history.state, '', url.toString());
    const out = await call('/parties/verify', { body: { token: link } });
    keep(out.token);
  } catch (e) {
    // A used or expired link: the page goes on signed out, and signIn() mails a new one.
    console.warn('[aimeat-parties] the sign-in link did not open:', e instanceof Error ? e.message : e);
  }
})();

const lang = () => (document.documentElement.lang || navigator.language || 'en').slice(0, 2);

const parties = {
  /** Resolves when a link the page was loaded with has been opened. */
  ready: () => linkOpened,
  /** Whether this tab holds a session. */
  signedIn: () => !!(token() || memory),
  /** Whether people may register to this app now: { open, effective }. */
  registration: () => call('/parties/registration'),
  /** Register with an e-mail address; a link is mailed to it. @param {string} email @param {string} [displayName] */
  signUp: (email, displayName) => call('/parties/signup', { body: { email, ...(displayName ? { display_name: displayName } : {}), lang: lang() } }),
  /** Ask for a new sign-in link. @param {string} email */
  signIn: (email) => call('/parties/signin', { body: { email, lang: lang() } }),
  /** Who is signed in, and its role in the app. */
  me: () => call('/parties/me', { auth: true }),
  /** End every session of this person in this app. */
  signOut: async () => {
    try { await call('/parties/signout', { body: {}, auth: true }); } finally { keep(null); }
    return { signed_out: true };
  },
  data: {
    /** One collection of the person's own, or with { shared: true } one the app shares. @param {string} key @param {{ shared?: boolean }} [opts] */
    get: async (key, opts = {}) => (await call(`/party-data/${encodeURIComponent(key)}${opts.shared ? '?shared=true' : ''}`, { auth: true })).value,
    /** Replace one collection of the person's own (at most 64 kB). @param {string} key @param {unknown} value */
    set: (key, value) => call(`/party-data/${encodeURIComponent(key)}`, { method: 'PUT', body: { value }, auth: true }),
    /** Delete one collection of the person's own. @param {string} key */
    remove: (key) => call(`/party-data/${encodeURIComponent(key)}`, { method: 'DELETE', auth: true }),
  },
};

attach('parties', parties);
