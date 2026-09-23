/**
 * @file public/views/admin/scheduler-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Scheduler page in the poster face (design canvas "AIMEAT Admin
 *   Scheduler"). Four sections: what broke on its last run and what it said, what fires next, the
 *   whole register with a search and the route's own filters, and the run log.
 *
 * @structure
 *   - default SchedulerTab({ data, reload }): the model, the four sections
 *   - nameOf / subOf / whoOf / lastWords: how one job says what it is
 *   - Broke: the failing jobs with their error sentence and two doors
 *   - Agenda: the next fires, in the order they fire
 *   - Register: search, six chips, one row per job, the state chip as the switch
 *   - RunLog: the last fifty fires with what set each off and what it did
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.0.0 — 2026-09-22 — Composed from the shared component set (components/poster-parts.js):
 *     the numeral band, shared sections, list rows for the failing jobs, the shared toolbar for the
 *     search and the filters, and shared tables for the agenda, the register and the run log. The
 *     state word is an on/off switch action, a switched-off job's row is muted, and the Failing and
 *     Errors filters are coral as they were. The page's own sheet (admin-scheduler.css) is gone.
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
import { Section, Columns, Stack, ListRow, Toolbar, Table, NumeralBand, Action, Text } from '/components/poster-parts.js';
import { cronWords } from '/views/profile/scheduler/cron-words.js';

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

  const filters = (current, set, list) => list.map(([id, label, tone]) => ({ id, label, tone, selected: current === id, onClick: () => set(id) }));
  /** A stamp and its distance, one above the other. */
  const stamp = (clockText, rel) => html`<${Stack} density="compact"><${Text} kind="mono">${clockText}<//><${Text} kind="caption" tone="muted">${rel}<//><//>`;
  /** A name and the quieter line under it. */
  const named = (name, sub, subMono = true) => html`<${Stack} density="compact"><strong>${name}</strong><${Text} kind=${subMono ? 'mono' : 'caption'} tone="muted">${sub}<//><//>`;
  /** A section's closing line: what is shown, and the note beside it. */
  const foot = (left, right) => html`<${Stack} direction="wrap" align="between"><${Text} kind="caption" tone="muted">${left}<//><${Text} kind="caption" tone="muted">${right}<//><//>`;

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Stack}>

      <${NumeralBand} tone="plain" items=${[
        { label: S('cntJobs'), value: num(m.total), note: S('cntJobsSub') },
        { label: S('cntOn'), value: num(m.on), note: S('cntOnSub', { n: num(m.off) }) },
        { label: S('cntFailed'), value: num(m.failing.length), note: S('cntFailedSub'), tone: 'coral' },
        { label: S('cntNever'), value: num(m.neverRun), note: S('cntNeverSub') },
      ]} />

      <${Section} title=${S('brokeTitle')} count="01">
        ${m.failing.length === 0
    ? html`<${Text} kind="caption" tone="muted">${S('brokeNone')}<//>`
    : html`
          <${Stack}>
            <${Columns} layout="equal" collapse=${640}>
              <${Stack} density="compact">
                <${Text} kind="label">${S('brokeLabel')}<//>
                <${Text} kind="number" tone="coral">${S('brokeHero', { n: num(m.failing.length), total: num(m.total) })}<//>
                <${Text} kind="caption" tone="muted">${S('brokeHeroSub')}<//>
              <//>
              <${Text}>${S('brokeLead')}<//>
            <//>
            <div>
              ${m.failing.map(job => html`
                <${ListRow} key=${job.id} name=${nameOf(job)} detail=${subOf(job)}
                  actions=${html`
                    <${Action} kind="text" onClick=${() => runNow(job.id)}>${S('runNow')}<//>
                    <${Action} kind="text" onClick=${() => toggle(job)}>${job.enabled ? S('switchOff') : S('switchOn')}<//>`}>
                  <${Stack} density="compact">
                    <${Text} tone="danger">${job.lastRunError || S('noMessage')}<//>
                    <${Text} kind="caption" tone="muted">${S('failedAt', { when: clock(job.lastRunAt), ago: since(job.lastRunAt), took: took(job.lastRunDurationMs) })}${job.enabled && job.nextRunAt ? ' ' + S('triesAgain', { when: clock(job.nextRunAt), in: until(job.nextRunAt) }) : ''}<//>
                  <//>
                <//>`)}
            </div>
          <//>`}
      <//>

      <${Section} title=${S('nextTitle')} count="02">
        ${m.agenda.length === 0
    ? html`<${Text} kind="caption" tone="muted">${S('nextNone')}<//>`
    : html`
          <${Stack}>
            <${Table} collapse=${640} headers=${[S('colWhen'), S('colJob'), S('colKind'), S('colWhose')]}
              rows=${m.agenda.slice(0, 6).map(job => [
                stamp(clock(job.nextRunAt), until(job.nextRunAt)),
                named(nameOf(job), cronWords(job.cron), false),
                { text: job.type, mono: true },
                job.ownerScope ? html`<strong>${ownerOf(job)}</strong>` : whoseWords(job),
              ])} />
            ${foot(S('agendaShown', { n: num(Math.min(6, m.agenda.length)), total: num(m.agenda.length) }),
              S('agendaRest', { activate: num(m.onActivate), off: num(m.off) }))}
          <//>`}
      <//>

      <${Section} title=${S('registerTitle')} count="03" description=${S('registerLead')}>
        <${Stack}>
          <${Toolbar}
            search=${{ ariaLabel: S('findPlaceholder'), placeholder: S('findPlaceholder'), value: find, onInput: (e) => setFind(e.target.value) }}
            filters=${filters(filter, setFilter, [
              ['all', S('chipAll', { n: num(m.total) })],
              ['failing', S('chipFailing', { n: num(m.failing.length) }), 'coral'],
              ['mine', S('chipMine', { n: num(m.mine) })],
              ['owned', S('chipOwned', { n: num(m.owned) })],
              ['extensions', S('chipExtensions', { n: num(m.extensions) })],
              ['off', S('chipOff', { n: num(m.off) })],
            ])} />

          <${Table} collapse=${640} rowTones=${shown.map(job => (job.enabled ? undefined : 'muted'))}
            headers=${[S('colJob'), S('colRuns'), S('colWhose'), S('colLastRun'), S('colNext'), '']}
            rows=${shown.map(job => {
    const next = nextWords(job);
    const failed = job.lastRunResult === 'error';
    return [
      named(nameOf(job), subOf(job)),
      html`<${Stack} density="compact"><span>${cronWords(job.cron)}</span><${Text} kind="mono" tone="muted">${job.cron}${job.timezone ? ' · ' + job.timezone : ''}<//><//>`,
      job.ownerScope ? html`<span><strong>${ownerOf(job)}</strong> ${S('ownerOwn')}</span>` : whoseWords(job),
      html`<${Stack} density="compact">
        <${Text} tone=${failed ? 'danger' : 'plain'}>${job.lastRunAt ? (failed ? S('ranFailed') : S('ranSucceeded')) : S('ranNever')}<//>
        ${job.lastRunAt && html`<${Text} kind="caption" tone="muted">${since(job.lastRunAt)} · ${took(job.lastRunDurationMs)}<//>`}
      <//>`,
      html`<${Text} kind="mono" tone=${next.none ? 'muted' : 'plain'}>${next.text}<//>`,
      html`<${Stack} direction="wrap" align="center" density="compact">
        <${Action} kind="text" semantics="switch" selected=${!!job.enabled} tone=${job.enabled ? 'success' : 'plain'}
          onClick=${() => toggle(job)}>${job.enabled ? S('stateOn') : S('stateOff')}<//>
        <${Action} kind="text" onClick=${() => runNow(job.id)}>${S('runNow')}<//>
        ${job.type !== 'core' && html`<${Action} kind="text" tone="danger" onClick=${() => remove(job)}>${S('delete')}<//>`}
      <//>`,
    ];
  })} />
          ${foot(S('registerShown', { n: num(shown.length), total: num(m.total) }), S('registerCoreNote'))}
        <//>
      <//>

      <${Section} title=${S('logTitle')} count="04" description=${S('logLead')}
        actions=${html`<${Action} onClick=${prune}>${S('prune')}<//>`}>
        ${log.length === 0
    ? html`<${Text} kind="caption" tone="muted">${S('logNone')}<//>`
    : html`
          <${Stack}>
            <${Toolbar} filters=${filters(logFilter, setLogFilter, [
              ['all', S('chipAllRuns')],
              ['errors', S('chipErrors', { n: num(log.filter(e => e.result === 'error').length) }), 'coral'],
              ['skipped', S('chipSkipped', { n: num(log.filter(e => e.result === 'skipped').length) })],
              ['manual', S('chipByHand', { n: num(log.filter(e => e.trigger === 'manual').length) })],
              ['activate', S('chipOnRestart', { n: num(log.filter(e => e.trigger === 'activate').length) })],
            ])} />
            <${Table} collapse=${640}
              headers=${[S('colWhen'), S('colJob'), S('colTrigger'), S('colResult'), S('colTook'), S('colDid')]}
              rows=${shownLog.map(e => [
                stamp(clock(e.createdAt), since(e.createdAt)),
                named(e.jobName || e.jobId, `${e.type}${e.extensionName ? ' · ' + e.extensionName : ''}`),
                S('trigger.' + e.trigger),
                html`<${Text} tone=${e.result === 'error' ? 'danger' : e.result === 'skipped' ? 'muted' : 'plain'}>${S('result.' + e.result)}<//>`,
                { text: took(e.durationMs), align: 'end' },
                didWhat(e),
              ])} />
            ${foot(S('logShown', { n: num(shownLog.length), loaded: num(log.length) }), S('logKeptNote', { total: num(logTotal) }))}
          <//>`}
      <//>

      <${ConfirmUI} />
    <//>`;
}

/**
 * What one run did, in the cell after how long it took.
 *
 * A skipped run never touched anything and carries the reason it was stopped, which is the only
 * thing worth reading on that row. A run that did happen names the keys it read and wrote — the
 * record keeps the KEYS, not counts, and they were never on a screen before.
 */
function didWhat(entry) {
  if (entry.result === 'skipped') return entry.errorMessage || S('skippedNoReason');
  const reads = entry.memoryReads || [];
  const writes = entry.memoryWrites || [];
  if (reads.length === 0 && writes.length === 0) return S('touchedNothing');
  const keys = [...reads, ...writes].slice(0, 3).join(', ');
  return html`<${Stack} density="compact"><strong>${S('touched', { r: reads.length, w: writes.length })}</strong><${Text} kind="mono" tone="muted">${keys}${reads.length + writes.length > 3 ? ' …' : ''}<//><//>`;
}
