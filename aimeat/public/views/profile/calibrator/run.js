/**
 * @file public/views/profile/calibrator/run.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One run of a calibration as a row (its number, version and time; a score per
 *   model; what did not pass; the door), and what opens under it: the four steps as folds. Each
 *   step shows what the models said, in words a person can check (the checkpoints as a table, the
 *   proposals as lists, the synthesis as numbered proposals and three options), and carries the
 *   same three doors: run this step here, copy this step's prompt to your own AI, paste the answer
 *   back. The empty runs (created and never started) are one row with one door.
 * @structure runRow · emptiesRow · runBody · stepFold · stepDoors · stepGenerate · stepAnalyze ·
 *   stepReflect · proposalList · stepSynthesize · modelHead · pre · pasteBox
 * @usage import { runRow, emptiesRow } from './run.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set: a run is a shared row, a step a shared fold, the
 *     checkpoints a shared Table, the options shared radio choices, a long text a folded code
 *     surface; no page classes remain.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.0.1 — 2026-09-04 — Model labels through labelWords: the stored ones carry a maker prefix and a price.
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-batch.js v1.1.0 and calibrator-batch.step4.js).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { ListRow, Fold, Stack, Columns, Table, Surface, Field, Steps, Text, Chip, Action, CopyAction } from '/components/poster-parts.js';
import { StatusLine } from '../ai/frame.js';
import { x, STEPS, dateWord, timeWord, durationWords, runAverage, failedWords, stepsDone, labelWords } from './frame.js';
import { stepPrompts, optionProposals } from './engine.js';
import { scoreTone } from './list.js';

const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? '', null, 2));
const proposalText = (p) => (typeof p === 'string' ? p : p?.text || p?.proposal || JSON.stringify(p));
const score = (v) => html`<${Text} kind="number" size="small" tone=${v == null ? 'muted' : scoreTone(v)}>${v != null ? v + ' %' : '·'}<//>`;

/* ── The row ──────────────────────────────────────────────────────────────────────────────────── */

export function runRow(ctx, run) {
  const id = run.batchId;
  const open = ctx.openRun === id;
  const detail = ctx.details[id];
  const running = !!ctx.running[id];
  const avg = runAverage(run);
  const done = detail ? stepsDone(detail) : null;
  const state = running ? ctx.progress[id] || x('stateRunning')
    : done ? (done.synthesize ? x('stateDone') : x('stateAt', { step: x('stepShort.' + (done.reflect ? 'reflect' : done.analyze ? 'analyze' : done.generate ? 'generate' : 'none')) }))
      : run.status === 'synthesized' ? x('stateDone') : x('stateAt', { step: x('stepShort.' + statusStep(run.status)) });
  const fails = detail ? (detail.models || []).map((m) => ({ label: labelWords(m.modelLabel), words: failedWords(m) })).filter((f) => f.words.length) : [];
  const what = fails.length ? fails.map((f) => `${f.label}: ${f.words.join(', ')}`).join(' · ') : (detail && avg != null ? x('allPassed') : '');
  return html`
    <${ListRow} key=${id} id=${'cal-run-' + id} name=${x('runN', { n: run.number })} onOpen=${() => ctx.toggleRun(id)}
      detail=${`v${run.promptVersion} · ${dateWord(run.createdAt)} ${timeWord(run.createdAt)} · ${state}`}
      value=${avg != null ? html`<${Text} kind="caption">${x('averageN', { n: avg })}<//>` : undefined}
      actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggleRun(id)}>${open ? x('close') : x('open')}<//>`}>
      <${Stack} density="compact">
        <${Stack} direction="wrap">
          ${(run.scores || []).map((s) => html`<${Stack} key=${s.modelId} density="compact">${score(s.overallScore)}<${Text} kind="caption" tone="muted" title=${s.modelLabel}>${labelWords(s.modelLabel)}<//><//>`)}
        <//>
        ${what ? html`<${Text} kind="caption" tone="muted">${what}<//>` : null}
        ${open ? html`<${Surface} kind="record">${detail ? runBody(ctx, run, detail) : html`<${Text} tone="muted">${x('loading')}<//>`}<//>` : null}
      <//>
    <//>`;
}

const statusStep = (status) => (status === 'reflected' ? 'reflect' : status === 'analyzed' ? 'analyze' : status === 'generated' ? 'generate' : 'none');

export function emptiesRow(ctx, empties) {
  if (!empties.length) return null;
  return html`
    <${ListRow} muted=${true} name=${x('emptyRunsN', { n: empties.length })} detailKind="text" detail=${x('emptyRunsSub')}
      actions=${html`<${Action} tone="danger" disabled=${ctx.busy === 'runs'} onClick=${() => ctx.deleteEmpties()}>${x('deleteEmpties')}<//>`}>
      <${Text} kind="caption" tone="muted">${x('emptyRunsWhat')}<//>
    <//>`;
}

/* ── What opens under a run ───────────────────────────────────────────────────────────────────── */

function runBody(ctx, run, detail) {
  const done = stepsDone(detail);
  const slowest = Math.max(0, ...(detail.models || []).map((m) => Number(m.step1_generation?.durationMs) || 0));
  const nDone = STEPS.filter((s) => done[s]).length;
  const running = !!ctx.running[run.batchId];
  return html`<${Stack}>
    <${Text} kind="lead">${x('runLead', { n: run.number, v: run.promptVersion, date: dateWord(run.createdAt), time: timeWord(run.createdAt) })}${slowest ? ' ' + x('runLeadTook', { d: durationWords(slowest) }) : ''} ${x('runLeadSteps', { n: nDone })}${done.synthesize && detail.step4_synthesis?.options ? ' ' + x('runLeadOptions') : ''}<//>
    ${running ? html`<${StatusLine}>${ctx.progress[run.batchId] || x('stateRunning')}<//>` : null}
    ${ctx.runMsg && ctx.runMsg.id === run.batchId ? html`<${StatusLine} error=${ctx.runMsg.error}>${ctx.runMsg.text}<//>` : null}
    <div>
      ${STEPS.map((step, i) => stepFold(ctx, run, detail, step, i, done))}
    </div>
    <${Stack} direction="wrap" align="center">
      ${!done.synthesize && !running ? html`<${Action} onClick=${() => ctx.runRest(run.batchId)}>${nDone ? x('runRest') : x('runAllSteps')}<//>` : null}
      <${Action} tone="danger" disabled=${running || ctx.busy === 'runs'} onClick=${() => ctx.deleteRun(run.batchId)}>${x('deleteRun')}<//>
    <//>
  <//>`;
}

function stepFold(ctx, run, detail, step, i, done) {
  const open = ctx.openStep === step;
  const models = detail.models || [];
  const right = done[step]
    ? (step === 'analyze' ? x('stepRightScored', { n: models.filter((m) => m.step2_analysis?.status === 'done').length })
      : step === 'synthesize' ? x('stepRightProposals', { n: (detail.step4_synthesis?.groupedProposals || []).length })
        : x('stepRightDone'))
    : x('stepRightPending');
  return html`
    <${Fold} key=${step} number=${String(i + 1)} title=${x('step.' + step)} sub=${right} open=${open} onToggle=${() => ctx.setOpenStep(open ? null : step)}>
      <${Text}>${x('stepWhat.' + step)}<//>
      ${step === 'generate' ? stepGenerate(ctx, run, detail) : step === 'analyze' ? stepAnalyze(ctx, run, detail) : step === 'reflect' ? stepReflect(ctx, run, detail) : stepSynthesize(ctx, run, detail)}
      ${stepDoors(ctx, run, detail, step)}
    <//>`;
}

function stepDoors(ctx, run, detail, step) {
  const running = !!ctx.running[run.batchId];
  const prompts = stepPrompts(step, ctx.engineFor(detail), detail);
  const can = step === 'generate' || (step === 'analyze' && (detail.models || []).some((m) => m.step1_generation?.status === 'done')) || (step === 'reflect' && (detail.models || []).some((m) => m.step2_analysis?.status === 'done')) || (step === 'synthesize' && (detail.models || []).some((m) => m.step3_reflection?.status === 'done'));
  return html`
    <${Stack} density="compact">
      <${Stack} direction="wrap" align="center">
        <${Action} disabled=${running || !can || !ctx.keyed} onClick=${() => ctx.runStep(run.batchId, step)}>${x('runStepHere')}<//>
        ${prompts.length === 1 ? html`<${CopyAction} text=${prompts[0].text} label=${x('copyStepPrompt')} />` : null}
        ${step === 'synthesize' ? html`<${Action} onClick=${() => ctx.openPaste({ batchId: run.batchId, step, index: 0 })}>${x('pasteAnswer')}<//>` : null}
      <//>
      ${prompts.length > 1 ? html`<${Stack} direction="wrap" align="center"><${Text} kind="caption" tone="muted">${x('copyStepPrompts')}<//>${prompts.map((p, i) => html`<${CopyAction} key=${i} text=${p.text} label=${p.label} />`)}<//>` : null}
      ${!can ? html`<${Text} kind="caption" tone="muted">${x('stepNeedsPrevious')}<//>` : null}
      ${step === 'synthesize' ? pasteBox(ctx, { batchId: run.batchId, step, index: 0 }) : null}
    <//>`;
}

/** One model's heading inside a step: its name, a score when there is one, and a short note. */
function modelHead(label, figure, note) {
  return html`<${Stack} direction="wrap" align="center">
    <strong>${label}</strong>${figure}${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}
  <//>`;
}

/* ── Step 1: the models answer ────────────────────────────────────────────────────────────────── */

function stepGenerate(ctx, run, detail) {
  return html`${(detail.models || []).map((m, i) => {
    const g = m.step1_generation || {};
    return html`
      <${Surface} kind="box" density="compact" key=${m.modelId}><${Stack} density="compact">
        ${modelHead(labelWords(m.modelLabel), null, g.status === 'done' ? (durationWords(g.durationMs) || x('pasted')) : g.status === 'error' ? null : x('stepRightPending'))}
        ${g.status === 'error' ? html`<${StatusLine} error=${true}>${g.error}<//>` : null}
        ${g.output ? pre(x('viewOutput'), g.output) : null}
        <${Stack} direction="wrap" align="center">
          ${g.output ? html`<${CopyAction} text=${g.output} label=${x('copyOutput')} />` : null}
          <${Action} onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'generate', index: i })}>${x('pasteAnswer')}<//>
        <//>
        ${pasteBox(ctx, { batchId: run.batchId, step: 'generate', index: i })}
      <//><//>`;
  })}`;
}

/* ── Step 2: the judge compares ───────────────────────────────────────────────────────────────── */

function stepAnalyze(ctx, run, detail) {
  const models = (detail.models || []).filter((m) => m.step1_generation?.status === 'done');
  if (!models.length) return html`<${Text} tone="muted">${x('noOutputsYet')}<//>`;
  return html`${models.map((m) => {
    const i = detail.models.indexOf(m);
    const a = m.step2_analysis || {};
    const dims = a.dimensions || [];
    return html`
      <${Surface} kind="box" density="compact" key=${m.modelId}><${Stack} density="compact">
        ${modelHead(labelWords(m.modelLabel), a.overallScore != null ? score(a.overallScore) : null, a.status === 'done' ? x('checkpointsN', { n: dims.length, ok: dims.filter((d) => d.pass).length }) : a.status === 'error' ? null : x('stepRightPending'))}
        ${a.status === 'error' ? html`<${StatusLine} error=${true}>${a.error}<//>` : null}
        ${dims.length ? html`<${Table} collapse="600" density="compact" label=${x('colCheckpoint')}
          headers=${['', x('colCheckpoint'), x('colExpected'), x('colActual'), x('colWeight')]}
          rows=${dims.map((d) => [
            html`<${Text} tone=${d.pass ? 'success' : 'danger'}>${d.pass ? '✓' : '✗'}<//>`,
            html`<${Stack} density="compact"><strong>${String(d.name || '').replace(/_/g, ' ')}</strong>${d.description ? html`<${Text} kind="caption" tone="muted">${d.description}<//>` : null}<//>`,
            d.expected || '',
            d.actual || '',
            html`<${Text} kind="caption">${x('severity.' + (d.severity || 'minor'))}<//>`,
          ])} />` : null}
        ${a.analysis ? pre(x('viewAnalysis'), text(a.analysis)) : null}
        ${a.promptSent ? pre(x('viewPromptSent'), a.promptSent) : null}
        <div><${Action} onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'analyze', index: i })}>${x('pasteAnswer')}<//></div>
        ${pasteBox(ctx, { batchId: run.batchId, step: 'analyze', index: i })}
      <//><//>`;
  })}`;
}

/* ── Step 3: proposals ────────────────────────────────────────────────────────────────────────── */

function stepReflect(ctx, run, detail) {
  const models = (detail.models || []).filter((m) => m.step2_analysis?.status === 'done');
  if (!models.length) return html`<${Text} tone="muted">${x('noScoresYet')}<//>`;
  return html`${models.map((m) => {
    const i = detail.models.indexOf(m);
    const r = m.step3_reflection || {};
    return html`
      <${Surface} kind="box" density="compact" key=${m.modelId}><${Stack} density="compact">
        ${modelHead(labelWords(m.modelLabel), null, r.status === 'done' ? x('proposalsN', { n: (r.judgeProposals?.proposals?.length || 0) + (r.selfProposals?.proposals?.length || 0) }) : x('stepRightPending'))}
        <${Columns} collapse="640">
          ${proposalList(ctx, run, i, 'judge', x('judgeProposals'), r.judgeProposals)}
          ${proposalList(ctx, run, i, 'self', x('selfProposals', { model: labelWords(m.modelLabel) }), r.selfProposals)}
        <//>
      <//><//>`;
  })}`;
}

function proposalList(ctx, run, index, which, title, part) {
  const list = part?.proposals || [];
  return html`
    <${Stack} density="compact">
      <${Text} kind="label">${title}<//>
      ${part?.error ? html`<${StatusLine} error=${true}>${part.error}<//>` : null}
      ${list.length ? html`<${Steps} items=${list.map((p) => proposalText(p))} />` : (!part?.error ? html`<${Text} tone="muted">${x('noProposals')}<//>` : null)}
      ${part?.reasoning && list.length ? pre(x('viewReasoning'), text(part.reasoning)) : null}
      <div><${Action} onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'reflect', index, which })}>${x('pasteAnswer')}<//></div>
      ${pasteBox(ctx, { batchId: run.batchId, step: 'reflect', index, which })}
    <//>`;
}

/* ── Step 4: the synthesis and the next version ───────────────────────────────────────────────── */

function stepSynthesize(ctx, run, detail) {
  const s = detail.step4_synthesis || {};
  const props = s.groupedProposals || [];
  const options = s.options || null;
  const key = ctx.option[run.batchId] || (options?.B ? 'B' : options?.A ? 'A' : 'C');
  const chosen = new Set((options?.[key]?.proposalIds || []).map((v) => (typeof v === 'number' ? v : -1)));
  const applying = ctx.busy === 'apply:' + run.batchId;
  if (s.status !== 'done' && !props.length) return html`${s.error ? html`<${StatusLine} error=${true}>${s.error}<//>` : html`<${Text} tone="muted">${x('noSynthesisYet')}<//>`}`;
  return html`
    ${s.error ? html`<${StatusLine} error=${true}>${s.error}<//>` : null}
    ${props.length ? html`
      <${Text} kind="label">${x('groupedProposals')}<//>
      <div>
        ${props.map((gp, i) => html`
          <${ListRow} key=${i} density="compact" number=${String(i + 1)} muted=${!chosen.has(i)} name=${proposalText(gp)}
            value=${gp.impact || gp.risk ? html`<${Stack} direction="wrap" density="compact">${gp.impact ? html`<${Chip} tone=${gp.impact === 'high' ? 'coral' : 'plain'}>${x('impact.' + gp.impact) || gp.impact}<//>` : null}${gp.risk ? html`<${Chip}>${x('risk.' + gp.risk) || gp.risk}<//>` : null}<//>` : undefined}>
            ${gp.explanation || gp.sources ? html`<${Stack} density="compact">
              ${gp.explanation ? html`<${Text} kind="caption">${gp.explanation}<//>` : null}
              ${gp.sources ? html`<${Text} kind="caption" tone="muted">${x('sources')}: ${Array.isArray(gp.sources) ? gp.sources.join(', ') : gp.sources}<//>` : null}
            <//>` : null}
          <//>`)}
      </div>` : null}
    ${options ? html`
      <${Text} kind="label">${x('options')}<//>
      <${Columns} collapse="640" density="compact">
        ${['A', 'B', 'C'].filter((k) => options[k]).map((k) => html`
          <${Action} key=${k} kind="choice" semantics="radio" title=${x('option.' + k)} selected=${key === k} onClick=${() => ctx.setOption(run.batchId, k)}>
            ${x('optionCount', { n: (options[k].proposalIds || []).length })}${options[k].expectedImpact ? ' · ' + options[k].expectedImpact : ''}
          <//>`)}
      <//>` : null}
    ${s.recommendation ? html`<${Text}><strong>${x('recommendation')}:</strong> ${s.recommendation}<//>` : null}
    ${s.analysis && props.length ? pre(x('viewAnalysis'), text(s.analysis)) : null}
    ${options ? html`
      <${Stack} direction="wrap" align="center">
        <${Action} disabled=${applying || !ctx.keyed || !optionProposals(s, key).length} onClick=${() => ctx.applyOption(run.batchId, key)}>${applying ? x('applying') : x('applyOption', { option: key, v: (ctx.project.currentVersion || 0) + 1 })}<//>
        <${CopyAction} text=${ctx.applyText(detail, key)} label=${x('copyApplyPrompt')} />
        <${Text} kind="caption" tone="muted">${applying ? x('applyingHint') : x('applyHint')}<//>
      <//>` : null}`;
}

/* ── Small parts ──────────────────────────────────────────────────────────────────────────────── */

/** A long text folded behind its label, shown as written. */
function pre(label, body) {
  if (!body) return null;
  return html`<${Surface} kind="code" summary=${label}>${body}<//>`;
}

function pasteBox(ctx, spec) {
  const p = ctx.paste;
  if (!p || p.batchId !== spec.batchId || p.step !== spec.step || p.index !== spec.index || (p.which || '') !== (spec.which || '')) return null;
  return html`
    <${Stack} density="compact">
      <${Field} type="textarea" rows=${6} label=${x('pasteLabel.' + spec.step)} value=${ctx.pasteText} placeholder=${x('pastePlaceholder')} onInput=${(e) => ctx.setPasteText(e.target.value)} />
      <${Stack} direction="wrap" align="center">
        <${Action} disabled=${!ctx.pasteText.trim() || ctx.busy === 'paste'} onClick=${() => ctx.savePaste()}>${x('save')}<//>
        <${Action} onClick=${() => ctx.openPaste(null)}>${x('cancel')}<//>
      <//>
    <//>`;
}
