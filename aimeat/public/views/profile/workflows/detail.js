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
 *   v1.17.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- The hairline over a part of the panel is the split (.og-split), a unification: the line Workflows and Boards drew alike.
 *   v1.14.0 -- 2026-09-26 -- How to read this page is the Facts; a fold's paragraph is the lead and a read-only value under its label the Facts' value (a unification: the look most tabs use); the rail's dead base look goes.
 *   v1.13.0 -- 2026-09-25 -- "Show keys", which shows the keys and stays pressed while they are shown, is the Tab's fold tone (.poster-tab--fold, is-on and aria-pressed while shown), a unification: Jouni's decision "Tabs and filters".
 *   v1.12.0 — 2026-09-25 — The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.11.0 — 2026-09-25 — The confirmation's and the settings fold's named values are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.10.0 — 2026-09-25 — The runs table is the Listing (listing, listing-row, its doors cell; listing--cols keeps its narrow-screen columns), a unification: the look most tabs use.
 *   v1.9.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.8.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 — 2026-09-25 — Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.5.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
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
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, loc, rel, day, durationWords, minutesWords, triggerWords, kindWords, signalWords, stepWord, stepTone, runWord, runTone, toneStatus, verdictOf, stepTitle, stepAgents, renderPage } from './frame.js';
import { Hint } from '/components/Hint.js';

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
    <span class="poster-chip">${triggerWords(def.trigger)}</span>
    <span class="poster-chip">${c('stepsN', { n: def.steps.length })}</span>
    ${agents.size ? html`<span class="poster-chip">${c('agentsN', { n: agents.size })}</span>` : null}
    ${gates.length ? html`<span class="poster-chip">${c('gatesN', { n: gates.length })}</span>` : null}
    ${last ? html`<span class=${toneStatus(runTone(last.status))}>${c('lastRunChip', { word: runWord(last.status).toLowerCase(), when: rel(last.startedAt) })}</span>` : null}
    ${def.notify_on_finish ? html`<span class="poster-chip">${c('chipNotify')}</span>` : null}
    ${def.skip_done ? html`<span class="poster-chip">${c('chipSkipDone')}</span>` : null}
    ${def.parallel ? html`<span class="poster-chip">${c('chipParallel')}</span>` : null}`;
  const doors = html`
    <button type="button" class="poster-slab" onClick=${() => ctx.openConfirm(id)}>${c('run')}</button>
    <button type="button" class="poster-action poster-action--small" disabled=${ctx.checking === id} onClick=${() => ctx.handleCheck(id)}>${c('checkNow')}</button>
    <button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickView({ kind: 'edit', id })}>${t('profile.workflows.edit')}</button>
    <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => { ctx.setFold('prompt', true); scrollTo('wp-prompt'); }}>${c('promptToChat')}</button>`;
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
      ${last ? html`<div class=${`wp-verdict poster-box wp-verdict--${v.tone}`}><div><b>${v.head}</b><span>${v.sub}</span></div><div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickView({ kind: 'run', id, runId: last.runId })}>${c('openRun')}</button></div></div>` : null}
      <${PageSection} id="wp-steps" num="01" title=${c('secSteps')} count=${`${def.steps.length} · ${c('secStepsSub')}`} doors=${html`<button type="button" class=${`poster-tab poster-tab--fold ${ctx.showKeys ? 'is-on' : ''}`} aria-pressed=${ctx.showKeys ? 'true' : 'false'} onClick=${() => ctx.setShowKeys(!ctx.showKeys)}>${c('showKeys')}</button>`} first>
        ${def.steps.map((s, i) => stepBlock(ctx, s, i, resolvedOf(s.id), last?.steps?.[s.id]))}
        <${Hint}>${c('stepsHint')}<//>
      <//>
      <${PageSection} id="wp-runs" num="02" title=${c('secRuns')} count=${ctx.runsTab === 'checks' ? c('checksN', { n: d?.checkCount ?? checks.length }) : c('runsN', { n: d?.runCount ?? runs.length })} doors=${html`<button type="button" class=${`poster-tab poster-tab--fold ${ctx.runsTab !== 'checks' ? 'is-on' : ''}`} onClick=${() => ctx.setRunsTab('runs')}>${c('runsWord')}</button><button type="button" class=${`poster-tab poster-tab--fold ${ctx.runsTab === 'checks' ? 'is-on' : ''}`} onClick=${() => ctx.setRunsTab('checks')}>${c('checksWord', { n: d?.checkCount ?? checks.length })}</button>`}>
        ${runsTable(ctx, item, ctx.runsTab === 'checks' ? checks : runs)}
      <//>
      <${FoldSection} id="wp-settings" num="03" title=${c('secSettings')} sub=${c('settingsSub')} open=${ctx.folds.settings} onToggle=${() => ctx.setFold('settings', !ctx.folds.settings)}>${settingsFold(ctx, item)}<//>
      <${FoldSection} id="wp-prompt" num="04" title=${c('promptToChat')} sub=${c('promptSub')} open=${ctx.folds.prompt} onToggle=${() => ctx.setFold('prompt', !ctx.folds.prompt)}>
        <p class="og-lead wp-prose">${c('promptImproveBody')}</p>
        <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.copyPrompt('improve-mcp', id)}>${c('copyImprove')}</button><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.copyPrompt('create-chat')}>${c('copyChatVersion')}</button></div>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}

/** The confirmation: what will happen, how long, what it spends, where it starts. */
function confirmPanel(ctx, item) {
  const def = item.def;
  const p = ctx.confirm.preflight;
  const title = loc(def.title) || def.id;
  const kv = (k, v) => html`<div class="facts-k poster-label">${k}</div><div class="facts-v">${v}</div>`;
  return html`
    <div class="wp-confirm poster-box poster-box--raised">
      <h3>${c('confirmTitle', { name: title })}</h3>
      ${!p ? html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>` : html`
        <div class="facts">
          ${kv(c('confirmWhat'), p.agents.length ? c('confirmWhatAgents', { n: p.willRun.length, agents: p.agents.join(', ') }) : c('confirmWhatNoAgents', { n: p.willRun.length }))}
          ${kv(c('confirmHowLong'), p.lastRun?.durationMs ? c('confirmHowLongBoth', { last: durationWords(p.lastRun.durationMs), max: minutesWords(p.maxMinutes) }) : c('confirmHowLongMax', { max: minutesWords(p.maxMinutes) }))}
          ${kv(c('confirmSpends'), c('confirmSpendsBody'))}
          ${p.skipDone && p.steps.some(s => s.willSkip) ? kv(c('confirmSkips'), c('confirmSkipsBody', { steps: p.steps.filter(s => s.willSkip).map(s => stepTitle(def.steps.find(d => d.id === s.id)) || s.id).join(', ') })) : null}
          ${kv(c('confirmVars'), Object.entries(p.vars).filter(([k]) => k !== 'run').map(([k, v]) => `${k} = ${v}`).join(' · ') || c('confirmVarsNone'))}
        </div>
        <div class="og-doors">
          <button type="button" class="poster-slab poster-slab--control" disabled=${ctx.running} onClick=${() => ctx.handleRun(def.id, false)}>${c('runNow')}</button>
          <button type="button" class="poster-action poster-action--small" disabled=${ctx.running} onClick=${() => ctx.handleRun(def.id, true)}>${c('runSandbox')}</button>
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.closeConfirm()}>${t('profile.cancel')}</button>
        </div>
        <${Hint}>${c('confirmHint')}<//>`}
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
      <span class="poster-hint">${c('checkHint')}</span>
      <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.dismissCheck(def.id)}>${c('close')}</button>
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
      <div class="wp-step-st">${state ? html`<b class=${toneStatus(tone)}>${stepWord(state)}</b>${obs ? html`<span>${obs}</span>` : null}${runStep?.attempt ? html`<span>${c('attemptsN', { n: runStep.attempt + 1 })}</span>` : null}` : html`<b class="poster-status poster-status--off">${c('notRunYet')}</b>`}</div>
    </div>`;
}

function runsTable(ctx, item, list) {
  if (ctx.detailLoading && !list.length) return html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>`;
  if (!list.length) return html`<p class="poster-quiet">${ctx.runsTab === 'checks' ? c('noChecks') : t('profile.workflows.noRuns')}</p>`;
  return html`
    <div class="listing listing--cols listing--when-state-desc-doors">
      ${list.slice(0, 20).map(r => { const v = verdictOf(r); return html`
        <div class="listing-row" key=${r.runId}>
          <div class="wp-m poster-time">${rel(r.startedAt)}</div>
          <div class=${`wp-m wp-m--${v.tone}`}><b>${runWord(r.status)}</b></div>
          <div class="wp-m wp-m--sub">${v.head}${r.mode === 'full-sandbox' ? ` · ${c('sandboxRun')}` : ''}</div>
          <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.pickView({ kind: 'run', id: item.def.id, runId: r.runId })}>${c('open')}</button></div>
        </div>`; })}
    </div>`;
}

function settingsFold(ctx, item) {
  const def = item.def;
  const row = (k, v) => html`<div class="facts-k poster-label">${k}</div><div class="facts-v">${v}</div>`;
  return html`
    <div class="facts">
      ${row(c('setTrigger'), triggerWords(def.trigger))}
      ${row(c('setVars'), (def.vars || []).length ? def.vars.map(v => `${v.name} = ${v.default ?? ''}${loc(v.description) ? ` (${loc(v.description)})` : ''}`).join(' · ') : c('confirmVarsNone'))}
      ${row(c('setNotify'), def.notify_on_finish ? c('yes') : c('no'))}
      ${row(c('setSkipDone'), def.skip_done ? c('yes') : c('no'))}
      ${row(c('setFresh'), def.fresh ? c('yes') : c('no'))}
      ${row(c('setParallel'), def.parallel ? c('yes') : c('no'))}
      ${row(c('setOnFail'), c('onFailInspect'))}
      ${row(c('setLlm'), def.llm?.approved ? c('yes') : c('no'))}
      ${row(c('setCreated'), `${day(def.createdAt)}${def.createdBy ? ` · ${String(def.createdBy).split('@')[0]}` : ''}`)}
    </div>
    <div class="og-doors og-split wp-danger-row"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickView({ kind: 'edit', id: def.id })}>${t('profile.workflows.edit')}</button><button type="button" class="poster-action poster-action--small poster-action--danger" onClick=${() => ctx.handleDelete(def.id)}>${c('deleteWorkflow')}</button></div>`;
}
