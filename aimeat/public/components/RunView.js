/**
 * @file public/components/RunView.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What opens under a run of several models (a calibration's run): its steps as rows
 *   that fold open in place, each model's block, the checkpoints a judge scored, two lists of
 *   proposals side by side, the numbered proposals with the chosen ones marked, a folded output,
 *   the box an answer is pasted into, and the line under the options. A page passes the words, the
 *   figures and what happens as data; it never writes a class. The look is
 *   css/components/run-view.css (tokens only); a step's row is the fold row (components/Folds.js).
 *
 *   - RunSteps: the steps, a rule between two of them.
 *   - RunStep({ num, name, right, done, open, onToggle }): one step: its fold row (the number, the
 *     name, the mono word at the right, the arrow; `done` shows a finished step's number in green)
 *     and, while `open`, its body under it. The row says aria-expanded.
 *   - RunStepDoors: the ways at a step's foot, under a dashed line.
 *   - RunCopies({ label }): a small typewriter label and the copy actions after it, wrapping.
 *   - RunModel({ name, figure, tone, meta }): one model's block, a heavy ink edge on the grey ground;
 *     its head is the name, the score (`figure`, in `tone` 'fine' | 'notice' | 'dim') and a
 *     typewriter line (`meta`); the children stand under the head.
 *   - RunChecks({ head, rows }): the checkpoints: head = [mark, checkpoint, expected, got, weight];
 *     a row { key, pass, name, description, expected, actual, weight } (the pass mark ✓ in green, ✗
 *     in coral). On a phone the mark and the checkpoint only.
 *   - RunColumns / RunColumn({ label }): two columns side by side (one on a phone), each with its
 *     row label.
 *   - RunProposals({ items }): numbered proposals; an item { key, n, chosen, text, notes, tags }, the
 *     chosen ones' numbers on coral, `notes` the grey lines under the words, `tags` the Mark tags at
 *     the right ({ label, tone }).
 *   - RunOutput({ label }): a long output folded behind its label (the children, as a code block).
 *   - RunApply({ note }): the line under the options (the loud action and its copy), `note` in
 *     typewriter under them.
 *   - RunPaste({ label }): the dashed box an answer is pasted into, its row label on top.
 * @structure RunSteps · RunStep · RunStepDoors · RunCopies · RunModel · RunChecks · RunColumns ·
 *   RunColumn · RunProposals · RunOutput · RunApply · RunPaste
 * @usage html`<${RunSteps}>${steps.map((s, i) => html`<${RunStep} key=${s} num=${i + 1} name=${x('step.' + s)}
 *          right=${word} done=${done[s]} open=${open === s} onToggle=${() => setOpen(open === s ? null : s)}>…<//>`)}<//>`
 *        html`<${RunModel} name=${label} figure=${'82 %'} tone="fine" meta=${x('checkpointsN', …)}>…<//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the opened run of views/profile/calibrator/run.js (the markup of
 *     css/components/calibration-run.css, .cal-steps … .cal-paste) as one component with its own
 *     class names (component plan, special view).
 */
import { h } from 'preact';
import htm from 'htm';
import { FoldRow } from '/components/Folds.js';
import { Figure } from '/components/Figure.js';
import { Mark, Label, Code } from '/components/Mark.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const given = (v) => v !== undefined && v !== null && v !== false && v !== '';

export function RunSteps({ children }) {
  return html`<div class="run-steps">${children}</div>`;
}

export function RunStep({ num, name, right, done, open, onToggle, children }) {
  return html`
    <section class="run-step">
      <${FoldRow} kind="toggle" num=${num} name=${name} right=${right} done=${!!done} open=${!!open} onClick=${() => onToggle?.()} />
      ${open ? html`<div class="run-step-body">${children}</div>` : null}
    </section>`;
}

export function RunStepDoors({ children }) {
  return html`<div class="run-step-doors">${children}</div>`;
}

export function RunCopies({ label, children }) {
  return html`<div class="run-copies">${given(label) ? html`<small>${label}</small>` : null}${children}</div>`;
}

export function RunModel({ name, figure, tone, meta, children }) {
  return html`
    <div class="run-model">
      <div class="run-model-head"><b>${name}</b>${given(figure) ? html`<${Figure} small tone=${tone} n=${figure} />` : null}${given(meta) ? html`<small>${meta}</small>` : null}</div>
      ${children}
    </div>`;
}

export function RunChecks({ head, rows }) {
  const cols = head || ['', '', '', '', ''];
  return html`
    <div class="run-checks">
      ${cols.map((c, i) => html`<div key=${'h' + i} class="run-checks-head poster-label">${c}</div>`)}
      ${(rows || []).map((r, k) => html`
        <div key=${'p' + k} class=${r.pass ? 'run-check-pass' : 'run-check-fail'}>${r.pass ? '✓' : '✗'}</div>
        <div key=${'n' + k}><b>${r.name}</b>${given(r.description) ? html`<small>${r.description}</small>` : null}</div>
        <div key=${'e' + k}>${r.expected || ''}</div>
        <div key=${'a' + k}>${r.actual || ''}</div>
        <div key=${'s' + k}><small>${r.weight}</small></div>`)}
    </div>`;
}

export function RunColumns({ children }) {
  return html`<div class="run-cols">${children}</div>`;
}

export function RunColumn({ label, children }) {
  return html`<div class="run-col">${given(label) ? html`<${Label}>${label}<//>` : null}${children}</div>`;
}

export function RunProposals({ items }) {
  return html`
    <div class="run-props">
      ${(items || []).map((p, i) => html`
        <div class="run-prop" key=${p.key ?? i}>
          <span class=${cx('run-prop-n', p.chosen && 'is-on')}>${p.n}</span>
          <span class="run-prop-t">${p.text}${(p.notes || []).filter(given).map((n, k) => html`<small key=${k}>${n}</small>`)}</span>
          <span class="run-prop-tags">${(p.tags || []).filter(Boolean).map((tg, k) => html`<${Mark} key=${k} tone=${tg.tone}>${tg.label}<//>`)}</span>
        </div>`)}
    </div>`;
}

export function RunOutput({ label, children }) {
  return html`<details class="run-output"><summary>${label}</summary><${Code} block>${children}<//></details>`;
}

export function RunApply({ note, children }) {
  return html`<div class="run-apply">${children}${given(note) ? html`<small>${note}</small>` : null}</div>`;
}

export function RunPaste({ label, children }) {
  return html`<div class="run-paste">${given(label) ? html`<${Label}>${label}<//>` : null}${children}</div>`;
}

export default RunSteps;
