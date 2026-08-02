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
 * @structure list() · providers() · start() · attach() · revoke() · on()/off() · panel()
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-connect.js"></script>
 *   const accounts = await AIMEAT.connect.list();
 *   await AIMEAT.connect.start('mastodon', { instance: 'mastodon.social' });
 *   await AIMEAT.connect.publish({ connectionId: accounts[0].id, caption: 'hello' });
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

/**
 * Providers this node can connect to.
 *
 * `nodeConfigured: false` means the NODE holds no application credentials for it. That is not the
 * same as unavailable: a user who registers their own app with setClient() can connect it anyway.
 * Show those rather than hiding them, or an operator's decision not to register an app silently
 * removes a choice from every user.
 */
async function providers() {
  const res = await authFetch('/v1/connections/providers');
  return (res?.data?.providers ?? []);
}

/**
 * Publish to an account the CALLER connected.
 *
 * The whole point of the capability, from an app's side: one call, one post, and the credential
 * never comes near the page.
 *
 * IDEMPOTENT BY CONTENT. The node keys an attempt on publisher + connection + file + caption and
 * records it BEFORE anything leaves. Calling twice with the same arguments returns the FIRST
 * outcome with `replay: true` and posts nothing further, which is why a failed network call is safe
 * to retry. On a provider that charges per post, that is a billing control and not only a nicety.
 *
 * TWO SUCCESSFUL ANSWERS ARE NOT PUBLICATIONS. `status: 'held'` is awaiting moderation and
 * `status: 'queued'` is a spent provider allowance. Neither is an error, because reporting them as
 * one teaches a caller to retry, and retrying makes both worse. Read `status`, not the absence of
 * a throw.
 *
 * @param {{connectionId: string, storageKey?: string, caption?: string,
 *          params?: Record<string, unknown>}} input
 * @returns {Promise<{url?: string, replay: boolean, status: string, attemptId: string, error?: string}>}
 */
async function publish(input) {
  if (!input?.connectionId) throw new Error('publish needs a connectionId');
  const res = await authFetch('/v1/connections/publish', {
    method: 'POST',
    body: JSON.stringify({
      connection_id: input.connectionId,
      storage_key: input.storageKey,
      caption: input.caption ?? '',
      params: input.params ?? {},
    }),
  });
  const d = res?.data ?? {};
  return {
    url: d.url,
    replay: Boolean(d.replay),
    status: d.attempt?.status ?? 'unknown',
    attemptId: d.attempt?.id ?? '',
    error: d.attempt?.error ?? undefined,
  };
}

/**
 * The apps the CALLER registered themselves, one per provider at most.
 *
 * WHY ANYONE WOULD. Without their own, every user of a node reaches a provider through one
 * registration: the node's. To the provider they are one application, sharing its rate limit, its
 * reputation and — where publishing is charged per call — its bill. Their own app spends their own.
 *
 * `connectionCount` is how many of their accounts were made with it. It is not decoration: a token
 * can only be renewed by the client that issued it, so that is also how many would stop renewing if
 * the app went away, which is why removeClient() refuses while it is above zero.
 */
async function clients() {
  const res = await authFetch('/v1/connections/clients');
  return (res?.data?.clients ?? []);
}

/**
 * Register the caller's own app at a provider. Replaces any previous one of theirs.
 *
 * The secret is write-only: it is encrypted by the node and no endpoint ever returns it, including
 * this one.
 *
 * EXISTING CONNECTIONS ARE NOT MOVED ONTO IT. Each keeps the app that minted its token, because
 * that is the only client that can renew it. Reconnect an account to move it.
 */
async function setClient(provider, clientId, clientSecret) {
  const res = await authFetch('/v1/connections/clients', {
    method: 'PUT',
    body: JSON.stringify({ provider, client_id: clientId, client_secret: clientSecret }),
  });
  announce();
  return res?.data?.client;
}

/**
 * Remove the caller's own app registration.
 *
 * Refused while any of their connected accounts still depends on it, with the count in the message.
 * Those accounts could only be renewed by this client; removing it would leave them working until
 * their tokens expire and then failing with an error nobody could trace back to this moment.
 */
async function removeClient(provider) {
  await authFetch(`/v1/connections/clients/${encodeURIComponent(provider)}`, { method: 'DELETE' });
  announce();
  return { removed: true };
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

  await waitForRound(before.length, opts.signal);

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
 * Wait for the round to finish, WITHOUT touching the pop-up window.
 *
 * This node sets a Cross-Origin-Opener-Policy, which severs the opener relationship as soon as the
 * pop-up navigates to the provider. `win.closed` is then unreadable — the first version of this
 * polled it and logged ten "COOP would block the window.closed call" errors per connection while
 * appearing to work, because the flow completed for other reasons.
 *
 * Two signals instead, and neither goes near the window:
 *   - the done page announces on a same-origin BroadcastChannel, which COOP does not affect
 *   - the connection list is polled, which is what ACTUALLY decides success and also covers the
 *     user who closes the pop-up before it ever reaches the done page
 *
 * Resolves either way; gives up after the timeout rather than waiting forever on a cancelled round.
 */
async function waitForRound(countBefore, signal) {
  const DEADLINE = Date.now() + 180_000;
  let channel = null;
  let announced = false;
  let aborted = false;
  try {
    channel = new BroadcastChannel('aimeat-connect');
    channel.onmessage = () => { announced = true; };
  } catch (err) {
    console.warn('[aimeat-connect] BroadcastChannel unavailable; falling back to polling', err);
  }
  if (signal) signal.addEventListener('abort', () => { aborted = true; }, { once: true });
  try {
    while (Date.now() < DEADLINE && !aborted) {
      await new Promise((r) => setTimeout(r, 1200));
      if (announced) return true;
      const now = await list();
      if (now.length > countBefore) return true;
    }
    return false;
  } finally {
    if (channel) channel.close();
  }
}

/**
 * Connect an account by SUPPLYING a credential, for a provider with no authorization round.
 *
 * Separate from start() because the two must never overlap: attaching a provider that HAS a consent
 * screen would be a way to skip it, and the node refuses that in both directions. A provider's
 * `attachFields` (from providers()) is what tells them apart.
 *
 * @param {string} provider
 * @param {Record<string,string>} fields
 */
async function attachAccount(provider, fields) {
  const res = await authFetch('/v1/connections/attach', {
    method: 'POST',
    body: JSON.stringify({ provider, mode: 'personal', fields }),
  });
  announce();
  return { connected: true, connection: res?.data?.connection };
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
  list, providers, start, attach: attachAccount, revoke, publish, on, off,
  clients, setClient, removeClient,
  /** Per-provider things a user must be told BEFORE they try. See notes.js. */
  notes: PROVIDER_NOTES,
  /** Mount the ready-made panel. See panel.js. */
  panel: (opts) => mountConnectPanel(connect, opts),
};

attach('connect', connect);

export default connect;
