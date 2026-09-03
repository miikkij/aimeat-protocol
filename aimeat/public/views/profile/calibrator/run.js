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
 * @structure runRow · emptiesRow · runBody · stepFold · stepGenerate · stepAnalyze · stepReflect ·
 *   stepSynthesize · pasteBox · pre · proposalList
 * @usage import { runRow, emptiesRow } from './run.js';
 * @version-history
 *   v1.0.1 — 2026-09-04 — Model labels through labelWords: the stored ones carry a maker prefix and a price.
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-batch.js v1.1.0 and calibrator-batch.step4.js).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { CopyButton } from '/components/CopyButton.js';
import { x, STEPS, dateWord, timeWord, durationWords, runAverage, failedWords, stepsDone, labelWords } from './frame.js';
import { stepPrompts, optionProposals } from './engine.js';

const scoreClass = (v) => (v == null ? 'is-dim' : v >= 80 ? 'is-good' : v >= 50 ? 'is-mid' : 'is-low');
const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? '', null, 2));
const proposalText = (p) => (typeof p === 'string' ? p : p?.text || p?.proposal || JSON.stringify(p));

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
  return html`
    <div class=${`cal-row cal-run ${open ? 'is-open' : ''}`} key=${id} id=${'cal-run-' + id}>
      <div class="cal-nm"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleRun(id)}>${x('runN', { n: run.number })}</button><small>v${run.promptVersion} · ${dateWord(run.createdAt)} ${timeWord(run.createdAt)} · ${state}</small></div>
      <div class="cal-sc cal-sc--many">${(run.scores || []).map((s) => html`<span key=${s.modelId}><b class=${scoreClass(s.overallScore)}>${s.overallScore != null ? s.overallScore + ' %' : '·'}</b><small title=${s.modelLabel}>${labelWords(s.modelLabel)}</small></span>`)}</div>
      <div class="cal-w">${avg != null ? html`<b>${x('averageN', { n: avg })}</b> ` : null}${fails.length ? fails.map((f) => `${f.label}: ${f.words.join(', ')}`).join(' · ') : (detail && avg != null ? x('allPassed') : '')}</div>
      <div class="cal-go"><button type="button" class="og-door" onClick=${() => ctx.toggleRun(id)}>${open ? x('close') : x('open')}</button></div>
      ${open ? html`<div class="cal-open">${detail ? runBody(ctx, run, detail) : html`<p class="cal-empty">${x('loading')}</p>`}</div>` : null}
    </div>`;
}

const statusStep = (status) => (status === 'reflected' ? 'reflect' : status === 'analyzed' ? 'analyze' : status === 'generated' ? 'generate' : 'none');

export function emptiesRow(ctx, empties) {
  if (!empties.length) return null;
  return html`
    <div class="cal-row cal-run is-empty">
      <div class="cal-nm"><span class="og-tbl-name">${x('emptyRunsN', { n: empties.length })}</span><small>${x('emptyRunsSub')}</small></div>
      <div class="cal-sc"></div>
      <div class="cal-w">${x('emptyRunsWhat')}</div>
      <div class="cal-go"><button type="button" class="og-door og-door--quiet og-door--danger" disabled=${ctx.busy === 'runs'} onClick=${() => ctx.deleteEmpties()}>${x('deleteEmpties')}</button></div>
    </div>`;
}

/* ── What opens under a run ───────────────────────────────────────────────────────────────────── */

function runBody(ctx, run, detail) {
  const done = stepsDone(detail);
  const slowest = Math.max(0, ...(detail.models || []).map((m) => Number(m.step1_generation?.durationMs) || 0));
  const nDone = STEPS.filter((s) => done[s]).length;
  const running = !!ctx.running[run.batchId];
  return html`
    <p class="cal-lead">${x('runLead', { n: run.number, v: run.promptVersion, date: dateWord(run.createdAt), time: timeWord(run.createdAt) })}${slowest ? ' ' + x('runLeadTook', { d: durationWords(slowest) }) : ''} ${x('runLeadSteps', { n: nDone })}${done.synthesize && detail.step4_synthesis?.options ? ' ' + x('runLeadOptions') : ''}</p>
    ${running ? html`<p class="cal-msg">${ctx.progress[run.batchId] || x('stateRunning')}</p>` : null}
    ${ctx.runMsg && ctx.runMsg.id === run.batchId ? html`<p class=${`cal-msg ${ctx.runMsg.error ? 'is-err' : ''}`}>${ctx.runMsg.text}</p>` : null}
    <div class="cal-steps">
      ${STEPS.map((step, i) => stepFold(ctx, run, detail, step, i, done))}
    </div>
    <div class="og-doors cal-run-doors">
      ${!done.synthesize && !running ? html`<button type="button" class="og-door" onClick=${() => ctx.runRest(run.batchId)}>${nDone ? x('runRest') : x('runAllSteps')}</button>` : null}
      <button type="button" class="og-door og-door--quiet og-door--danger" disabled=${running || ctx.busy === 'runs'} onClick=${() => ctx.deleteRun(run.batchId)}>${x('deleteRun')}</button>
    </div>`;
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
    <section class=${`cal-step ${open ? 'is-open' : ''} ${done[step] ? 'is-done' : ''}`} key=${step}>
      <button type="button" class="og-fold og-fold--toggle" aria-expanded=${open ? 'true' : 'false'} onClick=${() => ctx.setOpenStep(open ? null : step)}>
        <i>${i + 1}</i><span>${x('step.' + step)}</span><span class="og-fold-r">${right}</span><span class="og-fold-arrow">${open ? '↓' : '→'}</span>
      </button>
      ${open ? html`<div class="cal-step-body">
        <p class="cal-para">${x('stepWhat.' + step)}</p>
        ${step === 'generate' ? stepGenerate(ctx, run, detail) : step === 'analyze' ? stepAnalyze(ctx, run, detail) : step === 'reflect' ? stepReflect(ctx, run, detail) : stepSynthesize(ctx, run, detail)}
        ${stepDoors(ctx, run, detail, step)}
      </div>` : null}
    </section>`;
}

function stepDoors(ctx, run, detail, step) {
  const running = !!ctx.running[run.batchId];
  const prompts = stepPrompts(step, ctx.engineFor(detail), detail);
  const can = step === 'generate' || (step === 'analyze' && (detail.models || []).some((m) => m.step1_generation?.status === 'done')) || (step === 'reflect' && (detail.models || []).some((m) => m.step2_analysis?.status === 'done')) || (step === 'synthesize' && (detail.models || []).some((m) => m.step3_reflection?.status === 'done'));
  return html`
    <div class="cal-step-doors">
      <div class="og-doors">
        <button type="button" class="og-door" disabled=${running || !can || !ctx.keyed} onClick=${() => ctx.runStep(run.batchId, step)}>${x('runStepHere')}</button>
        ${prompts.length === 1 ? html`<${CopyButton} className="og-door og-door--quiet" text=${prompts[0].text} label=${x('copyStepPrompt')} />` : null}
        ${step === 'synthesize' ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openPaste({ batchId: run.batchId, step, index: 0 })}>${x('pasteAnswer')}</button>` : null}
      </div>
      ${prompts.length > 1 ? html`<div class="cal-copies"><small>${x('copyStepPrompts')}</small>${prompts.map((p, i) => html`<${CopyButton} key=${i} className="og-door og-door--quiet" text=${p.text} label=${p.label} />`)}</div>` : null}
      ${!can ? html`<small class="cal-hint">${x('stepNeedsPrevious')}</small>` : null}
      ${step === 'synthesize' ? pasteBox(ctx, { batchId: run.batchId, step, index: 0 }) : null}
    </div>`;
}

/* ── Step 1: the models answer ────────────────────────────────────────────────────────────────── */

function stepGenerate(ctx, run, detail) {
  return html`${(detail.models || []).map((m, i) => {
    const g = m.step1_generation || {};
    return html`
      <div class="cal-m" key=${m.modelId}>
        <div class="cal-m-h"><b>${labelWords(m.modelLabel)}</b><small>${g.status === 'done' ? (durationWords(g.durationMs) || x('pasted')) : g.status === 'error' ? html`<span class="is-err">${g.error}</span>` : x('stepRightPending')}</small></div>
        ${g.output ? pre(x('viewOutput'), g.output) : null}
        <div class="og-doors">
          ${g.output ? html`<${CopyButton} className="og-door og-door--quiet" text=${g.output} label=${x('copyOutput')} />` : null}
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'generate', index: i })}>${x('pasteAnswer')}</button>
        </div>
        ${pasteBox(ctx, { batchId: run.batchId, step: 'generate', index: i })}
      </div>`;
  })}`;
}

/* ── Step 2: the judge compares ───────────────────────────────────────────────────────────────── */

function stepAnalyze(ctx, run, detail) {
  const models = (detail.models || []).filter((m) => m.step1_generation?.status === 'done');
  if (!models.length) return html`<p class="cal-empty">${x('noOutputsYet')}</p>`;
  return html`${models.map((m) => {
    const i = detail.models.indexOf(m);
    const a = m.step2_analysis || {};
    const dims = a.dimensions || [];
    return html`
      <div class="cal-m" key=${m.modelId}>
        <div class="cal-m-h"><b>${labelWords(m.modelLabel)}</b>${a.overallScore != null ? html`<b class=${'cal-pct ' + scoreClass(a.overallScore)}>${a.overallScore} %</b>` : null}<small>${a.status === 'error' ? html`<span class="is-err">${a.error}</span>` : a.status === 'done' ? x('checkpointsN', { n: dims.length, ok: dims.filter((d) => d.pass).length }) : x('stepRightPending')}</small></div>
        ${dims.length ? html`
          <div class="cal-dims">
            <div class="cal-dh"></div><div class="cal-dh">${x('colCheckpoint')}</div><div class="cal-dh">${x('colExpected')}</div><div class="cal-dh">${x('colActual')}</div><div class="cal-dh">${x('colWeight')}</div>
            ${dims.map((d, k) => html`
              <div key=${'p' + k} class=${d.pass ? 'is-good' : 'is-low'}>${d.pass ? '✓' : '✗'}</div>
              <div key=${'n' + k}><b>${String(d.name || '').replace(/_/g, ' ')}</b>${d.description ? html`<small>${d.description}</small>` : null}</div>
              <div key=${'e' + k}>${d.expected || ''}</div>
              <div key=${'a' + k}>${d.actual || ''}</div>
              <div key=${'s' + k}><small>${x('severity.' + (d.severity || 'minor'))}</small></div>`)}
          </div>` : null}
        ${a.analysis ? pre(x('viewAnalysis'), text(a.analysis)) : null}
        ${a.promptSent ? pre(x('viewPromptSent'), a.promptSent) : null}
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'analyze', index: i })}>${x('pasteAnswer')}</button>
        </div>
        ${pasteBox(ctx, { batchId: run.batchId, step: 'analyze', index: i })}
      </div>`;
  })}`;
}

/* ── Step 3: proposals ────────────────────────────────────────────────────────────────────────── */

function stepReflect(ctx, run, detail) {
  const models = (detail.models || []).filter((m) => m.step2_analysis?.status === 'done');
  if (!models.length) return html`<p class="cal-empty">${x('noScoresYet')}</p>`;
  return html`${models.map((m) => {
    const i = detail.models.indexOf(m);
    const r = m.step3_reflection || {};
    return html`
      <div class="cal-m" key=${m.modelId}>
        <div class="cal-m-h"><b>${labelWords(m.modelLabel)}</b><small>${r.status === 'done' ? x('proposalsN', { n: (r.judgeProposals?.proposals?.length || 0) + (r.selfProposals?.proposals?.length || 0) }) : x('stepRightPending')}</small></div>
        <div class="cal-cols">
          ${proposalList(ctx, run, i, 'judge', x('judgeProposals'), r.judgeProposals)}
          ${proposalList(ctx, run, i, 'self', x('selfProposals', { model: labelWords(m.modelLabel) }), r.selfProposals)}
        </div>
      </div>`;
  })}`;
}

function proposalList(ctx, run, index, which, title, part) {
  const list = part?.proposals || [];
  return html`
    <div class="cal-col">
      <span class="og-label">${title}</span>
      ${part?.error ? html`<p class="cal-msg is-err">${part.error}</p>` : null}
      ${list.length ? html`<ol class="cal-ol">${list.map((p, k) => html`<li key=${k}>${proposalText(p)}</li>`)}</ol>` : (!part?.error ? html`<p class="cal-empty">${x('noProposals')}</p>` : null)}
      ${part?.reasoning && list.length ? pre(x('viewReasoning'), text(part.reasoning)) : null}
      <div class="og-doors">
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'reflect', index, which })}>${x('pasteAnswer')}</button>
      </div>
      ${pasteBox(ctx, { batchId: run.batchId, step: 'reflect', index, which })}
    </div>`;
}

/* ── Step 4: the synthesis and the next version ───────────────────────────────────────────────── */

function stepSynthesize(ctx, run, detail) {
  const s = detail.step4_synthesis || {};
  const props = s.groupedProposals || [];
  const options = s.options || null;
  const key = ctx.option[run.batchId] || (options?.B ? 'B' : options?.A ? 'A' : 'C');
  const chosen = new Set((options?.[key]?.proposalIds || []).map((v) => (typeof v === 'number' ? v : -1)));
  const applying = ctx.busy === 'apply:' + run.batchId;
  if (s.status !== 'done' && !props.length) return html`${s.error ? html`<p class="cal-msg is-err">${s.error}</p>` : html`<p class="cal-empty">${x('noSynthesisYet')}</p>`}`;
  return html`
    ${s.error ? html`<p class="cal-msg is-err">${s.error}</p>` : null}
    ${props.length ? html`
      <span class="og-label">${x('groupedProposals')}</span>
      <div class="cal-props">
        ${props.map((gp, i) => html`
          <div class="cal-prop" key=${i}>
            <span class=${`cal-prop-n ${chosen.has(i) ? 'is-on' : ''}`}>${i + 1}</span>
            <span class="cal-prop-t">${proposalText(gp)}${gp.explanation ? html`<small>${gp.explanation}</small>` : null}${gp.sources ? html`<small>${x('sources')}: ${Array.isArray(gp.sources) ? gp.sources.join(', ') : gp.sources}</small>` : null}</span>
            <span class="cal-prop-tag">${gp.impact ? html`<em class=${gp.impact === 'high' ? 'is-hi' : ''}>${x('impact.' + gp.impact) || gp.impact}</em>` : null}${gp.risk ? html`<em>${x('risk.' + gp.risk) || gp.risk}</em>` : null}</span>
          </div>`)}
      </div>` : null}
    ${options ? html`
      <span class="og-label">${x('options')}</span>
      <div class="cal-opts">
        ${['A', 'B', 'C'].filter((k) => options[k]).map((k) => html`
          <label class=${`cal-opt ${key === k ? 'is-on' : ''}`} key=${k}>
            <input type="radio" name=${'cal-opt-' + run.batchId} checked=${key === k} onChange=${() => ctx.setOption(run.batchId, k)} />
            <span><b>${x('option.' + k)}</b><small>${x('optionCount', { n: (options[k].proposalIds || []).length })}${options[k].expectedImpact ? ' · ' + options[k].expectedImpact : ''}</small></span>
          </label>`)}
      </div>` : null}
    ${s.recommendation ? html`<p class="cal-para"><b>${x('recommendation')}:</b> ${s.recommendation}</p>` : null}
    ${s.analysis && props.length ? pre(x('viewAnalysis'), text(s.analysis)) : null}
    ${options ? html`
      <div class="cal-apply">
        <button type="button" class="og-slab" disabled=${applying || !ctx.keyed || !optionProposals(s, key).length} onClick=${() => ctx.applyOption(run.batchId, key)}>${applying ? x('applying') : x('applyOption', { option: key, v: (ctx.project.currentVersion || 0) + 1 })}</button>
        <${CopyButton} className="og-door og-door--quiet" text=${ctx.applyText(detail, key)} label=${x('copyApplyPrompt')} />
        <small>${applying ? x('applyingHint') : x('applyHint')}</small>
      </div>` : null}`;
}

/* ── Small parts ──────────────────────────────────────────────────────────────────────────────── */

function pre(label, body) {
  if (!body) return null;
  return html`<details class="cal-pre"><summary>${label}</summary><pre>${body}</pre></details>`;
}

function pasteBox(ctx, spec) {
  const p = ctx.paste;
  if (!p || p.batchId !== spec.batchId || p.step !== spec.step || p.index !== spec.index || (p.which || '') !== (spec.which || '')) return null;
  return html`
    <div class="cal-paste">
      <span class="og-label">${x('pasteLabel.' + spec.step)}</span>
      <textarea class="og-textarea" rows="6" value=${ctx.pasteText} placeholder=${x('pastePlaceholder')} aria-label=${x('pasteAnswer')} onInput=${(e) => ctx.setPasteText(e.target.value)}></textarea>
      <div class="og-doors">
        <button type="button" class="og-door" disabled=${!ctx.pasteText.trim() || ctx.busy === 'paste'} onClick=${() => ctx.savePaste()}>${x('save')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openPaste(null)}>${x('cancel')}</button>
      </div>
    </div>`;
}
