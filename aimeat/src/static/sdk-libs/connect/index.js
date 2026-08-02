/**
 * @file connect/index.js
 * @description The aimeat-connect client library. Exposes `AIMEAT.connect` — the browser side of a
 *   principal's own accounts at external services (TARGET-057).
 *
 *   WHAT THIS LIBRARY NEVER HAS. A token. Not the access token, not the refresh token, not the
 *   ciphertext. The node holds the credential and an app receives provider, label and status; when
 *   an app needs to know whether an account can do something, it ASKS, because it cannot know what
 *   a provider's own scope names mean. That is not a limitation of this library, it is the point of
 *   it, and it is the whole difference from pasting a bearer key into a config file.
 *
 *   WHAT IT OWNS instead is the set of things every app would otherwise get wrong: opening the
 *   provider window and noticing when it closes, showing `needs_reauth` as something a person can
 *   act on rather than a red error, telling a Bluesky user where an app password comes from BEFORE
 *   they go looking, and warning an Instagram user about the Business-account requirement BEFORE
 *   the attempt rather than after it fails for a reason nobody can read.
 * @structure list() · providers() · start() · revoke() · on()/off() · panel()
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-connect.js"></script>
 *   const accounts = await AIMEAT.connect.list();
 *   await AIMEAT.connect.start('mastodon', { instance: 'mastodon.social' });
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial (TARGET-057 phase 3).
 */
import { makeSession } from '../_core/session.js';
import { attach } from '../_core/namespace.js';
import { mountConnectPanel } from './panel.js';
import { PROVIDER_NOTES } from './notes.js';

const { authFetch } = makeSession('aimeat-connect.js');

/**
 * @typedef {Object} Connection
 * @property {string} id
 * @property {string} provider
 * @property {'personal'|'shared'} mode
 * @property {string} accountLabel  What the provider calls this account. Never app-supplied.
 * @property {'active'|'needs_reauth'|'revoked'} status
 */

/** Listeners for "the set of connections changed". */
const listeners = new Set();

function announce() {
  for (const fn of listeners) {
    try { fn(); } catch (err) {
      // One bad listener must not stop the others, but a swallowed handler error is how a panel
      // silently stops updating, so it is reported.
      console.warn('[aimeat-connect] a change listener threw', err);
    }
  }
}

/** The caller's own connections. Never anyone else's — the node scopes this, not the caller. */
async function list() {
  const res = await authFetch('/v1/connections');
  return (res?.data?.connections ?? []);
}

/** Providers this node can connect to. An unconfigured one is simply absent. */
async function providers() {
  const res = await authFetch('/v1/connections/providers');
  return (res?.data?.providers ?? []);
}

/**
 * Begin connecting an account, and resolve when the round has finished.
 *
 * The consent happens at the PROVIDER in a window this opens; nothing about the user's credentials
 * passes through the page. Resolution is detected by the window closing plus a re-read of the list,
 * because a cross-origin child window cannot be asked what happened to it — and a promise that
 * resolved on the window opening would report success for a cancelled connection.
 *
 * @param {string} provider
 * @param {{instance?: string, mode?: 'personal'|'shared', signal?: AbortSignal}} [opts]
 * @returns {Promise<{connected: boolean, connection?: Connection}>}
 */
async function start(provider, opts = {}) {
  const before = await list();
  const res = await authFetch('/v1/connections/start', {
    method: 'POST',
    body: JSON.stringify({
      provider,
      instance: opts.instance,
      mode: opts.mode ?? 'personal',
      // The callback returns the browser here; a same-origin path only, which the node enforces.
      // A static page whose only job is to close the pop-up, because the backend renders no HTML.
      return_url: '/connection-done.html',
    }),
  });
  const url = res?.data?.authorize_url;
  if (!url) throw new Error('the node did not return an authorization URL');

  const win = window.open(url, 'aimeat-connect', 'width=620,height=760,noopener=no');
  if (!win) throw new Error('the connect window was blocked; allow pop-ups for this site');

  await new Promise((resolve) => {
    const done = () => { clearInterval(timer); resolve(undefined); };
    const timer = setInterval(() => { if (win.closed) done(); }, 400);
    if (opts.signal) opts.signal.addEventListener('abort', done, { once: true });
  });

  const after = await list();
  const known = new Set(before.map((c) => c.id));
  const added = after.find((c) => !known.has(c.id));
  // A re-authorisation repairs an existing row rather than adding one, so "nothing new appeared"
  // is not the same as "nothing happened" — a status that moved off needs_reauth counts too.
  const repaired = after.find((c) => {
    const prev = before.find((p) => p.id === c.id);
    return prev && prev.status !== 'active' && c.status === 'active';
  });
  announce();
  const connection = added ?? repaired;
  return { connected: Boolean(connection), connection };
}

/**
 * Disconnect an account. The node tells the provider first where it can, and removes the credential
 * either way — so this always ends with the account disconnected here.
 */
async function revoke(connectionId) {
  const res = await authFetch(`/v1/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
  announce();
  return { revoked: true, toldProvider: Boolean(res?.data?.told_provider) };
}

/** Subscribe to "the set of connections changed". Returns an unsubscribe function. */
function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function off(fn) { listeners.delete(fn); }

const connect = {
  list, providers, start, revoke, on, off,
  /** Per-provider things a user must be told BEFORE they try. See notes.js. */
  notes: PROVIDER_NOTES,
  /** Mount the ready-made panel. See panel.js. */
  panel: (opts) => mountConnectPanel(connect, opts),
};

attach('connect', connect);

export default connect;
