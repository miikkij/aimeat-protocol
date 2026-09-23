/**
 * @file public/components/StepList.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Numbered instructions a person follows by hand, one per line. Its look is
 *   css/components/step-list.css; the catalogue entry is `step-list`.
 * @structure StepList({ steps })
 * @usage html`<${StepList} steps=${['Open …', 'Paste …']} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/step-agent.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ steps: any[] }} props */
export function StepList({ steps }) {
  return html`
          <ol class="poster-manual">
            ${steps.map((s, i) => html`<li key=${i} class="poster-manual-step">${s}</li>`)}
          </ol>`;
}

export default StepList;
