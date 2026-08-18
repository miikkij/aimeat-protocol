/**
 * @file public/components/Spinner.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Preact + HTM inline loading indicator component rendering the theme.css
 *   .spinner element with optional trailing loading text.
 *
 * @structure
 *   - Spinner({ text }): returns a spinner span plus an optional loading-text label
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
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
