/**
 * @file public/components/TextInput.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A one-line text field in an ink frame, the full width of its column, with a sun
 *   outline on focus. Its look is css/components/text-input.css; the catalogue entry is
 *   `text-input`.
 * @structure TextInput({ id, maxLength, placeholder, value, onInput })
 * @usage html`<${TextInput} id="koti-agent-name" maxLength="40" value=${v} onInput=${set} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/step-agent.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ id: string, maxLength?: string, placeholder?: string, value: string, onInput: (e: Event) => void }} props
 */
export function TextInput({ id, maxLength, placeholder, value, onInput }) {
  return html`
          <input
            id=${id}
            class="poster-input"
            type="text"
            autocomplete="off"
            maxlength=${maxLength}
            placeholder=${placeholder}
            value=${value}
            onInput=${onInput} />`;
}

export default TextInput;
