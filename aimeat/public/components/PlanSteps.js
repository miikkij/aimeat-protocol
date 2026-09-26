/**
 * @file public/components/PlanSteps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The steps of a plan the AI made for one thing, one under the other: each step under the
 *   section rule, its head in a line (a tag, the title in bold, what stands after it: a mark, the
 *   agent it goes to), the lines about it under the head, and its ways at its foot. A step done is
 *   dimmed a little, a step skipped (or left out) more. A step may be one to pick: its title is then
 *   the words of a check box. PlanNote is the grey line in italics that says why (the plan's summary,
 *   a step's reason, what a step waits for). A page passes data and never writes a class. The look
 *   is css/components/plan-steps.css; the rule on top of a step is poster.css .poster-row--thing.
 *   Drawn first by a Notebook note (the enrich plan and the pieces of a split note), moved here from
 *   css/views/notebook.css (.pf-nb-plan-steps, .pf-nb-plan-step and its head, title, why and buttons,
 *   .pf-nb-chunk-pick, .pf-nb-enrich-summary, .pf-nb-suggest-reason) with its values unchanged.
 *
 *   - PlanSteps({ children }): the list of steps.
 *   - PlanStep({ state, pick, before, title, after, doors, children }): one step.
 *     `state` = 'done' | 'skipped'. `pick` = { checked, onChange(checked, e), disabled } makes the
 *     title the words of a check box. `before` stands before the title (the step's kind), `after`
 *     after it (the agent, a status, the home a piece goes to). `doors` is the row of ways at its
 *     foot. The children are the lines under the head.
 *   - PlanNote({ children }): the grey line in italics.
 * @structure PlanSteps({ children }) · PlanStep(props) · PlanNote({ children })
 * @usage html`<${PlanSteps}>${steps.map((s) => html`<${PlanStep} key=${s.id} state=${done ? 'done' : undefined}
 *          before=${html`<${Mark}>${kind}<//>`} title=${s.title} doors=${html`<${Loud} control …>Run<//>`}>
 *          <${PlanNote}>${s.rationale}<//><//>`)}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Notebook's plan steps and split pieces as one component, with
 *     the look they had (page group G4, the notebook).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const STATES = new Set(['done', 'skipped']);

export function PlanSteps({ children }) {
  return html`<ol class="plan-steps">${children}</ol>`;
}

export function PlanStep({ state, pick, before, title, after, doors, children }) {
  const name = html`<span class="plan-step-title">${title}</span>`;
  return html`<li class=${cx('plan-step', 'poster-row--thing', STATES.has(state) && `plan-step--${state}`)}>
    <div class="plan-step-head">
      ${before}
      ${pick
        ? html`<label class="plan-step-pick"><input type="checkbox" checked=${!!pick.checked} disabled=${pick.disabled}
            onChange=${pick.onChange ? (e) => pick.onChange(e.currentTarget.checked, e) : undefined} />${name}</label>`
        : name}
      ${after}
    </div>
    ${children}
    ${doors ? html`<div class="plan-step-doors">${doors}</div>` : null}
  </li>`;
}

export function PlanNote({ children }) {
  return html`<div class="text-meta-sm plan-note">${children}</div>`;
}

export default PlanSteps;
