/**
 * @file webhook/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT.webhook: an app sends a JSON payload to an outside URL, or reads one, through
 *   the node's `living-hooks` extension as the signed-in caller. Served as /v1/libs/aimeat-webhook.js;
 *   needs aimeat-auth.js loaded first.
 *
 *   WHY A LIBRARY AND NOT fetch(). The browser never calls a third-party address itself: the owner's
 *   allowlist decides which hosts the node will call, the node's rate limits and size caps apply, the
 *   request goes out through safeFetch, and a key is named in a header as `{{secret:NAME}}` and filled
 *   from the signed-in person's vault on the way out. The app never holds the key and never sees it.
 *   Until 2026-09-28 only the living-document library could reach this route (living/hooks.js); this
 *   library exposes the same code path to every app, so there is one implementation.
 *
 *   THE ALLOWLIST IS THE OWNER'S. It is the public memory record `living-hooks.settings`,
 *   `{ allow_hosts: ["api.example.com", ".example.org"] }` (a leading dot allows the host and every
 *   subdomain), plus whatever the operator allows for everyone. `hosts()` reads it and `allowHost()`
 *   adds one; call `allowHost()` only from a control the person presses, because a host on that list
 *   is an address every app and agent of this person may send to.
 * @usage
 *   <meta name="aimeat-scopes" content="memory:read memory:write ext:invoke">
 *   <script src="https://aimeat.io/v1/libs/aimeat-auth.js"></script>
 *   <script src="https://aimeat.io/v1/libs/aimeat-webhook.js"></script>
 *   const r = await AIMEAT.webhook.send({ url: 'https://hooks.example.com/in', body: { id: 1 },
 *     headers: { Authorization: 'Bearer {{secret:EXAMPLE_TOKEN}}' } });
 *   if (r.refusal) show(AIMEAT.webhook.words(r.refusal)); else show(r.status);
 * @version-history
 *   v1.1.0 — 2026-10-16 — The allowlist read is strict (QA audit F6-04): only a missing record reads
 *     as empty, and a refused read throws with the node's code, so allowHost() writes nothing instead
 *     of storing a list that holds only the new host, and hosts() no longer shows a refusal as "no
 *     hosts allowed". langs() checks for a document instead of catching its absence.
 *   v1.0.2 — 2026-10-13 — The usage example declares ext:invoke: send and read call the living-hooks
 *     extension action, which node 4.0 refuses without it. Comment only.
 *   v1.0.1 — 2026-10-05 — The language comes from _core/lang.js, the one resolver (secaudit 2026-10, M7).
 *   v1.0.0 — 2026-09-28 — Initial: the living-hooks send and read for any app.
 */
import { makeSession } from '../_core/session.js';
import { storedLang } from '../_core/lang.js';
import { attach } from '../_core/namespace.js';
import { createHooks } from '../living/hooks.js';
const { authFetch } = makeSession('aimeat-webhook.js');

/** The owner's allowlist record, read by the living-hooks extension with getPublic. */
const SETTINGS_KEY = 'living-hooks.settings';

/** The page's reading language first, then the person's saved choice, for the refusal words. */
function langs() {
  const out = [];
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const attr = root ? root.getAttribute('lang') : null;
  if (attr) out.push(attr.slice(0, 2).toLowerCase());
  const saved = storedLang();
  if (saved) out.push(saved.slice(0, 2).toLowerCase());
  return out;
}

const hooks = createHooks({ langs: langs });

/**
 * A host as the extension compares it: lower case, no scheme, no path, no port. A leading dot is
 * kept, because it means "this host and everything under it".
 * @param {string} value
 * @returns {string}
 */
function normaliseHost(value) {
  let h = String(value || '').trim().toLowerCase();
  const dot = h.startsWith('.');
  h = h.replace(/^\.+/, '').replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) return '';
  return (dot ? '.' : '') + h;
}

/**
 * The current allowlist record; an empty one ONLY when the record does not exist. A read the node
 * refused throws with the node's code, because allowHost() writes the whole record back: answering a
 * refusal with {} would store a list holding only the new host and drop every other one.
 */
async function readSettings() {
  // ?soft=1: a missing record is a clean 200 with a null value, not a 404 in the console.
  const res = await authFetch('/v1/memory/' + encodeURIComponent(SETTINGS_KEY) + '?soft=1');
  if (!res.ok) {
    if (res.error && res.error.code === 'NOT_FOUND') return {};
    throw Object.assign(new Error((res.error && res.error.message)
      || 'The allowlist could not be read, so nothing was changed. Try again.'),
    { code: (res.error && res.error.code) || 'READ_FAILED' });
  }
  const value = res.data && res.data.value;
  return value && typeof value === 'object' ? value : {};
}

const webhook = {
  /** Whether this page can send at all, and the words to show when it cannot. */
  status() { return hooks.status(); },

  /**
   * POST (or PUT) a JSON body to `url`. Answers the extension's result with `ms`, or `{ refusal }`
   * with the node's own code and sentence. Never throws.
   * @param {{ url: string, method?: 'POST'|'PUT', headers?: Record<string,string>, body: any }} req
   */
  send(req) { return hooks.send(req); },

  /**
   * GET `url` and answer the JSON (or the value at `path`, or the raw body with `raw: true`).
   * @param {{ url: string, path?: string, raw?: boolean, headers?: Record<string,string> }} req
   */
  read(req) { return hooks.read(req); },

  /** A refusal as a person reads it: the node's sentence first, then a fallback per code. */
  words(refusal) { return hooks.words(refusal); },

  /**
   * The hosts this person allows. The operator's hosts apply as well and are not listed here.
   * Throws (with the node's `code`) when the read was refused: an empty list means none are allowed.
   */
  async hosts() {
    const settings = await readSettings();
    return Array.isArray(settings.allow_hosts) ? settings.allow_hosts.slice() : [];
  },

  /**
   * Add one host to the person's allowlist. Returns the new list. Call it only from a control the
   * person presses: every app and agent of this person may send to a host on this list. When the
   * current list cannot be read it throws and writes nothing.
   * @param {string} host  "api.example.com", "https://api.example.com/x" or ".example.com"
   */
  async allowHost(host) {
    const clean = normaliseHost(host);
    if (!clean) {
      throw Object.assign(new Error('Give a host name such as api.example.com.'), { code: 'INVALID_INPUT' });
    }
    const settings = await readSettings();
    const list = Array.isArray(settings.allow_hosts) ? settings.allow_hosts.slice() : [];
    if (!list.includes(clean)) list.push(clean);
    // Public, because the extension reads it with getPublic; it holds host names, never a secret.
    const res = await authFetch('/v1/memory', {
      method: 'POST',
      body: JSON.stringify({ key: SETTINGS_KEY, value: Object.assign({}, settings, { allow_hosts: list }), visibility: 'public' }),
    });
    if (!res.ok) {
      throw Object.assign(new Error((res.error && res.error.message) || 'The allowlist was not saved.'),
        { code: res.error && res.error.code });
    }
    return list;
  },
};

attach('webhook', webhook);
