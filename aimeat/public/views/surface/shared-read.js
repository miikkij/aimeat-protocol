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
 *   THE CACHE HOLDS THE RAW ENVELOPE, AND `pick` IS APPLIED PER READER. It used to cache whatever
 *   the FIRST caller's `pick` produced, so the shape depended on which block rendered first — and
 *   two pairs disagreed: `organisms` and `knowledge` are each read once with a pick and once
 *   without. Operator-editable block ordering decides which runs first, so rearranging the page
 *   could hand a block a shape it did not expect and make the band disappear. One fetch either way;
 *   the pick is per consumer now, and two readers of one endpoint can no longer disagree about what
 *   they got. Review item 7.3, 2026-09-06.
 *
 *   AND IT IS CLEARED WHEN THE ACCOUNT CHANGES. The cache is module-level and survived a sign-out
 *   and sign-in in the same tab, so the next account's first render showed the previous account's
 *   counts until each key's own live-update fired. It listens for `aimeat-auth-change` and empties.
 *   Review item 7.5.
 *
 *   Module-level rather than a context, because the renderer mounts blocks from a map and they share
 *   no parent that could hold the value.
 * @structure useShared · invalidateShared · readShared
 * @usage const { data, ready } = useShared('usage', '/v1/owner/usage', ['memory', 'files', 'apps']);
 * @version-history
 *   v1.1.0 — 2026-09-06 — Raw cache with a per-reader `pick` (item 7.3), and cleared on
 *     `aimeat-auth-change` (item 7.5).
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { useState, useEffect } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';

/** key → { raw, ready } — the envelope's `data` as it arrived, never a shaped copy of it. */
const cache = new Map();
/** key → the promise of a read already under way */
const inFlight = new Map();
/** key → Set of callbacks taking the raw snapshot */
const listeners = new Map();

function snapshotOf(key) {
  return cache.get(key) ?? { raw: null, ready: false };
}

function publish(key) {
  for (const fn of listeners.get(key) ?? []) fn(snapshotOf(key));
}

/**
 * Read once. A caller arriving while a read is in flight waits for that one rather than starting a
 * second. What is stored is the raw `data`; each reader shapes its own copy.
 */
export function readShared(key, path) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = apiGet(path)
    .then((r) => { cache.set(key, { raw: r?.data ?? null, ready: true }); })
    .catch((err) => {
      // Every block that reads this renders nothing without it, and a page that is silently empty
      // reads as an account where nothing has happened. Recorded rather than swallowed.
      swallowed(`surface: ${key}`, err);
      cache.set(key, { raw: null, ready: true });
    })
    .finally(() => { inFlight.delete(key); publish(key); });
  inFlight.set(key, p);
  return p;
}

/** Drop what is cached for a key and read it again. For a block that just wrote something. */
export function invalidateShared(key, path) {
  cache.delete(key);
  return readShared(key, path);
}

/**
 * Forget everything. The cache belongs to whoever is signed in, and nothing else about it is
 * per-account — so a sign-out that left it standing handed the next person the previous one's
 * numbers on first render.
 */
export function clearShared() {
  cache.clear();
  inFlight.clear();
  for (const key of listeners.keys()) publish(key);
}

if (typeof window !== 'undefined') {
  window.addEventListener('aimeat-auth-change', clearShared);
}

/**
 * @param {string} key       what to cache it under
 * @param {string} path      the endpoint
 * @param {string[]} domains live-update domains that can change it; [] means it never changes
 * @param {(data:any)=>any} [pick] shape this reader's copy of the cached envelope
 */
export function useShared(key, path, domains, pick) {
  const shape = (snap) => ({ data: snap.raw === null ? null : (pick ? pick(snap.raw) : snap.raw), ready: snap.ready });
  const [snap, setSnap] = useState(() => shape(snapshotOf(key)));

  useEffect(() => {
    const onRaw = (raw) => setSnap(shape(raw));
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(onRaw);
    // An empty path means the caller does not know yet what to ask for (it is still waiting for an
    // owner name, say). Waiting is right; fetching the empty string is not.
    if (path && !cache.has(key)) readShared(key, path);
    else setSnap(shape(snapshotOf(key)));
    return () => { listeners.get(key)?.delete(onRaw); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path]);

  useEffect(() => {
    if (!path || !domains || domains.length === 0) return undefined;
    return onLiveUpdate(domains, () => { invalidateShared(key, path); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path, domains.join(',')]);

  return snap;
}
