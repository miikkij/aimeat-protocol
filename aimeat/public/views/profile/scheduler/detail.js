/**
 * @file public/views/profile/scheduler/detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One schedule as its own page under the scheduler's crumb: the name, its state and
 *   cadence as chips, the four actions as doors (run now, pause or resume, edit, cancel), a strip
 *   with the last run, the next, the run count and who created it; then what it does (the prompt,
 *   the task or the action, what it reads and writes, the purpose, the limits), the latest runs
 *   from the execution log, what is coming in the next seven days, and the editor as a fold. The
 *   rail lists what fires at the same time and what the same agent created. Every write goes
 *   through the services the old card already called.
 * @structure renderDetail · limitsOf · runDot · runRows
 * @usage import { renderDetail } from './detail.js';
 * @version-history
 *   v1.16.0 -- 2026-09-26 -- Every part is a component that takes data (page group G5): the head's tags are Marks as data (main's grey zone and cron tags come back as the dim Mark, main's og-chip--dim), the doors the Loud and the Action, the strip the FigureStrip, the rail's groups data (the "N more" a plain line), what it sends the JobPrompt, its facts the Facts, a run's result the Status Mark, what is coming the List.
 *   v1.15.0 -- 2026-09-26 -- The runs are the Timeline (components/Timeline.js): the time over its day, a dot for what the run did (an error is trouble, a write is made, a task sent to an agent is the agent's work, the rest is the system), and one line with the result's Status kept before the trigger, the duration, the error and what it wrote or created (a unification: Jouni's decision "Activity log").
 *   v1.14.0 -- 2026-09-26 -- What is coming is the Listing (listing, listing-row, the time and the zone in the words cell; listing--cols keeps the columns), a unification: the look most tabs use. The runs stay: a list of what happened (Jouni's decision "Activity log").
 *   v1.13.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.12.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- What a schedule reads, writes, is for, is limited by and who runs it are the Facts (facts facts--wide, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.9.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.8.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { PageSection } from '/components/PageSection.js';
import { TimelineList, TimelineRow } from '/components/Timeline.js';
import { FoldSection } from '/components/FoldSection.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { Facts } from '/components/Facts.js';
import { List, Row, Cell, Desc } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { JobPrompt } from '/components/JobPrompt.js';
import { formatUntil, scheduleIo, describeDispatch } from '../schedule-item.js';
import { cronWordsFor, zoneOf } from './cron-words.js';
import { kindOf, nameOf, dayLabel } from './model.js';
import { ScheduleEditForm } from './edit-form.js';
import { renderPage, whoRuns, resultWord, resultMark, resultStripTone, c, hhmm } from './frame.js';

function limitsOf(s) {
  const out = [];
  for (const k of s.constraints || []) {
    if (!k || k.enabled === false) continue;
    if (k.type === 'max_runs') out.push(c('limitMax', { n: k.params?.limit ?? '' }));
    if (k.type === 'daily_limit') out.push(c('limitDaily', { n: k.params?.limit ?? '' }));
  }
  return out.length ? out.join(' · ') : c('limitsNone');
}

/**
 * The Timeline's dot for a run (components/Timeline.js categories): an error is trouble, a run that
 * wrote records made something, one that sent a task went to an agent, the rest is the system.
 */
function runDot(r) {
  if (r.result === 'error') return 'trouble';
  if ((r.memoryWrites || []).length) return 'made';
  if (r.taskId) return 'agent';
  return 'system';
}

function runRows(runs) {
  return html`<${TimelineList}>${runs.map((r, i) => {
    const d = new Date(r.createdAt);
    const writes = r.memoryWrites || [];
    const did = writes.length ? ` · ${c('wroteTo')} ${writes.join(', ')}` : (r.taskId ? ` · ${c('taskCreated')}` : '');
    return html`<${TimelineRow} key=${i} category=${runDot(r)} when=${html`${hhmm(d)}<br />${dayLabel(d)}`}
      text=${html`${resultMark(r.result)} · ${c('trigger.' + (r.trigger || 'cron'))}${r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)} s` : ''}${r.errorMessage ? `: ${r.errorMessage}` : ''}${did}`} />`;
  })}<//>`;
}

export function renderDetail(ctx, s) {
  const m = ctx.model;
  const d = describeDispatch(s);
  const io = scheduleIo(s, t);
  const kind = kindOf(s);
  const busy = ctx.busy;
  const coming = m.occ.filter(o => o.s.id === s.id && o.at.getTime() >= Date.now()).slice(0, 5);
  const myRow = m.rhythm.find(r => r.s.id === s.id);
  const sameTime = myRow ? m.rhythm.filter(r => r.s.id !== s.id && r.times[0] === myRow.times[0]).slice(0, 4) : [];
  const sameAgent = s.agentName ? m.all.filter(x => x.id !== s.id && x.agentName === s.agentName) : [];
  const runs = ctx.detail?.id === s.id ? (ctx.detail.runs || []) : [];
  const last = s.lastRunResult || 'success';

  const marks = [
    { label: s.enabled === false ? t('profile.scheduler.paused') : c('status.running'), kind: 'status', tone: s.enabled === false ? 'attention' : 'fine' },
    { label: cronWordsFor(s) },
    // The effective zone, so a schedule that never named one still says which clock its hour
    // belongs to. It was `s.timezone` alone, which is null for anything created without the
    // field and left the chip off exactly where it was most needed.
    zoneOf(s) ? { label: zoneOf(s), tone: 'dim' } : null,
    { label: s.cron, tone: 'dim' },
    { label: whoRuns(s) },
    s.createdByAgent ? { label: t('profile.scheduler.byAgent'), tone: 'coral' } : null,
  ];

  const doors = s.readOnly ? null : html`
    <${Loud} control disabled=${busy} onClick=${() => ctx.onTrigger(s)}>${t('profile.scheduler.runNow')}<//>
    <${Action} small disabled=${busy} onClick=${() => ctx.onToggle(s)}>${s.enabled === false ? t('profile.scheduler.resume') : t('profile.scheduler.pause')}<//>
    <${Action} small onClick=${() => ctx.setEditOpen(v => !v)}>${t('profile.scheduler.edit')}<//>
    <${Action} small tone="danger" disabled=${busy} onClick=${() => ctx.onCancel(s)}>${t('profile.scheduler.cancel')}<//>`;

  const strip = html`<${FigureStrip} items=${[
    s.lastRunAt
      ? { key: 'last', n: resultWord(last), tone: resultStripTone(last), label: c('stripLast'), sub: `${formatRelativeTime(s.lastRunAt)} · ${dayLabel(new Date(s.lastRunAt))} ${hhmm(new Date(s.lastRunAt))}${s.lastRunError ? ` · ${s.lastRunError}` : ''}` }
      : { key: 'last', n: '·', label: c('stripLast'), sub: t('profile.scheduler.never') },
    s.enabled === false
      ? { key: 'next', n: '·', label: c('stripNextRun'), sub: t('profile.scheduler.paused') }
      : { key: 'next', n: formatUntil(s.nextRunAt), label: c('stripNextRun'), sub: s.nextRunAt ? `${dayLabel(new Date(s.nextRunAt))} ${hhmm(new Date(s.nextRunAt))}` : '' },
    { key: 'runs', n: s.runCount ?? 0, label: c('stripRuns'), sub: s.createdAt ? c('sinceDate', { d: fmtDate(s.createdAt) }) : '' },
    { key: 'creator', n: s.createdByAgent ? (s.agentName || t('profile.scheduler.byAgent')) : c('byYou'), tone: 'coral', label: c('stripCreator'), sub: s.createdAt ? fmtDate(s.createdAt) : '' },
  ]} />`;

  const railGroups = [
    sameTime.length ? { label: c('railSameTime'), items: sameTime.map(r => ({ key: r.s.id, mark: r.times[0], label: nameOf(r.s), onClick: () => ctx.pickView({ kind: 'detail', id: r.s.id }) })) } : null,
    sameAgent.length ? { label: c('railSameCreator', { a: s.agentName }), items: [
      ...sameAgent.slice(0, 5).map(x => ({ key: x.id, mark: '→', label: nameOf(x), onClick: () => ctx.pickView({ kind: 'detail', id: x.id }) })),
      sameAgent.length > 5 ? { key: 'more', plain: true, mark: '·', label: c('moreN', { n: sameAgent.length - 5 }) } : null,
    ] } : null,
  ].filter(Boolean);

  const whatLabel = kind === 'ai' ? c('promptLabel') : kind === 'agent' ? c('taskLabel') : kind === 'ext' ? c('actionLabel') : c('secWhat');

  return renderPage(ctx, {
    id: 'detail', crumbs: [nameOf(s)], title: nameOf(s), marks, doors, strip, railGroups,
    children: html`
      <${PageSection} id="sc-what" num="01" title=${c('secWhat')} first=${true}>
        <${JobPrompt} label=${whatLabel} title=${d.title} body=${d.body} />
        <${Facts} wide rows=${[
          io && { k: t('profile.scheduler.reads'), v: io.reads, mono: true },
          io && { k: t('profile.scheduler.writes'), v: io.writes, mono: true },
          s.purpose && { k: c('kPurpose'), v: s.purpose },
          !s.readOnly && { k: t('profile.scheduler.constraints'), v: limitsOf(s) },
          s.agentName && { k: t('profile.scheduler.col.agent'), v: s.agentName },
          s.readOnly && { k: t('profile.scheduler.col.extension'), v: `${s.extensionName}${s.actionId ? ` / ${s.actionId}` : ''} · ${c('readOnlyNote')}` },
        ]} />
      <//>
      <${PageSection} id="sc-runs" num="02" title=${c('secRuns')} count=${runs.length || null}>
        ${runs.length ? runRows(runs) : ctx.detail?.loading ? html`<${Note} kind="loading">${t('profile.scheduler.cal.loading')}<//>` : html`<${Note} kind="quiet">${c('noRuns')}<//>`}
      <//>
      <${PageSection} id="sc-coming" num="03" title=${c('secComing')}>
        ${coming.length ? html`<${List} cols="when-words" keepCols>
          ${coming.map((o, i) => html`<${Row} key=${i}><${Cell}><${Figure} small n=${hhmm(o.at)} sub=${dayLabel(o.at)} /><//><${Desc}>${zoneOf(s)}<//><//>`)}
        <//>` : html`<${Note} kind="quiet">${s.enabled === false ? t('profile.scheduler.paused') : (s.nextRunAt ? `${dayLabel(new Date(s.nextRunAt))} ${hhmm(new Date(s.nextRunAt))}` : c('noneNext'))}<//>`}
      <//>
      ${s.readOnly ? null : html`<${FoldSection} id="sc-edit" num="04" title=${t('profile.scheduler.edit')} sub=${c('editSub')} open=${ctx.editOpen} onToggle=${() => ctx.setEditOpen(v => !v)}>
        <${ScheduleEditForm} schedule=${s} showToast=${ctx.showToast} onSaved=${() => { ctx.setEditOpen(false); ctx.loadData(); }} onClose=${() => ctx.setEditOpen(false)} />
      <//>`}`,
  });
}
