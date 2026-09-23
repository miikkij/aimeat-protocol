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
 *   2026-09-22 -- Composed from the shared component set: steps are numbered ListRows, the runs a
 *     timeline, the confirmation an opened record, settings KeyValue rows; no own CSS. The delete
 *     door is an underlined word like the others (the set's danger tone is on the primary slab).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Stack, ListRow, KeyValue, Surface, Action, Text } from '/components/poster-parts.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, loc, rel, day, durationWords, minutesWords, triggerWords, kindWords, signalWords, stepWord, stepTone, runWord, runTone, verdictOf, stepTitle, stepAgents, renderPage, chipRow, chipTone, toneOf, verdictBlock, railList } from './frame.js';

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

  const chips = chipRow([
    [triggerWords(def.trigger)],
    [c('stepsN', { n: def.steps.length })],
    agents.size && [c('agentsN', { n: agents.size })],
    gates.length && [c('gatesN', { n: gates.length })],
    last && [c('lastRunChip', { word: runWord(last.status).toLowerCase(), when: rel(last.startedAt) }), chipTone(runTone(last.status))],
    def.notify_on_finish && [c('chipNotify'), 'muted'],
    def.skip_done && [c('chipSkipDone'), 'muted'],
    def.parallel && [c('chipParallel'), 'muted'],
  ]);
  const doors = html`
    <${Action} kind="primary" onClick=${() => ctx.openConfirm(id)}>${c('run')}<//>
    <${Action} disabled=${ctx.checking === id} onClick=${() => ctx.handleCheck(id)}>${c('checkNow')}<//>
    <${Action} onClick=${() => ctx.pickView({ kind: 'edit', id })}>${t('profile.workflows.edit')}<//>
    <${Action} onClick=${() => { ctx.setFold('prompt', true); scrollTo('wp-prompt'); }}>${c('promptToChat')}<//>`;
  const writes = d?.blueprint?.nodes?.length ? [...new Set(d.blueprint.nodes.flatMap(n => n.writes))].slice(0, 6) : [];
  const rail = html`
    ${railList(c('railAgents'), [...agents].map(a => { const red = last && def.steps.some(s => (Array.isArray(s.agent) ? s.agent.includes(a) : s.agent === a) && ['output-red', 'timed-out', 'agent-offline'].includes(last.steps?.[s.id]?.state)); return { key: a, label: `${a}${red ? ' !' : ''}`, tone: red ? 'danger' : undefined }; }))}
    ${writes.length ? railList(c('railWrites'), writes.map(k => ({ key: k, label: k }))) : null}`;

  return renderPage(ctx, {
    crumbs: [title], title, chips, doors, rail,
    children: html`
      ${loc(def.description) ? html`<${Text} kind="lead">${loc(def.description)}<//>` : null}
      ${ctx.confirm?.id === id ? confirmPanel(ctx, item) : null}
      ${ctx.checks[id] ? checkPanel(ctx, item) : null}
      ${last ? verdictBlock(v, html`<${Action} onClick=${() => ctx.pickView({ kind: 'run', id, runId: last.runId })}>${c('openRun')}<//>`) : null}
      <${Section} id="wp-steps" title=${c('secSteps')} count=${`${def.steps.length} · ${c('secStepsSub')}`} actions=${html`<${Action} kind="tab" selected=${ctx.showKeys} onClick=${() => ctx.setShowKeys(!ctx.showKeys)}>${c('showKeys')}<//>`}>
        ${def.steps.map((s, i) => stepBlock(ctx, s, i, resolvedOf(s.id), last?.steps?.[s.id]))}
        <${Text} kind="caption" tone="muted">${c('stepsHint')}<//>
      <//>
      <${Section} id="wp-runs" title=${c('secRuns')} count=${ctx.runsTab === 'checks' ? c('checksN', { n: d?.checkCount ?? checks.length }) : c('runsN', { n: d?.runCount ?? runs.length })}
        actions=${html`<${Action} kind="tab" selected=${ctx.runsTab !== 'checks'} onClick=${() => ctx.setRunsTab('runs')}>${c('runsWord')}<//><${Action} kind="tab" selected=${ctx.runsTab === 'checks'} onClick=${() => ctx.setRunsTab('checks')}>${c('checksWord', { n: d?.checkCount ?? checks.length })}<//>`}>
        ${runsTable(ctx, item, ctx.runsTab === 'checks' ? checks : runs)}
      <//>
      <${Fold} id="wp-settings" number="03" title=${c('secSettings')} sub=${c('settingsSub')} open=${ctx.folds.settings} onToggle=${() => ctx.setFold('settings', !ctx.folds.settings)}>${settingsFold(ctx, item)}<//>
      <${Fold} id="wp-prompt" number="04" title=${c('promptToChat')} sub=${c('promptSub')} open=${ctx.folds.prompt} onToggle=${() => ctx.setFold('prompt', !ctx.folds.prompt)}>
        <${Text}>${c('promptImproveBody')}<//>
        <${Stack} direction="wrap"><${Action} onClick=${() => ctx.copyPrompt('improve-mcp', id)}>${c('copyImprove')}<//><${Action} onClick=${() => ctx.copyPrompt('create-chat')}>${c('copyChatVersion')}<//><//>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}

/** The confirmation: what will happen, how long, what it spends, where it starts. */
function confirmPanel(ctx, item) {
  const def = item.def;
  const p = ctx.confirm.preflight;
  const title = loc(def.title) || def.id;
  const kv = (k, v) => html`<${KeyValue} label=${k} value=${v} />`;
  return html`<${Surface} kind="record"><${Stack}>
    <${Text} kind="heading">${c('confirmTitle', { name: title })}<//>
    ${!p ? html`<${Text} tone="muted">${t('common.loading')}<//>` : html`
      <${Stack} density="compact">
        ${kv(c('confirmWhat'), p.agents.length ? c('confirmWhatAgents', { n: p.willRun.length, agents: p.agents.join(', ') }) : c('confirmWhatNoAgents', { n: p.willRun.length }))}
        ${kv(c('confirmHowLong'), p.lastRun?.durationMs ? c('confirmHowLongBoth', { last: durationWords(p.lastRun.durationMs), max: minutesWords(p.maxMinutes) }) : c('confirmHowLongMax', { max: minutesWords(p.maxMinutes) }))}
        ${kv(c('confirmSpends'), c('confirmSpendsBody'))}
        ${p.skipDone && p.steps.some(s => s.willSkip) ? kv(c('confirmSkips'), c('confirmSkipsBody', { steps: p.steps.filter(s => s.willSkip).map(s => stepTitle(def.steps.find(d => d.id === s.id)) || s.id).join(', ') })) : null}
        ${kv(c('confirmVars'), Object.entries(p.vars).filter(([k]) => k !== 'run').map(([k, v]) => `${k} = ${v}`).join(' · ') || c('confirmVarsNone'))}
      <//>
      <${Stack} direction="wrap" align="center">
        <${Action} kind="primary" disabled=${ctx.running} onClick=${() => ctx.handleRun(def.id, false)}>${c('runNow')}<//>
        <${Action} disabled=${ctx.running} onClick=${() => ctx.handleRun(def.id, true)}>${c('runSandbox')}<//>
        <${Action} onClick=${() => ctx.closeConfirm()}>${t('profile.cancel')}<//>
      <//>
      <${Text} kind="caption" tone="muted">${c('confirmHint')}<//>`}
  <//><//>`;
}

/** What Check now found in memory, on the page, starting nothing. */
function checkPanel(ctx, item) {
  const def = item.def;
  const ch = ctx.checks[def.id];
  const words = def.steps.map(s => `${stepTitle(s)}: ${stepWord(ch.steps?.[s.id]?.state).toLowerCase()}`);
  return html`<${Surface} kind="box" tone="sun" density="compact"><${Stack} density="compact">
    <${Text} kind="label">${c('checkTitle', { when: rel(ch.at) })}<//>
    <${Text}>${words.join(' · ')}<//>
    <${Text} kind="caption">${c('checkHint')}<//>
    <${Stack} direction="horizontal" align="start"><${Action} onClick=${() => ctx.dismissCheck(def.id)}>${c('close')}<//><//>
  <//><//>`;
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
  const observed = runStep?.outputObserved || runStep?.inputObserved;
  const obs = observed ? ctx.observedWords(observed) : '';
  return html`<${ListRow} key=${step.id} number=${String(i + 1).padStart(2, '0')} name=${stepTitle(step)} detail=${`${step.id} · ${who}`}
    value=${state ? html`<${Stack} density="compact">
      <${Text} kind="label" tone=${toneOf(stepTone(state))}>${stepWord(state)}<//>
      ${obs ? html`<${Text} kind="caption">${obs}<//>` : null}
      ${runStep?.attempt ? html`<${Text} kind="caption">${c('attemptsN', { n: runStep.attempt + 1 })}<//>` : null}
    <//>` : html`<${Text} kind="label" tone="muted">${c('notRunYet')}<//>`}>
    <${Stack} density="compact">
      <${Text}>${after}. ${inputWords} ${outputWords}<//>
      ${ctx.showKeys && resolved?.deliverableKey ? html`<${Text} kind="mono" tone="muted">${c('writesKey', { key: resolved.deliverableKey })}<//>` : null}
    <//>
  <//>`;
}

function runsTable(ctx, item, list) {
  if (ctx.detailLoading && !list.length) return html`<${Text} tone="muted">${t('common.loading')}<//>`;
  if (!list.length) return html`<${Text} tone="muted">${ctx.runsTab === 'checks' ? c('noChecks') : t('profile.workflows.noRuns')}<//>`;
  return list.slice(0, 20).map(r => {
    const v = verdictOf(r);
    return html`<${ListRow} key=${r.runId} density="compact" time=${rel(r.startedAt)}
      marker=${v.tone === 'ok' ? 'success' : v.tone === 'bad' ? 'danger' : v.tone === 'wait' ? 'sun' : 'muted'}
      name=${runWord(r.status)} detailKind="text" detail=${`${v.head}${r.mode === 'full-sandbox' ? ` · ${c('sandboxRun')}` : ''}`}
      actions=${html`<${Action} onClick=${() => ctx.pickView({ kind: 'run', id: item.def.id, runId: r.runId })}>${c('open')}<//>`} />`;
  });
}

function settingsFold(ctx, item) {
  const def = item.def;
  const row = (k, v) => html`<${KeyValue} label=${k} value=${v} />`;
  return html`<${Stack} density="compact">
    ${row(c('setTrigger'), triggerWords(def.trigger))}
    ${row(c('setVars'), (def.vars || []).length ? def.vars.map(v => `${v.name} = ${v.default ?? ''}${loc(v.description) ? ` (${loc(v.description)})` : ''}`).join(' · ') : c('confirmVarsNone'))}
    ${row(c('setNotify'), def.notify_on_finish ? c('yes') : c('no'))}
    ${row(c('setSkipDone'), def.skip_done ? c('yes') : c('no'))}
    ${row(c('setFresh'), def.fresh ? c('yes') : c('no'))}
    ${row(c('setParallel'), def.parallel ? c('yes') : c('no'))}
    ${row(c('setOnFail'), c('onFailInspect'))}
    ${row(c('setLlm'), def.llm?.approved ? c('yes') : c('no'))}
    ${row(c('setCreated'), `${day(def.createdAt)}${def.createdBy ? ` · ${String(def.createdBy).split('@')[0]}` : ''}`)}
    <${Stack} direction="wrap"><${Action} onClick=${() => ctx.pickView({ kind: 'edit', id: def.id })}>${t('profile.workflows.edit')}<//><${Action} onClick=${() => ctx.handleDelete(def.id)}>${c('deleteWorkflow')}<//><//>
  <//>`;
}
