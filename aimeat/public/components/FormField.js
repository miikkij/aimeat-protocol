/**
 * @file public/components/FormField.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Preact + HTM presentational component that wraps a labeled form
 *   input group (label + child control + optional hint text) using the shared
 *   .form-group/.form-label/.form-hint CSS classes. With `error`, the refusal is
 *   shown under the control in the Field family's message look, and a single
 *   child control is marked aria-invalid and described by it.
 *
 * @structure
 *   - FormField({ label, hint, error, children, className }): renders the labeled group
 *
 * @version-history
 *   v1.1.0 — 2026-10-27 — `error`: the field's refusal under the control (Note kind message, error),
 *     with aria-invalid and aria-describedby on a single child control (wish
 *     wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h, cloneElement, isValidElement } from 'preact';
import { useId } from 'preact/hooks';
import htm from 'htm';
import { Note } from '/components/Note.js';
const html = htm.bind(h);

/**
 * FormField — labeled form group with optional hint text and error.
 * @param {{ label: string, hint?: string, error?: string, children: any, className?: string }} props
 */
export function FormField({ label, hint, error, children, className = '' }) {
  const msgId = `fe${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const control = error && isValidElement(children)
    ? cloneElement(children, { 'aria-invalid': 'true', 'aria-describedby': msgId })
    : children;
  return html`
    <div class="form-group ${className}">
      <label class="form-label">${label}</label>
      ${control}
      ${hint && html`<span class="form-hint">${hint}</span>`}
      ${error ? html`<${Note} kind="message" id=${msgId} error>${error}<//>` : null}
    </div>`;
}
