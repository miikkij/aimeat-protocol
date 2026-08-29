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
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { Section, Fold } from '/views/profile/organisms/poster-parts.js';
import { formatUntil, scheduleIo, describeDispatch } from '../schedule-item.js';
import { cronWords } from './cron-words.js';
import { kindOf, nameOf, dayLabel } from './model.js';
import { ScheduleEditForm } from './edit-form.js';
import { renderPage, whoRuns, resultWord, c, loc, hhmm } from './frame.js';

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
  return html`<div class="sc-agenda sc-agenda--runs">
    ${runs.map((r, i) => { const d = new Date(r.createdAt); return html`
      <div class="sc-at" key=${'a' + i}>${hhmm(d)}<small>${dayLabel(d, loc())}</small></div>
      <div class="sc-nm sc-nm--run" key=${'n' + i}>
        <b class=${`sc-res sc-res--${r.result}`}>${resultWord(r.result)}</b> · ${c('trigger.' + (r.trigger || 'cron'))}${r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)} s` : ''}
        ${r.errorMessage ? html`<small class="sc-err">${r.errorMessage}</small>` : null}
      </div>
      <div class="sc-who" key=${'w' + i}>${(r.memoryWrites || []).length ? html`${c('wroteTo')} ${r.memoryWrites.join(', ')}` : (r.taskId ? c('taskCreated') : '')}</div>
      <div class="sc-in" key=${'i' + i}></div>`; })}
  </div>`;
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

  const chips = html`
    <span class=${`og-chip ${s.enabled === false ? 'og-chip--dim' : 'og-chip--sun'}`}>${s.enabled === false ? t('profile.scheduler.paused') : c('status.running')}</span>
    <span class="og-chip">${cronWords(s.cron)}</span>
    ${s.timezone ? html`<span class="og-chip og-chip--dim sc-chip--mono">${s.timezone}</span>` : null}
    <span class="og-chip og-chip--dim sc-chip--mono">${s.cron}</span>
    <span class="og-chip">${whoRuns(s)}</span>
    ${s.createdByAgent ? html`<span class="og-chip og-chip--coral">${t('profile.scheduler.byAgent')}</span>` : null}`;

  const doors = s.readOnly ? null : html`
    <button type="button" class="og-slab" disabled=${busy} onClick=${() => ctx.onTrigger(s)}>${t('profile.scheduler.runNow')}</button>
    <button type="button" class="og-door" disabled=${busy} onClick=${() => ctx.onToggle(s)}>${s.enabled === false ? t('profile.scheduler.resume') : t('profile.scheduler.pause')}</button>
    <button type="button" class="og-door" onClick=${() => ctx.setEditOpen(v => !v)}>${t('profile.scheduler.edit')}</button>
    <button type="button" class="og-door og-door--danger" disabled=${busy} onClick=${() => ctx.onCancel(s)}>${t('profile.scheduler.cancel')}</button>`;

  const strip = html`
    <div class="og-strip">
      <div>${s.lastRunAt
        ? html`<b class=${`og-strip-coral sc-res--${s.lastRunResult || 'success'}`}>${resultWord(s.lastRunResult || 'success')}</b><span>${c('stripLast')}</span><small>${formatRelativeTime(s.lastRunAt)} · ${dayLabel(new Date(s.lastRunAt), loc())} ${hhmm(new Date(s.lastRunAt))}${s.lastRunError ? ` · ${s.lastRunError}` : ''}</small>`
        : html`<b>·</b><span>${c('stripLast')}</span><small>${t('profile.scheduler.never')}</small>`}</div>
      <div>${s.enabled === false
        ? html`<b>·</b><span>${c('stripNextRun')}</span><small>${t('profile.scheduler.paused')}</small>`
        : html`<b>${formatUntil(s.nextRunAt)}</b><span>${c('stripNextRun')}</span><small>${s.nextRunAt ? `${dayLabel(new Date(s.nextRunAt), loc())} ${hhmm(new Date(s.nextRunAt))}` : ''}</small>`}</div>
      <div><b>${s.runCount ?? 0}</b><span>${c('stripRuns')}</span><small>${s.createdAt ? c('sinceDate', { d: new Date(s.createdAt).toLocaleDateString(loc()) }) : ''}</small></div>
      <div><b class="og-strip-coral">${s.createdByAgent ? (s.agentName || t('profile.scheduler.byAgent')) : c('byYou')}</b><span>${c('stripCreator')}</span><small>${s.createdAt ? new Date(s.createdAt).toLocaleDateString(loc()) : ''}</small></div>
    </div>`;

  const rail = html`
    ${sameTime.length ? html`<hr /><span class="og-rail-label">${c('railSameTime')}</span>
      ${sameTime.map(r => html`<button type="button" class="og-rail-link" key=${r.s.id} onClick=${() => ctx.pickView({ kind: 'detail', id: r.s.id })}><i>${r.times[0]}</i>${nameOf(r.s)}</button>`)}` : null}
    ${sameAgent.length ? html`<hr /><span class="og-rail-label">${c('railSameCreator', { a: s.agentName })}</span>
      ${sameAgent.slice(0, 5).map(x => html`<button type="button" class="og-rail-link" key=${x.id} onClick=${() => ctx.pickView({ kind: 'detail', id: x.id })}><i>→</i>${nameOf(x)}</button>`)}
      ${sameAgent.length > 5 ? html`<span class="og-rail-link"><i>·</i>${c('moreN', { n: sameAgent.length - 5 })}</span>` : null}` : null}`;

  const whatLabel = kind === 'ai' ? c('promptLabel') : kind === 'agent' ? c('taskLabel') : kind === 'ext' ? c('actionLabel') : c('secWhat');

  return renderPage(ctx, {
    id: 'detail', crumbs: [nameOf(s)], title: nameOf(s), chips, doors, strip, rail,
    children: html`
      <${Section} id="sc-what" num="01" title=${c('secWhat')} first=${true}>
        ${d.title || d.body ? html`<div class="sc-prompt"><span class="og-label">${whatLabel}</span>${d.title ? html`<div class="sc-prompt-title">${d.title}</div>` : null}${d.body ? html`<div class="sc-prompt-body">${d.body}</div>` : null}</div>` : null}
        <div class="sc-kv">
          ${io ? html`<div class="k">${t('profile.scheduler.reads')}</div><div><code>${io.reads}</code></div><div class="k">${t('profile.scheduler.writes')}</div><div><code>${io.writes}</code></div>` : null}
          ${s.purpose ? html`<div class="k">${c('kPurpose')}</div><div>${s.purpose}</div>` : null}
          ${s.readOnly ? null : html`<div class="k">${t('profile.scheduler.constraints')}</div><div>${limitsOf(s)}</div>`}
          ${s.agentName ? html`<div class="k">${t('profile.scheduler.col.agent')}</div><div>${s.agentName}</div>` : null}
          ${s.readOnly ? html`<div class="k">${t('profile.scheduler.col.extension')}</div><div>${s.extensionName}${s.actionId ? ` / ${s.actionId}` : ''} · ${c('readOnlyNote')}</div>` : null}
        </div>
      <//>
      <${Section} id="sc-runs" num="02" title=${c('secRuns')} count=${runs.length || null}>
        ${runs.length ? runRows(runs) : html`<p class="og-empty">${ctx.detail?.loading ? t('profile.scheduler.cal.loading') : c('noRuns')}</p>`}
      <//>
      <${Section} id="sc-coming" num="03" title=${c('secComing')}>
        ${coming.length ? html`<div class="sc-agenda sc-agenda--coming">
          ${coming.map((o, i) => html`<div class="sc-at" key=${'a' + i}>${hhmm(o.at)}<small>${dayLabel(o.at, loc())}</small></div><div class="sc-who" key=${'w' + i}>${s.timezone || ''}</div>`)}
        </div>` : html`<p class="og-empty">${s.enabled === false ? t('profile.scheduler.paused') : (s.nextRunAt ? `${dayLabel(new Date(s.nextRunAt), loc())} ${hhmm(new Date(s.nextRunAt))}` : c('noneNext'))}</p>`}
      <//>
      ${s.readOnly ? null : html`<${Fold} id="sc-edit" num="04" title=${t('profile.scheduler.edit')} sub=${c('editSub')} open=${ctx.editOpen} onToggle=${() => ctx.setEditOpen(v => !v)}>
        <${ScheduleEditForm} schedule=${s} showToast=${ctx.showToast} onSaved=${() => { ctx.setEditOpen(false); ctx.loadData(); }} onClose=${() => ctx.setEditOpen(false)} />
      <//>`}`,
  });
}
