/**
 * @file public/components/ProgressSteps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the AI is doing now, while a slow call runs, as one component. ProgressSteps is
 *   the steps of the job one per line: the steps done in the success colour with a ✓, the step now
 *   in bold with a →, the steps to come dimmed with a dot. ProgressNow is the block a dialog shows in
 *   its body while it waits: the spinner with its words, a line in bold that says what the AI does,
 *   and the step it is at in grey under it, all in the middle. A page passes the words and never
 *   writes a class. The look is css/components/progress-steps.css (the steps: the values of the
 *   Notebook's .pf-nb-steps, moved there before; the block: the Track a response dialog's
 *   .inbox-track-classify, moved out of css/views/inbox.css unchanged); the spinner is
 *   components/Spinner.js.
 *
 *   - ProgressSteps({ steps, at }): `steps` are the words of each step, `at` the index of the step
 *     now (the ones before it are done).
 *   - ProgressNow({ label, title, step }): `label` the spinner's words, `title` the bold line, `step`
 *     the grey line.
 * @structure ProgressSteps({ steps, at }) · ProgressNow({ label, title, step })
 * @usage html`<${ProgressSteps} steps=${NB_STEPS.map((k) => t(k))} at=${sortStep} />`
 *        html`<${ProgressNow} label=${t('profile.loading')} title=${t('inbox.trackAiThinking')} step=${t(NB_STEPS[i])} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Notebook's sorting steps and the Track a response dialog's
 *     waiting block as one component, with the look they had (page group G4, the notebook).
 */
import { h } from 'preact';
import htm from 'htm';
import { Spinner } from '/components/Spinner.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

export function ProgressSteps({ steps = [], at = 0 }) {
  return html`<ol class="progress-steps">
    ${steps.map((s, i) => html`<li key=${i} class=${cx('progress-step', i < at && 'progress-step--done', i === at && 'progress-step--active')}>
      ${i < at ? '✓' : i === at ? '→' : '·'} ${s}
    </li>`)}
  </ol>`;
}

export function ProgressNow({ label, title, step }) {
  return html`<div class="progress-now" role="status">
    <${Spinner} text=${label} />
    <div class="progress-now-title">${title}</div>
    <div class="progress-now-step">${step}</div>
  </div>`;
}

export default ProgressSteps;
