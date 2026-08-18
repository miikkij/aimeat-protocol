/**
 * @file presence-store.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared client-side presence store powering the `usePresence(ghii)`
 *   hook. Every <PresenceDot> in a list subscribes here; the store COALESCES all
 *   ghiis requested within one tick into a single batched GET /v1/presence call —
 *   so a 50-row member list makes one request, not fifty. Results are cached with
 *   a short TTL and re-fetched on the global `aimeat-live-update` SSE event, so all
 *   dots flip live without per-component polling.
 * @structure
 *   - usePresence(ghii) — preact hook → { status, since } | undefined
 *   - refreshAll() — invalidate + re-batch all currently-subscribed ghiis
 *   - internal: cache, subscriber registry, pending-batch flusher
 * @usage import { usePresence } from '/js/presence-store.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial shared presence store (cache + batch + live refresh).
 */
import { useState, useEffect } from 'preact/hooks';
import { getPresenceBatch } from '/js/services/presence.js';
import { swallowed } from '/js/swallowed.js';

const cache = new Map();        // ghii → { status, since }
const subs = new Map();         // ghii → Set<fn>
const lastFetched = new Map();  // ghii → ms
let pending = new Set();
let timer = null;
let liveBound = false;

const TTL_MS = 60_000;
const BATCH_DELAY_MS = 40;

function notify(ghii) {
  const set = subs.get(ghii);
  if (set) for (const fn of set) fn(cache.get(ghii));
}

async function flush() {
  timer = null;
  const ids = [...pending];
  pending = new Set();
  if (!ids.length) return;
  try {
    const map = await getPresenceBatch(ids);
    const now = Date.now();
    for (const ghii of ids) {
      cache.set(ghii, map[ghii] || { status: 'unknown', since: null });
      lastFetched.set(ghii, now);
      notify(ghii);
    }
  } catch (err) {
    /* leave the cache as-is; a later live-update or remount retries */
    swallowed('presence-store: flush', err);
  }
}

function schedule() {
  if (!timer) timer = setTimeout(flush, BATCH_DELAY_MS);
}

function request(ghii, force) {
  if (!force && lastFetched.has(ghii) && Date.now() - lastFetched.get(ghii) < TTL_MS) return;
  pending.add(ghii);
  schedule();
}

/** Invalidate and re-fetch every currently-subscribed identity (called on SSE updates). */
export function refreshAll() {
  lastFetched.clear();
  for (const ghii of subs.keys()) pending.add(ghii);
  if (pending.size) schedule();
}

function bindLive() {
  if (liveBound) return;
  liveBound = true;
  // Refresh presence only when the 'presence' domain actually changed (or on a legacy
  // "everything changed" payload), not on every unrelated live update.
  window.addEventListener('aimeat-live-update', (e) => {
    const d = /** @type {CustomEvent} */ (e).detail?.domains;
    if (d && !d.has('presence')) return;
    refreshAll();
  });
}

/**
 * Subscribe to a single identity's presence. Returns { status, since } (or
 * undefined until the first fetch resolves). Pass a falsy ghii to opt out.
 */
export function usePresence(ghii) {
  const [val, setVal] = useState(() => (ghii ? cache.get(ghii) : undefined));
  useEffect(() => {
    if (!ghii) { setVal(undefined); return; }
    bindLive();
    let set = subs.get(ghii);
    if (!set) { set = new Set(); subs.set(ghii, set); }
    const fn = (v) => setVal(v);
    set.add(fn);
    setVal(cache.get(ghii));
    request(ghii);
    return () => {
      set.delete(fn);
      if (!set.size) subs.delete(ghii);
    };
  }, [ghii]);
  return val;
}
