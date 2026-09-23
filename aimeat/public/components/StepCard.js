/**
 * @file public/components/StepCard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One step of a numbered setup path: its number, its title and a lead line, and what
 *   the step asks for (children). The open step is the only thing on the page with an ink frame and
 *   a sun shadow. StepLede is the step's lead paragraph. Its look is
 *   css/components/step-card.css; the catalogue entry is `step-card`.
 * @structure StepCard({ num, title, children }) · StepLede({ children })
 * @usage html`<${StepCard} num="2" title=${t('home.agent.title')}><${StepLede}>…<//>…<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/step-agent.js and step-mat.js (the open step)
 *     with its markup unchanged; the done and limit cuts stay in the files that draw them, which
 *     no page mounts today (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ num: any, title: any, children?: any }} props */
export function StepCard({ num, title, children }) {
  return html`
    <div class="poster-step poster-step--open">
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
