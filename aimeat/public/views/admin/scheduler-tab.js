/**
 * @file public/views/admin/scheduler-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Scheduler page in the poster face (design canvas "AIMEAT Admin
 *   Scheduler"). Four sections: what broke on its last run and what it said, what fires next, the
 *   whole register with a search and the route's own filters, and the run log. The page draws
 *   library components and passes them data; it writes no class.
 *
 * @structure
 *   - default SchedulerTab({ data, reload }): the model, the four sections
 *   - nameOf / subOf / whoOf / lastWords: how one job says what it is
 *   - Broke: the failing jobs with their error sentence and two doors
 *   - Agenda: the next fires, in the order they fire
 *   - Register: search, six filter tabs, one row per job, the state tag as the switch
 *   - RunLog: the last fifty fires with what set each off and what it did
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.0.0 — 2026-09-27 — The page draws library components (FigureStrip, Section, Figure, List,
 *     SearchLine, Tabs, Mark, Action, Note) and writes no class; admin-scheduler.css goes. The
 *     failed count keeps its coral, a switched-off job its dimmed row, a failed run and a failed
 *     result their coral words; the state tag is still the switch (on the sun while it runs).
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v2.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v2.0.0 — 2026-09-12 — The poster face, and the four fields the page had been reading under the
 *     wrong names. Last run, Result and Next run were an em-dash on every row because the page read
 *     lastRun / lastResult / nextRun while the record carries lastRunAt / lastRunResult / nextRunAt;
 *     the Failed counter matched the same missing field, so it read 0 whatever was failing; and the
 *     run log's memory column read memoryRead / memoryWritten against a record that carries
 *     memoryReads / memoryWrites, which are the lists of keys rather than counts. lastRunError,
 *     ownerScope, displayName, purpose, timezone and runCount were on the record and on no screen.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Empty, useToast, Toast } from './shared.js';
import { triggerSchedulerJob, updateSchedulerJob, deleteSchedulerJob, pruneSchedulerLog } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { cronWords } from '/views/profile/scheduler/cron-words.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure, Tinted } from '/components/Figure.js';
import { List, Row as ListRow, Name, Desc, Who, When, Cell, Num, Doors, SearchLine } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Action } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Beside, Split, Row, Stack } from '/components/Layout.js';
import { Note } from '/components/Note.js';

const S = (key, params) => t('admin.sched.' + key, params);

/** The label its owner gave it; where there is none, the id it was registered under. */
function nameOf(job) {
  return job.displayName || job.name || job.id;
}

/**
 * The second line: what kind of job it is, and the one thing that tells this one from its kind.
 * A core job is told apart by its handler, an extension's by the extension, an agent's by the
 * agent; a schedule id is a uuid, and its first block is enough to recognise a row by.
 */
function subOf(job) {
  const which = job.extensionName || job.agentName || job.coreHandler
    || String(job.id).split(':').pop().split('-')[0];
  return `${job.type} · ${which}`;
}

/** Whose job this is. An owner-scoped job belongs to a person; everything else to the installation. */
function ownerOf(job) {
  return job.ownerScope ? String(job.ownerScope).split('@')[0] : '';
}

/** The one word the Whose column says: a person, an extension, or the installation itself. */
function whoseWords(job) {
  if (job.ownerScope) return ownerOf(job);
  if (job.extensionName) return job.extensionName;
  return S('thisInstallation');
}

/**
 * How far a stamp is from now, in one unit, without inventing a precision it does not have.
 * Distance only: the caller says whether that is behind or ahead.
 */
function distance(iso) {
  const ms = Math.abs(Date.now() - new Date(iso).getTime());
  if (!Number.isFinite(ms)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return null;
  if (min < 60) return S('agoMin', { n: min });
  // Hours up to two days: "36 h" beats "2 days" for anything an operator is about to act on.
  const hrs = Math.round(min / 60);
  if (hrs < 48) return S('agoHour', { n: hrs });
  return S('agoDay', { n: Math.round(hrs / 24) });
}

/** A stamp behind us: "12 min ago", or "just now" when it is inside the minute. */
function since(iso) {
  if (!iso) return '';
  const d = distance(iso);
  return d ? S('agoTime', { t: d }) : S('agoNow');
}

/** A stamp ahead of us: "in 4 h", or "any moment" when it is inside the minute. */
function until(iso) {
  if (!iso) return '';
  const d = distance(iso);
  return d ? S('inTime', { t: d }) : S('inSoon');
}

/**
 * The clock a person reads at a glance: the time alone for today, the date and time otherwise.
 * The machine reading `when()` gives is right for a log and too long for a column of times.
 */
function clock(iso) {
  if (!iso) return '';
  const sameDay = new Date(iso).toDateString() === new Date().toDateString();
  return sameDay ? when(iso).slice(11) : when(iso).slice(5);
}

/** When it next fires, or the reason it never will. */
function nextWords(job) {
  if (!job.enabled) return { text: S('nextOff'), none: true };
  if (job.cron === '@activate') return { text: S('nextOnRestart'), none: true };
  if (!job.nextRunAt) return { text: S('nextNotSet'), none: true };
  return { text: clock(job.nextRunAt), none: false };
}

/** A duration a person reads: milliseconds under a second, seconds above it. */
function took(ms) {
  if (ms == null) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The line under a list: what it shows, and what it leaves out. */
function Foot({ left, right }) {
  return html`<${Row} justify="between" wrap above="medium">
    <${Note} kind="meta" inline>${left}<//><${Note} kind="meta" inline>${right}<//>
  <//>`;
}

export default function SchedulerTab({ data, reload }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [find, setFind] = useState('');
  const [filter, setFilter] = useState('all');
  const [logFilter, setLogFilter] = useState('all');

  const jobs = useMemo(() => data.schedulerJobs?.jobs || [], [data.schedulerJobs]);
  const log = data.schedulerLog?.entries || data.schedulerLog?.data?.entries || [];
  const logTotal = data.schedulerLog?.total ?? data.schedulerLog?.data?.total ?? log.length;

  const m = useMemo(() => {
    const failing = jobs.filter(j => j.lastRunResult === 'error');
    const agenda = jobs
      .filter(j => j.enabled && j.nextRunAt)
      .sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : 1));
    return {
      total: jobs.length,
      on: jobs.filter(j => j.enabled).length,
      off: jobs.filter(j => !j.enabled).length,
      failing,
      neverRun: jobs.filter(j => !j.lastRunAt).length,
      agenda,
      onActivate: jobs.filter(j => j.cron === '@activate').length,
      mine: jobs.filter(j => !j.ownerScope).length,
      owned: jobs.filter(j => j.ownerScope).length,
      extensions: jobs.filter(j => j.type === 'extension').length,
    };
  }, [jobs]);

  async function act(fn) {
    try { await fn(); reload(); } catch (e) { showErr(e.message); }
  }

  const runNow = (id) => act(() => triggerSchedulerJob(id));
  const toggle = (job) => act(() => updateSchedulerJob(job.id, { enabled: !job.enabled }));
  const remove = (job) => confirm(S('deleteAsk', { name: nameOf(job) }),
    () => act(() => deleteSchedulerJob(job.id)), { danger: true });
  const prune = () => confirm(S('pruneAsk'), () => act(() => pruneSchedulerLog(30)), { danger: true });

  if (!jobs.length) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Empty} text=${S('noJobs')} />
      <${ConfirmUI} />`;
  }

  const shown = jobs.filter(j => {
    if (filter === 'failing' && j.lastRunResult !== 'error') return false;
    if (filter === 'mine' && j.ownerScope) return false;
    if (filter === 'owned' && !j.ownerScope) return false;
    if (filter === 'extensions' && j.type !== 'extension') return false;
    if (filter === 'off' && j.enabled) return false;
    const q = find.trim().toLowerCase();
    if (!q) return true;
    return [nameOf(j), j.id, j.type, j.ownerScope, j.extensionName, j.agentName, j.purpose]
      .some(v => String(v || '').toLowerCase().includes(q));
  });

  const shownLog = log.filter(e => {
    if (logFilter === 'errors') return e.result === 'error';
    if (logFilter === 'skipped') return e.result === 'skipped';
    if (logFilter === 'manual') return e.trigger === 'manual';
    if (logFilter === 'activate') return e.trigger === 'activate';
    return true;
  });

  // The filters that point at something wrong wear the coral while they are not chosen.
  const chips = [
    { value: 'all', label: S('chipAll', { n: num(m.total) }) },
    { value: 'failing', label: S('chipFailing', { n: num(m.failing.length) }), attention: true },
    { value: 'mine', label: S('chipMine', { n: num(m.mine) }) },
    { value: 'owned', label: S('chipOwned', { n: num(m.owned) }) },
    { value: 'extensions', label: S('chipExtensions', { n: num(m.extensions) }) },
    { value: 'off', label: S('chipOff', { n: num(m.off) }) },
  ];
  const logChips = [
    { value: 'all', label: S('chipAllRuns') },
    { value: 'errors', label: S('chipErrors', { n: num(log.filter(e => e.result === 'error').length) }), attention: true },
    { value: 'skipped', label: S('chipSkipped', { n: num(log.filter(e => e.result === 'skipped').length) }) },
    { value: 'manual', label: S('chipByHand', { n: num(log.filter(e => e.trigger === 'manual').length) }) },
    { value: 'activate', label: S('chipOnRestart', { n: num(log.filter(e => e.trigger === 'activate').length) }) },
  ];

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

    <${FigureStrip} lead wrap items=${[
      { key: 'jobs', n: num(m.total), label: S('cntJobs'), sub: S('cntJobsSub') },
      { key: 'on', n: num(m.on), label: S('cntOn'), sub: S('cntOnSub', { n: num(m.off) }) },
      // The one number an operator acts on is the one in coral.
      { key: 'failed', n: num(m.failing.length), tone: 'notice', label: S('cntFailed'), sub: S('cntFailedSub') },
      { key: 'never', n: num(m.neverRun), label: S('cntNever'), sub: S('cntNeverSub') },
    ]} />

    <${Section} num="01" title=${S('brokeTitle')} first>
      ${m.failing.length === 0
    ? html`<${Note} kind="quiet">${S('brokeNone')}<//>`
    : html`
        <${Beside} wide side=${html`<${Note} kind="lead">${S('brokeLead')}<//>`}>
          <${Label} block>${S('brokeLabel')}<//>
          <${Figure} n=${S('brokeHero', { n: num(m.failing.length), total: num(m.total) })} />
          <${Note}>${S('brokeHeroSub')}<//>
        <//>
        <${Split} heavy above="section">
          <${List} cols="name-desc-doors">
            ${m.failing.map(job => html`
              <${ListRow} key=${job.id}>
                <${Name} meta=${subOf(job)}>${nameOf(job)}<//>
                <${Cell} code sub=${`${S('failedAt', { when: clock(job.lastRunAt), ago: since(job.lastRunAt), took: took(job.lastRunDurationMs) })}${
      job.enabled && job.nextRunAt ? ' ' + S('triesAgain', { when: clock(job.nextRunAt), in: until(job.nextRunAt) }) : ''}`}>
                  ${job.lastRunError || S('noMessage')}
                <//>
                <${Doors}>
                  <${Action} small row onClick=${() => runNow(job.id)}>${S('runNow')}<//>
                  <${Action} small row onClick=${() => toggle(job)}>${job.enabled ? S('switchOff') : S('switchOn')}<//>
                <//>
              <//>`)}
          <//>
        <//>`}
    <//>

    <${Section} num="02" title=${S('nextTitle')}>
      ${m.agenda.length === 0
    ? html`<${Note} kind="quiet">${S('nextNone')}<//>`
    : html`
        <${List} cols="when-name-kind-who" labels head=${[S('colWhen'), S('colJob'), S('colKind'), S('colWhose')]}>
          ${m.agenda.slice(0, 6).map(job => html`
            <${ListRow} key=${job.id}>
              <${When} at=${until(job.nextRunAt)}>${clock(job.nextRunAt)}<//>
              <${Name} meta=${cronWords(job.cron)}>${nameOf(job)}<//>
              <${Cell} meta>${job.type}<//>
              ${job.ownerScope ? html`<${Who}>${ownerOf(job)}<//>` : html`<${Desc}>${whoseWords(job)}<//>`}
            <//>`)}
        <//>
        <${Foot} left=${S('agendaShown', { n: num(Math.min(6, m.agenda.length)), total: num(m.agenda.length) })}
          right=${S('agendaRest', { activate: num(m.onActivate), off: num(m.off) })} />`}
    <//>

    <${Section} num="03" title=${S('registerTitle')}>
      <${Note} kind="lead">${S('registerLead')}<//>
      <${Stack} gap="small">
        <${SearchLine} find text value=${find} onInput=${e => setFind(e.target.value)} placeholder=${S('findPlaceholder')} />
        <${Tabs} tone="filter" value=${filter} onSelect=${setFilter} label=${S('registerTitle')} items=${chips} />
      <//>
      <${List} cols="name-when-who-state-when-doors" labels apart
        head=${[S('colJob'), S('colRuns'), S('colWhose'), S('colLastRun'), S('colNext'), '']}>
        ${shown.map(job => {
    const next = nextWords(job);
    const failed = job.lastRunResult === 'error';
    return html`
          <${ListRow} key=${job.id} faded=${!job.enabled} hover>
            <${Name} meta=${subOf(job)}>${nameOf(job)}<//>
            <${Desc} sub=${`${job.cron}${job.timezone ? ' · ' + job.timezone : ''}`}>${cronWords(job.cron)}<//>
            ${job.ownerScope ? html`<${Who} sub=${S('ownerOwn')}>${ownerOf(job)}<//>` : html`<${Desc}>${whoseWords(job)}<//>`}
            <${Desc} sub=${job.lastRunAt ? `${since(job.lastRunAt)} · ${took(job.lastRunDurationMs)}` : undefined}>
              ${job.lastRunAt
      ? (failed ? html`<${Tinted} strong tone="notice">${S('ranFailed')}<//>` : S('ranSucceeded'))
      : S('ranNever')}
            <//>
            ${next.none ? html`<${Cell} meta>${next.text}<//>` : html`<${When}>${next.text}<//>`}
            <${Doors}>
              <${Mark} tone=${job.enabled ? 'sun' : 'dim'} onClick=${() => toggle(job)}>${job.enabled ? S('stateOn') : S('stateOff')}<//>
              <${Action} small row onClick=${() => runNow(job.id)}>${S('runNow')}<//>
              ${job.type !== 'core' && html`<${Action} small row tone="danger" onClick=${() => remove(job)}>${S('delete')}<//>`}
            <//>
          <//>`;
  })}
      <//>
      <${Foot} left=${S('registerShown', { n: num(shown.length), total: num(m.total) })} right=${S('registerCoreNote')} />
    <//>

    <${Section} num="04" title=${S('logTitle')}
      doors=${html`<${Action} small onClick=${prune}>${S('prune')}<//>`}>
      <${Note} kind="lead">${S('logLead')}<//>
      ${log.length === 0
    ? html`<${Note} kind="quiet">${S('logNone')}<//>`
    : html`
        <${Tabs} tone="filter" value=${logFilter} onSelect=${setLogFilter} label=${S('logTitle')} items=${logChips} />
        <${List} cols="when-name-kind-state-n-desc" labels apart
          head=${[S('colWhen'), S('colJob'), S('colTrigger'), S('colResult'), { label: S('colTook'), num: true }, S('colDid')]}>
          ${shownLog.map(e => {
      const did = didWhat(e);
      return html`
            <${ListRow} key=${e.id}>
              <${When} at=${since(e.createdAt)}>${clock(e.createdAt)}<//>
              <${Name} meta=${`${e.type}${e.extensionName ? ' · ' + e.extensionName : ''}`}>${e.jobName || e.jobId}<//>
              <${Cell} meta>${S('trigger.' + e.trigger)}<//>
              <${Desc}>${e.result === 'error'
        ? html`<${Tinted} strong tone="notice">${S('result.' + e.result)}<//>`
        : e.result === 'skipped' ? S('result.' + e.result) : html`<${Tinted} strong>${S('result.' + e.result)}<//>`}<//>
              <${Num}>${took(e.durationMs)}<//>
              <${Desc} sub=${did.keys}>${did.head ? html`<${Tinted} strong>${did.head}<//>` : did.text}<//>
            <//>`;
    })}
        <//>
        <${Foot} left=${S('logShown', { n: num(shownLog.length), loaded: num(log.length) })}
          right=${S('logKeptNote', { total: num(logTotal) })} />`}
    <//>

    <${ConfirmUI} />`;
}

/**
 * What one run did, in the cell after how long it took.
 *
 * A skipped run never touched anything and carries the reason it was stopped, which is the only
 * thing worth reading on that row. A run that did happen names the keys it read and wrote — the
 * record keeps the KEYS, not counts, and they were never on a screen before.
 * @returns {{ text?: string, head?: string, keys?: string }}
 */
function didWhat(entry) {
  if (entry.result === 'skipped') return { text: entry.errorMessage || S('skippedNoReason') };
  const reads = entry.memoryReads || [];
  const writes = entry.memoryWrites || [];
  if (reads.length === 0 && writes.length === 0) return { text: S('touchedNothing') };
  const keys = [...reads, ...writes].slice(0, 3).join(', ');
  return { head: S('touched', { r: reads.length, w: writes.length }), keys: `${keys}${reads.length + writes.length > 3 ? ' …' : ''}` };
}
