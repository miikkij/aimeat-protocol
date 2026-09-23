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
 *   2026-09-22 -- Composed from the shared component set: a step is a numbered ListRow with its
 *     state as the value, the verdict the shared block, the raw record a code Surface; no own CSS.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Stack, ListRow, Surface, Action, Text } from '/components/poster-parts.js';
import { collectImages, ImageStrip } from '/components/ImageDeliverable.js';
import { c, loc, rel, day, durationWords, stepWord, stepTone, runWord, runTone, verdictOf, stepTitle, stepAgents, signalWords, renderPage, chipRow, chipTone, toneOf, verdictBlock } from './frame.js';
import { questionBlock } from './cover.js';

export function renderRun(ctx, item, runId) {
  const run = ctx.run?.runId === runId ? ctx.run : null;
  const wfTitle = loc(item.def.title) || item.def.id;
  const back = html`<${Action} onClick=${() => ctx.pickView({ kind: 'detail', id: item.def.id })}>← ${c('backToWorkflow')}<//>`;
  const crumbWf = { label: wfTitle, go: () => ctx.pickView({ kind: 'detail', id: item.def.id }) };
  if (!run) return renderPage(ctx, { crumbs: [crumbWf, '…'], title: wfTitle, back, children: html`<${Text} tone="muted">${t('common.loading')}<//>` });

  const def = run.defSnapshot || item.def;
  const v = verdictOf(run);
  const inFlight = run.status === 'running' || run.status === 'waiting-step';
  const green = def.steps.filter(s => run.steps?.[s.id]?.state === 'green').length;
  const took = run.endedAt ? durationWords(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) : '';
  const waiting = def.steps.filter(s => run.steps?.[s.id]?.state === 'waiting-human');
  const resolvedOf = (id) => (run.resolved || []).find(r => r.stepId === id);
  const isCheck = run.mode === 'signals-only';
  const title = `${wfTitle} · ${isCheck ? c('checkWord') : c('runWord')} ${day(run.startedAt)}`;

  const chips = chipRow([
    [runWord(run.status), runTone(run.status) === 'ok' ? 'sun' : chipTone(runTone(run.status))],
    [c('startedChip', { when: rel(run.startedAt) })],
    [c('producedChip', { n: green, total: def.steps.length })],
    took && [c('tookChip', { took }), 'muted'],
    isCheck ? [c('checkChip'), 'muted'] : run.mode === 'full-sandbox' ? [c('sandboxRun'), 'muted'] : null,
    ...Object.entries(run.vars || {}).filter(([k]) => k !== 'run').slice(0, 3).map(([k, val]) => [`${k} = ${val}`, 'muted']),
  ]);
  const doors = html`
    ${waiting.length ? html`<${Action} kind="primary" onClick=${() => document.getElementById('wp-question')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>${c('answer')}<//>` : null}
    ${inFlight ? html`<${Action} disabled=${ctx.cancelling} onClick=${() => ctx.handleCancel(item.def.id, run.runId)}>${t('profile.workflows.cancelRun')}<//>` : null}
    ${!inFlight && !isCheck ? html`<${Action} onClick=${() => { ctx.pickView({ kind: 'detail', id: item.def.id }); ctx.openConfirm(item.def.id); }}>${c('runAgain')}<//>` : null}`;
  const rail = html`<${Stack} density="compact">
    <${Text} kind="label">${c('statesTitle')}<//>
    ${['green', 'output-red', 'input-red', 'waiting-human', 'timed-out', 'agent-offline', 'skipped'].map(s => html`<${Stack} key=${s} density="compact">
      <${Text} kind="caption" tone=${toneOf(stepTone(s))}>${stepWord(s)}<//>
      <${Text} kind="mono">${s}<//>
    <//>`)}
  <//>`;

  return renderPage(ctx, {
    crumbs: [crumbWf, isCheck ? c('checkWord') : c('runWord') + ' ' + day(run.startedAt)],
    title, chips, doors, rail, back,
    children: html`
      ${verdictBlock(v)}
      ${waiting.length ? html`<${Section} id="wp-question" title=${c('secQuestion')}>
        <${Stack}>
          ${ctx.pending.filter(p => p.runId === run.runId).map(p => questionBlock(ctx, p, false))}
          ${!ctx.pending.some(p => p.runId === run.runId) ? html`<${Text} tone="muted">${c('questionLoading')}<//>` : null}
        <//>
      <//>` : null}
      <${Section} id="wp-run-steps" title=${c('secSteps')} count=${`${def.steps.length} · ${c('secRunStepsSub')}`}>
        ${def.steps.map((s, i) => {
          const rs = run.steps?.[s.id] || {};
          const r = resolvedOf(s.id);
          const agents = stepAgents(s, r);
          const who = s.action?.kind === 'human-input' ? c('you') : agents.join(', ');
          const obs = ctx.observedWords(rs.outputObserved || rs.inputObserved);
          const imgs = collectImages([rs.outputObserved, rs.inputObserved, rs.writes], s.id);
          const why = rs.state === 'input-red' ? c('whyInput', { what: r?.required_to_function && r.required_to_function !== 'none' ? signalWords(r.required_to_function) : '' })
            : rs.state === 'output-red' ? c('whyOutput', { what: r?.success_signal ? signalWords(r.success_signal) : '' })
            : rs.state === 'skipped' ? c('whySkipped') : rs.state === 'timed-out' ? c('whyTimedOut') : rs.state === 'agent-offline' ? c('whyOffline')
            : rs.state === 'green' ? c('whyGreen', { what: r?.success_signal ? signalWords(r.success_signal) : '' }) : rs.state === 'dispatched' ? c('whyDispatched', { since: rel(rs.startedAt || run.startedAt) }) : '';
          return html`<${ListRow} key=${s.id} number=${String(i + 1).padStart(2, '0')} name=${stepTitle(s)}
            detail=${`${s.id} · ${who}${s.offer ? ` · ${s.offer}` : ''}`}
            value=${html`<${Stack} density="compact">
              <${Text} kind="label" tone=${toneOf(stepTone(rs.state))}>${stepWord(rs.state)}<//>
              ${obs ? html`<${Text} kind="caption">${obs}<//>` : null}
              ${rs.attempt ? html`<${Text} kind="caption">${c('attemptsN', { n: rs.attempt + 1 })}<//>` : null}
              ${rs.endedAt ? html`<${Text} kind="caption">${rel(rs.endedAt)}<//>` : null}
            <//>`}>
            <${Stack} density="compact">
              ${why ? html`<${Text}>${why}<//>` : null}
              ${rs.human?.answer ? html`<${Text}>${c('answered', { pick: rs.human.answer.pick || (rs.human.answer.picks || []).join(', '), other: rs.human.answer.other || '', by: String(rs.human.answer.by || '').split('@')[0] })}<//>` : null}
              ${imgs.length ? html`<${ImageStrip} images=${imgs} />` : null}
            <//>
          <//>`; })}
      <//>
      <${Fold} id="wp-raw" number=${waiting.length ? '03' : '02'} title=${c('rawTitle')} sub=${c('rawSub')} open=${ctx.folds.raw} onToggle=${() => ctx.setFold('raw', !ctx.folds.raw)}>
        <${Surface} kind="code">${JSON.stringify({ runId: run.runId, mode: run.mode, status: run.status, vars: run.vars, steps: run.steps, resolved: run.resolved }, null, 2)}<//>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}
