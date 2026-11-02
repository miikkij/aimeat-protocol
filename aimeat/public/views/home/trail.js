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
 *   the page's language comes from CODE_PHRASE, then FAMILY_PHRASE, and the `home.trail.did.<phrase>`
 *   keys; a code without one says "made a change" or "read data", so no row is dropped, no row is in
 *   a language the page is not in, and no row shows a route or an id.
 * @structure default HomeTrailView; trailLine(entry) · isRoutine(entry) · plainTarget(raw) · internal:
 *   CODE_PHRASE, FAMILY_PHRASE, ROUTINE, EVENT_PHRASE, Day, byDay
 * @usage routed at /v1/home?trail=1 by spa.html
 * @version-history
 *   v1.4.0 — 2026-11-02 — An agent's run is one line with how it ended and how many steps failed
 *     (foldRuns); agents by the name the person gave them; a row the log cannot name waits behind the
 *     tick with the reads (aimeat-protocol-4e's first-timer round on crew60).
 *   v1.3.0 — 2026-11-02 — The Home's own record writes (home.visits, home.offers and the like, which
 *     the page makes while the person only looks) are routine; "Pidä tämä" on home.made-for-you stays
 *     in view as "kept the work made for them". Needs the record key as the target, which POST
 *     /v1/memory records since aimeat-protocol-4e's 1ca286ecd.
 *   v1.2.0 — 2026-11-01 — Families of codes an agent's run writes (notes, tasks, documents, messages)
 *     have phrases; housekeeping (a live stream ticket, a task plan's steps, reports) waits with the
 *     reads; an unknown row says "made a change", and the target is a plain name or nothing, never a
 *     route or an id (commercial's crew55 chain test).
 *   v1.1.0 — 2026-11-01 — The phrase table for the codes 4e named; reads (readOnly) hidden behind a
 *     tick; a failed action says so; older pages read with `before`, as the route pages.
 *   v1.0.0 — 2026-11-01 — Initial (the trail route is aimeat-protocol-4e's).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tn, getLocale } from '/js/i18n.js';
import { useAgentNames } from './away.js';
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
/**
 * Codes in families, for what an agent's run writes (commercial's crew55 chain test: most rows were
 * raw routes). Matched in order after CODE_PHRASE; the first pattern that fits names the phrase.
 * @type {Array<[RegExp, string]>}
 */
const FAMILY_PHRASE = [
  [/^(POST|PUT|PATCH) \/v1\/memory(\/:key)?$|^POST \/v1\/memory\/(bulk|files|import|copy|bundle)$|^PATCH \/v1\/memory\/files\/:key$/, 'savedNote'],
  [/^DELETE \/v1\/memory\/|^POST \/v1\/memory\/bulk-delete$|^aimeat_memory_delete$/, 'deletedNote'],
  [/^POST \/v1\/agents\/:name\/tasks$|^aimeat_task_create$|^aimeat_v2_task_create$/, 'gaveTask'],
  [/^POST \/v1\/agents\/:name\/tasks\/:id\/start$|^aimeat_task_start$/, 'startedTask'],
  [/^POST \/v1\/agents\/:name\/tasks\/:id\/event$|^aimeat_task_event$/, 'reportedTask'],
  [/^POST \/v1\/agents\/:name\/tasks\/:id\/complete$|^aimeat_task_complete$|^aimeat_work_deliver$/, 'finishedTask'],
  [/^POST \/v1\/agents\/:name\/tasks\/:id\/fail$|^aimeat_task_fail$/, 'failedTask'],
  [/^POST \/v1\/agents\/:name\/tasks\/:id\/decline$|^aimeat_task_decline$/, 'declinedTask'],
  [/^(PATCH|DELETE) \/v1\/agents\/:name\/tasks\/:id(\/todos\/:todoId|\/triage)?$|^POST \/v1\/agents\/:name\/tasks\/:id\/(pause|queue|rate|request-changes|propose-todos)$|^aimeat_task_(todo|propose_todos)$/, 'changedTask'],
  [/^POST \/v1\/events\//, 'openedPage'],
  [/^aimeat_workspace_|^(POST|PUT|PATCH) \/v1\/workspaces\//, 'wroteDoc'],
  [/^aimeat_dm_send|^aimeat_message_send$|^POST \/v1\/(dm|messages)\b/, 'sentMessage'],
];

/**
 * Housekeeping: rows an agent's run or a page writes for itself, not an action on the place (a live
 * stream ticket, the steps of a task's plan, a heartbeat or a report of the runtime). Hidden with the
 * reads until asked for.
 */
const ROUTINE = [
  /^POST \/v1\/events\//,
  /\/todos(\/|$)|\/propose-todos$|\/triage$|^aimeat_task_todo$|^aimeat_task_propose_todos$/,
  /heartbeat|telemetry|runtime|capabilities_report|_report$/,
];

/** A write of a record (REST or MCP): its target is the record's key (middleware/trail-recorder.ts). */
const MEMORY_WRITE = /^(POST|PUT|PATCH) \/v1\/memory(\/:key)?$|^aimeat_memory_write$/;
/** The Home's own records, written by the page while the person only looks (visit counters, offers). */
const HOME_RECORD = /^home\./;
/** The one Home record a person writes on purpose: "Pidä tämä" on work made for them. */
const KEPT_WORK = 'home.made-for-you';

/** True for a row that is housekeeping rather than an action on the place. */
export function isRoutine(entry) {
  const code = String(entry.code || '');
  const target = String(entry.target || '');
  if (MEMORY_WRITE.test(code) && HOME_RECORD.test(target) && target !== KEPT_WORK) return true;
  return ROUTINE.some((re) => re.test(code));
}

/** An entry's `event`, for a code the table does not name. */
const EVENT_PHRASE = { 'app.published': 'publishedApp', 'agent.approved': 'approvedAgent' };

/** The phrase id for a code: its own entry, then its family, then the event the node named. */
function phraseOf(entry) {
  const code = String(entry.code || '');
  if (MEMORY_WRITE.test(code) && entry.target === KEPT_WORK) return 'keptWork';
  return CODE_PHRASE[code] || FAMILY_PHRASE.find(([re]) => re.test(code))?.[1] || EVENT_PHRASE[entry.event] || '';
}

/**
 * A segment that is a machine id: hex or a uuid, a prefixed id with a digit in it ("t_48be5aae",
 * never "news-digest"), anything with a long digit run, or a shortened one ending in "…".
 */
const ID_LIKE = /^[0-9a-f-]{8,}$|^[a-z]{1,8}[_-](?=[0-9a-z]*\d)[0-9a-z]{6,}$|\d{4,}|…$/i;

/**
 * What the row acted on, in words a person reads: the first part of the target that is not a machine
 * id, with an app's ".html" left off. A record key ("journey.state") or a route is no name, so the
 * row then goes without one.
 */
export function plainTarget(raw) {
  const parts = String(raw || '').trim().split('/').filter((p) => p && !ID_LIKE.test(p));
  const name = (parts[0] || '').replace(/\.html$/i, '');
  if (!name || /[.:#@?=]/.test(name) || name.length > 48) return '';
  return name;
}

/**
 * Who did it. Always a third person, never "you": the verb phrase is one form per language, and a
 * "Sinä julkaisi" would be wrong Finnish.
 */
function who(entry, shownName = (n) => n) {
  const name = String(entry.actorName || '').trim();
  // An agent by the name the person gave it (the Agents page's), not its short name.
  if (name) return entry.actorKind === 'agent' || entry.actorKind === 'ai' ? shownName(name) : name;
  if (entry.actorKind === 'operator') return tr('home.trail.operator', 'The operator');
  return String(entry.actor || tr('home.trail.someone', 'Someone'));
}

/**
 * The row's sentence: who, what, and on what. The verb phrase comes from the code's phrase key or its
 * family's; without one, an English page keeps the node's phrase for an MCP tool (its title), and
 * every other row says "made a change" or "read data". A route or an id is never shown (commercial's
 * crew55 chain test). A failed action says so after the sentence.
 */
export function trailLine(entry, shownName) {
  const code = String(entry.code || '');
  const phraseId = phraseOf(entry);
  const keyed = phraseId ? tr(`home.trail.did.${phraseId}`, '') : '';
  const toolTitle = getLocale() === 'en' && code.startsWith('aimeat_') && entry.action ? String(entry.action) : '';
  const phrase = keyed || toolTitle || (entry.readOnly
    ? tr('home.trail.did.readData', 'read data')
    : tr('home.trail.did.madeChange', 'made a change'));
  // An agent acting on its own task names itself as the target; saying it twice reads as a fault.
  const actor = who(entry, shownName);
  const named = plainTarget(entry.target);
  const target = named && named !== actor && named !== entry.actorName ? named : '';
  const line = target
    ? fill(tr('home.trail.lineTarget', '{who} {what}: {target}'), { who: actor, what: phrase, target })
    : fill(tr('home.trail.line', '{who} {what}'), { who: actor, what: phrase });
  return entry.outcome === 'error' ? `${line} ${tr('home.trail.failed', '(did not succeed)')}` : line;
}

/** Two calls of one agent this close together are one run of its work. */
const RUN_GAP_MS = 15 * 60 * 1000;

/**
 * The rows to show, newest first. An agent's run (its calls one after another, each within RUN_GAP_MS
 * of the next) is one line with how it ended: finished, not finished, or worked, with how many steps
 * and how many of them failed (aimeat-protocol-4e's first-timer round on crew60: a morning digest run
 * was about 25 rows). Outside a run, a row the log cannot name ("made a change", a read, housekeeping)
 * is not shown; the tick shows every row as it is.
 * @param {any[]} entries
 * @param {(e: any) => boolean} quiet
 * @param {(n: string) => string} shownName
 * @returns {Array<{ at: string, actorKind: string, text: string }>}
 */
export function foldRuns(entries, quiet, shownName) {
  const out = [];
  let i = 0;
  while (i < entries.length) {
    const first = entries[i];
    let j = i + 1;
    if (first.actorKind === 'agent') {
      while (j < entries.length && entries[j].actorKind === 'agent' && entries[j].actor === first.actor
        && Math.abs(Date.parse(entries[j - 1].at) - Date.parse(entries[j].at)) <= RUN_GAP_MS) j++;
    }
    const group = entries.slice(i, j);
    i = j;
    if (group.length === 1) {
      if (!quiet(first)) out.push({ at: first.at, actorKind: first.actorKind, text: trailLine(first, shownName) });
      continue;
    }
    const phrases = group.map(phraseOf);
    const failedSteps = group.filter((e) => e.outcome === 'error').length;
    if (!group.some((e) => !quiet(e)) && !failedSteps) continue;
    const kind = phrases.includes('finishedTask') ? 'finished' : phrases.includes('failedTask') ? 'failed' : 'worked';
    const runWords = { finished: 'finished its work', failed: 'could not finish its work', worked: 'worked' };
    const steps = tn('home.trail.run.steps', group.length);
    let text = fill(tr(`home.trail.run.${kind}`, `{who} ${runWords[kind]} ({steps})`), { who: who(first, shownName), steps });
    if (failedSteps) text += ` ${tn('home.trail.run.failedSteps', failedSteps)}`;
    out.push({ at: first.at, actorKind: first.actorKind, text });
  }
  return out;
}

function byDay(items) {
  const groups = [];
  let current = null;
  for (const item of items) {
    const day = dayKey(new Date(item.at));
    if (!current || current.day !== day) {
      current = { day, items: [] };
      groups.push(current);
    }
    current.items.push(item);
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
      ${group.items.map((item, i) => html`
        <${TimelineRow} key=${i} category=${KIND_CATEGORY[item.actorKind] || 'system'}
          text=${item.text} when=${ago(item.at, { horizonDays: Infinity })} />`)}
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
  const shownName = useAgentNames(!!session);

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

  // Reads, housekeeping and rows the log cannot name wait behind one tick, and an agent's run is one
  // line: what was done to the place stays in view. The tick shows every row as it is.
  const quiet = (entry) => entry.readOnly || isRoutine(entry) || !phraseOf(entry);
  const shown = showReads
    ? entries.map((entry) => ({ at: entry.at, actorKind: entry.actorKind, text: trailLine(entry, shownName) }))
    : foldRuns(entries, quiet, shownName);
  const hasReads = entries.some(quiet) || shown.length < entries.length;

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
