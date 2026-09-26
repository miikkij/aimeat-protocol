/**
 * @file public/components/EcoAutomation.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An ecosystem app's automation board, as components that take data: the one flow card
 *   read top to bottom (FlowCard: its numbered steps, FlowStep, and the one save at its foot), the
 *   status timeline of the latest run (StatusTimeline: publish, process, deliver, each a StatusStep
 *   with a dot on the line in its state's colour, its name, its marks and what it says), and a job's
 *   run log (RunLog: when, how it went, what started it, how long it took, why it failed). A special
 *   view of the Ecosystem apps page; the page passes data and never a class. Its look is
 *   css/components/eco-automation.css (its own class names, .eco-automation-*).
 * @structure FlowCard({ save, children }) · FlowStep({ num, off, children }) ·
 *   StatusTimeline({ title, children }) · StatusStep({ state, label, marks, children }) · RunLog({ rows })
 * @usage html`<${FlowCard} save=${html`<${Loud} control …>…<//>`}>
 *          <${FlowStep} num=${t('…autoStep1')}>…<//>
 *        <//>
 *        <${StatusTimeline} title=${t('…autoStatusTitle')}>
 *          <${StatusStep} state="ok" label=${t('…autoStatusPublished')} marks=${…}>…<//>
 *        <//>`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Its own class names (.pf-eco-auto-flow-card → .eco-automation-card,
 *     -flow-save → -save, -flow-step → -step, -flow-step-disabled → -step--off, -flow-num → -num,
 *     .pf-eco-auto-status → .eco-automation-status, .pf-eco-recipe-head → -status-title,
 *     -status-timeline → -timeline, -status-step → -stage, -status-head → -stage-head, -status-dot
 *     (-ok/-wait/-off/-error) → -dot (--ok/--wait/--off/--error), -status-label → -stage-label,
 *     -status-body → -stage-body, .pf-eco-auto-log(-row/-time/-trigger/-dur/-reason) →
 *     .eco-automation-log(…)); every rule keeps its value (Jouni: components draw only their own
 *     class names, a move).
 *   v1.0.0 — 2026-09-26 — Initial: the ecosystem automation's flow card, status timeline and run log
 *     (written as markup in views/profile/ecosystem-tab.automation.js) as components that take data
 *     (page group G5).
 */
import { h } from 'preact';
import htm from 'htm';
import { Mark } from '/components/Mark.js';

const html = htm.bind(h);
const STATES = new Set(['ok', 'wait', 'off', 'error']);
const shown = (v) => v !== undefined && v !== null && v !== false && v !== '';

/** The one config card, read top to bottom; `save` is the one action at its foot. */
export function FlowCard({ save, children }) {
  return html`<div class="eco-automation-card poster-row--thing">
    ${children}
    ${save ? html`<div class="eco-automation-save">${save}</div>` : null}
  </div>`;
}

/** One numbered step of the card; `off` greys a step that cannot be set now. */
export function FlowStep({ num, off, children }) {
  return html`<div class=${off ? 'eco-automation-step eco-automation-step--off' : 'eco-automation-step'}>
    ${shown(num) ? html`<div class="eco-automation-num">${num}</div>` : null}
    ${children}
  </div>`;
}

/** The status of the latest run: a vertical line of steps under a small heading. */
export function StatusTimeline({ title, children }) {
  return html`<div class="eco-automation-status">
    <div class="eco-automation-status-title">${title}</div>
    <div class="eco-automation-timeline">${children}</div>
  </div>`;
}

/** One step on the line: `state` = 'ok' | 'wait' | 'off' | 'error' colours its dot. */
export function StatusStep({ state, label, marks, children }) {
  const s = STATES.has(state) ? state : 'off';
  return html`<div class="eco-automation-stage">
    <div class="eco-automation-stage-head">
      <span class=${`eco-automation-dot eco-automation-dot--${s}`}></span>
      <strong class="eco-automation-stage-label">${label}</strong>
      ${marks}
    </div>
    <div class="eco-automation-stage-body">${children}</div>
  </div>`;
}

/**
 * A job's runs, newest first: `rows` = [{ key, when, result: { word, tone }, trigger, duration, reason }]
 * (tone is the Status tone: fine, danger, off).
 */
export function RunLog({ rows = [] }) {
  return html`<div class="eco-automation-log">
    ${rows.map((r) => html`
      <div class="eco-automation-log-row" key=${r.key}>
        <span class="eco-automation-log-time poster-time">${r.when}</span>
        ${r.result ? html`<${Mark} kind="status" tone=${r.result.tone}>${r.result.word}<//>` : null}
        ${shown(r.trigger) ? html`<span class="text-meta-sm eco-automation-log-trigger">${r.trigger}</span>` : null}
        ${shown(r.duration) ? html`<span class="text-meta-sm eco-automation-log-dur">${r.duration}</span>` : null}
        ${shown(r.reason) ? html`<span class="text-meta-sm eco-automation-log-reason">${r.reason}</span>` : null}
      </div>`)}
  </div>`;
}

export default FlowCard;
