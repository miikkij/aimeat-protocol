/**
 * @file public/views/home/trail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The place's activity log: every action done in it, by whom, on what and when, as a
 *   plain list day by day, newest first (Jouni, 1.11 16.22, "Rakennamme kanssasi" part 3). It reads
 *   GET /v1/build-with-you/trail, which pages with `next`; the page's look is the full record's
 *   (history.js): the same day groups and timeline rows.
 *
 *   THE NODE WRITES THE ACTION IN ENGLISH AND KEEPS THE TOOL OR ROUTE NAME IN `code`. The phrase in
 *   the page's language comes from CODE_PHRASE and the `home.trail.did.<phrase>` keys; a code without
 *   one says which tool or route was used, so no row is dropped and no row is in a language the page
 *   is not in.
 * @structure default HomeTrailView; trailLine(entry) · internal: CODE_PHRASE, EVENT_PHRASE, Day, byDay
 * @usage routed at /v1/home?trail=1 by spa.html
 * @version-history
 *   v1.1.0 — 2026-11-01 — The phrase table for the codes 4e named; reads (readOnly) hidden behind a
 *     tick; a failed action says so; older pages read with `before`, as the route pages.
 *   v1.0.0 — 2026-11-01 — Initial (the trail route is aimeat-protocol-4e's).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { getSession } from '/js/services/auth.js';
import { relayLiveUpdates, onLiveUpdate } from '/lib/live-updates.js';
import { ago, calendar, dayKey, dayWord } from '/js/format.js';
import { Spinner } from '/components/Spinner.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { ActionRow } from '/components/ActionRow.js';
import { Loud } from '/components/Action.js';
import { BackLink } from '/components/BackLink.js';
import { DayGroup, DayList, DayEmpty } from '/components/DayGroup.js';
import { ArchiveMore } from '/components/ArchiveSection.js';
import { TimelineRow } from '/components/Timeline.js';
import { Check } from '/components/Check.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const fill = (s, vars) => Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s);

const PATH = '/v1/build-with-you/trail';
/** One read; the node's own default. */
const PAGE = 100;

/** The dot's colour on the timeline by who acted: the person, an AI, agent or app, the operator. */
const KIND_CATEGORY = { person: 'made', agent: 'agent', ai: 'agent', app: 'agent', operator: 'access' };

/**
 * The codes with a phrase of their own (aimeat-protocol-4e's list of 2026-11-01). `code` is an MCP
 * tool name or "METHOD /route/template", an open set; a code not here keeps the fallback. The value
 * names a `home.trail.did.<phrase>` key, so several codes for one action share one phrase.
 */
const CODE_PHRASE = {
  aimeat_build_request_submit: 'sentRequest',
  'POST /v1/build-with-you/request': 'sentRequest',
  aimeat_build_request_status: 'checkedRequest',
  aimeat_trail_list: 'readTrail',
  aimeat_app_publish: 'publishedApp',
  aimeat_app_draft_publish: 'publishedApp',
  'POST /v1/apps': 'publishedApp',
  'POST /v1/apps/:owner/:filename/publish-draft': 'publishedApp',
  'POST /v1/agents': 'approvedAgent',
  'POST /v1/agents/v2/agent-proposals/:id/approve': 'approvedAgent',
  'POST /v1/agents/verify': 'approvedAgent',
  'POST /v1/agents/device-authorize': 'approvedAgent',
  'POST /v1/chat/threads/:id/turn': 'askedChat',
  aimeat_memory_write: 'savedNote',
  'PUT /v1/memory/:key': 'savedNote',
  aimeat_workspace_write: 'wroteDoc',
  aimeat_storage_upload: 'uploadedFile',
};
/** An entry's `event`, for a code the table does not name. */
const EVENT_PHRASE = { 'app.published': 'publishedApp', 'agent.approved': 'approvedAgent' };

/**
 * Who did it. Always a third person, never "you": the verb phrase is one form per language, and a
 * "Sinä julkaisi" would be wrong Finnish.
 */
function who(entry) {
  const name = String(entry.actorName || '').trim();
  if (name) return name;
  if (entry.actorKind === 'operator') return tr('home.trail.operator', 'The operator');
  return String(entry.actor || tr('home.trail.someone', 'Someone'));
}

/**
 * The row's sentence: who, what, and on what. The verb phrase comes from the code's phrase key; without
 * one, English pages keep the node's phrase and other pages name the tool or route that was used. A
 * failed action says so after the sentence.
 */
export function trailLine(entry) {
  const code = String(entry.code || '');
  const phraseId = CODE_PHRASE[code] || EVENT_PHRASE[entry.event];
  const keyed = phraseId ? tr(`home.trail.did.${phraseId}`, '') : '';
  const phrase = keyed
    || (getLocale() === 'en' && entry.action
      ? String(entry.action)
      : fill(tr('home.trail.used', 'used {code}'), { code: code || String(entry.action || '') }));
  const target = String(entry.target || '').trim();
  const line = target
    ? fill(tr('home.trail.lineTarget', '{who} {what}: {target}'), { who: who(entry), what: phrase, target })
    : fill(tr('home.trail.line', '{who} {what}'), { who: who(entry), what: phrase });
  return entry.outcome === 'error' ? `${line} ${tr('home.trail.failed', '(did not succeed)')}` : line;
}

function byDay(entries) {
  const groups = [];
  let current = null;
  for (const entry of entries) {
    const day = dayKey(new Date(entry.at));
    if (!current || current.day !== day) {
      current = { day, entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }
  return groups;
}

/** Today and yesterday by name (CLDR), any other day as a date. */
function dayLabel(day) {
  if (dayKey(new Date()) === day) return dayWord(0);
  if (dayKey(new Date(Date.now() - 86400000)) === day) return dayWord(-1);
  return calendar(day, { day: 'numeric', month: 'long', year: 'numeric' });
}

function Day({ group }) {
  return html`
    <${DayGroup} title=${dayLabel(group.day)}>
      ${group.entries.map((entry, i) => html`
        <${TimelineRow} key=${i} category=${KIND_CATEGORY[entry.actorKind] || 'system'}
          text=${trailLine(entry)} when=${ago(entry.at, { horizonDays: Infinity })} />`)}
    <//>`;
}

export default function HomeTrailView({ navigate }) {
  const session = useSession();
  const [entries, setEntries] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  // An MCP tool that only reads (readOnly) is hidden until asked for: an AI reads far more often than
  // it changes anything, and the reads would bury what was done.
  const [showReads, setShowReads] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet(`${PATH}?limit=${PAGE}`);
      setEntries(res?.data?.entries ?? []);
      setNext(res?.data?.next ?? null);
      setLoadError('');
    } catch (e) {
      setLoadError(e.message || String(e));
    }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  // A route of its own, so it opens the live stream itself; the node sends "build-with-you" when the
  // request changes, and the log is read again then. It sends no event per action (every write).
  useEffect(() => (session ? relayLiveUpdates(() => getSession()?.jwt) : undefined), [session]);
  useEffect(() => (session ? onLiveUpdate(['build-with-you'], load) : undefined), [session, load]);

  const loadMore = useCallback(async () => {
    if (!next) return;
    setBusy(true);
    try {
      const res = await apiGet(`${PATH}?limit=${PAGE}&before=${encodeURIComponent(next)}`);
      setEntries((prev) => [...(prev || []), ...(res?.data?.entries ?? [])]);
      setNext(res?.data?.next ?? null);
    } catch (e) {
      setLoadError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [next]);

  if (!session) {
    return html`
      <${PageFrame}>
        <${PageIntro} title=${tr('home.trail.title', 'Activity log')}
          sub=${tr('home.signInDesc', 'Sign in to see where you left off.')} />
        <${ActionRow}>
          <${Loud} onClick=${() => navigate('/v1/portal')}>${tr('home.signIn', 'Sign in')}<//>
        <//>
      <//>`;
  }

  if (loadError && !entries) {
    return html`<${PageFrame}><${ErrorNote} text=${loadError} /><//>`;
  }

  if (!entries) return html`<${PageFrame} loading=${true}><${Spinner} /><//>`;

  const shown = showReads ? entries : entries.filter((entry) => !entry.readOnly);
  const hasReads = entries.some((entry) => entry.readOnly);

  return html`
    <${PageFrame} width="narrow">
      <${BackLink} href="/v1/home" onClick=${(e) => { e.preventDefault(); navigate('/v1/home'); }}>
        ↩ ${tr('home.history.back', 'Back to your home')}
      <//>
      <${PageIntro} title=${tr('home.trail.title', 'Activity log')}
        sub=${tr('home.trail.sub', 'Everything done in your place: what, on what, who did it and when. Newest first.')} />
      ${hasReads && html`
        <${Check} checked=${showReads} onChange=${setShowReads}>
          ${tr('home.trail.showReads', 'Show reads too')}
        <//>`}
      ${shown.length === 0
        ? html`<${DayEmpty}>${tr('home.trail.empty', 'Nothing has been done here yet.')}<//>`
        : html`<${DayList}>${byDay(shown).map((group) => html`<${Day} group=${group} key=${group.day} />`)}<//>`}
      ${next && html`
        <${ArchiveMore} disabled=${busy} onClick=${loadMore}>
          ${busy ? tr('home.history.reading', 'Reading…') : tr('home.trail.more', 'Show older')}
        <//>`}
      ${loadError && html`<${ErrorNote} text=${loadError} />`}
    <//>`;
}
