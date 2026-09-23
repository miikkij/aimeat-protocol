/**
 * @file public/components/Chooser.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pick a task and get what it needs. Chooser is the section (headline slab, lead
 *   line); ChooserChoices is the row of choices and ChooserChoice one choice (the underlined action
 *   shape, the chosen one on the sun); ChooserPanel is the area the choice governs, with a sun bar
 *   down its left edge; ChooserStatus a row stating where things stand with its action;
 *   ChooserBox a framed box that opens inside the panel; ChooserFold a fold for what is optional;
 *   ChooserLinks the row of next steps; ChooserResult what came back. Its look is
 *   css/components/chooser.css; the catalogue entry is `chooser`.
 * @structure Chooser({ titleId, title, lead, children }) · ChooserChoices({ label, children }) ·
 *   ChooserChoice({ on, onClick, children }) · ChooserPanel · ChooserStatus · ChooserBox ·
 *   ChooserFold({ summary, children }) · ChooserLinks · ChooserResult
 * @usage
 *   html`<${Chooser} titleId="home-journey-title" title=${t('…')} lead=${t('…')}>
 *     <${ChooserChoices} label=${t('…')}>${ids.map((id) => html`<${ChooserChoice} on=${id === pick} …>…<//>`)}<//>
 *     <${ChooserPanel}>…<//>
 *   <//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/journey.js (the task chooser) with its markup
 *     unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ titleId: string, title: any, lead: any, children?: any }} props */
export function Chooser({ titleId, title, lead, children }) {
  return html`
    <section class="poster-chooser" aria-labelledby=${titleId}>
      <h2 id=${titleId} class="poster-section-title poster-section-title--large">${title}</h2>
      <p>${lead}</p>
      ${children}
    </section>`;
}

/** @param {{ label: string, children?: any }} props */
export function ChooserChoices({ label, children }) {
  return html`<div class="poster-chooser-choices" role="group" aria-label=${label}>
        ${children}
      </div>`;
}

/** @param {{ on: boolean, onClick: () => void, children?: any }} props */
export function ChooserChoice({ on, onClick, children }) {
  return html`<button type="button" class=${'poster-tab' + (on ? ' is-on' : '')}
          aria-pressed=${on} onClick=${onClick}>
          ${children}
        </button>`;
}

export function ChooserPanel({ children }) {
  return html`<div class="poster-chooser-panel">${children}</div>`;
}

export function ChooserStatus({ children }) {
  return html`<div class="poster-chooser-status poster-row" role="status">${children}</div>`;
}

export function ChooserBox({ children }) {
  return html`<div class="poster-chooser-connect">${children}</div>`;
}

/** @param {{ summary: any, children?: any }} props */
export function ChooserFold({ summary, children }) {
  return html`<details class="poster-chooser-details"><summary>${summary}</summary>${children}</details>`;
}

export function ChooserLinks({ children }) {
  return html`<div class="poster-chooser-links">${children}</div>`;
}

export function ChooserResult({ children }) {
  return html`<div class="poster-chooser-result poster-box" role="status">${children}</div>`;
}

export default Chooser;
