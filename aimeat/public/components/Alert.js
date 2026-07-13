/**
 * @file public/components/Alert.js
 * @description Reusable inline notification banner (Preact + HTM) rendering a typed
 *   alert (success/error/info/warn) with an icon, message, and optional dismiss button.
 *
 * @structure
 *   - Alert({ type, message, onDismiss }): renders `.alert.alert-<type>`; returns null when message is empty
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * Alert — inline notification banner.
 * @param {{ type: 'success'|'error'|'info'|'warn', message: string, onDismiss?: () => void }} props
 */
export function Alert({ type = 'info', message, onDismiss }) {
  if (!message) return null;
  const icons = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
  return html`
    <div class="alert alert-${type}">
      <span class="alert-icon">${icons[type] || ''}</span>
      <span class="alert-msg">${message}</span>
      ${onDismiss && html`<button class="alert-close" onClick=${onDismiss}>✕</button>`}
    </div>`;
}
