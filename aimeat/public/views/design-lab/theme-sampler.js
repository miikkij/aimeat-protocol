/**
 * @file public/views/design-lab/theme-sampler.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The theme sampler: the parts a theme changes most, drawn together with the library's
 *   own classes, so a theme is judged on a page rather than on a list of colours. Themes & Styles
 *   shows it in the lab's preview frame, light and dark side by side, wearing the draft being edited
 *   (frame.js `preview=1`). Every class here is a catalogued part or shape; nothing is styled here.
 * @structure THEME_SAMPLER — a lab-only demo (`theme:sampler`)
 * @usage import { THEME_SAMPLER } from './theme-sampler.js';  demoFor('theme:sampler')
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const noop = () => {};

export const THEME_SAMPLER = {
    variants: [{
        name: 'sampler',
        render: () => html`
          <div>
            <h2 class="poster-section-title">This week</h2>
            <div class="poster-panel">
              <span class="poster-label">Open items</span> <span class="poster-count poster-count--waiting">3</span>
              <div class="poster-row poster-row--thing"><strong>Pick the junior designer</strong><br /><span class="text-meta">Yours · in 19 hours</span></div>
              <div class="poster-row"><strong>Send the August invoice</strong><br /><span class="text-meta">Yours · tomorrow</span></div>
            </div>
            <div role="tablist">
              <button type="button" class="poster-tab is-on" onClick=${noop}>Overview</button>
              <button type="button" class="poster-tab" onClick=${noop}>Tasks</button>
              <button type="button" class="poster-tab" onClick=${noop}>Files</button>
            </div>
            <div class="poster-box">
              <p>Words on a card read as they do on the page. <a href="#" onClick=${(e) => e.preventDefault()}>A link</a> takes the accent.</p>
              <p class="text-meta">Quiet words say when and whose.</p>
            </div>
            <p>
              <button type="button" class="poster-action" onClick=${noop}>Cancel</button>
              <button type="button" class="poster-slab poster-slab--control" onClick=${noop}>Save</button>
              <button type="button" class="poster-slab poster-slab--control poster-slab--danger" onClick=${noop}>Delete</button>
            </p>
          </div>`,
    }],
};
