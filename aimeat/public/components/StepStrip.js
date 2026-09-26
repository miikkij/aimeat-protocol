/**
 * @file public/components/StepStrip.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The strip of an automation's steps (a special view of the Offers page, its "runs on
 *   its own" lines): each step a small framed box with its name and a typewriter line under it (who
 *   runs it, how its last run went), pressed to open that step's offer; the frame green when its last
 *   run went through, coral on a coral-tinted ground when it failed or stalled. In a chain the steps
 *   stand one after another with an arrow between them; loose steps stand side by side. A page passes
 *   the steps as data and what a press does; it never writes a class. The look is
 *   css/components/step-strip.css (formerly offer-lines.css .op-steps, .op-step, .op-arrow); the
 *   arrow wears the poster face through the library's numeral class (.poster-stat-number).
 *
 *   StepStrip({ steps, chain }):
 *   - steps: [{ key, name, sub, state, onOpen, title }]; state = 'done' | 'failed' | undefined (not run,
 *     or still waiting).
 *   - chain: the steps run one after the other (an arrow → between two steps).
 * @structure StepStrip({ steps, chain })
 * @usage html`<${StepStrip} chain steps=${ch.steps.map((s) => ({ key: s.key, name: s.offer.title, sub: s.agent, state: 'done', onOpen: () => open(s) }))} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Offers page's step strip as a component, with the values of
 *     offer-lines.css (page group G6).
 */
import { h, Fragment } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const STATES = new Set(['done', 'failed']);

export function StepStrip({ steps = [], chain }) {
  const list = (steps || []).filter(Boolean);
  return html`<div class="step-strip">
    ${list.map((s, i) => html`<${Fragment} key=${s.key ?? i}>
      ${chain && i ? html`<span class="poster-stat-number poster-stat-number--small step-strip-arrow" aria-hidden="true">→</span>` : null}
      <button type="button" class=${STATES.has(s.state) ? `step-strip-step step-strip-step--${s.state}` : 'step-strip-step'}
        title=${s.title} onClick=${s.onOpen}>${s.name}${s.sub ? html`<small>${s.sub}</small>` : null}</button>
    <//>`)}
  </div>`;
}

export default StepStrip;
