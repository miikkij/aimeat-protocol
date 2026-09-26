/**
 * @file public/components/WorkflowSteps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workflow's steps, one per row with a rule under it: the number in coral typewriter,
 *   the step's name in bold with its agent in typewriter under it, what it takes and gives in grey
 *   lines (a memory key in typewriter), anything more the step shows (the pictures it made), and on
 *   the right its state as a Status with what was seen, a line each; on a narrow screen the state goes
 *   under the words. A special view of the Workflows page (a workflow and one of its runs), drawn from
 *   data; the page passes the steps and never a class. Its look is css/components/workflow-steps.css
 *   (its own class names, .workflow-steps-*) and the Status of poster.css.
 * @structure WorkflowSteps({ steps })
 * @usage html`<${WorkflowSteps} steps=${def.steps.map((s, i) => ({ key: s.id, num: '01', title, sub,
 *          lines: [words, { text: key, code: true }], state: { word, tone: 'fine' }, notes: [observed] }))} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Its own class names (.wp-step → .workflow-steps-step, .wp-step-n →
 *     .workflow-steps-num, .wp-step-body → .workflow-steps-body, .wp-sig → .workflow-steps-line,
 *     .wp-sig--key → .workflow-steps-line--key, .wp-step-st → .workflow-steps-state); every rule keeps
 *     its value (Jouni: components draw only their own class names, a move).
 *   v1.0.0 — 2026-09-26 — Initial: a workflow's steps (.wp-step, written as markup in
 *     views/profile/workflows/detail.js and run.js) as a component that takes data (page group G5).
 */
import { h } from 'preact';
import htm from 'htm';
import { Mark } from '/components/Mark.js';

const html = htm.bind(h);
const shown = (v) => v !== undefined && v !== null && v !== false && v !== '';

/**
 * @param {{ steps: Array<{ key: any, num: any, title: any, sub?: any,
 *   lines?: Array<any|{ text: any, code?: boolean }>, extra?: any,
 *   state?: { word: any, tone?: 'fine'|'attention'|'danger'|'off' }, notes?: any[] }> }} props
 */
export function WorkflowSteps({ steps = [] }) {
  return html`${steps.map((s) => html`
    <div class="workflow-steps-step" key=${s.key}>
      <div class="workflow-steps-num">${s.num}</div>
      <div class="workflow-steps-body">
        <b>${s.title}<small>${s.sub}</small></b>
        ${(s.lines || []).filter(shown).map((l, i) => (l && typeof l === 'object' && 'text' in l && !('props' in l)
          ? html`<div class=${l.code ? 'workflow-steps-line workflow-steps-line--key' : 'workflow-steps-line'} key=${i}>${l.text}</div>`
          : html`<div class="workflow-steps-line" key=${i}>${l}</div>`))}
        ${s.extra}
      </div>
      <div class="workflow-steps-state">${s.state ? html`<${Mark} kind="status" tone=${s.state.tone}>${s.state.word}<//>` : null}${(s.notes || []).filter(shown).map((n, i) => html`<span key=${i}>${n}</span>`)}</div>
    </div>`)}`;
}

export default WorkflowSteps;
