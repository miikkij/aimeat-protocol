/**
 * @file public/js/organism-names.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The names of the organisms the signed-in person belongs to, read once for the whole
 *   page and shared by every caller (plan doc-mvcn6c7e4e5q, V6.4). An AudienceBadge on a list of a
 *   hundred records names "Innokas Medical members" with one GET /v1/organisms?member=<owner>, not
 *   one per row. The list is read again only when the live stream says the organisms changed (the
 *   `aimeat-live-update` event with the 'organisms' domain, or one that names no domain); there is
 *   no timer.
 * @structure useOrganismName(id) · organismNames() · forgetOrganismNames()
 * @usage
 *   import { useOrganismName } from '/js/organism-names.js';
 *   const name = useOrganismName(audience.organismId);   // undefined until read, null when unknown
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V6.4).
 */
import { useState, useEffect } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

/** @type {Map<string, string>|null} organism id → name, null until read */
let names = null;
/** @type {Promise<Map<string, string>>|null} */
let inFlight = null;
const subscribers = new Set();
let liveBound = false;

async function read() {
  const owner = getSession()?.owner;
  const map = new Map();
  if (!owner) return map;
  const res = await apiGet(`/v1/organisms?member=${encodeURIComponent(owner)}`);
  for (const o of res?.data?.organisms || []) if (o?.id) map.set(o.id, o.name || o.id);
  return map;
}

/** The names, read once per page and shared. Resolves to an empty map when the read fails. */
export function organismNames() {
  if (names) return Promise.resolve(names);
  if (!inFlight) {
    inFlight = read()
      .then((m) => { names = m; return m; })
      .catch((err) => { swallowed('organism-names: read', err); names = new Map(); return names; })
      .finally(() => { inFlight = null; for (const fn of subscribers) fn(names); });
  }
  return inFlight;
}

/** Drop the names; the next caller reads them again. */
export function forgetOrganismNames() {
  names = null;
}

function bindLive() {
  if (liveBound) return;
  liveBound = true;
  window.addEventListener('aimeat-live-update', (e) => {
    const d = /** @type {CustomEvent} */ (e).detail?.domains;
    if (d && !d.has('organisms')) return;
    forgetOrganismNames();
    if (subscribers.size) organismNames();
  });
}

/**
 * The name of one organism the person belongs to: undefined while it is being read, null when the
 * person is not a member of it (or the read failed), the name otherwise. A falsy id reads nothing.
 * @param {string|undefined|null} id
 */
export function useOrganismName(id) {
  const [map, setMap] = useState(names);
  useEffect(() => {
    if (!id) return undefined;
    bindLive();
    const fn = (m) => setMap(m);
    subscribers.add(fn);
    organismNames().then(fn);
    return () => { subscribers.delete(fn); };
  }, [id]);
  if (!id) return null;
  if (!map) return undefined;
  return map.get(id) ?? null;
}
