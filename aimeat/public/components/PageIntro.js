/**
 * @file public/components/PageIntro.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A page's own headline and one line under it. Its look is
 *   css/components/page-intro.css; the catalogue entry is `page-intro`.
 * @structure PageIntro({ title, sub })
 * @usage html`<${PageIntro} title=${t('…')} sub=${t('…')} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home (index.js, history.js) with its markup unchanged
 *     (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ title: any, sub?: any }} props */
export function PageIntro({ title, sub }) {
  return html`
    <header class="poster-intro">
      <h1 class="poster-intro-title">${title}</h1>
      <p class="poster-intro-sub">${sub}</p>
    </header>`;
}

export default PageIntro;
