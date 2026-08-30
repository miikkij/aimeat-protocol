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
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold } from '/views/profile/organisms/poster-parts.js';
import { collectImages, ImageStrip } from '/components/ImageDeliverable.js';
import { c, loc, rel, day, durationWords, stepWord, stepTone, runWord, runTone, verdictOf, stepTitle, stepAgents, signalWords, renderPage } from './frame.js';
import { questionBlock } from './cover.js';

export function renderRun(ctx, item, runId) {
  const run = ctx.run?.runId === runId ? ctx.run : null;
  const wfTitle = loc(item.def.title) || item.def.id;
  const back = html`<button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'detail', id: item.def.id })}><i>←</i>${c('backToWorkflow')}</button>`;
  const crumbWf = html`<button type="button" class="og-crumb-link" onClick=${() => ctx.pickView({ kind: 'detail', id: item.def.id })}>${wfTitle}</button>`;
  if (!run) return renderPage(ctx, { crumbs: [crumbWf, '…'], title: wfTitle, back, children: html`<p class="og-empty wp-loading">${t('common.loading')}</p>` });

  const def = run.defSnapshot || item.def;
  const v = verdictOf(run);
  const inFlight = run.status === 'running' || run.status === 'waiting-step';
  const green = def.steps.filter(s => run.steps?.[s.id]?.state === 'green').length;
  const took = run.endedAt ? durationWords(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) : '';
  const waiting = def.steps.filter(s => run.steps?.[s.id]?.state === 'waiting-human');
  const resolvedOf = (id) => (run.resolved || []).find(r => r.stepId === id);
  const isCheck = run.mode === 'signals-only';
  const title = `${wfTitle} · ${isCheck ? c('checkWord') : c('runWord')} ${day(run.startedAt)}`;

  const chips = html`
    <span class=${`og-chip ${runTone(run.status) === 'bad' ? 'og-chip--coral' : runTone(run.status) === 'wait' ? 'og-chip--sun' : runTone(run.status) === 'ok' ? 'og-chip--sun' : ''}`}>${runWord(run.status)}</span>
    <span class="og-chip">${c('startedChip', { when: rel(run.startedAt) })}</span>
    <span class="og-chip">${c('producedChip', { n: green, total: def.steps.length })}</span>
    ${took ? html`<span class="og-chip og-chip--dim">${c('tookChip', { took })}</span>` : null}
    ${isCheck ? html`<span class="og-chip og-chip--dim">${c('checkChip')}</span>` : run.mode === 'full-sandbox' ? html`<span class="og-chip og-chip--dim">${c('sandboxRun')}</span>` : null}
    ${Object.entries(run.vars || {}).filter(([k]) => k !== 'run').slice(0, 3).map(([k, val]) => html`<span class="og-chip og-chip--dim wp-chip--case" key=${k}>${k} = ${val}</span>`)}`;
  const doors = html`
    ${waiting.length ? html`<button type="button" class="og-slab" onClick=${() => document.getElementById('wp-question')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>${c('answer')}</button>` : null}
    ${inFlight ? html`<button type="button" class="og-door og-door--danger" disabled=${ctx.cancelling} onClick=${() => ctx.handleCancel(item.def.id, run.runId)}>${t('profile.workflows.cancelRun')}</button>` : null}
    ${!inFlight && !isCheck ? html`<button type="button" class="og-door" onClick=${() => { ctx.pickView({ kind: 'detail', id: item.def.id }); ctx.openConfirm(item.def.id); }}>${c('runAgain')}</button>` : null}`;
  const rail = html`
    <hr />
    <span class="og-rail-label">${c('statesTitle')}</span>
    <div class="wp-words wp-words--rail">
      ${['green', 'output-red', 'input-red', 'waiting-human', 'timed-out', 'agent-offline', 'skipped'].map(s => html`<div key=${s}><b class=${`wp-st--${stepTone(s)}`}>${stepWord(s)}</b> <code>${s}</code></div>`)}
    </div>`;

  return renderPage(ctx, {
    crumbs: [crumbWf, isCheck ? c('checkWord') : c('runWord') + ' ' + day(run.startedAt)],
    title, chips, doors, rail, back,
    children: html`
      <div class=${`wp-verdict wp-verdict--${v.tone}`}><div><b>${v.head}</b><span>${v.sub}</span></div></div>
      ${waiting.length ? html`<${Section} id="wp-question" num="01" title=${c('secQuestion')} first>
        ${ctx.pending.filter(p => p.runId === run.runId).map(p => questionBlock(ctx, p, false))}
        ${!ctx.pending.some(p => p.runId === run.runId) ? html`<p class="og-empty">${c('questionLoading')}</p>` : null}
      <//>` : null}
      <${Section} id="wp-run-steps" num=${waiting.length ? '02' : '01'} title=${c('secSteps')} count=${`${def.steps.length} · ${c('secRunStepsSub')}`} first=${!waiting.length}>
        ${def.steps.map((s, i) => {
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
          return html`
            <div class="wp-step" key=${s.id}>
              <div class="wp-step-n">${String(i + 1).padStart(2, '0')}</div>
              <div class="wp-step-body">
                <b>${stepTitle(s)}<small>${s.id} · ${who}${s.offer ? ` · ${s.offer}` : ''}</small></b>
                <div class="wp-sig">${why}</div>
                ${rs.human?.answer ? html`<div class="wp-sig">${c('answered', { pick: rs.human.answer.pick || (rs.human.answer.picks || []).join(', '), other: rs.human.answer.other || '', by: String(rs.human.answer.by || '').split('@')[0] })}</div>` : null}
                ${imgs.length ? html`<${ImageStrip} images=${imgs} />` : null}
              </div>
              <div class="wp-step-st"><b class=${`wp-st--${tone}`}>${stepWord(rs.state)}</b>${obs ? html`<span>${obs}</span>` : null}${rs.attempt ? html`<span>${c('attemptsN', { n: rs.attempt + 1 })}</span>` : null}${rs.endedAt ? html`<span>${rel(rs.endedAt)}</span>` : null}</div>
            </div>`; })}
      <//>
      <${Fold} id="wp-raw" num=${waiting.length ? '03' : '02'} title=${c('rawTitle')} sub=${c('rawSub')} open=${ctx.folds.raw} onToggle=${() => ctx.setFold('raw', !ctx.folds.raw)}>
        <pre class="wp-code">${JSON.stringify({ runId: run.runId, mode: run.mode, status: run.status, vars: run.vars, steps: run.steps, resolved: run.resolved }, null, 2)}</pre>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}
