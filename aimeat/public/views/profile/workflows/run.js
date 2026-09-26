/**
 * @file public/views/profile/workflows/run.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One run as its own page under its workflow: the outcome as one sentence, the
 *   question to the person when a step waits for them (answerable right there), every step with
 *   its state in words and what the node observed, and the raw record as a fold (the pinned
 *   definition, the variables, the observations as JSON) for whoever needs the machine's words.
 * @structure renderRun
 * @usage import { renderRun } from './run.js';
 * @version-history
 *   v1.14.1 — 2026-09-26 — The run record scrolls after 32rem again, as main's .wp-code did (Code
 *     scroll="page"; fix pass).
 *   v1.14.0 — 2026-09-26 — Every part is a component that takes data (page group G5): the head's tags are Marks as data (main's grey took, check, sandbox and variable tags come back as the dim Mark, main's og-chip--dim), the verdict the Box in its tone, the steps the WorkflowSteps, the rail's states plain lines, the record the Code block; the crumb's way back is data.
 *   v1.13.0 — 2026-09-26 — A run's record is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.12.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.11.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.10.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.9.0 — 2026-09-25 — The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.8.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.7.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 — 2026-09-25 — Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
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
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { collectImages, ImageStrip } from '/components/ImageDeliverable.js';
import { Box } from '/components/Box.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { WorkflowSteps } from '/components/WorkflowSteps.js';
import { c, loc, rel, day, durationWords, stepWord, stepTone, runWord, runTone, toneStatus, statusMark, verdictOf, stepTitle, stepAgents, signalWords, renderPage } from './frame.js';
import { questionBlock } from './cover.js';
import { verdictTone } from './detail.js';

export function renderRun(ctx, item, runId) {
  const run = ctx.run?.runId === runId ? ctx.run : null;
  const wfTitle = loc(item.def.title) || item.def.id;
  const back = { label: c('backToWorkflow'), onClick: () => ctx.pickView({ kind: 'detail', id: item.def.id }) };
  const crumbWf = { label: wfTitle, onClick: () => ctx.pickView({ kind: 'detail', id: item.def.id }) };
  if (!run) return renderPage(ctx, { crumbs: [crumbWf, '…'], title: wfTitle, back, children: html`<${Note} kind="loading">${t('common.loading')}<//>` });

  const def = run.defSnapshot || item.def;
  const v = verdictOf(run);
  const inFlight = run.status === 'running' || run.status === 'waiting-step';
  const green = def.steps.filter(s => run.steps?.[s.id]?.state === 'green').length;
  const took = run.endedAt ? durationWords(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) : '';
  const waiting = def.steps.filter(s => run.steps?.[s.id]?.state === 'waiting-human');
  const resolvedOf = (id) => (run.resolved || []).find(r => r.stepId === id);
  const isCheck = run.mode === 'signals-only';
  const title = `${wfTitle} · ${isCheck ? c('checkWord') : c('runWord')} ${day(run.startedAt)}`;

  const marks = [
    { kind: 'status', tone: toneStatus(runTone(run.status)), label: runWord(run.status) },
    { label: c('startedChip', { when: rel(run.startedAt) }) },
    { label: c('producedChip', { n: green, total: def.steps.length }) },
    took ? { label: c('tookChip', { took }), tone: 'dim' } : null,
    isCheck ? { label: c('checkChip'), tone: 'dim' } : run.mode === 'full-sandbox' ? { label: c('sandboxRun'), tone: 'dim' } : null,
    ...Object.entries(run.vars || {}).filter(([k]) => k !== 'run').slice(0, 3).map(([k, val]) => ({ key: k, label: `${k} = ${val}`, tone: 'dim' })),
  ];
  const doors = html`
    ${waiting.length ? html`<${Loud} onClick=${() => document.getElementById('wp-question')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>${c('answer')}<//>` : null}
    ${inFlight ? html`<${Action} small tone="danger" disabled=${ctx.cancelling} onClick=${() => ctx.handleCancel(item.def.id, run.runId)}>${t('profile.workflows.cancelRun')}<//>` : null}
    ${!inFlight && !isCheck ? html`<${Action} small onClick=${() => { ctx.pickView({ kind: 'detail', id: item.def.id }); ctx.openConfirm(item.def.id); }}>${c('runAgain')}<//>` : null}`;
  const railGroups = [{ label: c('statesTitle'), items: ['green', 'output-red', 'input-red', 'waiting-human', 'timed-out', 'agent-offline', 'skipped']
    .map(s => ({ key: s, plain: true, label: html`${statusMark(stepTone(s), stepWord(s))} <${Code}>${s}<//>` })) }];

  return renderPage(ctx, {
    crumbs: [crumbWf, isCheck ? c('checkWord') : c('runWord') + ' ' + day(run.startedAt)],
    title, marks, doors, railGroups, back,
    children: html`
      <${Box} tone=${verdictTone(v.tone)} name=${v.head}><${Note}>${v.sub}<//><//>
      ${waiting.length ? html`<${PageSection} id="wp-question" num="01" title=${c('secQuestion')} first>
        ${ctx.pending.filter(p => p.runId === run.runId).map(p => questionBlock(ctx, p, false))}
        ${!ctx.pending.some(p => p.runId === run.runId) ? html`<${Note} kind="loading">${c('questionLoading')}<//>` : null}
      <//>` : null}
      <${PageSection} id="wp-run-steps" num=${waiting.length ? '02' : '01'} title=${c('secSteps')} count=${`${def.steps.length} · ${c('secRunStepsSub')}`} first=${!waiting.length}>
        <${WorkflowSteps} steps=${def.steps.map((s, i) => {
          const rs = run.steps?.[s.id] || {};
          const r = resolvedOf(s.id);
          const tone = stepTone(rs.state);
          const agents = stepAgents(s, r);
          const who = s.action?.kind === 'human-input' ? c('you') : agents.join(', ');
          const obs = ctx.observedWords(rs.outputObserved || rs.inputObserved);
          const imgs = collectImages([rs.outputObserved, rs.inputObserved, rs.writes], s.id);
          const why = rs.state === 'input-red' ? c('whyInput', { what: r?.required_to_function && r.required_to_function !== 'none' ? signalWords(r.required_to_function) : '' })
            : rs.state === 'output-red' ? c('whyOutput', { what: r?.success_signal ? signalWords(r.success_signal) : '' })
            : rs.state === 'skipped' ? c('whySkipped') : rs.state === 'timed-out' ? c('whyTimedOut') : rs.state === 'agent-offline' ? c('whyOffline')
            : rs.state === 'green' ? c('whyGreen', { what: r?.success_signal ? signalWords(r.success_signal) : '' }) : rs.state === 'dispatched' ? c('whyDispatched', { since: rel(rs.startedAt || run.startedAt) }) : '';
          return {
            key: s.id, num: String(i + 1).padStart(2, '0'), title: stepTitle(s), sub: `${s.id} · ${who}${s.offer ? ` · ${s.offer}` : ''}`,
            lines: [why, rs.human?.answer ? c('answered', { pick: rs.human.answer.pick || (rs.human.answer.picks || []).join(', '), other: rs.human.answer.other || '', by: String(rs.human.answer.by || '').split('@')[0] }) : null],
            extra: imgs.length ? html`<${ImageStrip} images=${imgs} />` : null,
            state: { word: stepWord(rs.state), tone: toneStatus(tone) },
            notes: [obs, rs.attempt ? c('attemptsN', { n: rs.attempt + 1 }) : null, rs.endedAt ? html`<${Mark} kind="time">${rel(rs.endedAt)}<//>` : null],
          };
        })} />
      <//>
      <${FoldSection} clip id="wp-raw" num=${waiting.length ? '03' : '02'} title=${c('rawTitle')} sub=${c('rawSub')} open=${ctx.folds.raw} onToggle=${() => ctx.setFold('raw', !ctx.folds.raw)}>
        <${Code} block scroll="page">${JSON.stringify({ runId: run.runId, mode: run.mode, status: run.status, vars: run.vars, steps: run.steps, resolved: run.resolved }, null, 2)}<//>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}
