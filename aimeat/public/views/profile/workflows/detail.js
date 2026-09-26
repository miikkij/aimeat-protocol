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
 * @structure renderDetail · confirmPanel · checkPanel · stepItem · runsTable · settingsFold
 * @usage import { renderDetail } from './detail.js';
 * @version-history
 *   v1.18.1 -- 2026-09-26 -- The verdict's "open the run" stands at the right of its words again, as
 *     main's .wp-verdict drew it (Box beside; fix pass).
 *   v1.18.0 -- 2026-09-26 -- Every part is a component that takes data (page group G5): the head's tags are Marks as data (main's grey notify, skip-done and parallel tags come back as the dim Mark, main's og-chip--dim), the verdict, the confirmation and the check note the Box (the verdict's frame in its tone), the steps the WorkflowSteps, the runs the List (the run's word a Tinted word in its tone), the settings the Facts with their doors under the Split, the rail's agents and keys plain lines. stepBlock becomes stepItem (a step as the component's data).
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
import { scrollToSection } from '/components/Rail.js';
import { Facts } from '/components/Facts.js';
import { Box } from '/components/Box.js';
import { List, Row, When, Cell, Desc, Doors } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Tab } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
import { Split } from '/components/Layout.js';
import { WorkflowSteps } from '/components/WorkflowSteps.js';
import { c, loc, rel, day, durationWords, minutesWords, triggerWords, kindWords, signalWords, stepWord, stepTone, runWord, runTone, toneStatus, runTint, verdictOf, stepTitle, stepAgents, renderPage } from './frame.js';
import { Hint } from '/components/Hint.js';

/** The verdict's frame: a run that went wrong needs a look, one that waits waits. */
export const verdictTone = (tone) => (tone === 'bad' ? 'attention' : tone === 'wait' ? 'waiting' : undefined);

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

  const marks = [
    { label: triggerWords(def.trigger) },
    { label: c('stepsN', { n: def.steps.length }) },
    agents.size ? { label: c('agentsN', { n: agents.size }) } : null,
    gates.length ? { label: c('gatesN', { n: gates.length }) } : null,
    last ? { kind: 'status', tone: toneStatus(runTone(last.status)), label: c('lastRunChip', { word: runWord(last.status).toLowerCase(), when: rel(last.startedAt) }) } : null,
    def.notify_on_finish ? { label: c('chipNotify'), tone: 'dim' } : null,
    def.skip_done ? { label: c('chipSkipDone'), tone: 'dim' } : null,
    def.parallel ? { label: c('chipParallel'), tone: 'dim' } : null,
  ];
  const doors = html`
    <${Loud} onClick=${() => ctx.openConfirm(id)}>${c('run')}<//>
    <${Action} small disabled=${ctx.checking === id} onClick=${() => ctx.handleCheck(id)}>${c('checkNow')}<//>
    <${Action} small onClick=${() => ctx.pickView({ kind: 'edit', id })}>${t('profile.workflows.edit')}<//>
    <${Action} small soft onClick=${() => { ctx.setFold('prompt', true); scrollToSection('wp-prompt'); }}>${c('promptToChat')}<//>`;
  const railGroups = [
    { label: c('railAgents'), items: [...agents].map(a => {
      const red = last && def.steps.some(s => (Array.isArray(s.agent) ? s.agent.includes(a) : s.agent === a) && ['output-red', 'timed-out', 'agent-offline'].includes(last.steps?.[s.id]?.state));
      return { key: a, plain: true, mark: '→', label: a, count: red ? '!' : undefined };
    }) },
    d?.blueprint?.nodes?.length ? { label: c('railWrites'), items: [...new Set(d.blueprint.nodes.flatMap(n => n.writes))].slice(0, 6).map(k => ({ key: k, plain: true, code: true, mark: '→', label: k })) } : null,
  ].filter(Boolean);

  return renderPage(ctx, {
    crumbs: [title], title, marks, doors, railGroups, desc: loc(def.description) || null,
    children: html`
      ${ctx.confirm?.id === id ? confirmPanel(ctx, item) : null}
      ${ctx.checks[id] ? checkPanel(ctx, item) : null}
      ${last ? html`<${Box} tone=${verdictTone(v.tone)} name=${v.head} beside
        doors=${html`<${Action} small onClick=${() => ctx.pickView({ kind: 'run', id, runId: last.runId })}>${c('openRun')}<//>`}><${Note}>${v.sub}<//><//>` : null}
      <${PageSection} id="wp-steps" num="01" title=${c('secSteps')} count=${`${def.steps.length} · ${c('secStepsSub')}`} doors=${html`<${Tab} tone="fold" on=${ctx.showKeys} pressed=${ctx.showKeys} onClick=${() => ctx.setShowKeys(!ctx.showKeys)}>${c('showKeys')}<//>`} first>
        <${WorkflowSteps} steps=${def.steps.map((s, i) => stepItem(ctx, s, i, resolvedOf(s.id), last?.steps?.[s.id]))} />
        <${Hint}>${c('stepsHint')}<//>
      <//>
      <${PageSection} id="wp-runs" num="02" title=${c('secRuns')} count=${ctx.runsTab === 'checks' ? c('checksN', { n: d?.checkCount ?? checks.length }) : c('runsN', { n: d?.runCount ?? runs.length })} doors=${html`<${Tab} tone="fold" on=${ctx.runsTab !== 'checks'} onClick=${() => ctx.setRunsTab('runs')}>${c('runsWord')}<//><${Tab} tone="fold" on=${ctx.runsTab === 'checks'} onClick=${() => ctx.setRunsTab('checks')}>${c('checksWord', { n: d?.checkCount ?? checks.length })}<//>`}>
        ${runsTable(ctx, item, ctx.runsTab === 'checks' ? checks : runs)}
      <//>
      <${FoldSection} clip id="wp-settings" num="03" title=${c('secSettings')} sub=${c('settingsSub')} open=${ctx.folds.settings} onToggle=${() => ctx.setFold('settings', !ctx.folds.settings)}>${settingsFold(ctx, item)}<//>
      <${FoldSection} clip id="wp-prompt" num="04" title=${c('promptToChat')} sub=${c('promptSub')} open=${ctx.folds.prompt} onToggle=${() => ctx.setFold('prompt', !ctx.folds.prompt)}>
        <${Note} kind="lead">${c('promptImproveBody')}<//>
        <${Actions}><${Action} small onClick=${() => ctx.copyPrompt('improve-mcp', id)}>${c('copyImprove')}<//><${Action} small soft onClick=${() => ctx.copyPrompt('create-chat')}>${c('copyChatVersion')}<//><//>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}

/** The confirmation: what will happen, how long, what it spends, where it starts. */
function confirmPanel(ctx, item) {
  const def = item.def;
  const p = ctx.confirm.preflight;
  const title = loc(def.title) || def.id;
  return html`
    <${Box} tone="raised" name=${c('confirmTitle', { name: title })}
      doors=${p ? html`
        <${Loud} control disabled=${ctx.running} onClick=${() => ctx.handleRun(def.id, false)}>${c('runNow')}<//>
        <${Action} small disabled=${ctx.running} onClick=${() => ctx.handleRun(def.id, true)}>${c('runSandbox')}<//>
        <${Action} small soft onClick=${() => ctx.closeConfirm()}>${t('profile.cancel')}<//>` : null}>
      ${!p ? html`<${Note} kind="loading">${t('common.loading')}<//>` : html`
        <${Facts} rows=${[
          { k: c('confirmWhat'), v: p.agents.length ? c('confirmWhatAgents', { n: p.willRun.length, agents: p.agents.join(', ') }) : c('confirmWhatNoAgents', { n: p.willRun.length }) },
          { k: c('confirmHowLong'), v: p.lastRun?.durationMs ? c('confirmHowLongBoth', { last: durationWords(p.lastRun.durationMs), max: minutesWords(p.maxMinutes) }) : c('confirmHowLongMax', { max: minutesWords(p.maxMinutes) }) },
          { k: c('confirmSpends'), v: c('confirmSpendsBody') },
          p.skipDone && p.steps.some(s => s.willSkip) && { k: c('confirmSkips'), v: c('confirmSkipsBody', { steps: p.steps.filter(s => s.willSkip).map(s => stepTitle(def.steps.find(x => x.id === s.id)) || s.id).join(', ') }) },
          { k: c('confirmVars'), v: Object.entries(p.vars).filter(([k]) => k !== 'run').map(([k, val]) => `${k} = ${val}`).join(' · ') || c('confirmVarsNone') },
        ]} />`}
      ${p ? html`<${Hint}>${c('confirmHint')}<//>` : null}
    <//>`;
}

/** What Check now found in memory, on the page, starting nothing. */
function checkPanel(ctx, item) {
  const def = item.def;
  const ch = ctx.checks[def.id];
  const words = def.steps.map(s => `${stepTitle(s)}: ${stepWord(ch.steps?.[s.id]?.state).toLowerCase()}`);
  return html`
    <${Box} tone="attention" name=${c('checkTitle', { when: rel(ch.at) })}
      end=${html`<${Action} small soft onClick=${() => ctx.dismissCheck(def.id)}>${c('close')}<//>`}>
      ${words.join(' · ')}
      <${Note}>${c('checkHint')}<//>
    <//>`;
}

/** One step, as WorkflowSteps' data: what it does, who does it, what must be there and how the node sees it produced, and the last run's state. */
export function stepItem(ctx, step, i, resolved, runStep) {
  const agents = stepAgents(step, resolved);
  const who = step.action?.kind === 'human-input' ? c('you') : agents.length ? `${agents.join(', ')}${step.offer ? ` · ${step.offer}` : ''}` : kindWords(step);
  const input = resolved?.required_to_function;
  const after = step.after?.length ? c('afterSteps', { steps: step.after.join(', ') }) : c('startsAtOnce');
  const inputWords = step.action?.kind === 'human-input' ? c('gateWords', { q: step.action.question?.prompt || '' }) : input && input !== 'none' ? c('needs', { what: signalWords(input) }) : c('noInputNeeded');
  const outputWords = resolved?.success_signal ? c('producedWhen', { what: signalWords(resolved.success_signal) }) : '';
  const state = runStep?.state;
  const observed = runStep?.outputObserved || runStep?.inputObserved;
  const obs = observed ? ctx.observedWords(observed) : '';
  return {
    key: step.id, num: String(i + 1).padStart(2, '0'), title: stepTitle(step), sub: `${step.id} · ${who}`,
    lines: [`${after}. ${inputWords} ${outputWords}`, ctx.showKeys && resolved?.deliverableKey ? { text: c('writesKey', { key: resolved.deliverableKey }), code: true } : null],
    state: state ? { word: stepWord(state), tone: toneStatus(stepTone(state)) } : { word: c('notRunYet'), tone: 'off' },
    notes: state ? [obs, runStep?.attempt ? c('attemptsN', { n: runStep.attempt + 1 }) : null] : [],
  };
}

function runsTable(ctx, item, list) {
  return html`
    <${List} cols="when-state-desc-doors" keepCols loading=${ctx.detailLoading && !list.length ? t('common.loading') : false}
      empty=${ctx.runsTab === 'checks' ? c('noChecks') : t('profile.workflows.noRuns')}>
      ${list.slice(0, 20).map(r => { const v = verdictOf(r); return html`
        <${Row} key=${r.runId}>
          <${When}>${rel(r.startedAt)}<//>
          <${Cell} meta>${runTint(v.tone, runWord(r.status))}<//>
          <${Desc}>${v.head}${r.mode === 'full-sandbox' ? ` · ${c('sandboxRun')}` : ''}<//>
          <${Doors}><${Action} small row onClick=${() => ctx.pickView({ kind: 'run', id: item.def.id, runId: r.runId })}>${c('open')}<//><//>
        <//>`; })}
    <//>`;
}

function settingsFold(ctx, item) {
  const def = item.def;
  return html`
    <${Facts} rows=${[
      { k: c('setTrigger'), v: triggerWords(def.trigger) },
      { k: c('setVars'), v: (def.vars || []).length ? def.vars.map(v => `${v.name} = ${v.default ?? ''}${loc(v.description) ? ` (${loc(v.description)})` : ''}`).join(' · ') : c('confirmVarsNone') },
      { k: c('setNotify'), v: def.notify_on_finish ? c('yes') : c('no') },
      { k: c('setSkipDone'), v: def.skip_done ? c('yes') : c('no') },
      { k: c('setFresh'), v: def.fresh ? c('yes') : c('no') },
      { k: c('setParallel'), v: def.parallel ? c('yes') : c('no') },
      { k: c('setOnFail'), v: c('onFailInspect') },
      { k: c('setLlm'), v: def.llm?.approved ? c('yes') : c('no') },
      { k: c('setCreated'), v: `${day(def.createdAt)}${def.createdBy ? ` · ${String(def.createdBy).split('@')[0]}` : ''}` },
    ]} />
    <${Split} pad="medium">
      <${Actions}>
        <${Action} small onClick=${() => ctx.pickView({ kind: 'edit', id: def.id })}>${t('profile.workflows.edit')}<//>
        <${Action} small tone="danger" onClick=${() => ctx.handleDelete(def.id)}>${c('deleteWorkflow')}<//>
      <//>
    <//>`;
}
