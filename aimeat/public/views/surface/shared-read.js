/**
 * @file public/views/surface/shared-read.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One read per endpoint per page, shared by whichever blocks need it, re-read only when
 *   a domain that can actually change it fires.
 *
 *   THIS IS THE FIX FOR THE PROBLEM THE BLOCK ENGINE EXISTS TO SOLVE. The home used to run eleven
 *   requests through one loader, and one raw `aimeat-live-update` listener re-ran all eleven on
 *   every SSE event of any kind — a message arriving re-read the app list. The engine's rule is that
 *   a block owns its data, but several blocks genuinely read the SAME endpoint (the counts feed both
 *   the inventory band and the achievements strip), and four copies of one request is not ownership.
 *
 *   So: one request, several readers, and each read declares the domains it depends on. A message
 *   arriving now re-reads the mailbox and nothing else.
 *
 *   Module-level rather than a context, because the renderer mounts blocks from a map and they share
 *   no parent that could hold the value.
 * @structure useShared · invalidateShared
 * @usage const { data, ready } = useShared('usage', '/v1/owner/usage', ['memory', 'files', 'apps']);
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { useState, useEffect } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';

/** key → { data, ready } */
const cache = new Map();
/** key → the promise of a read already under way */
const inFlight = new Map();
/** key → Set of setState functions */
const listeners = new Map();

function snapshotOf(key) {
  return cache.get(key) ?? { data: null, ready: false };
}

function publish(key) {
  for (const fn of listeners.get(key) ?? []) fn(snapshotOf(key));
}

/**
 * Read once. A caller arriving while a read is in flight waits for that one rather than starting a
 * second. `pick` shapes the envelope into what the blocks want, so each block is not re-deriving it.
 */
export function readShared(key, path, pick) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = apiGet(path)
    .then((r) => { cache.set(key, { data: pick ? pick(r?.data) : (r?.data ?? null), ready: true }); })
    .catch((err) => {
      // Every block that reads this renders nothing without it, and a page that is silently empty
      // reads as an account where nothing has happened. Recorded rather than swallowed.
      swallowed(`surface: ${key}`, err);
      cache.set(key, { data: null, ready: true });
    })
    .finally(() => { inFlight.delete(key); publish(key); });
  inFlight.set(key, p);
  return p;
}

/** Drop what is cached for a key and read it again. For a block that just wrote something. */
export function invalidateShared(key, path, pick) {
  cache.delete(key);
  return readShared(key, path, pick);
}

/**
 * @param {string} key       what to cache it under
 * @param {string} path      the endpoint
 * @param {string[]} domains live-update domains that can change it; [] means it never changes
 * @param {(data:any)=>any} [pick] shape the envelope's data before it is cached
 */
export function useShared(key, path, domains, pick) {
  const [snap, setSnap] = useState(() => snapshotOf(key));

  useEffect(() => {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(setSnap);
    // An empty path means the caller does not know yet what to ask for (it is still waiting for an
    // owner name, say). Waiting is right; fetching the empty string is not.
    if (path && !cache.has(key)) readShared(key, path, pick);
    else setSnap(snapshotOf(key));
    return () => { listeners.get(key)?.delete(setSnap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path]);

  useEffect(() => {
    if (!path || !domains || domains.length === 0) return undefined;
    return onLiveUpdate(domains, () => { invalidateShared(key, path, pick); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path, domains.join(',')]);

  return snap;
}
