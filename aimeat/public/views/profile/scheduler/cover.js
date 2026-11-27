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
 *   Pure render functions over the ctx bag scheduler-tab.js assembles; every part is a component
 *   that takes data (the page writes no class). How the page explains itself
 *   (.claude/rules/page-guidance.md): PageStart "scheduler" under the head, on the empty cover too,
 *   and the title's question mark concept.schedule.
 * @structure renderSchedulerView · renderCover · secNext · secRhythm · secContinuous · secRare · secAll · secAgents · registerTable · pages
 * @usage import { renderSchedulerView } from './scheduler/cover.js';
 * @version-history
 *   v1.25.0 -- 2026-11-27 -- The person's schedules (sc-all, the register) are section 01, a schedule whose last run
 *     failed at its top; what fires next, the week's rhythm and the rest follow, numbered after the filter. The
 *     continuous and the rarer schedules are FoldSection rows that say how many (or how many failed, or when the next
 *     runs) and open in place, numbered as parts of the rhythm ("03.1", "03.2") while it is drawn. The failed figure is
 *     in the notice tone and opens the failed list; the strip has hideZeros for a page with only the agents' reported
 *     times; the head keeps only the paused and agent-made tags. The register's search and filter wait for a first
 *     schedule; a search that finds nothing says so. An agent's reported job state is in the reader's words where the
 *     page has one. The empty cover (no schedule, no reported time) is unchanged. No control was removed.
 *   v1.24.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md): PageStart under the head (folded once a schedule exists, its button the new-schedule form) and the title's question mark concept.schedule, on the empty cover as on the full one.
 *   v1.23.0 -- 2026-11-01 -- With no schedule at all the page is one sentence (cover.descEmpty) and the two ways on, without the "Seuraavaksi 01" section that repeated it (Jouni's review of v33, K53).
 *   v1.22.0 -- 2026-10-31 -- With no schedule at all the cover is the explanation, "Tee ensimmäinen agentti →" (to the Home's new-agent page) with "tai tee ajastus itse", and the one empty line: no strip, tags, filters or side panel (Jouni's review of v31, K53-K55). "Ei vielä hallinnoituja ajastuksia" reads "Sinulla ei ole vielä ajastuksia".
 *   v1.21.0 -- 2026-10-31 -- The week's rhythm, the continuous ones, the rarer ones and the agents' reported times are drawn only when they hold something (v31 K54); with no schedule at all, "next up" says where an approved agent's run will appear (K53); the head says in plain words what the page is (K55).
 *   v1.20.0 -- 2026-09-26 -- Every part is a component that takes data (page group G5): the page frame is the SettingsPage, the strip the FigureStrip, the lists the List (the time a Figure, the countdown the Num's sign, the long words clipped), the week's rhythm the WeekRhythm, the continuous jobs the JobChips, the search the SearchLine, "show more" the More, the doors the Tab's fold tone. Main's grey tags come back: the paused count, and the failed count while it is 0, are the dim Mark (main's og-chip--dim).
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
import { SettingsPage } from '/components/SettingsPage.js';
import { PageStart } from '/components/PageStart.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { List, Row, Name, Desc, Who, Num, When, Cell, Doors, Group, SearchLine, More } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tab } from '/components/Tabs.js';
import { WeekRhythm } from '/components/WeekRhythm.js';
import { JobChips } from '/components/JobChips.js';
import SchedulerCalendar from '../scheduler-calendar.js';
import { formatUntil } from '../schedule-item.js';
import { cronWords, cronWordsFor } from './cron-words.js';
import { kindOf, nameOf, dayLabel } from './model.js';
import { CreateForm } from './create-form.js';
import { renderDetail } from './detail.js';
import { c, hhmm, whoRuns, resultWord, resultStripTone, lastRun, crumb, pageLinks, renderPage } from './frame.js';
import { Hint } from '/components/Hint.js';

const AGENDA_ROWS = 6;
const TABLE_ROWS = 12;
const open = (ctx, s) => () => ctx.pickView({ kind: 'detail', id: s.id });
/** A line that says a part is empty, or loading while it loads. */
const emptyOr = (loading, words) => (loading ? html`<${Note} kind="loading">${t('profile.scheduler.cal.loading')}<//>` : html`<${Note} kind="quiet">${words}<//>`);

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
  const tag = (n, key, tone) => ({ label: c(key, { n }), tone });
  // An empty section is not drawn: three headings with "nothing here" under them read as a page
  // that does not work (v31 K54). Each comes back the moment it has a run; while the runs load they
  // all stand, so the page does not jump.
  const shown = {
    rhythm: ctx.occLoading || m.rhythm.length > 0,
    cont: ctx.occLoading || m.continuous.length > 0,
    rare: ctx.occLoading || m.rare.length > 0,
    agents: ctx.internal.length > 0,
  };
  const latest = m.latest ? (m.latest.lastRunResult || 'success') : null;
  // hideZeros: with only the agents' own reported times and no schedule here, every figure is zero
  // or "·", and the strip is not drawn. A failed schedule is the figure that needs the person: it is
  // in the notice tone and opens the list of failed schedules.
  const strip = html`<${FigureStrip} hideZeros items=${[
    m.next
      ? { key: 'next', n: hhmm(m.next.at), label: c('stripNext'), sub: `${nameOf(m.next.s)} · ${dayLabel(m.next.at)} · ${formatUntil(m.next.at.toISOString())}` }
      : { key: 'next', n: '·', label: c('stripNext'), sub: c('stripNextNone') },
    { key: 'today', n: m.todayLeft, label: c('stripToday'), sub: c('stripTodaySub') },
    m.latest
      ? { key: 'latest', n: resultWord(latest), tone: resultStripTone(latest), label: c('stripLatest'), sub: `${nameOf(m.latest)} · ${formatRelativeTime(m.latest.lastRunAt)}` }
      : { key: 'latest', n: '·', label: c('stripLatest'), sub: t('profile.scheduler.never') },
    { key: 'failed', n: m.failed.length, tone: m.failed.length ? 'notice' : undefined, label: c('stripFailed'), sub: c('stripFailedSub'),
      onClick: m.failed.length ? () => ctx.pickView({ kind: 'page', id: 'failed' }) : undefined },
  ]} />`;

  // The start (page-guidance.md): folded once a schedule exists; its button is this page's own form.
  const start = html`<${PageStart} id="scheduler" done=${m.all.length > 0}
    action=${{ onClick: () => ctx.pickView({ kind: 'page', id: 'create' }) }} />`;

  // With no schedule at all the page is its explanation and one way on: no counters, tags, filters
  // or side panel, which would only count zeros (Jouni's review of v31, K53-K55).
  if (!ctx.occLoading && m.all.length === 0 && ctx.internal.length === 0) {
    // One sentence and the two ways on; the "Seuraavaksi 01" section only repeated it (review of v33).
    return html`<${SettingsPage} name="sc" crumb=${crumb(ctx, [])} title=${t('profile.scheduler.title')} help="concept.schedule"
      desc=${c('descEmpty')} start=${start}
      actions=${html`
        <${Loud} href="/v1/home?new-agent=1">${c('firstAgent')}<//>
        <${Actions}><${Action} small onClick=${() => ctx.pickView({ kind: 'page', id: 'create' })}>${c('orSchedule')}<//><//>`}
      strip=${ctx.error ? html`<${Note} kind="message" error>${ctx.error}<//>` : null} />`;
  }

  // What is drawn, in this order: the person's schedules first (the register, a failed one at its
  // top), then what fires next once there is a schedule, the week's rhythm, and as rows that open in
  // place the continuous and the rarer schedules (parts of the rhythm, "03.1" and "03.2", while it is
  // drawn) and the times the agents report. Numbered after the filter, so a hidden section leaves no gap.
  const parts = [
    { id: 'sc-all', label: c('secAll'), count: m.all.length },
    (ctx.occLoading || m.all.length > 0) && { id: 'sc-next', label: c('secNext'), count: m.agenda.length },
    shown.rhythm && { id: 'sc-rhythm', label: c('secRhythm'), count: m.rhythm.length },
    shown.cont && { id: 'sc-cont', label: c('secCont'), count: m.continuous.length, part: shown.rhythm },
    shown.rare && { id: 'sc-rare', label: c('secRare'), count: m.rare.length, part: shown.rhythm },
    shown.agents && { id: 'sc-agents', label: c('secAgents'), count: ctx.internal.length },
  ].filter(Boolean);
  let whole = 0, sub = 0;
  const sections = parts.map(({ part, ...s }) => {
    if (part) { sub += 1; return { ...s, num: `${String(whole).padStart(2, '0')}.${sub}` }; }
    whole += 1; sub = 0;
    return { ...s, num: String(whole).padStart(2, '0') };
  });
  const numOf = Object.fromEntries(sections.map((s) => [s.id, s.num]));

  return html`<${SettingsPage} name="sc" crumb=${crumb(ctx, [])} title=${t('profile.scheduler.title')} help="concept.schedule"
    start=${start}
    marks=${[
      // The counts the strip and the sections say are not repeated as tags; paused and agent-made stay.
      m.paused.length ? tag(m.paused.length, 'chipPaused', 'dim') : null,
      m.agentMade ? tag(m.agentMade, 'chipAgent') : null,
    ]}
    desc=${c('desc')}
    actions=${html`
      <${Loud} onClick=${() => ctx.pickView({ kind: 'page', id: 'create' })}>${t('profile.scheduler.newSchedule')}<//>
      <${Actions}><${Action} small onClick=${() => ctx.pickView({ kind: 'page', id: 'calendar' })}>${c('calendar')}<//><//>`}
    strip=${html`${ctx.error ? html`<${Note} kind="message" error>${ctx.error}<//>` : null}${strip}`}
    railTitle=${c('railTitle')}
    sections=${sections.length > 1 ? sections : undefined}
    pagesLabel=${c('pages')} pages=${pageLinks(ctx, null)}>
      ${secAll(ctx, numOf['sc-all'])}
      ${numOf['sc-next'] ? secNext(ctx, numOf['sc-next']) : null}
      ${numOf['sc-rhythm'] ? secRhythm(ctx, numOf['sc-rhythm']) : null}
      ${numOf['sc-cont'] ? secContinuous(ctx, numOf['sc-cont']) : null}
      ${numOf['sc-rare'] ? secRare(ctx, numOf['sc-rare']) : null}
      ${numOf['sc-agents'] ? secAgents(ctx, numOf['sc-agents']) : null}
  <//>`;
}

/* ── 01 What fires next ────────────────────────────────────────────────────────────────────── */
function agendaRows(ctx, list) {
  const nowMs = Date.now();
  return html`<${List} cols="when-name-who-in" keepCols>
    ${list.map((o, i) => html`
      <${Row} key=${i}>
        <${Cell}><${Figure} small n=${hhmm(o.at)} sub=${dayLabel(o.at)} /><//>
        <${Name} onOpen=${open(ctx, o.s)} clip meta=${`${cronWordsFor(o.s)}${o.s.purpose ? ` · ${o.s.purpose}` : ''}`}>${nameOf(o.s)}<//>
        <${Who} clip>${whoRuns(o.s)}<//>
        <${Num} sign>${o.at.getTime() > nowMs ? formatUntil(o.at.toISOString()) : ''}<//>
      <//>`)}
  <//>`;
}
function secNext(ctx, n) {
  const list = ctx.nextOpen ? ctx.model.agenda : ctx.model.agenda.slice(0, AGENDA_ROWS);
  const doors = ctx.model.agenda.length > AGENDA_ROWS
    ? html`<${Action} tone="more" onClick=${() => ctx.setNextOpen(v => !v)}>${ctx.nextOpen ? c('showFewer') : c('showAllComing', { n: ctx.model.agenda.length })}<//>` : null;
  return html`<${PageSection} id="sc-next" num=${n} title=${c('secNext')} count=${ctx.model.next ? dayLabel(ctx.model.next.at) : null} doors=${doors}>
    ${list.length ? agendaRows(ctx, list) : emptyOr(ctx.occLoading, ctx.model.all.length ? c('noneNext') : c('emptyAll'))}
  <//>`;
}

/* ── 02 The week's rhythm ──────────────────────────────────────────────────────────────────── */
function secRhythm(ctx, n) {
  const m = ctx.model;
  const rows = ctx.rhythmSort === 'name' ? [...m.rhythm].sort((a, b) => nameOf(a.s).localeCompare(nameOf(b.s))) : m.rhythm;
  const doors = html`
    <${Tab} tone="fold" on=${ctx.rhythmSort === 'time'} onClick=${() => ctx.setRhythmSort('time')}>${c('byTime')}<//>
    <${Tab} tone="fold" on=${ctx.rhythmSort === 'name'} onClick=${() => ctx.setRhythmSort('name')}>${c('byName')}<//>`;
  // `times` are MINUTES past midnight in the reader's own zone — a number, because that is what
  // sorts. They are a WALL CLOCK rather than an instant, so they are written out as one: anchored
  // in UTC and formatted in UTC, which leaves the digits alone and still gives the reader their own
  // 12- or 24-hour face. The short form names the hours only, which is what the column has room for.
  const wall = (mins) => new Date(Date.UTC(2024, 0, 1, Math.floor(mins / 60), mins % 60));
  const clockOf = (mins) => fmtTime(wall(mins), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const hourOf = (mins) => fmtTime(wall(mins), { hour: '2-digit', timeZone: 'UTC' });
  const timeLabel = (r) => (r.times.length === 1 ? clockOf(r.times[0]) : r.times.length <= 3 ? r.times.map(hourOf).join(' · ') : c('timesN', { n: r.times.length }));
  return html`<${PageSection} id="sc-rhythm" num=${n} title=${c('secRhythm')} count=${c('secRhythmSub', { n: m.rhythm.length })} doors=${doors}>
    ${rows.length ? html`
      <${WeekRhythm} heads=${{ time: c('colTime'), name: c('colSchedule'), last: c('colLast') }}
        days=${m.days.map((d, i) => ({ key: i, label: calendar(d, { weekday: 'short' }), sub: d.getDate(), today: i === 0 }))}
        rows=${rows.map(r => ({ key: r.s.id, time: timeLabel(r), name: nameOf(r.s), onOpen: open(ctx, r.s), note: cronWordsFor(r.s),
          days: r.days, agent: kindOf(r.s) === 'agent', last: lastRun(r.s) }))} />
      ${/* A column IS a calendar day, so it is written as one: calendar() cannot be slid into the
            day before by a reader whose clock sits west of the browser's. */''}
      <${Hint}>${c('rhythmHint')}<//>` : emptyOr(ctx.occLoading, c('noneRhythm'))}
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
/** One row that says how many run continuously, or how many of them failed, and opens in place. */
function secContinuous(ctx, n) {
  const list = ctx.model.continuous;
  const failed = list.filter(f => f.s.lastRunResult === 'error').length;
  const sub = ctx.occLoading ? t('profile.scheduler.cal.loading') : failed ? c('chipFailed', { n: failed }) : c('secContSub', { n: list.length });
  return html`<${FoldSection} id="sc-cont" num=${n} title=${c('secCont')} sub=${sub} open=${ctx.contOpen} onToggle=${() => ctx.setContOpen(v => !v)}>
    ${list.length ? html`<${JobChips} items=${list.map(f => ({
      key: f.scheduleId, name: nameOf(f.s), warn: f.s.lastRunResult === 'error', onOpen: open(ctx, f.s),
      note: `${cadence(f)} · ${t('profile.scheduler.cal.perDay', { n: f.approxPerDay })}${f.s.runCount ? ` · ${c('runsN', { n: fmtNum(Number(f.s.runCount)) })}` : ''}`,
    }))} />` : html`<${Note} kind="quiet">${c('noneCont')}<//>`}
  <//>`;
}

/* ── 04 Less often ─────────────────────────────────────────────────────────────────────────── */
/** One row that says how many run less often than weekly and when the next of them runs; opens in place. */
function secRare(ctx, n) {
  const list = ctx.model.rare;
  const sub = ctx.occLoading ? t('profile.scheduler.cal.loading')
    : list.length ? c('rareSub', { n: list.length, d: fmtDate(new Date(list[0].nextRunAt), { day: 'numeric', month: 'numeric' }) }) : c('secRareSub');
  return html`<${FoldSection} id="sc-rare" num=${n} title=${c('secRare')} sub=${sub} open=${ctx.rareOpen} onToggle=${() => ctx.setRareOpen(v => !v)}>
    <${List} cols="when-name-who-in" keepCols empty=${c('noneRare')}>
      ${list.map(s => { const d = new Date(s.nextRunAt); return html`
        <${Row} key=${s.id}>
          <${Cell}><${Figure} small n=${fmtDate(d, { day: 'numeric', month: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })} sub=${`${fmtDate(d, { weekday: 'short' })} ${hhmm(d)}`} /><//>
          <${Name} onOpen=${open(ctx, s)} clip meta=${cronWordsFor(s)}>${nameOf(s)}<//>
          <${Who} clip>${whoRuns(s)}<//>
          <${Num} sign>${formatUntil(s.nextRunAt)}<//>
        <//>`; })}
    <//>
  <//>`;
}

/* ── 05 The register ───────────────────────────────────────────────────────────────────────── */
export function registerTable(ctx, list, { id = 'reg', head = true } = {}) {
  const isOpen = ctx.moreOpen.has(id);
  const shown = isOpen ? list : list.slice(0, TABLE_ROWS);
  return html`
    <${List} cols="name-when-who-last-n-doors" keepCols
      head=${head ? [c('colSchedule'), c('colWhen'), c('colWho'), c('colLast'), t('profile.scheduler.col.runs'), ''] : null}>
      ${shown.map(s => html`
        <${Row} key=${s.id}>
          <${Name} onOpen=${open(ctx, s)} after=${s.enabled === false ? html`<${Mark} kind="status" tone="attention">${t('profile.scheduler.paused')}<//>` : null}>${nameOf(s)}<//>
          <${Desc} clip>${cronWordsFor(s)}<//>
          <${Who} clip>${whoRuns(s)}<//>
          <${When} clip>${lastRun(s)}<//>
          <${Num}><${Figure} small n=${s.runCount ?? 0} /><//>
          <${Doors}><${Action} small row onClick=${open(ctx, s)}>${c('open')}<//><//>
        <//>`)}
    <//>
    ${list.length > TABLE_ROWS ? html`<${More} label=${isOpen ? c('showFewer') : c('showRest', { n: list.length - TABLE_ROWS })} onMore=${() => ctx.toggleMore(id)} />` : null}`;
}
/**
 * The person's schedules, section 01: every schedule with its rhythm, who runs it and how its last
 * run went. A schedule whose last run failed comes first (then by name), so the row that needs the
 * person is the first one they meet.
 */
function secAll(ctx, n) {
  const m = ctx.model;
  const q = ctx.regQuery.trim().toLowerCase();
  const failedFirst = (a, b) => ((a.lastRunResult === 'error' ? 0 : 1) - (b.lastRunResult === 'error' ? 0 : 1)) || nameOf(a).localeCompare(nameOf(b));
  let list = [...m.all].sort(failedFirst);
  if (ctx.regFilter === 'agents') list = list.filter(s => s.createdByAgent || kindOf(s) === 'agent');
  if (q) list = list.filter(s => nameOf(s).toLowerCase().includes(q) || (s.agentName || '').toLowerCase().includes(q));
  // With no schedule here the search and the agents' filter have nothing to work on and are not drawn.
  const doors = m.all.length ? html`
    <${Tab} tone="fold" on=${ctx.showSearch} pressed=${ctx.showSearch} onClick=${() => ctx.setShowSearch(v => !v)}>${c('searchName')}<//>
    <${Tab} tone="fold" on=${ctx.regFilter === 'agents'} onClick=${() => ctx.setRegFilter(f => (f === 'agents' ? 'all' : 'agents'))}>${c('agentsOnly')}<//>` : null;
  return html`<${PageSection} id="sc-all" num=${n} title=${c('secAll')} count=${list.length} doors=${doors} first=${true}>
    ${ctx.showSearch && m.all.length ? html`<${SearchLine} value=${ctx.regQuery} onInput=${e => ctx.setRegQuery(e.target.value)} placeholder=${c('searchName')} />` : null}
    ${list.length ? registerTable(ctx, list) : html`<${Note} kind="quiet">${m.all.length ? c('noneMatch') : t('profile.scheduler.noManaged')}<//>`}
  <//>`;
}

/* ── 06 The agents' own ────────────────────────────────────────────────────────────────────── */
/** An agent's own word for a job's state, in the reader's words where the page has one, else as the agent wrote it. */
const agentState = (s) => { const v = s || 'active'; const k = `profile.scheduler.cover.agentState.${v}`; const w = t(k); return w === k ? v : w; };
function secAgents(ctx, n) {
  const groups = ctx.internal;
  return html`<${FoldSection} id="sc-agents" num=${n} title=${c('secAgents')} sub=${c('secAgentsSub', { n: groups.length })} open=${ctx.agentsOpen} onToggle=${() => ctx.setAgentsOpen(v => !v)}>
    <${Hint}>${t('profile.scheduler.internalNote')}<//>
    ${groups.length ? groups.map(grp => html`<${Group} key=${grp.gaii} title=${grp.agentName}>
      <${List} cols="name-when-state" keepCols>
        ${grp.entries.map((e, i) => html`
          <${Row} key=${i}>
            <${Name} clip meta=${e.purpose || null}>${e.name}<//>
            <${Desc} clip>${cronWords(e.cron || e.schedule || '')}${e.timezone ? ` · ${e.timezone}` : ''}<//>
            <${Desc} clip>${agentState(e.status)}<//>
          <//>`)}
      <//>
    <//>`) : html`<${Note} kind="quiet">${t('profile.scheduler.noInternal')}<//>`}
  <//>`;
}

/* ── Pages ─────────────────────────────────────────────────────────────────────────────────── */
function renderCreate(ctx) {
  return renderPage(ctx, {
    id: 'create', crumbs: [t('profile.scheduler.newSchedule')], title: t('profile.scheduler.newSchedule'), desc: c('createDesc'),
    children: html`
      <${CreateForm} agents=${ctx.agents} showToast=${ctx.showToast} onCancel=${() => ctx.pickView({ kind: 'cover' })}
        onCreated=${() => { ctx.pickView({ kind: 'cover' }); ctx.loadData(); }} />`,
  });
}
function renderList(ctx, id, title, list, empty) {
  return renderPage(ctx, {
    id, crumbs: [title], title,
    marks: [{ label: c('chipAll', { n: list.length }) }],
    children: list.length ? registerTable(ctx, list, { id }) : html`<${Note} kind="quiet">${empty}<//>`,
  });
}
function renderCalendar(ctx) {
  return renderPage(ctx, {
    id: 'calendar', crumbs: [c('calendar')], title: c('calendar'),
    children: html`<${SchedulerCalendar} schedules=${ctx.model.all} reloadKey=${ctx.reloadTick} onJumpTo=${(id) => ctx.pickView({ kind: 'detail', id })} />`,
  });
}
