/**
 * @file public/views/home/history.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The whole record: the live window in full, and the archive behind it. The home card
 *   shows a glance and this page is where the glance leads. Design:
 *   docs/internal/telemetria/04-account-events.md
 *
 *   TWO LISTS, NOT ONE SCROLL. The window is what happened lately; the archive is everything the
 *   window has pushed out. They cost different amounts to read and they answer different questions,
 *   so they are separated by a heading rather than blended into one list that gets quietly slower
 *   the further down you go. The archive is fetched only when asked for: a person opening this page
 *   wants the window, and making the fast answer wait for the slow one serves nobody.
 *
 *   THE ROWS ARE THE CARD'S ROWS. FeedRow, line() and when() come from feed.js, so a sentence
 *   cannot read one way on the home and another way here.
 * @structure default HomeHistoryView; internal: DayGroup
 * @usage routed at /v1/home?history=1 by spa.html
 * @version-history
 *   2026-09-13: Shared page frame, date groups and archive controls replace home-only layout.
 *   v1.0.0 — 2026-08-17 — Initial: the full window, day by day, and a paged archive under it.
 */
import { h } from 'preact';
import { Page, Section, Stack, Text, Surface, Action } from '/components/poster-parts.js';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { Spinner } from '/components/Spinner.js';
import { swallowed } from '/js/swallowed.js';
import { FeedRow, line } from '/views/home/feed.js';
import { calendar, dayKey, dayWord } from '/js/format.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** How much of the window one read takes. The window itself is at most a few hundred rows. */
const WINDOW_LIMIT = 500;

/** How much archive one press brings back. Small enough to stay fast, big enough to be worth it. */
const ARCHIVE_PAGE = 50;

/**
 * Group rows by the day they happened, newest day first.
 *
 * A hundred rows each labelled "3 d ago" is a list you cannot navigate: the relative time is right
 * for six rows on a card and useless as the only structure on a long page. The day heading gives
 * back the thing a person actually scans for, which is when.
 */
function byDay(items) {
  const groups = [];
  let current = null;
  for (const item of items) {
    const day = String(item.at || '').slice(0, 10);
    if (!current || current.day !== day) {
      current = { day, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

/**
 * A day heading a person reads, not an ISO date. Today and yesterday are named.
 *
 * The two names come from CLDR rather than from a key pair with an English fallback: it already
 * holds "tänään" and "eilen" for every language, and a key that falls back to English is a key that
 * shows English on a page nobody has translated yet. The day itself is matched in the READER'S zone,
 * so the heading agrees with the rows under it.
 */
function dayLabel(day) {
  if (dayKey(new Date()) === day) return dayWord(0);
  if (dayKey(new Date(Date.now() - 86400000)) === day) return dayWord(-1);
  // A calendar square rather than a moment: pinned, so no zone can label it the day before.
  return calendar(day, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** One day of rows, under its heading. */
function DayGroup({ group }) {
  return html`<${Stack}>
    <${Text} kind="label">${dayLabel(group.day)}<//>
    <div>${group.items.map((item,i)=>html`<${FeedRow} item=${item} key=${i} />`)}</div>
  <//>`;
}

export default function HomeHistoryView({ navigate }) {
  const session = useSession();
  const [items, setItems] = useState(null);
  const [windowSize, setWindowSize] = useState(0);
  const [archive, setArchive] = useState([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiGet(`/v1/account/events?limit=${WINDOW_LIMIT}`);
      setItems(res?.data?.events ?? []);
      setWindowSize(res?.data?.window ?? 0);
      setLoadError('');
    } catch (e) {
      setLoadError(e.message || String(e));
    }
    // How much archive there is decides whether the door to it appears at all. One row is enough
    // to learn the total, and asking for fifty here would page an archive nobody has opened.
    try {
      const head = await apiGet('/v1/account/events/archive?limit=1');
      setArchiveTotal(head?.data?.total ?? 0);
    } catch (e) {
      // The window is the answer to this page; the archive is an offer. A failure here hides the
      // offer rather than the page, and is recorded so an archive that never appears is visible
      // as a failure rather than as an account with no history.
      swallowed('home history: archive size', e);
      setArchiveTotal(0);
    }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  // The same live-update contract every server-data surface keeps: something happening in another
  // tab moves this page too, and a record of what happened that needs a reload is a stale record.
  useEffect(() => {
    const handler = () => { if (session) load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session, load]);

  const loadArchive = useCallback(async () => {
    setBusy(true);
    try {
      const res = await apiGet(`/v1/account/events/archive?limit=${ARCHIVE_PAGE}&offset=${archive.length}`);
      setArchive(prev => [...prev, ...(res?.data?.events ?? [])]);
      setArchiveTotal(res?.data?.total ?? archiveTotal);
      setArchiveOpen(true);
    } catch (e) {
      setLoadError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [archive.length, archiveTotal]);

  if (!session) return html`<${Page} width="reading" title=${tr('home.history.signInTitle','Your record is yours to read')}>
    <${Stack} align="start"><${Text} tone="muted">${tr('home.signInDesc','Sign in to see where you left off.')}<//>
      <${Action} kind="primary" onClick=${()=>navigate('/v1/portal')}>${tr('home.signIn','Sign in')}<//>
    <//><//>`;
  if (loadError && !items) return html`<${Page} width="reading"><${Surface} kind="aside" tone="danger" role="alert">${loadError}<//><//>`;
  if (!items) return html`<${Page} width="reading"><${Stack} align="center"><${Spinner} /><//><//>`;
  const shown=items.filter(it=>line(it));
  const archiveShown=archive.filter(it=>line(it));
  const remaining=archiveTotal-archive.length;
  return html`<${Page} width="reading" title=${tr('home.feed.title','What has happened')}
    crumb=${html`<${Action} kind="text" href="/v1/home" onClick=${e=>{e.preventDefault();navigate('/v1/home');}}>
      ↩ ${tr('home.history.back','Back to your home')}<//>`}>
    <${Stack} density="roomy">
      <${Text} kind="lead" tone="muted">${windowSize>0
        ? tr('home.history.sub','The last {n} things on your account, newest first.').replace('{n}',String(windowSize))
        : tr('home.history.subPlain','Everything on your account, newest first.')}<//>
      ${shown.length===0 ? html`<${Text}>${tr('home.history.empty','Nothing has been recorded here yet. It fills up as you use the place.')}<//>`
        : byDay(shown).map(group=>html`<${DayGroup} group=${group} key=${group.day} />`)}
      ${archiveTotal>0 && html`<${Section} title=${tr('home.history.archiveTitle','Older than that')}><${Stack}>
        <${Text} tone="muted">${tr('home.history.archiveNote','{n} things have moved out of the window. They are still here, just slower to read.').replace('{n}',String(archiveTotal))}<//>
        ${archiveOpen && archiveShown.length>0 && byDay(archiveShown).map(group=>html`<${DayGroup} group=${group} key=${group.day} />`)}
        ${remaining>0 && html`<${Action} disabled=${busy} onClick=${loadArchive}>${busy
          ? tr('home.history.reading','Reading…') : archiveOpen
            ? tr('home.history.showMore','Show {n} more').replace('{n}',String(Math.min(remaining,ARCHIVE_PAGE)))
            : tr('home.history.openArchive','Open the archive')}<//>`}
      <//><//>`}
      ${loadError && html`<${Surface} kind="aside" tone="danger" role="alert">${loadError}<//>`}
    <//><//>`;
}
