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
 * @structure renderDetail · limitsOf · runRows
 * @usage import { renderDetail } from './detail.js';
 * @version-history
 *   2026-09-22 -- Cancel the schedule is in the danger tone.
 *   2026-09-22 -- Composed from the shared component set (NumeralBand strip, Section, Fold,
 *     KeyValue, ListRow timelines, Surface for the prompt); no own CSS. The cancel door is an
 *     underlined word like the others: the set's danger tone exists only on the primary slab.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { Section, Fold, Stack, ListRow, KeyValue, NumeralBand, Action, Text, Surface } from '/components/poster-parts.js';
import { formatUntil, scheduleIo, describeDispatch } from '../schedule-item.js';
import { cronWordsFor, zoneOf } from './cron-words.js';
import { kindOf, nameOf, dayLabel } from './model.js';
import { ScheduleEditForm } from './edit-form.js';
import { renderPage, whoRuns, resultWord, resultTone, chipRow, railList, c, hhmm } from './frame.js';

function limitsOf(s) {
  const out = [];
  for (const k of s.constraints || []) {
    if (!k || k.enabled === false) continue;
    if (k.type === 'max_runs') out.push(c('limitMax', { n: k.params?.limit ?? '' }));
    if (k.type === 'daily_limit') out.push(c('limitDaily', { n: k.params?.limit ?? '' }));
  }
  return out.length ? out.join(' · ') : c('limitsNone');
}

function runRows(runs) {
  return runs.map((r, i) => {
    const d = new Date(r.createdAt);
    const wrote = (r.memoryWrites || []).length ? `${c('wroteTo')} ${r.memoryWrites.join(', ')}` : (r.taskId ? c('taskCreated') : '');
    return html`<${ListRow} key=${i} density="compact" time=${`${hhmm(d)} ${dayLabel(d)}`} marker=${resultTone(r.result)}
      name=${`${resultWord(r.result)} · ${c('trigger.' + (r.trigger || 'cron'))}${r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)} s` : ''}`}
      detail=${wrote || undefined}>
      ${r.errorMessage ? html`<${Text} kind="caption" tone="danger">${r.errorMessage}<//>` : null}
    <//>`;
  });
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

  // The effective zone, so a schedule that never named one still says which clock its hour
  // belongs to. It was `s.timezone` alone, which is null for anything created without the field
  // and left the chip off exactly where it was most needed.
  const chips = chipRow([
    [s.enabled === false ? t('profile.scheduler.paused') : c('status.running'), s.enabled === false ? 'muted' : 'sun'],
    [cronWordsFor(s)],
    zoneOf(s) && [zoneOf(s), 'muted'],
    [s.cron, 'muted'],
    [whoRuns(s)],
    s.createdByAgent && [t('profile.scheduler.byAgent'), 'sun'],
  ]);

  const doors = s.readOnly ? null : html`
    <${Action} kind="primary" disabled=${busy} onClick=${() => ctx.onTrigger(s)}>${t('profile.scheduler.runNow')}<//>
    <${Action} disabled=${busy} onClick=${() => ctx.onToggle(s)}>${s.enabled === false ? t('profile.scheduler.resume') : t('profile.scheduler.pause')}<//>
    <${Action} onClick=${() => ctx.setEditOpen(v => !v)}>${t('profile.scheduler.edit')}<//>
    <${Action} tone="danger" disabled=${busy} onClick=${() => ctx.onCancel(s)}>${t('profile.scheduler.cancel')}<//>`;

  const strip = html`<${NumeralBand} tone="plain" items=${[
    s.lastRunAt ? { label: c('stripLast'), value: resultWord(s.lastRunResult || 'success'), tone: 'coral',
      note: `${formatRelativeTime(s.lastRunAt)} · ${dayLabel(new Date(s.lastRunAt))} ${hhmm(new Date(s.lastRunAt))}${s.lastRunError ? ` · ${s.lastRunError}` : ''}` }
      : { label: c('stripLast'), value: '·', note: t('profile.scheduler.never') },
    s.enabled === false ? { label: c('stripNextRun'), value: '·', note: t('profile.scheduler.paused') }
      : { label: c('stripNextRun'), value: formatUntil(s.nextRunAt), note: s.nextRunAt ? `${dayLabel(new Date(s.nextRunAt))} ${hhmm(new Date(s.nextRunAt))}` : undefined },
    { label: c('stripRuns'), value: s.runCount ?? 0, note: s.createdAt ? c('sinceDate', { d: fmtDate(s.createdAt) }) : undefined },
    { label: c('stripCreator'), value: s.createdByAgent ? (s.agentName || t('profile.scheduler.byAgent')) : c('byYou'), note: s.createdAt ? fmtDate(s.createdAt) : undefined, tone: 'coral' },
  ]} />`;

  const rail = html`
    ${sameTime.length ? railList(c('railSameTime'), sameTime.map(r => ({ key: r.s.id, label: `${r.times[0]} · ${nameOf(r.s)}`, onClick: () => ctx.pickView({ kind: 'detail', id: r.s.id }) }))) : null}
    ${sameAgent.length ? railList(c('railSameCreator', { a: s.agentName }), [
      ...sameAgent.slice(0, 5).map(x => ({ key: x.id, label: nameOf(x), onClick: () => ctx.pickView({ kind: 'detail', id: x.id }) })),
      ...(sameAgent.length > 5 ? [{ key: 'more', label: c('moreN', { n: sameAgent.length - 5 }) }] : []),
    ]) : null}`;

  const whatLabel = kind === 'ai' ? c('promptLabel') : kind === 'agent' ? c('taskLabel') : kind === 'ext' ? c('actionLabel') : c('secWhat');

  return renderPage(ctx, {
    id: 'detail', crumbs: [nameOf(s)], title: nameOf(s), chips, doors, strip, rail,
    children: html`
      <${Section} id="sc-what" title=${c('secWhat')}>
        <${Stack}>
          ${d.title || d.body ? html`<${Surface} kind="box"><${Stack} density="compact">
            <${Text} kind="label">${whatLabel}<//>
            ${d.title ? html`<${Text} kind="heading">${d.title}<//>` : null}
            ${d.body ? html`<${Text}>${d.body}<//>` : null}
          <//><//>` : null}
          <${Stack} density="compact">
            ${io ? html`<${KeyValue} label=${t('profile.scheduler.reads')} value=${io.reads} mono=${true} /><${KeyValue} label=${t('profile.scheduler.writes')} value=${io.writes} mono=${true} />` : null}
            ${s.purpose ? html`<${KeyValue} label=${c('kPurpose')} value=${s.purpose} />` : null}
            ${s.readOnly ? null : html`<${KeyValue} label=${t('profile.scheduler.constraints')} value=${limitsOf(s)} />`}
            ${s.agentName ? html`<${KeyValue} label=${t('profile.scheduler.col.agent')} value=${s.agentName} />` : null}
            ${s.readOnly ? html`<${KeyValue} label=${t('profile.scheduler.col.extension')} value=${`${s.extensionName}${s.actionId ? ` / ${s.actionId}` : ''} · ${c('readOnlyNote')}`} />` : null}
          <//>
        <//>
      <//>
      <${Section} id="sc-runs" title=${c('secRuns')} count=${runs.length || null}>
        ${runs.length ? runRows(runs) : html`<${Text} tone="muted">${ctx.detail?.loading ? t('profile.scheduler.cal.loading') : c('noRuns')}<//>`}
      <//>
      <${Section} id="sc-coming" title=${c('secComing')}>
        ${coming.length ? coming.map((o, i) => html`<${ListRow} key=${i} density="compact" time=${`${hhmm(o.at)} ${dayLabel(o.at)}`} name=${zoneOf(s)} />`)
          : html`<${Text} tone="muted">${s.enabled === false ? t('profile.scheduler.paused') : (s.nextRunAt ? `${dayLabel(new Date(s.nextRunAt))} ${hhmm(new Date(s.nextRunAt))}` : c('noneNext'))}<//>`}
      <//>
      ${s.readOnly ? null : html`<${Fold} id="sc-edit" number="04" title=${t('profile.scheduler.edit')} sub=${c('editSub')} open=${ctx.editOpen} onToggle=${() => ctx.setEditOpen(v => !v)}>
        <${ScheduleEditForm} schedule=${s} showToast=${ctx.showToast} onSaved=${() => { ctx.setEditOpen(false); ctx.loadData(); }} onClose=${() => ctx.setEditOpen(false)} />
      <//>`}`,
  });
}
