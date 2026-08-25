/**
 * @file public/views/surface/home-prefs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's own choices about their home — which chips they starred, whether the
 *   achievements strip is shown, what they have marked as tried, and which order the apps row is in
 *   — read once and written whole.
 *
 *   ONE RECORD, NOT FOUR. home.prefs is a record rather than a cell: every one of those lives in it,
 *   and a change writes the lot. That is why a write MERGES over what is known, and why it reads the
 *   stored value first when nothing is known yet — a click in the first second must not overwrite
 *   somebody's stars with an empty object.
 *
 *   TWO SYSTEMS DECIDE WHAT A PERSON SEES, AND THEY DECIDE DIFFERENT THINGS. The node's layout says
 *   which blocks EXIST on this surface; these preferences say what the person did with the ones that
 *   do. A preference naming a block the operator has since removed is simply never consulted, the
 *   same way an unknown block id is dropped.
 * @structure useHomePrefs
 * @usage const { prefs, toggleStar, markTried, setAppsMode } = useHomePrefs();
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial, lifted out of views/home/index.js so a block can reach it.
 */
import { useCallback } from 'preact/hooks';
import { api, apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { useShared, invalidateShared } from '/views/surface/shared-read.js';

const KEY = 'home-prefs';
const PATH = '/v1/memory/home.prefs?soft=1';
const pick = (d) => (d?.exists === false ? {} : (d?.value ?? {}));

export function useHomePrefs() {
  const { data, ready } = useShared(KEY, PATH, ['memory'], pick);
  const prefs = data ?? null;

  const writePrefs = useCallback(async (patch) => {
    // Merge over what is KNOWN. Before the record has loaded, the known copy is the server's.
    let base = prefs;
    if (base === null) {
      base = await apiGet(PATH)
        .then(pick)
        .catch((e) => { swallowed('surface: prefs read-before-write', e); return {}; });
    }
    const next = { ...base, ...patch };
    await api('/v1/memory', {
      method: 'POST',
      body: JSON.stringify({ key: 'home.prefs', value: next, visibility: 'private' }),
    }).catch((e) => swallowed('surface: prefs write', e));
    // Re-read rather than assume: the write may have been refused, and a page showing a star that
    // did not stick is worse than one that shows the truth a moment later.
    await invalidateShared(KEY, PATH, pick);
  }, [prefs]);

  const markTried = useCallback((what) =>
    writePrefs({ tried: { ...(prefs?.tried ?? {}), [what]: new Date().toISOString() } }),
  [prefs, writePrefs]);

  const toggleStar = useCallback((id) => {
    const stars = prefs?.stars ?? [];
    return writePrefs({ stars: stars.includes(id) ? stars.filter((x) => x !== id) : [...stars, id] });
  }, [prefs, writePrefs]);

  const setAppsMode = useCallback((mode) => writePrefs({ appsRecency: mode }), [writePrefs]);

  return { prefs, ready, writePrefs, markTried, toggleStar, setAppsMode };
}
