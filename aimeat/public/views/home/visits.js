/**
 * @file public/views/home/visits.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which visit to the home this is: the count the home's offers are timed by ("three
 *   visits", Jouni 2.11 00.52: the morning digest on the first, finished work made for the person on
 *   the third). A visit is an opening of the home at least VISIT_GAP_MS after the last one counted,
 *   so moving between pages, or a reload, is the same visit. Kept in the person's own memory record
 *   `home.visits` { count, last }, private; the "while you were away" card keeps its own `home.visit`.
 * @structure useHomeVisit(signedIn) · VISIT_GAP_MS · OFFERS_KEY · OFFERS_PATH · patchOffers(patch)
 * @usage const visit = useHomeVisit(!!session);   // null until read, then 1, 2, 3, …
 * @version-history
 *   v1.1.0 — 2026-11-02 — patchOffers(): the one writer of `home.offers`, the home's record of its offers
 *     and the person's answers, shared by morning-digest.js and made-for-you.js.
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { useState, useEffect } from 'preact/hooks';
import { api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { invalidateShared } from '/views/surface/shared-read.js';

/** The home's offers and the person's answers to them: one private record, read through useShared('home-offers'). */
export const OFFERS_KEY = 'home.offers';
export const OFFERS_PATH = `/v1/memory/${OFFERS_KEY}?soft=1`;

/** Merge `patch` into `home.offers`, keeping what else it holds, and tell the readers. Bookkeeping: the trail files it as routine. */
export async function patchOffers(patch) {
  const read = await api(OFFERS_PATH);
  const cur = read?.data?.value && typeof read.data.value === 'object' ? read.data.value : {};
  await api('/v1/memory', {
    method: 'POST',
    body: JSON.stringify({ key: OFFERS_KEY, value: { ...cur, ...patch }, visibility: 'private' }),
  });
  await invalidateShared('home-offers', OFFERS_PATH);
}

const KEY = 'home.visits';
/** Four hours: a morning and an afternoon are two visits, a reload is not. */
export const VISIT_GAP_MS = 4 * 60 * 60 * 1000;

/** Count this opening when it is a new visit, and answer which visit it is. */
async function countVisit() {
  const read = await api(`/v1/memory/${KEY}?soft=1`);
  const cur = read?.data?.value && typeof read.data.value === 'object' ? read.data.value : {};
  const count = Number.isFinite(Number(cur.count)) ? Number(cur.count) : 0;
  const last = Date.parse(cur.last) || 0;
  if (count > 0 && Date.now() - last < VISIT_GAP_MS) return count;
  const next = count + 1;
  await api('/v1/memory', {
    method: 'POST',
    body: JSON.stringify({ key: KEY, value: { count: next, last: new Date().toISOString() }, visibility: 'private' }),
  });
  return next;
}

/** Which visit this is: null until it is read. A failed read or write leaves it null, and no offer shows. */
export function useHomeVisit(signedIn) {
  const [visit, setVisit] = useState(null);
  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    countVisit()
      .then((n) => { if (live) setVisit(n); })
      .catch((err) => swallowed('home visits: count', err));
    return () => { live = false; };
  }, [signedIn]);
  return visit;
}
