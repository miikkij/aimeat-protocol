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
