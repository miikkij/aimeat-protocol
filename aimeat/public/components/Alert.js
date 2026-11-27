/**
 * @file public/components/Alert.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reusable inline notification banner (Preact + HTM) rendering a typed
 *   alert (success/error/info/warn) with an icon, message, and optional dismiss button.
 *
 * @structure
 *   - Alert({ type, message, onDismiss }): renders `.alert.alert-<type>`; returns null when message is empty
 *
 * @version-history
 *   v1.1.0 — 2026-11-27 — The warn and info marks and the dismiss button draw the Glyph marks
 *     (warning, info, close) instead of emoji; the error mark is ✗; the dismiss button has an
 *     accessible name (common.close).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Glyph } from '/components/Action.js';
const html = htm.bind(h);

/**
 * Alert — inline notification banner.
 * @param {{ type: 'success'|'error'|'info'|'warn', message: string, onDismiss?: () => void }} props
 */
export function Alert({ type = 'info', message, onDismiss }) {
  if (!message) return null;
  const icons = { success: '✓', error: '✗', warn: html`<${Glyph} name="warning" />`, info: html`<${Glyph} name="info" />` };
  return html`
    <div class="alert alert-${type}">
      <span class="alert-icon">${icons[type] || ''}</span>
      <span class="alert-msg">${message}</span>
      ${onDismiss && html`<button class="alert-close" title=${t('common.close')} aria-label=${t('common.close')} onClick=${onDismiss}><${Glyph} name="close" /></button>`}
    </div>`;
}
