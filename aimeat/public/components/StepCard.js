/**
 * @file public/components/StepCard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One step of a numbered setup path: its number, its title and a lead line, and what
 *   the step asks for (children). The open step is the only thing on the page with an ink frame and
 *   a sun shadow. StepLede is the step's lead paragraph. Its look is
 *   css/components/step-card.css; the catalogue entry is `step-card`.
 *   `rule`: a step of a guide inside a dialog, under the heavy ink rule with no frame, its number on
 *   ink (the app catalogue's prompt builder).
 *   `question`: one numbered question of a form, no frame, a hairline under it, its number on ink,
 *   its lede and its fields in line with its title (the app catalogue's tool editor).
 * @structure StepCard({ num, title, rule, question, children }) · StepLede({ children })
 * @usage html`<${StepCard} num="2" title=${t('home.agent.title')}><${StepLede}>…<//>…<//>`
 * @version-history
 *   v1.2.0 — 2026-09-27 — `question`: one numbered question of a form under a hairline, what it asks
 *     indented to its title (the old catalogue's .mz-group); additive, appcat parity (sections-d).
 *   v1.1.0 — 2026-09-27 — `rule`: the step under the heavy rule with its number on ink (the old
 *     catalogue's .pb-step); additive, appcat dialogs builder 2.
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/step-agent.js and step-mat.js (the open step)
 *     with its markup unchanged; the done and limit cuts stay in the files that draw them, which
 *     no page mounts today (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ num: any, title: any, rule?: boolean, question?: boolean, children?: any }} props */
export function StepCard({ num, title, rule, question, children }) {
  // rule (added by appcat dialogs builder 2): a step of a guide inside a dialog, under the heavy ink
  // rule with no frame, its number on ink (the old catalogue's prompt builder, .pb-step).
  // question (added by appcat sections-d, parity): one numbered question of a form, a hairline under
  // it, what it asks in line with its title (the old catalogue's tool editor, .mz-group).
  const cls = question ? 'poster-step poster-step--question' : (rule ? 'poster-step poster-step--rule' : 'poster-step poster-step--open');
  return html`
    <div class=${cls}>
      <div class="poster-step-head">
        <span class="poster-step-num">${num}</span>
        <h2 class="poster-step-title">${title}</h2>
      </div>
      ${children}
    </div>`;
}

export function StepLede({ children }) {
  return html`
      <p class="poster-step-lede">
        ${children}
      </p>`;
}

export default StepCard;
