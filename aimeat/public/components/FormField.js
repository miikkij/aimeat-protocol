/**
 * @file public/components/FormField.js
 * @description Preact + HTM presentational component that wraps a labeled form
 *   input group (label + child control + optional hint text) using the shared
 *   .form-group/.form-label/.form-hint CSS classes.
 *
 * @structure
 *   - FormField({ label, hint, children, className }): renders the labeled group
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * FormField — labeled form group with optional hint text.
 * @param {{ label: string, hint?: string, children: any, className?: string }} props
 */
export function FormField({ label, hint, children, className = '' }) {
  return html`
    <div class="form-group ${className}">
      <label class="form-label">${label}</label>
      ${children}
      ${hint && html`<span class="form-hint">${hint}</span>`}
    </div>`;
}
