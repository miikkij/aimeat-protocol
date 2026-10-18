/**
 * @file public/js/services/news.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which change-log entries are new for one person: the pure half of the home's news
 *   band, with no imports, so a unit test reads the same code the browser runs
 *   (test/unit/news-since.test.ts). The hook that reads the log and the person's record is
 *   views/home/news-data.js.
 *
 *   WHAT A PERSON HAS SEEN is their memory record `home.news` = { at, lastId }: when they last
 *   pressed "Read", and the newest entry at that moment. Unseen is every entry above lastId in the
 *   newest-first list (or, when that entry is gone, every entry dated after `at`). A person who never
 *   confirmed, or whose last confirmation is older than WINDOW_DAYS, sees only the highlights of the
 *   last WINDOW_DAYS days, so nobody returns to a hundred lines (Jouni, 2026-10-18).
 *
 *   WHO SEES WHAT. Everyone signed in reads the user and agent entries; an operator also reads the
 *   operator entries; a person with at least one app of their own also reads the developer entries.
 *   An entry without an audience counts as a user entry.
 * @structure AUDIENCES · WINDOW_DAYS · OTHERS_SHOWN · entryAddress · audiencesOf · audienceOf · newsFor
 * @usage import { newsFor, audiencesOf } from '/js/services/news.js';
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish-uutta-aimeatissa-mit-on-tullut-sitten-viime-katselun-kenelle).
 */

export const AUDIENCES = ['user', 'agent', 'operator', 'developer'];
/** How far back a person who has not confirmed lately is shown highlights. */
export const WINDOW_DAYS = 30;
/** How many entries that are not highlights the home band lists before it points at the history. */
export const OTHERS_SHOWN = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The address of an entry on /v1/changelog: its date, then its position among that day's entries.
 * The history page's anchors are made by this same function.
 * @param {any[]} entries
 * @param {number} index
 */
export function entryAddress(entries, index) {
  const date = entries[index]?.date || 'undated';
  let n = 0;
  for (let i = 0; i < index; i++) if (entries[i]?.date === date) n++;
  return n === 0 ? date : `${date}-${n + 1}`;
}

/**
 * The audiences this person reads.
 * @param {{ operator?: boolean, developer?: boolean }} [who]
 */
export function audiencesOf({ operator = false, developer = false } = {}) {
  const set = new Set(['user', 'agent']);
  if (operator) set.add('operator');
  if (developer) set.add('developer');
  return set;
}

/**
 * The audiences an entry reaches; an entry that names none is a user entry.
 * @param {any} entry
 * @returns {string[]}
 */
export function audienceOf(entry) {
  const a = Array.isArray(entry?.audience) ? entry.audience.filter((x) => AUDIENCES.includes(x)) : [];
  return a.length ? a : ['user'];
}

/**
 * What is new for one person.
 * @param {any[]} entries   the change log, newest first
 * @param {{ at?: string, lastId?: string } | null | undefined} seen   the person's home.news record
 * @param {Set<string>} audiences
 * @param {Date} [now]
 * @returns {{ mode: 'since' | 'window' | 'none', highlights: any[], others: any[], hidden: number }}
 *   each item is { entry, index, address }. In 'window' mode `others` is empty and `hidden` counts
 *   the window's entries that are not highlights.
 */
export function newsFor(entries, seen, audiences, now = new Date()) {
  const list = Array.isArray(entries) ? entries : [];
  const item = (entry, index) => ({ entry, index, address: entryAddress(list, index) });
  const reaches = (e) => audienceOf(e).some((a) => audiences.has(a));
  const seenAt = seen?.at ? new Date(seen.at) : null;
  const recent = !!seenAt && !Number.isNaN(seenAt.getTime()) && now.getTime() - seenAt.getTime() <= WINDOW_DAYS * DAY_MS;

  if (recent && seenAt) {
    const cut = seen?.lastId ? list.findIndex((e) => e?.id === seen.lastId) : -1;
    const seenDay = seenAt.toISOString().slice(0, 10);
    const fresh = list
      .map(item)
      .filter(({ entry, index }) => (cut >= 0 ? index < cut : String(entry?.date || '') > seenDay))
      .filter(({ entry }) => reaches(entry));
    const highlights = fresh.filter(({ entry }) => entry?.highlight === true);
    const others = fresh.filter(({ entry }) => entry?.highlight !== true);
    return { mode: fresh.length ? 'since' : 'none', highlights, others, hidden: 0 };
  }

  const from = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const inWindow = list.map(item).filter(({ entry }) => String(entry?.date || '') >= from && reaches(entry));
  const highlights = inWindow.filter(({ entry }) => entry?.highlight === true);
  return {
    mode: highlights.length ? 'window' : 'none',
    highlights,
    others: [],
    hidden: inWindow.length - highlights.length,
  };
}
