/**
 * @file public/views/home/news-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What is new on this node for the signed-in person, and the way to confirm it: the
 *   change log (/changelog.json) read against the person's own record of what they have seen
 *   (memory key `home.news`). The rules for what counts as new are js/services/news.js; this file
 *   only reads and writes.
 *
 *   THE CHANGE LOG IS THE ONE SOURCE. Every entry carries a short summary, the audiences it reaches,
 *   whether it is a highlight, and for a fix or a security entry what it means for the person's use.
 *   Nothing here is a second list of news.
 * @structure useNews(session) · re-exports AUDIENCES, WINDOW_DAYS, OTHERS_SHOWN, entryAddress, audienceOf
 * @usage const { highlights, others, mode, count, confirm } = useNews(session);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish-uutta-aimeatissa-mit-on-tullut-sitten-viime-katselun-kenelle).
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { useShared, invalidateShared } from '/views/surface/shared-read.js';
import { newsFor, audiencesOf, OTHERS_SHOWN } from '/js/services/news.js';

export { AUDIENCES, WINDOW_DAYS, OTHERS_SHOWN, entryAddress, audienceOf } from '/js/services/news.js';

const SEEN_KEY = 'home-news';
const SEEN_PATH = '/v1/memory/home.news?soft=1';
const APPS_KEY = 'home-news-own-apps';
const APPS_PATH = '/v1/apps?own=true&limit=1';

/** The change log, read once per page load. window.__B is the build's cache-buster. */
let logPromise = null;
function readLog() {
  if (!logPromise) {
    logPromise = fetch('/changelog.json' + (window.__B || ''))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (Array.isArray(j?.entries) ? j.entries : []))
      .catch((err) => { swallowed('news: changelog', err); logPromise = null; return []; });
  }
  return logPromise;
}

/**
 * The news for the signed-in person, and the way to confirm it. Re-reads the seen record when any
 * tab writes memory, so a confirmation in one tab clears the band and the count in the others.
 * @param {any} session
 */
export function useNews(session) {
  const signedIn = !!session;
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    readLog().then((e) => { if (live) setEntries(e); });
    return () => { live = false; };
  }, [signedIn]);

  const seenRead = useShared(SEEN_KEY, signedIn ? SEEN_PATH : '', ['memory'], (d) => (d?.exists === false ? {} : (d?.value ?? {})));
  const appsRead = useShared(APPS_KEY, signedIn ? APPS_PATH : '', [], (d) => Number(d?.total ?? d?.apps?.length ?? 0) > 0);

  const operator = Array.isArray(session?.roles) && session.roles.includes('operator');
  const ready = signedIn && entries !== null && seenRead.ready && appsRead.ready;
  const news = ready
    ? newsFor(entries, seenRead.data, audiencesOf({ operator, developer: appsRead.data === true }))
    : { mode: 'none', highlights: [], others: [], hidden: 0 };

  const newestId = entries?.[0]?.id || '';
  const confirm = useCallback(async () => {
    await api('/v1/memory', {
      method: 'POST',
      body: JSON.stringify({ key: 'home.news', value: { at: new Date().toISOString(), lastId: newestId }, visibility: 'private' }),
    });
    await invalidateShared(SEEN_KEY, SEEN_PATH);
  }, [newestId]);

  // The count on the header's Home link is the rows the band lists, so the two never disagree; the
  // rest the band names in one sentence and leaves to the history page.
  const count = news.highlights.length + Math.min(news.others.length, OTHERS_SHOWN);
  return { ready, ...news, count, confirm };
}
