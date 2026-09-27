/**
 * @file public/components/SwatchPicker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A choice among a few named looks: a title and a hint, a preview strip in a 2px ink
 *   frame (what the page gives it, or the empty label), and the choices as a radio group of
 *   framed buttons, the chosen one on the sun. Its look is css/components/swatch-picker.css; the
 *   catalogue entry is `swatch-picker`.
 * @structure SwatchPicker({ title, hint, preview, pattern, emptyLabel, choices, onChoose })
 * @usage
 *   html`<${SwatchPicker} title=${…} hint=${…} emptyLabel=${t('…Off')} pattern=${current}
 *     choices=${[{ value: '', label: 'Off', active: !current }, …]} onChoose=${choose} />`
 * @version-history
 *   v1.2.0 — 2026-09-27 — `pattern`: the margin figure's name, and the picker draws its preview
 *     swatch (.mp-swatch) itself; `preview` stays for any other preview (additive, page group G9).
 *   v1.1.0 — 2026-09-24 — The choices are the tab's tile tone, with their look unchanged (Jouni's
 *     decision "Choice").
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/settings-dialog.js (the margin pattern) with its
 *     markup unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ title: any, hint: any, preview?: any, pattern?: string, emptyLabel: any,
 *   choices: Array<{ value: string, label: any, active: boolean }>, onChoose: (value: string) => void }} props
 */
export function SwatchPicker({ title, hint, preview, pattern, emptyLabel, choices, onChoose }) {
  // pattern (added by page group G9): the margin figure to preview, by name; the picker draws the
  // swatch itself (css/components/margin-pattern.css .mp-swatch), so a page passes the name and not a class.
  const shown = preview || (pattern ? html`<div class=${`mp-swatch mp-swatch--${pattern}`}></div>` : null);
  return html`
    <div class="poster-settings-pattern">
      <div class="poster-settings-pattern-words">
        <span class="poster-settings-pattern-title">${title}</span>
        <span class="poster-settings-pattern-hint">${hint}</span>
      </div>
      <div class="poster-settings-pattern-preview" aria-hidden="true">
        ${shown || html`<span class="poster-settings-pattern-none">${emptyLabel}</span>`}
      </div>
      <div class="poster-settings-pattern-choices" role="radiogroup" aria-label=${title}>
        ${choices.map((c) => html`
          <button type="button" key=${c.value} class=${`poster-tab poster-tab--tile ${c.active ? 'is-on' : ''}`}
            role="radio" aria-checked=${c.active ? 'true' : 'false'} onClick=${() => onChoose(c.value)}>
            ${c.label}
          </button>
        `)}
      </div>
    </div>`;
}

export default SwatchPicker;
