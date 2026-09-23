/**
 * @file public/views/profile/agents/gaii-chip.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent's GAII as a control: shown in full, in the monospace face, and copied to
 *   the clipboard when pressed. It is the string a person hands to a chat, a config file or
 *   another agent, so it belongs beside the agent wherever the agent is listed rather than only
 *   behind the board's hover card.
 * @structure GaiiChip({ agent, className })
 * @usage import { GaiiChip } from './gaii-chip.js';
 *   html`<${GaiiChip} agent=${agent} />`
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial: the copy control the board's ID card already carried, in a form
 *     the agent list rows can wear.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { agentGaii } from './tab-helpers.js';

const html = htm.bind(h);

// The mark at the right end of the value: two sheets while there is something to press, a tick
// once it has been. Drawn rather than typed — an icon in this interface is inline SVG.
const CopyMark = html`<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
  <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.2" />
  <path d="M10.6 3.4v-.8a1.2 1.2 0 0 0-1.2-1.2H3.6a1.2 1.2 0 0 0-1.2 1.2v5.8a1.2 1.2 0 0 0 1.2 1.2h.8" />
</svg>`;

/**
 * GaiiChip — the agent's full GAII, click to copy.
 * @param {{ agent: object, className?: string }} props
 */
export function GaiiChip({ agent, className = '' }) {
  const [copied, setCopied] = useState(false);
  const gaii = agentGaii(agent);

  // Every place this sits is itself a click target: the collapsed row opens the agent, the
  // expanded header closes it. Copying an identifier must do neither.
  const copy = useCallback(async (e) => {
    e.stopPropagation();
    await copyToClipboard(gaii);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [gaii]);

  return html`
    <button type="button"
            class="pf-agd-gaii ${copied ? 'pf-agd-gaii--copied' : ''} ${className}"
            title=${copied ? t('profile.agents.gaiiCopied') : t('profile.agents.copyGaii')}
            aria-label=${t('profile.agents.copyGaii')}
            onClick=${copy}>
      <code class="pf-agd-gaii-value">${gaii}</code>
      <span class="pf-agd-gaii-mark">${copied ? '✓' : CopyMark}</span>
    </button>`;
}
