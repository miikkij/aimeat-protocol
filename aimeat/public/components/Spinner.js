import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * Spinner — inline loading indicator using theme.css .spinner class.
 * @param {{ text?: string }} props
 */
export function Spinner({ text }) {
  return html`<span class="spinner"></span>${text && html`<span class="loading-text">${text}</span>`}`;
}
