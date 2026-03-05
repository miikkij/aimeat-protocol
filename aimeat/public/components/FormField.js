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
