/**
 * @file public/views/profile/workflows/detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One workflow as its own page under the Workflows crumb: when it runs, how many
 *   steps and agents, what the last run did as chips; Run, Check now, Edit and the prompt as
 *   doors; the verdict of the last run as one sentence; the steps with their checks in words and
 *   the last run's state on each; the runs (the checks apart, on their own door); the settings as
 *   a fold in words; the prompt as a fold. Run opens the confirmation (what will happen, how long,
 *   what it spends, where it starts) before anything starts; Check now answers on the page and
 *   starts nothing.
 * @structure renderDetail · confirmPanel · checkPanel · stepBlock · runsTable · settingsFold
 * @usage import { renderDetail } from './detail.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, loc, rel, day, durationWords, minutesWords, triggerWords, kindWords, signalWords, stepWord, stepTone, runWord, runTone, verdictOf, stepTitle, stepAgents, renderPage } from './frame.js';

export function renderDetail(ctx, item) {
  const def = item.def;
  const id = def.id;
  const d = ctx.detail?.id === id ? ctx.detail : null;
  const runs = d?.runs || [];
  const checks = d?.checks || [];
  const last = runs[0] || item.lastRun || null;
  const v = verdictOf(last);
  const agents = new Set(def.steps.flatMap(s => Array.isArray(s.agent) ? s.agent : s.agent ? [s.agent] : []));
  const gates = def.steps.filter(s => s.action?.kind === 'human-input');
  const resolvedOf = (stepId) => (last?.resolved || d?.blueprintResolved || []).find(r => r.stepId === stepId);
  const title = loc(def.title) || id;

  const chips = html`
    <span class="og-chip">${triggerWords(def.trigger)}</span>
    <span class="og-chip">${c('stepsN', { n: def.steps.length })}</span>
    ${agents.size ? html`<span class="og-chip">${c('agentsN', { n: agents.size })}</span>` : null}
    ${gates.length ? html`<span class="og-chip">${c('gatesN', { n: gates.length })}</span>` : null}
    ${last ? html`<span class=${`og-chip ${runTone(last.status) === 'bad' ? 'og-chip--coral' : runTone(last.status) === 'wait' ? 'og-chip--sun' : ''}`}>${c('lastRunChip', { word: runWord(last.status).toLowerCase(), when: rel(last.startedAt) })}</span>` : null}
    ${def.notify_on_finish ? html`<span class="og-chip og-chip--dim">${c('chipNotify')}</span>` : null}
    ${def.skip_done ? html`<span class="og-chip og-chip--dim">${c('chipSkipDone')}</span>` : null}`;
  const doors = html`
    <button type="button" class="og-slab" onClick=${() => ctx.openConfirm(id)}>${c('run')}</button>
    <button type="button" class="og-door" disabled=${ctx.checking === id} onClick=${() => ctx.handleCheck(id)}>${c('checkNow')}</button>
    <button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'edit', id })}>${t('profile.workflows.edit')}</button>
    <button type="button" class="og-door og-door--quiet" onClick=${() => { ctx.setFold('prompt', true); scrollTo('wp-prompt'); }}>${c('promptToChat')}</button>`;
  const rail = html`
    <hr />
    <span class="og-rail-label">${c('railAgents')}</span>
    ${[...agents].map(a => { const red = last && def.steps.some(s => (Array.isArray(s.agent) ? s.agent.includes(a) : s.agent === a) && ['output-red', 'timed-out', 'agent-offline'].includes(last.steps?.[s.id]?.state)); return html`<span class="og-rail-link wp-rail-static" key=${a}><i>→</i>${a}${red ? html`<em>!</em>` : null}</span>`; })}
    ${d?.blueprint?.nodes?.length ? html`<hr /><span class="og-rail-label">${c('railWrites')}</span>${[...new Set(d.blueprint.nodes.flatMap(n => n.writes))].slice(0, 6).map(k => html`<span class="og-rail-link wp-rail-static wp-rail-key" key=${k}><i>→</i>${k}</span>`)}` : null}`;

  return renderPage(ctx, {
    crumbs: [title], title, chips, doors, rail,
    children: html`
      ${loc(def.description) ? html`<p class="og-desc og-desc--page">${loc(def.description)}</p>` : null}
      ${ctx.confirm?.id === id ? confirmPanel(ctx, item) : null}
      ${ctx.checks[id] ? checkPanel(ctx, item) : null}
      ${last ? html`<div class=${`wp-verdict wp-verdict--${v.tone}`}><div><b>${v.head}</b><span>${v.sub}</span></div><div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'run', id, runId: last.runId })}>${c('openRun')}</button></div></div>` : null}
      <${Section} id="wp-steps" num="01" title=${c('secSteps')} count=${`${def.steps.length} · ${c('secStepsSub')}`} doors=${html`<button type="button" class=${`og-door og-door--quiet ${ctx.showKeys ? 'on' : ''}`} onClick=${() => ctx.setShowKeys(!ctx.showKeys)}>${c('showKeys')}</button>`} first>
        ${def.steps.map((s, i) => stepBlock(ctx, s, i, resolvedOf(s.id), last?.steps?.[s.id]))}
        <p class="wp-hint">${c('stepsHint')}</p>
      <//>
      <${Section} id="wp-runs" num="02" title=${c('secRuns')} count=${ctx.runsTab === 'checks' ? c('checksN', { n: d?.checkCount ?? checks.length }) : c('runsN', { n: d?.runCount ?? runs.length })} doors=${html`<button type="button" class=${`og-door og-door--quiet ${ctx.runsTab !== 'checks' ? 'on' : ''}`} onClick=${() => ctx.setRunsTab('runs')}>${c('runsWord')}</button><button type="button" class=${`og-door og-door--quiet ${ctx.runsTab === 'checks' ? 'on' : ''}`} onClick=${() => ctx.setRunsTab('checks')}>${c('checksWord', { n: d?.checkCount ?? checks.length })}</button>`}>
        ${runsTable(ctx, item, ctx.runsTab === 'checks' ? checks : runs)}
      <//>
      <${Fold} id="wp-settings" num="03" title=${c('secSettings')} sub=${c('settingsSub')} open=${ctx.folds.settings} onToggle=${() => ctx.setFold('settings', !ctx.folds.settings)}>${settingsFold(ctx, item)}<//>
      <${Fold} id="wp-prompt" num="04" title=${c('promptToChat')} sub=${c('promptSub')} open=${ctx.folds.prompt} onToggle=${() => ctx.setFold('prompt', !ctx.folds.prompt)}>
        <p class="wp-prose">${c('promptImproveBody')}</p>
        <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.copyPrompt('improve-mcp', id)}>${c('copyImprove')}</button><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.copyPrompt('create-chat')}>${c('copyChatVersion')}</button></div>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}

/** The confirmation: what will happen, how long, what it spends, where it starts. */
function confirmPanel(ctx, item) {
  const def = item.def;
  const p = ctx.confirm.preflight;
  const title = loc(def.title) || def.id;
  const kv = (k, v) => html`<div class="wp-kv-k">${k}</div><div class="wp-kv-v">${v}</div>`;
  return html`
    <div class="wp-confirm">
      <h3>${c('confirmTitle', { name: title })}</h3>
      ${!p ? html`<p class="og-empty wp-loading">${t('common.loading')}</p>` : html`
        <div class="wp-kv">
          ${kv(c('confirmWhat'), p.agents.length ? c('confirmWhatAgents', { n: p.willRun.length, agents: p.agents.join(', ') }) : c('confirmWhatNoAgents', { n: p.willRun.length }))}
          ${kv(c('confirmHowLong'), p.lastRun?.durationMs ? c('confirmHowLongBoth', { last: durationWords(p.lastRun.durationMs), max: minutesWords(p.maxMinutes) }) : c('confirmHowLongMax', { max: minutesWords(p.maxMinutes) }))}
          ${kv(c('confirmSpends'), c('confirmSpendsBody'))}
          ${p.skipDone && p.steps.some(s => s.willSkip) ? kv(c('confirmSkips'), c('confirmSkipsBody', { steps: p.steps.filter(s => s.willSkip).map(s => stepTitle(def.steps.find(d => d.id === s.id)) || s.id).join(', ') })) : null}
          ${kv(c('confirmVars'), Object.entries(p.vars).filter(([k]) => k !== 'run').map(([k, v]) => `${k} = ${v}`).join(' · ') || c('confirmVarsNone'))}
        </div>
        <div class="og-doors">
          <button type="button" class="og-slab" disabled=${ctx.running} onClick=${() => ctx.handleRun(def.id, false)}>${c('runNow')}</button>
          <button type="button" class="og-door" disabled=${ctx.running} onClick=${() => ctx.handleRun(def.id, true)}>${c('runSandbox')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.closeConfirm()}>${t('profile.cancel')}</button>
        </div>
        <p class="wp-hint">${c('confirmHint')}</p>`}
    </div>`;
}

/** What Check now found in memory, on the page, starting nothing. */
function checkPanel(ctx, item) {
  const def = item.def;
  const ch = ctx.checks[def.id];
  const words = def.steps.map(s => `${stepTitle(s)}: ${stepWord(ch.steps?.[s.id]?.state).toLowerCase()}`);
  return html`
    <div class="wp-note wp-note--check">
      <b>${c('checkTitle', { when: rel(ch.at) })}</b>
      <span>${words.join(' · ')}</span>
      <span class="wp-hint">${c('checkHint')}</span>
      <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.dismissCheck(def.id)}>${c('close')}</button>
    </div>`;
}

/** One step: what it does, who does it, what must be there and how the node sees it produced, and the last run's state. */
export function stepBlock(ctx, step, i, resolved, runStep) {
  const agents = stepAgents(step, resolved);
  const who = step.action?.kind === 'human-input' ? c('you') : agents.length ? `${agents.join(', ')}${step.offer ? ` · ${step.offer}` : ''}` : kindWords(step);
  const input = resolved?.required_to_function;
  const after = step.after?.length ? c('afterSteps', { steps: step.after.join(', ') }) : c('startsAtOnce');
  const inputWords = step.action?.kind === 'human-input' ? c('gateWords', { q: step.action.question?.prompt || '' }) : input && input !== 'none' ? c('needs', { what: signalWords(input) }) : c('noInputNeeded');
  const outputWords = resolved?.success_signal ? c('producedWhen', { what: signalWords(resolved.success_signal) }) : '';
  const state = runStep?.state;
  const tone = stepTone(state);
  const observed = runStep?.outputObserved || runStep?.inputObserved;
  const obs = observed ? ctx.observedWords(observed) : '';
  return html`
    <div class="wp-step" key=${step.id}>
      <div class="wp-step-n">${String(i + 1).padStart(2, '0')}</div>
      <div class="wp-step-body">
        <b>${stepTitle(step)}<small>${step.id} · ${who}</small></b>
        <div class="wp-sig">${after}. ${inputWords} ${outputWords}</div>
        ${ctx.showKeys && resolved?.deliverableKey ? html`<div class="wp-sig wp-sig--key">${c('writesKey', { key: resolved.deliverableKey })}</div>` : null}
      </div>
      <div class="wp-step-st">${state ? html`<b class=${`wp-st--${tone}`}>${stepWord(state)}</b>${obs ? html`<span>${obs}</span>` : null}${runStep?.attempt ? html`<span>${c('attemptsN', { n: runStep.attempt + 1 })}</span>` : null}` : html`<b class="wp-st--none">${c('notRunYet')}</b>`}</div>
    </div>`;
}

function runsTable(ctx, item, list) {
  if (ctx.detailLoading && !list.length) return html`<p class="og-empty wp-loading">${t('common.loading')}</p>`;
  if (!list.length) return html`<p class="og-empty">${ctx.runsTab === 'checks' ? c('noChecks') : t('profile.workflows.noRuns')}</p>`;
  return html`
    <div class="wp-runs">
      ${list.slice(0, 20).map(r => { const v = verdictOf(r); return html`
        <div class="wp-m" key=${'w' + r.runId}>${rel(r.startedAt)}</div>
        <div class=${`wp-m wp-m--${v.tone}`} key=${'s' + r.runId}><b>${runWord(r.status)}</b></div>
        <div class="wp-m wp-m--sub" key=${'v' + r.runId}>${v.head}${r.mode === 'full-sandbox' ? ` · ${c('sandboxRun')}` : ''}</div>
        <div class="og-tbl-door" key=${'d' + r.runId}><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'run', id: item.def.id, runId: r.runId })}>${c('open')}</button></div>`; })}
    </div>`;
}

function settingsFold(ctx, item) {
  const def = item.def;
  const row = (k, v) => html`<div class="wp-kv-k">${k}</div><div class="wp-kv-v">${v}</div>`;
  return html`
    <div class="wp-kv">
      ${row(c('setTrigger'), triggerWords(def.trigger))}
      ${row(c('setVars'), (def.vars || []).length ? def.vars.map(v => `${v.name} = ${v.default ?? ''}${loc(v.description) ? ` (${loc(v.description)})` : ''}`).join(' · ') : c('confirmVarsNone'))}
      ${row(c('setNotify'), def.notify_on_finish ? c('yes') : c('no'))}
      ${row(c('setSkipDone'), def.skip_done ? c('yes') : c('no'))}
      ${row(c('setFresh'), def.fresh ? c('yes') : c('no'))}
      ${row(c('setOnFail'), c('onFailInspect'))}
      ${row(c('setLlm'), def.llm?.approved ? c('yes') : c('no'))}
      ${row(c('setCreated'), `${day(def.createdAt)}${def.createdBy ? ` · ${String(def.createdBy).split('@')[0]}` : ''}`)}
    </div>
    <div class="og-doors wp-danger-row"><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'edit', id: def.id })}>${t('profile.workflows.edit')}</button><button type="button" class="og-door og-door--danger" onClick=${() => ctx.handleDelete(def.id)}>${c('deleteWorkflow')}</button></div>`;
}
