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
      <div class="og adm-sch"><${Empty} text=${S('noJobs')} /></div>
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

  const chip = (key, label, cls = '') => html`
    <button type="button" class="adm-sch-chip ${cls} ${filter === key ? 'on' : ''}"
      onClick=${() => setFilter(key)}>${label}</button>`;
  const logChip = (key, label, cls = '') => html`
    <button type="button" class="adm-sch-chip ${cls} ${logFilter === key ? 'on' : ''}"
      onClick=${() => setLogFilter(key)}>${label}</button>`;

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <div class="og adm-sch">

      <div class="og-strip">
        <div><b>${num(m.total)}</b><span>${S('cntJobs')}</span><small>${S('cntJobsSub')}</small></div>
        <div><b>${num(m.on)}</b><span>${S('cntOn')}</span><small>${S('cntOnSub', { n: num(m.off) })}</small></div>
        <div class="adm-sch-bad"><b>${num(m.failing.length)}</b><span>${S('cntFailed')}</span><small>${S('cntFailedSub')}</small></div>
        <div><b>${num(m.neverRun)}</b><span>${S('cntNever')}</span><small>${S('cntNeverSub')}</small></div>
      </div>

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${S('brokeTitle')}<small>01</small></h2></div>
        ${m.failing.length === 0
    ? html`<p class="adm-sch-note">${S('brokeNone')}</p>`
    : html`
          <div class="adm-sch-top">
            <div>
              <div class="adm-sch-lbl">${S('brokeLabel')}</div>
              <div class="adm-sch-hero">${S('brokeHero', { n: num(m.failing.length), total: num(m.total) })}</div>
              <p class="adm-sch-hero-sub">${S('brokeHeroSub')}</p>
            </div>
            <div><p class="adm-sch-lead">${S('brokeLead')}</p></div>
          </div>
          <div class="adm-sch-fails">
            ${m.failing.map(job => html`
              <div class="adm-sch-frow" key=${job.id}>
                <span class="adm-sch-fname">${nameOf(job)}<em>${subOf(job)}</em></span>
                <span class="adm-sch-ferr">${job.lastRunError || S('noMessage')}
                  <span class="adm-sch-fwhen">${S('failedAt', { when: clock(job.lastRunAt), ago: since(job.lastRunAt), took: took(job.lastRunDurationMs) })}
                    ${job.enabled && job.nextRunAt ? ' ' + S('triesAgain', { when: clock(job.nextRunAt), in: until(job.nextRunAt) }) : ''}</span>
                </span>
                <span class="adm-sch-facts">
                  <button type="button" class="adm-sch-door" onClick=${() => runNow(job.id)}>${S('runNow')}</button>
                  <button type="button" class="adm-sch-door" onClick=${() => toggle(job)}>${job.enabled ? S('switchOff') : S('switchOn')}</button>
                </span>
              </div>`)}
          </div>`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${S('nextTitle')}<small>02</small></h2></div>
        ${m.agenda.length === 0
    ? html`<p class="adm-sch-note">${S('nextNone')}</p>`
    : html`
          <div class="adm-sch-agenda">
            <div class="adm-sch-ahrow">
              <span>${S('colWhen')}</span><span>${S('colJob')}</span><span>${S('colKind')}</span><span>${S('colWhose')}</span>
            </div>
            ${m.agenda.slice(0, 6).map(job => html`
              <div class="adm-sch-arow" key=${job.id}>
                <span class="adm-sch-at">${clock(job.nextRunAt)}<i>${until(job.nextRunAt)}</i></span>
                <span class="adm-sch-aname">${nameOf(job)}<em>${cronWords(job.cron)}</em></span>
                <span class="adm-sch-akind">${job.type}</span>
                <span class="adm-sch-awho">${job.ownerScope ? html`<b>${ownerOf(job)}</b>` : whoseWords(job)}</span>
              </div>`)}
          </div>
          <div class="adm-sch-foot">
            <span>${S('agendaShown', { n: num(Math.min(6, m.agenda.length)), total: num(m.agenda.length) })}</span>
            <span>${S('agendaRest', { activate: num(m.onActivate), off: num(m.off) })}</span>
          </div>`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${S('registerTitle')}<small>03</small></h2></div>
        <p class="adm-sch-lead">${S('registerLead')}</p>

        <div class="adm-sch-tools">
          <div class="adm-sch-find">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M16 16 L21 21"></path></svg>
            <input type="text" value=${find} onInput=${e => setFind(e.target.value)} placeholder=${S('findPlaceholder')} />
          </div>
          <div class="adm-sch-chips">
            ${chip('all', S('chipAll', { n: num(m.total) }))}
            ${chip('failing', S('chipFailing', { n: num(m.failing.length) }), 'bad')}
            ${chip('mine', S('chipMine', { n: num(m.mine) }))}
            ${chip('owned', S('chipOwned', { n: num(m.owned) }))}
            ${chip('extensions', S('chipExtensions', { n: num(m.extensions) }))}
            ${chip('off', S('chipOff', { n: num(m.off) }))}
          </div>
        </div>

        <div class="adm-sch-rows">
          <div class="adm-sch-hrow">
            <span>${S('colJob')}</span><span>${S('colRuns')}</span><span>${S('colWhose')}</span>
            <span>${S('colLastRun')}</span><span>${S('colNext')}</span><span></span>
          </div>
          ${shown.map(job => {
    const next = nextWords(job);
    return html`
            <div class="adm-sch-row ${job.enabled ? '' : 'is-off'}" key=${job.id}>
              <span class="adm-sch-name">${nameOf(job)}<em>${subOf(job)}</em></span>
              <span class="adm-sch-when">${cronWords(job.cron)}<em>${job.cron}${job.timezone ? ' · ' + job.timezone : ''}</em></span>
              <span class="adm-sch-who">${job.ownerScope
    ? html`<b>${ownerOf(job)}</b>${S('ownerOwn')}`
    : whoseWords(job)}</span>
              <span class="adm-sch-ran ${job.lastRunResult === 'error' ? 'err' : ''}">
                ${job.lastRunAt ? (job.lastRunResult === 'error' ? S('ranFailed') : S('ranSucceeded')) : S('ranNever')}
                ${job.lastRunAt && html`<em>${since(job.lastRunAt)} · ${took(job.lastRunDurationMs)}</em>`}
              </span>
              <span class="adm-sch-next ${next.none ? 'none' : ''}">${next.text}</span>
              <span class="adm-sch-acts">
                <button type="button" class="adm-sch-state ${job.enabled ? '' : 'off'}"
                  onClick=${() => toggle(job)}>${job.enabled ? S('stateOn') : S('stateOff')}</button>
                <button type="button" class="adm-sch-run" onClick=${() => runNow(job.id)}>${S('runNow')}</button>
                ${job.type !== 'core' && html`
                  <button type="button" class="adm-sch-kill" onClick=${() => remove(job)}>${S('delete')}</button>`}
              </span>
            </div>`;
  })}
        </div>
        <div class="adm-sch-foot">
          <span>${S('registerShown', { n: num(shown.length), total: num(m.total) })}</span>
          <span>${S('registerCoreNote')}</span>
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h">
          <h2>${S('logTitle')}<small>04</small></h2>
          <button type="button" class="og-door" onClick=${prune}>${S('prune')}</button>
        </div>
        <p class="adm-sch-lead">${S('logLead')}</p>
        ${log.length === 0
    ? html`<p class="adm-sch-note">${S('logNone')}</p>`
    : html`
          <div class="adm-sch-chips adm-sch-chips--log">
            ${logChip('all', S('chipAllRuns'))}
            ${logChip('errors', S('chipErrors', { n: num(log.filter(e => e.result === 'error').length) }), 'bad')}
            ${logChip('skipped', S('chipSkipped', { n: num(log.filter(e => e.result === 'skipped').length) }))}
            ${logChip('manual', S('chipByHand', { n: num(log.filter(e => e.trigger === 'manual').length) }))}
            ${logChip('activate', S('chipOnRestart', { n: num(log.filter(e => e.trigger === 'activate').length) }))}
          </div>
          <div class="adm-sch-lrows">
            <div class="adm-sch-lhrow">
              <span>${S('colWhen')}</span><span>${S('colJob')}</span><span>${S('colTrigger')}</span>
              <span>${S('colResult')}</span><span class="r">${S('colTook')}</span><span>${S('colDid')}</span>
            </div>
            ${shownLog.map(e => html`
              <div class="adm-sch-lrow" key=${e.id}>
                <span class="adm-sch-t">${clock(e.createdAt)}<i>${since(e.createdAt)}</i></span>
                <span class="adm-sch-ljob">${e.jobName || e.jobId}<em>${e.type}${e.extensionName ? ' · ' + e.extensionName : ''}</em></span>
                <span class="adm-sch-trig">${S('trigger.' + e.trigger)}</span>
                <span class="adm-sch-res ${e.result === 'error' ? 'err' : e.result === 'skipped' ? 'skip' : ''}">${S('result.' + e.result)}</span>
                <span class="adm-sch-ms r">${took(e.durationMs)}</span>
                <span class="adm-sch-did">${didWhat(e)}</span>
              </div>`)}
          </div>
          <div class="adm-sch-foot">
            <span>${S('logShown', { n: num(shownLog.length), loaded: num(log.length) })}</span>
            <span>${S('logKeptNote', { total: num(logTotal) })}</span>
          </div>`}
      </section>

      <${ConfirmUI} />
    </div>`;
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
  return html`<b>${S('touched', { r: reads.length, w: writes.length })}</b><em>${keys}${reads.length + writes.length > 3 ? ' …' : ''}</em>`;
}
