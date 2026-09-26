/**
 * @file public/views/profile/scheduler/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Scheduler in the poster face (design canvas "AIMEAT Ajastimen sivu", direction A).
 *   The COVER answers in the order a person asks: what fires next, the week's rhythm as one row per
 *   schedule with a mark on each day it fires, the continuous jobs on their own, the rarer ones as a
 *   dated list, then every schedule as a register with one door per row, and the agents' own
 *   schedules as a fold. Each schedule opens as a PAGE under the same crumb (detail.js); the new
 *   schedule form, the paused and failed lists and the old calendar are pages reached from the rail.
 *   Pure render functions over the ctx bag scheduler-tab.js assembles.
 * @structure renderSchedulerView · renderCover · secNext · secRhythm · secContinuous · secRare · secAll · secAgents · registerTable · pages
 * @usage import { renderSchedulerView } from './scheduler/cover.js';
 * @version-history
 *   v1.19.0 -- 2026-09-26 -- What fires next, the rarer ones, the register and the agents' own jobs are the Listing (listing, listing-row and its head row, name, who, words, figure and doors cells; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.18.0 -- 2026-09-26 -- The line under a schedule's or a job's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.17.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.16.0 -- 2026-09-26 -- The last loading line here carries the Loading mark, only while it says loading (a unification: the look most tabs use).
 *   v1.15.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-26 -- The agent over its own jobs is the Group heading (.poster-day-title), a unification: Jouni's decision Group heading.
 *   v1.13.0 -- 2026-09-25 -- A line that says a load or a save failed is the Form message in its error tone (.form-message--error); the error lines' own rules go (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- The search button, which shows the search line and stays pressed while it is shown, is the Tab's fold tone (.poster-tab--fold, is-on and aria-pressed while shown), a unification: Jouni's decision "Tabs and filters".
 *   v1.11.0 -- 2026-09-25 -- "Show more" under a list is the action link's more tone (.poster-action--more), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.8.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the seven-column week grid and the wall of cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, num as fmtNum, time as fmtTime, calendar } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import SchedulerCalendar from '../scheduler-calendar.js';
import { formatUntil } from '../schedule-item.js';
import { cronWords, cronWordsFor } from './cron-words.js';
import { kindOf, nameOf, dayLabel } from './model.js';
import { CreateForm } from './create-form.js';
import { renderDetail } from './detail.js';
import { c, hhmm, whoRuns, resultWord, lastRun, crumb, pageLinks, renderPage } from './frame.js';
import { Hint } from '/components/Hint.js';

const AGENDA_ROWS = 6;
const TABLE_ROWS = 12;
const openBtn = (ctx, s, label) => html`<button type="button" class="og-tbl-name" onClick=${() => ctx.pickView({ kind: 'detail', id: s.id })}>${label || nameOf(s)}</button>`;

/* ── The cover ─────────────────────────────────────────────────────────────────────────────── */
export function renderSchedulerView(ctx) {
  const v = ctx.view;
  if (v.kind === 'detail') {
    const s = ctx.model.byId.get(v.id);
    if (s) return renderDetail(ctx, s);
  }
  if (v.kind === 'page') {
    if (v.id === 'create') return renderCreate(ctx);
    if (v.id === 'paused') return renderList(ctx, 'paused', c('pausedPage'), ctx.model.paused, c('pausedEmpty'));
    if (v.id === 'failed') return renderList(ctx, 'failed', c('failedPage'), ctx.model.failed, c('failedEmpty'));
    if (v.id === 'calendar') return renderCalendar(ctx);
  }
  return renderCover(ctx);
}

function renderCover(ctx) {
  const m = ctx.model;
  const chip = (n, key, cls = '') => html`<span class=${`poster-chip ${cls}`}>${c(key, { n })}</span>`;
  const strip = html`
    <div class="og-strip">
      <div>${m.next
        ? html`<b>${hhmm(m.next.at)}</b><span>${c('stripNext')}</span><small>${nameOf(m.next.s)} · ${dayLabel(m.next.at)} · ${formatUntil(m.next.at.toISOString())}</small>`
        : html`<b>·</b><span>${c('stripNext')}</span><small>${c('stripNextNone')}</small>`}</div>
      <div><b>${m.todayLeft}</b><span>${c('stripToday')}</span><small>${c('stripTodaySub')}</small></div>
      <div>${m.latest
        ? html`<b class=${`og-strip-coral sc-res--${m.latest.lastRunResult || 'success'}`}>${resultWord(m.latest.lastRunResult || 'success')}</b><span>${c('stripLatest')}</span><small>${nameOf(m.latest)} · ${formatRelativeTime(m.latest.lastRunAt)}</small>`
        : html`<b>·</b><span>${c('stripLatest')}</span><small>${t('profile.scheduler.never')}</small>`}</div>
      <div><b>${m.failed.length}</b><span>${c('stripFailed')}</span><small>${c('stripFailedSub')}</small></div>
    </div>`;

  return html`
    <div class="og og-sc">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('profile.scheduler.title')}</h1>
          <div class="poster-chips">
            ${chip(m.all.length, 'chipAll')}${chip(m.rhythm.length, 'chipWeekly')}${chip(m.continuous.length, 'chipCont')}${chip(m.rare.length, 'chipRare')}
            ${chip(m.paused.length, 'chipPaused')}${chip(m.failed.length, 'chipFailed', m.failed.length ? 'poster-chip--coral' : '')}
            ${m.agentMade ? chip(m.agentMade, 'chipAgent', 'poster-chip--coral') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="poster-slab" onClick=${() => ctx.pickView({ kind: 'page', id: 'create' })}>${t('profile.scheduler.newSchedule')}</button>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickView({ kind: 'page', id: 'calendar' })}>${c('calendar')}</button></div>
        </div>
      </div>
      ${ctx.error ? html`<div class="form-message form-message--error">${ctx.error}</div>` : null}
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secNext(ctx)}
          ${secRhythm(ctx)}
          ${secContinuous(ctx)}
          ${secRare(ctx)}
          ${secAll(ctx)}
          ${secAgents(ctx)}
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'sc-next', c('secNext'), m.agenda.length], ['02', 'sc-rhythm', c('secRhythm'), m.rhythm.length], ['03', 'sc-cont', c('secCont'), m.continuous.length],
            ['04', 'sc-rare', c('secRare'), m.rare.length], ['05', 'sc-all', c('secAll'), m.all.length], ['06', 'sc-agents', c('secAgents'), ctx.internal.length]]
            .map(([num, id, label, n]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${num}</i>${label}<em>${n}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks(ctx, null)}
        </nav>
      </div>
    </div>`;
}

/* ── 01 What fires next ────────────────────────────────────────────────────────────────────── */
function agendaRows(ctx, list) {
  const nowMs = Date.now();
  return html`<div class="listing listing--cols listing--when-name-who-in sc-list">
    ${list.map((o, i) => html`
      <div class="listing-row" key=${i}>
        <div class="sc-at poster-stat-number poster-stat-number--small">${hhmm(o.at)}<small>${dayLabel(o.at)}</small></div>
        <div class="listing-name">${openBtn(ctx, o.s)}<small class="listing-meta">${cronWordsFor(o.s)}${o.s.purpose ? ` · ${o.s.purpose}` : ''}</small></div>
        <div class="listing-who">${whoRuns(o.s)}</div>
        <div class="listing-n sc-in">${o.at.getTime() > nowMs ? formatUntil(o.at.toISOString()) : ''}</div>
      </div>`)}
  </div>`;
}
function secNext(ctx) {
  const list = ctx.nextOpen ? ctx.model.agenda : ctx.model.agenda.slice(0, AGENDA_ROWS);
  const doors = ctx.model.agenda.length > AGENDA_ROWS
    ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setNextOpen(v => !v)}>${ctx.nextOpen ? c('showFewer') : c('showAllComing', { n: ctx.model.agenda.length })}</button>` : null;
  return html`<${PageSection} id="sc-next" num="01" title=${c('secNext')} count=${ctx.model.next ? dayLabel(ctx.model.next.at) : null} doors=${doors} first=${true}>
    ${list.length ? agendaRows(ctx, list) : html`<p class=${`poster-quiet${ctx.occLoading ? ' loading-mark' : ''}`}>${ctx.occLoading ? t('profile.scheduler.cal.loading') : c('noneNext')}</p>`}
  <//>`;
}

/* ── 02 The week's rhythm ──────────────────────────────────────────────────────────────────── */
function secRhythm(ctx) {
  const m = ctx.model;
  const rows = ctx.rhythmSort === 'name' ? [...m.rhythm].sort((a, b) => nameOf(a.s).localeCompare(nameOf(b.s))) : m.rhythm;
  const doors = html`
    <button type="button" class=${`poster-tab poster-tab--fold ${ctx.rhythmSort === 'time' ? 'is-on' : ''}`} onClick=${() => ctx.setRhythmSort('time')}>${c('byTime')}</button>
    <button type="button" class=${`poster-tab poster-tab--fold ${ctx.rhythmSort === 'name' ? 'is-on' : ''}`} onClick=${() => ctx.setRhythmSort('name')}>${c('byName')}</button>`;
  // `times` are MINUTES past midnight in the reader's own zone — a number, because that is what
  // sorts. They are a WALL CLOCK rather than an instant, so they are written out as one: anchored
  // in UTC and formatted in UTC, which leaves the digits alone and still gives the reader their own
  // 12- or 24-hour face. The short form names the hours only, which is what the column has room for.
  const wall = (mins) => new Date(Date.UTC(2024, 0, 1, Math.floor(mins / 60), mins % 60));
  const clockOf = (mins) => fmtTime(wall(mins), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const hourOf = (mins) => fmtTime(wall(mins), { hour: '2-digit', timeZone: 'UTC' });
  const timeLabel = (r) => (r.times.length === 1 ? clockOf(r.times[0]) : r.times.length <= 3 ? r.times.map(hourOf).join(' · ') : c('timesN', { n: r.times.length }));
  return html`<${PageSection} id="sc-rhythm" num="02" title=${c('secRhythm')} count=${c('secRhythmSub', { n: m.rhythm.length })} doors=${doors}>
    ${rows.length ? html`
      <div class="sc-rhythm">
        <div class="sc-hd poster-label">${c('colTime')}</div><div class="sc-hd poster-label">${c('colSchedule')}</div>
        ${/* A column IS a calendar day, so it is written as one: calendar() cannot be slid into the
              day before by a reader whose clock sits west of the browser's. */''}
        ${m.days.map((d, i) => html`<div class=${`sc-hd sc-hd--day poster-label ${i === 0 ? 'sc-today' : ''}`} key=${'h' + i}>${calendar(d, { weekday: 'short' })}<small>${d.getDate()}</small></div>`)}
        <div class="sc-hd poster-label">${c('colLast')}</div>
        ${rows.map(r => html`
          <div class="sc-t" key=${'t' + r.s.id}>${timeLabel(r)}</div>
          <div class="sc-nm" key=${'n' + r.s.id}>${openBtn(ctx, r.s)}<i>${cronWordsFor(r.s)}</i></div>
          ${r.days.map((on, i) => html`<div class=${`sc-d ${on ? '' : 'sc-d--no'} ${i === 0 ? 'sc-today' : ''} ${kindOf(r.s) === 'agent' ? 'sc-d--agent' : ''}`} key=${'d' + r.s.id + i}>${on ? '●' : '·'}</div>`)}
          <div class="sc-last poster-time" key=${'l' + r.s.id}>${lastRun(r.s)}</div>`)}
      </div>
      <${Hint}>${c('rhythmHint')}<//>` : html`<p class=${`poster-quiet${ctx.occLoading ? ' loading-mark' : ''}`}>${ctx.occLoading ? t('profile.scheduler.cal.loading') : c('noneRhythm')}</p>`}
  <//>`;
}

/* ── 03 Continuous ─────────────────────────────────────────────────────────────────────────── */
function cadence(f) {
  const min = f.intervalMinutes;
  if (!min || !isFinite(min)) return '';
  if (min < 60) return t('profile.scheduler.cal.everyMin', { n: min });
  if (min % 60 === 0) return t('profile.scheduler.cal.everyHour', { n: min / 60 });
  return t('profile.scheduler.cal.everyMin', { n: min });
}
function secContinuous(ctx) {
  const list = ctx.model.continuous;
  return html`<${PageSection} id="sc-cont" num="03" title=${c('secCont')} count=${c('secContSub', { n: list.length })}>
    ${list.length ? html`<div class="sc-cont">
      ${list.map(f => html`<button type="button" key=${f.scheduleId} class=${`sc-job ${f.s.lastRunResult === 'error' ? 'sc-job--warn' : ''}`} onClick=${() => ctx.pickView({ kind: 'detail', id: f.s.id })}>
        ${nameOf(f.s)}<i>${cadence(f)} · ${t('profile.scheduler.cal.perDay', { n: f.approxPerDay })}${f.s.runCount ? ` · ${c('runsN', { n: fmtNum(Number(f.s.runCount)) })}` : ''}</i>
      </button>`)}
    </div>` : html`<p class="poster-quiet">${c('noneCont')}</p>`}
  <//>`;
}

/* ── 04 Less often ─────────────────────────────────────────────────────────────────────────── */
function secRare(ctx) {
  const list = ctx.model.rare;
  return html`<${PageSection} id="sc-rare" num="04" title=${c('secRare')} count=${c('secRareSub')}>
    ${list.length ? html`<div class="listing listing--cols listing--when-name-who-in sc-list">
      ${list.map(s => { const d = new Date(s.nextRunAt); return html`
        <div class="listing-row" key=${s.id}>
          <div class="sc-at poster-stat-number poster-stat-number--small">${fmtDate(d, { day: 'numeric', month: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}<small>${fmtDate(d, { weekday: 'short' })} ${hhmm(d)}</small></div>
          <div class="listing-name">${openBtn(ctx, s)}<small class="listing-meta">${cronWordsFor(s)}</small></div>
          <div class="listing-who">${whoRuns(s)}</div>
          <div class="listing-n sc-in">${formatUntil(s.nextRunAt)}</div>
        </div>`; })}
    </div>` : html`<p class="poster-quiet">${c('noneRare')}</p>`}
  <//>`;
}

/* ── 05 The register ───────────────────────────────────────────────────────────────────────── */
export function registerTable(ctx, list, { id = 'reg', head = true } = {}) {
  const open = ctx.moreOpen.has(id);
  const shown = open ? list : list.slice(0, TABLE_ROWS);
  return html`
    <div class="listing listing--cols listing--name-when-who-last-n-doors sc-reg">
      ${head ? html`<div class="listing-row listing-row--head"><div class="poster-label">${c('colSchedule')}</div><div class="poster-label">${c('colWhen')}</div><div class="poster-label">${c('colWho')}</div><div class="poster-label">${c('colLast')}</div><div class="poster-label">${t('profile.scheduler.col.runs')}</div><div class="poster-label"></div></div>` : null}
      ${shown.map(s => html`
        <div class="listing-row" key=${s.id}>
          <div class="listing-name">${openBtn(ctx, s)}${s.enabled === false ? html`<span class="poster-status poster-status--attention">${t('profile.scheduler.paused')}</span>` : null}</div>
          <div class="listing-desc">${cronWordsFor(s)}</div>
          <div class="listing-who">${whoRuns(s)}</div>
          <div class="poster-time">${lastRun(s)}</div>
          <div class="listing-n sc-n poster-stat-number poster-stat-number--small">${s.runCount ?? 0}</div>
          <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.pickView({ kind: 'detail', id: s.id })}>${c('open')}</button></div>
        </div>`)}
    </div>
    ${list.length > TABLE_ROWS ? html`<p class="sc-more"><button type="button" class="poster-action poster-action--more" onClick=${() => ctx.toggleMore(id)}>${open ? c('showFewer') : c('showRest', { n: list.length - TABLE_ROWS })}</button></p>` : null}`;
}
function secAll(ctx) {
  const m = ctx.model;
  const q = ctx.regQuery.trim().toLowerCase();
  let list = [...m.all].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (ctx.regFilter === 'agents') list = list.filter(s => s.createdByAgent || kindOf(s) === 'agent');
  if (q) list = list.filter(s => nameOf(s).toLowerCase().includes(q) || (s.agentName || '').toLowerCase().includes(q));
  const doors = html`
    <button type="button" class=${`poster-tab poster-tab--fold ${ctx.showSearch ? 'is-on' : ''}`} aria-pressed=${ctx.showSearch ? 'true' : 'false'} onClick=${() => ctx.setShowSearch(v => !v)}>${c('searchName')}</button>
    <button type="button" class=${`poster-tab poster-tab--fold ${ctx.regFilter === 'agents' ? 'is-on' : ''}`} onClick=${() => ctx.setRegFilter(f => (f === 'agents' ? 'all' : 'agents'))}>${c('agentsOnly')}</button>`;
  return html`<${PageSection} id="sc-all" num="05" title=${c('secAll')} count=${list.length} doors=${doors}>
    ${ctx.showSearch ? html`<div class="search-line"><input class="og-input" type="search" value=${ctx.regQuery} onInput=${e => ctx.setRegQuery(e.target.value)} placeholder=${c('searchName')} /></div>` : null}
    ${list.length ? registerTable(ctx, list) : html`<p class="poster-quiet">${t('profile.scheduler.noManaged')}</p>`}
  <//>`;
}

/* ── 06 The agents' own ────────────────────────────────────────────────────────────────────── */
function secAgents(ctx) {
  const groups = ctx.internal;
  return html`<${FoldSection} id="sc-agents" num="06" title=${c('secAgents')} sub=${c('secAgentsSub', { n: groups.length })} open=${ctx.agentsOpen} onToggle=${() => ctx.setAgentsOpen(v => !v)}>
    <${Hint}>${t('profile.scheduler.internalNote')}<//>
    ${groups.length ? groups.map(grp => html`<div class="sc-internal" key=${grp.gaii}>
      <div class="poster-day-title sc-internal-agent">${grp.agentName}</div>
      <div class="listing listing--cols listing--name-when-state sc-reg">
        ${grp.entries.map((e, i) => html`
          <div class="listing-row" key=${i}>
            <div class="listing-name">${e.name}${e.purpose ? html`<small class="listing-meta">${e.purpose}</small>` : null}</div>
            <div class="listing-desc">${cronWords(e.cron || e.schedule || '')}${e.timezone ? ` · ${e.timezone}` : ''}</div>
            <div class="listing-desc">${e.status || 'active'}</div>
          </div>`)}
      </div>
    </div>`) : html`<p class="poster-quiet">${t('profile.scheduler.noInternal')}</p>`}
  <//>`;
}

/* ── Pages ─────────────────────────────────────────────────────────────────────────────────── */
function renderCreate(ctx) {
  return renderPage(ctx, {
    id: 'create', crumbs: [t('profile.scheduler.newSchedule')], title: t('profile.scheduler.newSchedule'),
    children: html`
      <p class="og-desc og-desc--page">${c('createDesc')}</p>
      <${CreateForm} agents=${ctx.agents} showToast=${ctx.showToast} onCancel=${() => ctx.pickView({ kind: 'cover' })}
        onCreated=${() => { ctx.pickView({ kind: 'cover' }); ctx.loadData(); }} />`,
  });
}
function renderList(ctx, id, title, list, empty) {
  return renderPage(ctx, {
    id, crumbs: [title], title,
    chips: html`<span class="poster-chip">${c('chipAll', { n: list.length })}</span>`,
    children: list.length ? registerTable(ctx, list, { id }) : html`<p class="poster-quiet">${empty}</p>`,
  });
}
function renderCalendar(ctx) {
  return renderPage(ctx, {
    id: 'calendar', crumbs: [c('calendar')], title: c('calendar'),
    children: html`<${SchedulerCalendar} schedules=${ctx.model.all} reloadKey=${ctx.reloadTick} onJumpTo=${(id) => ctx.pickView({ kind: 'detail', id })} />`,
  });
}
