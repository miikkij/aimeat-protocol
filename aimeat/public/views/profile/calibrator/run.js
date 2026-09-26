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
 *   stepReflect · proposalList · stepSynthesize · output · pasteBox
 * @usage import { runRow, emptiesRow } from './run.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- The page passes data to the library's components and writes no class: the row is the List's Row with its Panel, a score the Figure, what opens the Run view (components/RunView.js: the steps as folds, the model blocks, the checkpoints, the proposals, a folded output, the paste box), the options the boxed Choice with its radio dots, the lines Note (component plan, page group G4).
 *   v1.18.0 -- 2026-09-26 -- A folded output is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.17.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v1.14.0 -- 2026-09-26 -- A score is the small stat number (.poster-stat-number--small), as the wallet's amounts, a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-26 -- A run's step is the fold row at its own size, a finished step its done tone (.og-fold--done), a unification.
 *   v1.12.0 -- 2026-09-25 -- A line that says a part is still loading is the quiet sentence with the Loading mark (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A line that says what happened after an action is the Form message, a failure in its error tone (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- A road or an option you choose is the Choice tile (.poster-choice), a unification: the look most tabs use.
 *   v1.9.0 -- 2026-09-25 -- A run's row and the empty runs' row are the Listing (listing-row and its name, words and doors cells, the open panel), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.0.1 — 2026-09-04 — Model labels through labelWords: the stored ones carry a maker prefix and a price.
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-batch.js v1.1.0 and calibrator-batch.step4.js).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Figure, Tinted } from '/components/Figure.js';
import { Choice } from '/components/Choice.js';
import { TextArea } from '/components/TextField.js';
import { Split } from '/components/Layout.js';
import {
  RunSteps, RunStep, RunStepDoors, RunCopies, RunModel, RunChecks, RunColumns, RunColumn, RunProposals, RunOutput, RunApply, RunPaste,
} from '/components/RunView.js';
import { x, STEPS, dateWord, timeWord, durationWords, runAverage, failedWords, stepsDone, labelWords } from './frame.js';
import { stepPrompts, optionProposals } from './engine.js';

/** A score's state colour: none yet grey, fine from 80 %, the plain colour from 50 %, coral under it. */
const scoreTone = (v) => (v == null ? 'dim' : v >= 80 ? 'fine' : v >= 50 ? undefined : 'notice');
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
    <${Row} key=${id} id=${'cal-run-' + id} open=${open}
      panel=${detail ? runBody(ctx, run, detail) : html`<${Note} kind="loading">${x('loading')}<//>`}>
      <${Name} onOpen=${() => ctx.toggleRun(id)} meta=${html`v${run.promptVersion} · ${dateWord(run.createdAt)} ${timeWord(run.createdAt)} · ${state}`}>${x('runN', { n: run.number })}<//>
      <${Cell} line>${(run.scores || []).map((s) => html`<${Figure} key=${s.modelId} small tone=${scoreTone(s.overallScore)} n=${s.overallScore != null ? s.overallScore + ' %' : '·'} sub=${labelWords(s.modelLabel)} title=${s.modelLabel} />`)}<//>
      <${Desc}>${avg != null ? html`<b>${x('averageN', { n: avg })}</b> ` : null}${fails.length ? fails.map((f) => `${f.label}: ${f.words.join(', ')}`).join(' · ') : (detail && avg != null ? x('allPassed') : '')}<//>
      <${Doors}><${Action} small row onClick=${() => ctx.toggleRun(id)}>${open ? x('close') : x('open')}<//><//>
    <//>`;
}

const statusStep = (status) => (status === 'reflected' ? 'reflect' : status === 'analyzed' ? 'analyze' : status === 'generated' ? 'generate' : 'none');

export function emptiesRow(ctx, empties) {
  if (!empties.length) return null;
  return html`
    <${Row} key="empties" faded>
      <${Name} meta=${x('emptyRunsSub')}>${x('emptyRunsN', { n: empties.length })}<//>
      <${Cell} />
      <${Desc}>${x('emptyRunsWhat')}<//>
      <${Doors}><${Action} small row soft tone="danger" disabled=${ctx.busy === 'runs'} onClick=${() => ctx.deleteEmpties()}>${x('deleteEmpties')}<//><//>
    <//>`;
}

/* ── What opens under a run ───────────────────────────────────────────────────────────────────── */

function runBody(ctx, run, detail) {
  const done = stepsDone(detail);
  const slowest = Math.max(0, ...(detail.models || []).map((m) => Number(m.step1_generation?.durationMs) || 0));
  const nDone = STEPS.filter((s) => done[s]).length;
  const running = !!ctx.running[run.batchId];
  return html`
    <${Note} kind="lead">${x('runLead', { n: run.number, v: run.promptVersion, date: dateWord(run.createdAt), time: timeWord(run.createdAt) })}${slowest ? ' ' + x('runLeadTook', { d: durationWords(slowest) }) : ''} ${x('runLeadSteps', { n: nDone })}${done.synthesize && detail.step4_synthesis?.options ? ' ' + x('runLeadOptions') : ''}<//>
    ${running ? html`<${Note} kind="message">${ctx.progress[run.batchId] || x('stateRunning')}<//>` : null}
    ${ctx.runMsg && ctx.runMsg.id === run.batchId ? html`<${Note} kind="message" error=${!!ctx.runMsg.error}>${ctx.runMsg.text}<//>` : null}
    <${RunSteps}>
      ${STEPS.map((step, i) => stepFold(ctx, run, detail, step, i, done))}
    <//>
    <${Split} above="large">
      <${Actions}>
        ${!done.synthesize && !running ? html`<${Action} small onClick=${() => ctx.runRest(run.batchId)}>${nDone ? x('runRest') : x('runAllSteps')}<//>` : null}
        <${Action} small soft tone="danger" disabled=${running || ctx.busy === 'runs'} onClick=${() => ctx.deleteRun(run.batchId)}>${x('deleteRun')}<//>
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
    <${RunStep} key=${step} num=${i + 1} name=${x('step.' + step)} right=${right} done=${!!done[step]} open=${open} onToggle=${() => ctx.setOpenStep(open ? null : step)}>
      <${Note} kind="lead">${x('stepWhat.' + step)}<//>
      ${step === 'generate' ? stepGenerate(ctx, run, detail) : step === 'analyze' ? stepAnalyze(ctx, run, detail) : step === 'reflect' ? stepReflect(ctx, run, detail) : stepSynthesize(ctx, run, detail)}
      ${stepDoors(ctx, run, detail, step)}
    <//>`;
}

function stepDoors(ctx, run, detail, step) {
  const running = !!ctx.running[run.batchId];
  const prompts = stepPrompts(step, ctx.engineFor(detail), detail);
  const can = step === 'generate' || (step === 'analyze' && (detail.models || []).some((m) => m.step1_generation?.status === 'done')) || (step === 'reflect' && (detail.models || []).some((m) => m.step2_analysis?.status === 'done')) || (step === 'synthesize' && (detail.models || []).some((m) => m.step3_reflection?.status === 'done'));
  return html`
    <${RunStepDoors}>
      <${Actions}>
        <${Action} small disabled=${running || !can || !ctx.keyed} onClick=${() => ctx.runStep(run.batchId, step)}>${x('runStepHere')}<//>
        ${prompts.length === 1 ? html`<${Action} small soft copy=${prompts[0].text}>${x('copyStepPrompt')}<//>` : null}
        ${step === 'synthesize' ? html`<${Action} small soft onClick=${() => ctx.openPaste({ batchId: run.batchId, step, index: 0 })}>${x('pasteAnswer')}<//>` : null}
      <//>
      ${prompts.length > 1 ? html`<${RunCopies} label=${x('copyStepPrompts')}>${prompts.map((p, i) => html`<${Action} key=${i} small soft copy=${p.text}>${p.label}<//>`)}<//>` : null}
      ${!can ? html`<${Note}>${x('stepNeedsPrevious')}<//>` : null}
      ${step === 'synthesize' ? pasteBox(ctx, { batchId: run.batchId, step, index: 0 }) : null}
    <//>`;
}

/* ── Step 1: the models answer ────────────────────────────────────────────────────────────────── */

function stepGenerate(ctx, run, detail) {
  return html`${(detail.models || []).map((m, i) => {
    const g = m.step1_generation || {};
    return html`
      <${RunModel} key=${m.modelId} name=${labelWords(m.modelLabel)}
        meta=${g.status === 'done' ? (durationWords(g.durationMs) || x('pasted')) : g.status === 'error' ? html`<${Tinted} tone="notice">${g.error}<//>` : x('stepRightPending')}>
        ${g.output ? output(x('viewOutput'), g.output) : null}
        <${Actions}>
          ${g.output ? html`<${Action} small soft copy=${g.output}>${x('copyOutput')}<//>` : null}
          <${Action} small soft onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'generate', index: i })}>${x('pasteAnswer')}<//>
        <//>
        ${pasteBox(ctx, { batchId: run.batchId, step: 'generate', index: i })}
      <//>`;
  })}`;
}

/* ── Step 2: the judge compares ───────────────────────────────────────────────────────────────── */

function stepAnalyze(ctx, run, detail) {
  const models = (detail.models || []).filter((m) => m.step1_generation?.status === 'done');
  if (!models.length) return html`<${Note} kind="quiet">${x('noOutputsYet')}<//>`;
  return html`${models.map((m) => {
    const i = detail.models.indexOf(m);
    const a = m.step2_analysis || {};
    const dims = a.dimensions || [];
    return html`
      <${RunModel} key=${m.modelId} name=${labelWords(m.modelLabel)}
        figure=${a.overallScore != null ? `${a.overallScore} %` : null} tone=${scoreTone(a.overallScore)}
        meta=${a.status === 'error' ? html`<${Tinted} tone="notice">${a.error}<//>` : a.status === 'done' ? x('checkpointsN', { n: dims.length, ok: dims.filter((d) => d.pass).length }) : x('stepRightPending')}>
        ${dims.length ? html`<${RunChecks} head=${['', x('colCheckpoint'), x('colExpected'), x('colActual'), x('colWeight')]}
          rows=${dims.map((d, k) => ({ key: k, pass: !!d.pass, name: String(d.name || '').replace(/_/g, ' '), description: d.description, expected: d.expected, actual: d.actual, weight: x('severity.' + (d.severity || 'minor')) }))} />` : null}
        ${a.analysis ? output(x('viewAnalysis'), text(a.analysis)) : null}
        ${a.promptSent ? output(x('viewPromptSent'), a.promptSent) : null}
        <${Actions}>
          <${Action} small soft onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'analyze', index: i })}>${x('pasteAnswer')}<//>
        <//>
        ${pasteBox(ctx, { batchId: run.batchId, step: 'analyze', index: i })}
      <//>`;
  })}`;
}

/* ── Step 3: proposals ────────────────────────────────────────────────────────────────────────── */

function stepReflect(ctx, run, detail) {
  const models = (detail.models || []).filter((m) => m.step2_analysis?.status === 'done');
  if (!models.length) return html`<${Note} kind="quiet">${x('noScoresYet')}<//>`;
  return html`${models.map((m) => {
    const i = detail.models.indexOf(m);
    const r = m.step3_reflection || {};
    return html`
      <${RunModel} key=${m.modelId} name=${labelWords(m.modelLabel)}
        meta=${r.status === 'done' ? x('proposalsN', { n: (r.judgeProposals?.proposals?.length || 0) + (r.selfProposals?.proposals?.length || 0) }) : x('stepRightPending')}>
        <${RunColumns}>
          ${proposalList(ctx, run, i, 'judge', x('judgeProposals'), r.judgeProposals)}
          ${proposalList(ctx, run, i, 'self', x('selfProposals', { model: labelWords(m.modelLabel) }), r.selfProposals)}
        <//>
      <//>`;
  })}`;
}

function proposalList(ctx, run, index, which, title, part) {
  const list = part?.proposals || [];
  return html`
    <${RunColumn} label=${title}>
      ${part?.error ? html`<${Note} kind="message" error>${part.error}<//>` : null}
      ${list.length ? html`<${IndexList} steps>${list.map((p, k) => html`<${IndexStep} key=${k}>${proposalText(p)}<//>`)}<//>` : (!part?.error ? html`<${Note} kind="quiet">${x('noProposals')}<//>` : null)}
      ${part?.reasoning && list.length ? output(x('viewReasoning'), text(part.reasoning)) : null}
      <${Actions}>
        <${Action} small soft onClick=${() => ctx.openPaste({ batchId: run.batchId, step: 'reflect', index, which })}>${x('pasteAnswer')}<//>
      <//>
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
  if (s.status !== 'done' && !props.length) return html`${s.error ? html`<${Note} kind="message" error>${s.error}<//>` : html`<${Note} kind="quiet">${x('noSynthesisYet')}<//>`}`;
  return html`
    ${s.error ? html`<${Note} kind="message" error>${s.error}<//>` : null}
    ${props.length ? html`
      <${Label} block>${x('groupedProposals')}<//>
      <${RunProposals} items=${props.map((gp, i) => ({
        key: i, n: i + 1, chosen: chosen.has(i), text: proposalText(gp),
        notes: [gp.explanation, gp.sources ? html`${x('sources')}: ${Array.isArray(gp.sources) ? gp.sources.join(', ') : gp.sources}` : null],
        tags: [gp.impact ? { label: x('impact.' + gp.impact) || gp.impact, tone: gp.impact === 'high' ? 'coral' : undefined } : null, gp.risk ? { label: x('risk.' + gp.risk) || gp.risk } : null],
      }))} />` : null}
    ${options ? html`
      <${Label} block>${x('options')}<//>
      <${Choice} boxed dot cols=${3} name=${'cal-opt-' + run.batchId} ariaLabel=${x('options')} value=${key} onChange=${(k) => ctx.setOption(run.batchId, k)}
        options=${['A', 'B', 'C'].filter((k) => options[k]).map((k) => ({ value: k, label: x('option.' + k), hint: `${x('optionCount', { n: (options[k].proposalIds || []).length })}${options[k].expectedImpact ? ' · ' + options[k].expectedImpact : ''}` }))} />` : null}
    ${s.recommendation ? html`<${Note} kind="lead"><b>${x('recommendation')}:</b> ${s.recommendation}<//>` : null}
    ${s.analysis && props.length ? output(x('viewAnalysis'), text(s.analysis)) : null}
    ${options ? html`
      <${RunApply} note=${applying ? x('applyingHint') : x('applyHint')}>
        <${Loud} control disabled=${applying || !ctx.keyed || !optionProposals(s, key).length} onClick=${() => ctx.applyOption(run.batchId, key)}>${applying ? x('applying') : x('applyOption', { option: key, v: (ctx.project.currentVersion || 0) + 1 })}<//>
        <${Action} small soft copy=${ctx.applyText(detail, key)}>${x('copyApplyPrompt')}<//>
      <//>` : null}`;
}

/* ── Small parts ──────────────────────────────────────────────────────────────────────────────── */

/** A long output folded behind its label; nothing when there is no output. */
function output(label, body) {
  if (!body) return null;
  return html`<${RunOutput} label=${label}>${body}<//>`;
}

function pasteBox(ctx, spec) {
  const p = ctx.paste;
  if (!p || p.batchId !== spec.batchId || p.step !== spec.step || p.index !== spec.index || (p.which || '') !== (spec.which || '')) return null;
  return html`
    <${RunPaste} label=${x('pasteLabel.' + spec.step)}>
      <${TextArea} rows=${6} value=${ctx.pasteText} placeholder=${x('pastePlaceholder')} ariaLabel=${x('pasteAnswer')} onInput=${(v) => ctx.setPasteText(v)} />
      <${Actions}>
        <${Action} small disabled=${!ctx.pasteText.trim() || ctx.busy === 'paste'} onClick=${() => ctx.savePaste()}>${x('save')}<//>
        <${Action} small soft onClick=${() => ctx.openPaste(null)}>${x('cancel')}<//>
      <//>
    <//>`;
}
