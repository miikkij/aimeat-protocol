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
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, NumeralBand for the strip,
 *     ListRow timelines for what fires next and the rarer ones, Table for the week's rhythm and the
 *     register. No own CSS. A day the schedule fires is a ✓ (the site's glyphs are ✓ ✗ → ↩).
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the seven-column week grid and the wall of cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, num as fmtNum, time as fmtTime, calendar } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { Page, Rail, Section, Fold, Stack, ListRow, Table, NumeralBand, Field, Action, Chip, Text } from '/components/poster-parts.js';
import SchedulerCalendar from '../scheduler-calendar.js';
import { formatUntil } from '../schedule-item.js';
import { cronWords, cronWordsFor } from './cron-words.js';
import { kindOf, nameOf, dayLabel } from './model.js';
import { CreateForm } from './create-form.js';
import { renderDetail } from './detail.js';
import { c, hhmm, whoRuns, resultWord, lastRun, crumb, chipRow, pageLinks, renderPage } from './frame.js';

const AGENDA_ROWS = 6;
const TABLE_ROWS = 12;
const openDetail = (ctx, s) => () => ctx.pickView({ kind: 'detail', id: s.id });
const nameCell = (ctx, s, extra) => html`<${Stack} density="compact">
  <${Action} kind="text" onClick=${openDetail(ctx, s)}>${nameOf(s)}<//>${extra}<//>`;

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
  const strip = html`<${NumeralBand} tone="plain" items=${[
    m.next ? { label: c('stripNext'), value: hhmm(m.next.at), note: `${nameOf(m.next.s)} · ${dayLabel(m.next.at)} · ${formatUntil(m.next.at.toISOString())}` }
      : { label: c('stripNext'), value: '·', note: c('stripNextNone') },
    { label: c('stripToday'), value: m.todayLeft, note: c('stripTodaySub') },
    m.latest ? { label: c('stripLatest'), value: resultWord(m.latest.lastRunResult || 'success'), note: `${nameOf(m.latest)} · ${formatRelativeTime(m.latest.lastRunAt)}`, tone: 'coral' }
      : { label: c('stripLatest'), value: '·', note: t('profile.scheduler.never') },
    { label: c('stripFailed'), value: m.failed.length, note: c('stripFailedSub') },
  ]} />`;
  const chips = chipRow([
    [c('chipAll', { n: m.all.length })], [c('chipWeekly', { n: m.rhythm.length })], [c('chipCont', { n: m.continuous.length })], [c('chipRare', { n: m.rare.length })],
    [c('chipPaused', { n: m.paused.length }), 'muted'], [c('chipFailed', { n: m.failed.length }), m.failed.length ? 'sun' : 'muted'],
    m.agentMade && [c('chipAgent', { n: m.agentMade }), 'sun'],
  ]);
  const actions = html`<${Action} kind="primary" onClick=${() => ctx.pickView({ kind: 'page', id: 'create' })}>${t('profile.scheduler.newSchedule')}<//>
    <${Action} onClick=${() => ctx.pickView({ kind: 'page', id: 'calendar' })}>${c('calendar')}<//>`;
  const rail = html`<${Rail} kind="index" title=${c('railTitle')} entries=${[
    { href: '#sc-next', label: c('secNext'), count: m.agenda.length },
    { href: '#sc-rhythm', label: c('secRhythm'), count: m.rhythm.length },
    { href: '#sc-cont', label: c('secCont'), count: m.continuous.length },
    { href: '#sc-rare', label: c('secRare'), count: m.rare.length },
    { href: '#sc-all', label: c('secAll'), count: m.all.length },
    { href: '#sc-agents', label: c('secAgents'), count: ctx.internal.length },
  ]}>${pageLinks(ctx, null)}<//>`;
  return html`<${Page} width="wide" title=${t('profile.scheduler.title')} crumbs=${crumb(ctx, [])} identity=${chips} actions=${actions} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${c('desc')}<//>
      ${ctx.error ? html`<${Text} tone="danger">${ctx.error}<//>` : null}
      ${strip}
      ${secNext(ctx)}${secRhythm(ctx)}${secContinuous(ctx)}${secRare(ctx)}${secAll(ctx)}${secAgents(ctx)}
    <//>
  <//>`;
}

/* ── 01 What fires next ────────────────────────────────────────────────────────────────────── */
function agendaRows(ctx, list) {
  const nowMs = Date.now();
  return list.map((o, i) => html`<${ListRow} key=${i} density="compact" time=${`${hhmm(o.at)} ${dayLabel(o.at)}`}
    name=${nameOf(o.s)} onOpen=${openDetail(ctx, o.s)} detailKind="text"
    detail=${`${cronWordsFor(o.s)} · ${whoRuns(o.s)}${o.s.purpose ? ` · ${o.s.purpose}` : ''}`}
    value=${o.at.getTime() > nowMs ? formatUntil(o.at.toISOString()) : undefined} />`);
}
function secNext(ctx) {
  const list = ctx.nextOpen ? ctx.model.agenda : ctx.model.agenda.slice(0, AGENDA_ROWS);
  const actions = ctx.model.agenda.length > AGENDA_ROWS
    ? html`<${Action} onClick=${() => ctx.setNextOpen(v => !v)}>${ctx.nextOpen ? c('showFewer') : c('showAllComing', { n: ctx.model.agenda.length })}<//>` : null;
  return html`<${Section} id="sc-next" title=${c('secNext')} count=${ctx.model.next ? dayLabel(ctx.model.next.at) : null} actions=${actions}>
    ${list.length ? agendaRows(ctx, list) : html`<${Text} tone="muted">${ctx.occLoading ? t('profile.scheduler.cal.loading') : c('noneNext')}<//>`}
  <//>`;
}

/* ── 02 The week's rhythm ──────────────────────────────────────────────────────────────────── */
function secRhythm(ctx) {
  const m = ctx.model;
  const rows = ctx.rhythmSort === 'name' ? [...m.rhythm].sort((a, b) => nameOf(a.s).localeCompare(nameOf(b.s))) : m.rhythm;
  const actions = html`
    <${Action} kind="tab" selected=${ctx.rhythmSort === 'time'} onClick=${() => ctx.setRhythmSort('time')}>${c('byTime')}<//>
    <${Action} kind="tab" selected=${ctx.rhythmSort === 'name'} onClick=${() => ctx.setRhythmSort('name')}>${c('byName')}<//>`;
  // `times` are MINUTES past midnight in the reader's own zone — a number, because that is what
  // sorts. They are a WALL CLOCK rather than an instant, so they are written out as one: anchored
  // in UTC and formatted in UTC, which leaves the digits alone and still gives the reader their own
  // 12- or 24-hour face. The short form names the hours only, which is what the column has room for.
  const wall = (mins) => new Date(Date.UTC(2024, 0, 1, Math.floor(mins / 60), mins % 60));
  const clockOf = (mins) => fmtTime(wall(mins), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const hourOf = (mins) => fmtTime(wall(mins), { hour: '2-digit', timeZone: 'UTC' });
  const timeLabel = (r) => (r.times.length === 1 ? clockOf(r.times[0]) : r.times.length <= 3 ? r.times.map(hourOf).join(' · ') : c('timesN', { n: r.times.length }));
  // A column IS a calendar day, so it is written as one: calendar() cannot be slid into the day
  // before by a reader whose clock sits west of the browser's.
  // Today's column head sits on the sun; an agent's task is marked in coral, the rest in ink.
  const dayHead = (d, i) => (i === 0 ? html`<${Chip} tone="sun">${calendar(d, { weekday: 'short' })} ${d.getDate()}<//>` : `${calendar(d, { weekday: 'short' })} ${d.getDate()}`);
  const dayCell = (on, s) => html`<${Text} kind="mono" tone=${on ? (kindOf(s) === 'agent' ? 'coral' : 'plain') : 'muted'}>${on ? '✓' : '·'}<//>`;
  return html`<${Section} id="sc-rhythm" title=${c('secRhythm')} count=${c('secRhythmSub', { n: m.rhythm.length })} actions=${actions}>
    ${rows.length ? html`<${Stack}>
      <${Table} density="compact" label=${c('secRhythm')}
        headers=${[c('colTime'), c('colSchedule'), ...m.days.map(dayHead), c('colLast')]}
        rows=${rows.map(r => [{ text: timeLabel(r), mono: true },
          nameCell(ctx, r.s, html`<${Text} kind="caption" tone="muted">${cronWordsFor(r.s)}<//>`),
          ...r.days.map(on => dayCell(on, r.s)),
          { text: lastRun(r.s), mono: true }])} />
      <${Text} kind="caption" tone="muted">${c('rhythmHint')}<//>
    <//>` : html`<${Text} tone="muted">${ctx.occLoading ? t('profile.scheduler.cal.loading') : c('noneRhythm')}<//>`}
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
  return html`<${Section} id="sc-cont" title=${c('secCont')} count=${c('secContSub', { n: list.length })}>
    ${list.length ? list.map(f => html`<${ListRow} key=${f.scheduleId} density="compact" marker=${f.s.lastRunResult === 'error' ? 'danger' : 'success'}
      name=${nameOf(f.s)} onOpen=${openDetail(ctx, f.s)}
      detail=${`${cadence(f)} · ${t('profile.scheduler.cal.perDay', { n: f.approxPerDay })}${f.s.runCount ? ` · ${c('runsN', { n: fmtNum(Number(f.s.runCount)) })}` : ''}`} />`)
      : html`<${Text} tone="muted">${c('noneCont')}<//>`}
  <//>`;
}

/* ── 04 Less often ─────────────────────────────────────────────────────────────────────────── */
function secRare(ctx) {
  const list = ctx.model.rare;
  return html`<${Section} id="sc-rare" title=${c('secRare')} count=${c('secRareSub')}>
    ${list.length ? list.map(s => { const d = new Date(s.nextRunAt); return html`<${ListRow} key=${s.id} density="compact"
      time=${`${fmtDate(d, { day: 'numeric', month: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })} ${fmtDate(d, { weekday: 'short' })} ${hhmm(d)}`}
      name=${nameOf(s)} onOpen=${openDetail(ctx, s)} detailKind="text" detail=${`${cronWordsFor(s)} · ${whoRuns(s)}`}
      value=${formatUntil(s.nextRunAt)} />`; })
      : html`<${Text} tone="muted">${c('noneRare')}<//>`}
  <//>`;
}

/* ── 05 The register ───────────────────────────────────────────────────────────────────────── */
export function registerTable(ctx, list, { id = 'reg' } = {}) {
  const open = ctx.moreOpen.has(id);
  const shown = open ? list : list.slice(0, TABLE_ROWS);
  return html`<${Stack}>
    <${Table} density="compact" label=${c('secAll')}
      headers=${[c('colSchedule'), c('colWhen'), c('colWho'), c('colLast'), t('profile.scheduler.col.runs'), '']}
      rows=${shown.map(s => [
        nameCell(ctx, s, s.enabled === false ? html`<${Chip} tone="muted">${t('profile.scheduler.paused')}<//>` : null),
        cronWordsFor(s), { text: whoRuns(s), mono: true }, { text: lastRun(s), mono: true }, { text: String(s.runCount ?? 0), mono: true },
        html`<${Action} onClick=${openDetail(ctx, s)}>${c('open')}<//>`])} />
    ${list.length > TABLE_ROWS ? html`<${Stack} direction="horizontal" align="start"><${Action} onClick=${() => ctx.toggleMore(id)}>${open ? c('showFewer') : c('showRest', { n: list.length - TABLE_ROWS })}<//><//>` : null}
  <//>`;
}
function secAll(ctx) {
  const m = ctx.model;
  const q = ctx.regQuery.trim().toLowerCase();
  let list = [...m.all].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (ctx.regFilter === 'agents') list = list.filter(s => s.createdByAgent || kindOf(s) === 'agent');
  if (q) list = list.filter(s => nameOf(s).toLowerCase().includes(q) || (s.agentName || '').toLowerCase().includes(q));
  const actions = html`
    <${Action} kind="tab" selected=${ctx.showSearch} onClick=${() => ctx.setShowSearch(v => !v)}>${c('searchName')}<//>
    <${Action} kind="tab" selected=${ctx.regFilter === 'agents'} onClick=${() => ctx.setRegFilter(f => (f === 'agents' ? 'all' : 'agents'))}>${c('agentsOnly')}<//>`;
  return html`<${Section} id="sc-all" title=${c('secAll')} count=${list.length} actions=${actions}>
    <${Stack}>
      ${ctx.showSearch ? html`<${Field} type="search" value=${ctx.regQuery} onInput=${e => ctx.setRegQuery(e.target.value)} placeholder=${c('searchName')} />` : null}
      ${list.length ? registerTable(ctx, list) : html`<${Text} tone="muted">${t('profile.scheduler.noManaged')}<//>`}
    <//>
  <//>`;
}

/* ── 06 The agents' own ────────────────────────────────────────────────────────────────────── */
function secAgents(ctx) {
  const groups = ctx.internal;
  return html`<${Fold} id="sc-agents" number="06" title=${c('secAgents')} sub=${c('secAgentsSub', { n: groups.length })} open=${ctx.agentsOpen} onToggle=${() => ctx.setAgentsOpen(v => !v)}>
    <${Text} kind="caption" tone="muted">${t('profile.scheduler.internalNote')}<//>
    ${groups.length ? groups.map(grp => html`<${Stack} key=${grp.gaii} density="compact">
      <${Text} kind="label">${grp.agentName}<//>
      ${grp.entries.map((e, i) => html`<${ListRow} key=${i} density="compact" name=${e.name} detail=${e.purpose || undefined} detailKind="text"
        value=${`${cronWords(e.cron || e.schedule || '')}${e.timezone ? ` · ${e.timezone}` : ''} · ${e.status || 'active'}`} />`)}
    <//>`) : html`<${Text} tone="muted">${t('profile.scheduler.noInternal')}<//>`}
  <//>`;
}

/* ── Pages ─────────────────────────────────────────────────────────────────────────────────── */
function renderCreate(ctx) {
  return renderPage(ctx, {
    id: 'create', crumbs: [t('profile.scheduler.newSchedule')], title: t('profile.scheduler.newSchedule'),
    children: html`
      <${Text} kind="lead">${c('createDesc')}<//>
      <${CreateForm} agents=${ctx.agents} showToast=${ctx.showToast} onCancel=${() => ctx.pickView({ kind: 'cover' })}
        onCreated=${() => { ctx.pickView({ kind: 'cover' }); ctx.loadData(); }} />`,
  });
}
function renderList(ctx, id, title, list, empty) {
  return renderPage(ctx, {
    id, crumbs: [title], title,
    chips: chipRow([[c('chipAll', { n: list.length })]]),
    children: list.length ? registerTable(ctx, list, { id }) : html`<${Text} tone="muted">${empty}<//>`,
  });
}
function renderCalendar(ctx) {
  return renderPage(ctx, {
    id: 'calendar', crumbs: [c('calendar')], title: c('calendar'),
    children: html`<${SchedulerCalendar} schedules=${ctx.model.all} reloadKey=${ctx.reloadTick} onJumpTo=${(id) => ctx.pickView({ kind: 'detail', id })} />`,
  });
}
