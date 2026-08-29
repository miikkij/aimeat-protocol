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
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the seven-column week grid and the wall of cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import SchedulerCalendar from '../scheduler-calendar.js';
import { formatUntil } from '../schedule-item.js';
import { cronWords } from './cron-words.js';
import { kindOf, nameOf, dayLabel } from './model.js';
import { CreateForm } from './create-form.js';
import { renderDetail } from './detail.js';
import { c, loc, hhmm, whoRuns, resultWord, lastRun, crumb, pageLinks, renderPage } from './frame.js';

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
  const chip = (n, key, cls = '') => html`<span class=${`og-chip ${cls}`}>${c(key, { n })}</span>`;
  const strip = html`
    <div class="og-strip">
      <div>${m.next
        ? html`<b>${hhmm(m.next.at)}</b><span>${c('stripNext')}</span><small>${nameOf(m.next.s)} · ${dayLabel(m.next.at, loc())} · ${formatUntil(m.next.at.toISOString())}</small>`
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
          <h1 class="og-title">${t('profile.scheduler.title')}</h1>
          <div class="og-chips">
            ${chip(m.all.length, 'chipAll')}${chip(m.rhythm.length, 'chipWeekly')}${chip(m.continuous.length, 'chipCont')}${chip(m.rare.length, 'chipRare')}
            ${chip(m.paused.length, 'chipPaused', 'og-chip--dim')}${chip(m.failed.length, 'chipFailed', m.failed.length ? 'og-chip--coral' : 'og-chip--dim')}
            ${m.agentMade ? chip(m.agentMade, 'chipAgent', 'og-chip--coral') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${() => ctx.pickView({ kind: 'page', id: 'create' })}>${t('profile.scheduler.newSchedule')}</button>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'page', id: 'calendar' })}>${c('calendar')}</button></div>
        </div>
      </div>
      ${ctx.error ? html`<div class="sch-error">${ctx.error}</div>` : null}
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
  return html`<div class="sc-agenda">
    ${list.map((o, i) => html`
      <div class="sc-at" key=${'a' + i}>${hhmm(o.at)}<small>${dayLabel(o.at, loc())}</small></div>
      <div class="sc-nm" key=${'n' + i}>${openBtn(ctx, o.s)}<small>${cronWords(o.s.cron)}${o.s.purpose ? ` · ${o.s.purpose}` : ''}</small></div>
      <div class="sc-who" key=${'w' + i}>${whoRuns(o.s)}</div>
      <div class="sc-in" key=${'i' + i}>${o.at.getTime() > nowMs ? formatUntil(o.at.toISOString()) : ''}</div>`)}
  </div>`;
}
function secNext(ctx) {
  const list = ctx.nextOpen ? ctx.model.agenda : ctx.model.agenda.slice(0, AGENDA_ROWS);
  const doors = ctx.model.agenda.length > AGENDA_ROWS
    ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setNextOpen(v => !v)}>${ctx.nextOpen ? c('showFewer') : c('showAllComing', { n: ctx.model.agenda.length })}</button>` : null;
  return html`<${Section} id="sc-next" num="01" title=${c('secNext')} count=${ctx.model.next ? dayLabel(ctx.model.next.at, loc()) : null} doors=${doors} first=${true}>
    ${list.length ? agendaRows(ctx, list) : html`<p class="og-empty">${ctx.occLoading ? t('profile.scheduler.cal.loading') : c('noneNext')}</p>`}
  <//>`;
}

/* ── 02 The week's rhythm ──────────────────────────────────────────────────────────────────── */
function secRhythm(ctx) {
  const m = ctx.model;
  const rows = ctx.rhythmSort === 'name' ? [...m.rhythm].sort((a, b) => nameOf(a.s).localeCompare(nameOf(b.s))) : m.rhythm;
  const doors = html`
    <button type="button" class=${`og-door og-door--quiet ${ctx.rhythmSort === 'time' ? 'on' : ''}`} onClick=${() => ctx.setRhythmSort('time')}>${c('byTime')}</button>
    <button type="button" class=${`og-door og-door--quiet ${ctx.rhythmSort === 'name' ? 'on' : ''}`} onClick=${() => ctx.setRhythmSort('name')}>${c('byName')}</button>`;
  const timeLabel = (r) => (r.times.length === 1 ? r.times[0] : r.times.length <= 3 ? r.times.map(x => x.slice(0, 2)).join(' · ') : c('timesN', { n: r.times.length }));
  return html`<${Section} id="sc-rhythm" num="02" title=${c('secRhythm')} count=${c('secRhythmSub', { n: m.rhythm.length })} doors=${doors}>
    ${rows.length ? html`
      <div class="sc-rhythm">
        <div class="sc-hd">${c('colTime')}</div><div class="sc-hd">${c('colSchedule')}</div>
        ${m.days.map((d, i) => html`<div class=${`sc-hd sc-hd--day ${i === 0 ? 'sc-today' : ''}`} key=${'h' + i}>${d.toLocaleDateString(loc(), { weekday: 'short' })}<small>${d.getDate()}</small></div>`)}
        <div class="sc-hd">${c('colLast')}</div>
        ${rows.map(r => html`
          <div class="sc-t" key=${'t' + r.s.id}>${timeLabel(r)}</div>
          <div class="sc-nm" key=${'n' + r.s.id}>${openBtn(ctx, r.s)}<i>${cronWords(r.s.cron)}</i></div>
          ${r.days.map((on, i) => html`<div class=${`sc-d ${on ? '' : 'sc-d--no'} ${i === 0 ? 'sc-today' : ''} ${kindOf(r.s) === 'agent' ? 'sc-d--agent' : ''}`} key=${'d' + r.s.id + i}>${on ? '●' : '·'}</div>`)}
          <div class="sc-last" key=${'l' + r.s.id}>${lastRun(r.s)}</div>`)}
      </div>
      <p class="sc-hint">${c('rhythmHint')}</p>` : html`<p class="og-empty">${ctx.occLoading ? t('profile.scheduler.cal.loading') : c('noneRhythm')}</p>`}
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
  return html`<${Section} id="sc-cont" num="03" title=${c('secCont')} count=${c('secContSub', { n: list.length })}>
    ${list.length ? html`<div class="sc-cont">
      ${list.map(f => html`<button type="button" key=${f.scheduleId} class=${`sc-job ${f.s.lastRunResult === 'error' ? 'sc-job--warn' : ''}`} onClick=${() => ctx.pickView({ kind: 'detail', id: f.s.id })}>
        ${nameOf(f.s)}<i>${cadence(f)} · ${t('profile.scheduler.cal.perDay', { n: f.approxPerDay })}${f.s.runCount ? ` · ${c('runsN', { n: Number(f.s.runCount).toLocaleString(loc()) })}` : ''}</i>
      </button>`)}
    </div>` : html`<p class="og-empty">${c('noneCont')}</p>`}
  <//>`;
}

/* ── 04 Less often ─────────────────────────────────────────────────────────────────────────── */
function secRare(ctx) {
  const list = ctx.model.rare;
  return html`<${Section} id="sc-rare" num="04" title=${c('secRare')} count=${c('secRareSub')}>
    ${list.length ? html`<div class="sc-agenda sc-agenda--rare">
      ${list.map(s => { const d = new Date(s.nextRunAt); return html`
        <div class="sc-at" key=${'a' + s.id}>${d.toLocaleDateString(loc(), { day: 'numeric', month: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}<small>${d.toLocaleDateString(loc(), { weekday: 'short' })} ${hhmm(d)}</small></div>
        <div class="sc-nm" key=${'n' + s.id}>${openBtn(ctx, s)}<small>${cronWords(s.cron)}</small></div>
        <div class="sc-who" key=${'w' + s.id}>${whoRuns(s)}</div>
        <div class="sc-in" key=${'i' + s.id}>${formatUntil(s.nextRunAt)}</div>`; })}
    </div>` : html`<p class="og-empty">${c('noneRare')}</p>`}
  <//>`;
}

/* ── 05 The register ───────────────────────────────────────────────────────────────────────── */
export function registerTable(ctx, list, { id = 'reg', head = true } = {}) {
  const open = ctx.moreOpen.has(id);
  const shown = open ? list : list.slice(0, TABLE_ROWS);
  return html`
    ${head ? html`<div class="sc-reg sc-reg--head"><div>${c('colSchedule')}</div><div>${c('colWhen')}</div><div>${c('colWho')}</div><div>${c('colLast')}</div><div>${t('profile.scheduler.col.runs')}</div><div></div></div>` : null}
    <div class="sc-reg">
      ${shown.map(s => html`
        <div class="sc-nm" key=${'n' + s.id}>${openBtn(ctx, s)}${s.enabled === false ? html`<span class="og-chip og-chip--dim og-chip--xs">${t('profile.scheduler.paused')}</span>` : null}</div>
        <div class="sc-w" key=${'w' + s.id}>${cronWords(s.cron)}</div>
        <div class="sc-m" key=${'o' + s.id}>${whoRuns(s)}</div>
        <div class="sc-m" key=${'l' + s.id}>${lastRun(s)}</div>
        <div class="sc-n" key=${'r' + s.id}>${s.runCount ?? 0}</div>
        <div class="og-tbl-door" key=${'d' + s.id}><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'detail', id: s.id })}>${c('open')}</button></div>`)}
    </div>
    ${list.length > TABLE_ROWS ? html`<p class="sc-more"><button type="button" onClick=${() => ctx.toggleMore(id)}>${open ? c('showFewer') : c('showRest', { n: list.length - TABLE_ROWS })}</button></p>` : null}`;
}
function secAll(ctx) {
  const m = ctx.model;
  const q = ctx.regQuery.trim().toLowerCase();
  let list = [...m.all].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (ctx.regFilter === 'agents') list = list.filter(s => s.createdByAgent || kindOf(s) === 'agent');
  if (q) list = list.filter(s => nameOf(s).toLowerCase().includes(q) || (s.agentName || '').toLowerCase().includes(q));
  const doors = html`
    <button type="button" class=${`og-door og-door--quiet ${ctx.showSearch ? 'on' : ''}`} onClick=${() => ctx.setShowSearch(v => !v)}>${c('searchName')}</button>
    <button type="button" class=${`og-door og-door--quiet ${ctx.regFilter === 'agents' ? 'on' : ''}`} onClick=${() => ctx.setRegFilter(f => (f === 'agents' ? 'all' : 'agents'))}>${c('agentsOnly')}</button>`;
  return html`<${Section} id="sc-all" num="05" title=${c('secAll')} count=${list.length} doors=${doors}>
    ${ctx.showSearch ? html`<div class="sc-search"><input type="search" value=${ctx.regQuery} onInput=${e => ctx.setRegQuery(e.target.value)} placeholder=${c('searchName')} /></div>` : null}
    ${list.length ? registerTable(ctx, list) : html`<p class="og-empty">${t('profile.scheduler.noManaged')}</p>`}
  <//>`;
}

/* ── 06 The agents' own ────────────────────────────────────────────────────────────────────── */
function secAgents(ctx) {
  const groups = ctx.internal;
  return html`<${Fold} id="sc-agents" num="06" title=${c('secAgents')} sub=${c('secAgentsSub', { n: groups.length })} open=${ctx.agentsOpen} onToggle=${() => ctx.setAgentsOpen(v => !v)}>
    <p class="sc-hint">${t('profile.scheduler.internalNote')}</p>
    ${groups.length ? groups.map(grp => html`<div class="sc-internal" key=${grp.gaii}>
      <div class="sc-internal-agent">${grp.agentName}</div>
      <div class="sc-reg sc-reg--internal">
        ${grp.entries.map((e, i) => html`
          <div class="sc-nm" key=${'n' + i}>${e.name}${e.purpose ? html`<small>${e.purpose}</small>` : null}</div>
          <div class="sc-w" key=${'w' + i}>${cronWords(e.cron || e.schedule || '')}${e.timezone ? ` · ${e.timezone}` : ''}</div>
          <div class="sc-m" key=${'s' + i}>${e.status || 'active'}</div>`)}
      </div>
    </div>`) : html`<p class="og-empty">${t('profile.scheduler.noInternal')}</p>`}
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
    chips: html`<span class="og-chip">${c('chipAll', { n: list.length })}</span>`,
    children: list.length ? registerTable(ctx, list, { id }) : html`<p class="og-empty">${empty}</p>`,
  });
}
function renderCalendar(ctx) {
  return renderPage(ctx, {
    id: 'calendar', crumbs: [c('calendar')], title: c('calendar'),
    children: html`<${SchedulerCalendar} schedules=${ctx.model.all} reloadKey=${ctx.reloadTick} onJumpTo=${(id) => ctx.pickView({ kind: 'detail', id })} />`,
  });
}
