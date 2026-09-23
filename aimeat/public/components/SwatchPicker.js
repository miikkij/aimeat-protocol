/**
 * @file public/components/SwatchPicker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A choice among a few named looks: a title and a hint, a preview strip in a 2px ink
 *   frame (what the page gives it, or the empty label), and the choices as a radio group of
 *   framed buttons, the chosen one on the sun. Its look is css/components/swatch-picker.css; the
 *   catalogue entry is `swatch-picker`.
 * @structure SwatchPicker({ title, hint, preview, emptyLabel, choices, onChoose })
 * @usage
 *   html`<${SwatchPicker} title=${…} hint=${…} emptyLabel=${t('…Off')}
 *     preview=${current ? html`<div class=${'mp-swatch mp-swatch--' + current}></div>` : null}
 *     choices=${[{ value: '', label: 'Off', active: !current }, …]} onChoose=${choose} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/settings-dialog.js (the margin pattern) with its
 *     markup unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ title: any, hint: any, preview?: any, emptyLabel: any,
 *   choices: Array<{ value: string, label: any, active: boolean }>, onChoose: (value: string) => void }} props
 */
export function SwatchPicker({ title, hint, preview, emptyLabel, choices, onChoose }) {
  return html`
    <div class="poster-settings-pattern">
      <div class="poster-settings-pattern-words">
        <span class="poster-settings-pattern-title">${title}</span>
        <span class="poster-settings-pattern-hint">${hint}</span>
      </div>
      <div class="poster-settings-pattern-preview" aria-hidden="true">
        ${preview || html`<span class="poster-settings-pattern-none">${emptyLabel}</span>`}
      </div>
      <div class="poster-settings-pattern-choices" role="radiogroup" aria-label=${title}>
        ${choices.map((c) => html`
          <button type="button" key=${c.value} class=${`poster-settings-pattern-choice ${c.active ? 'active' : ''}`}
            role="radio" aria-checked=${c.active ? 'true' : 'false'} onClick=${() => onChoose(c.value)}>
            ${c.label}
          </button>
        `)}
      </div>
    </div>`;
}

export default SwatchPicker;
