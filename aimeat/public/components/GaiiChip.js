/**
 * @file public/components/GaiiChip.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's GAII as a control: shown in full in the typewriter face, and copied to the
 *   clipboard when pressed, with a copy mark after it that turns into a tick for a moment. It is the
 *   string a person hands to a chat, a config file or another agent, so it stands beside the agent
 *   wherever the agent is listed. Every place it sits is itself a click target (a row that opens the
 *   agent, a head that closes it), so a press on it copies and does nothing else. A page passes the
 *   GAII; it never writes a class. The look is css/components/gaii-chip.css.
 * @structure GaiiChip({ gaii, label, copiedLabel })
 * @usage html`<${GaiiChip} gaii=${agentGaii(agent)} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved out of views/profile/agents/gaii-chip.js with its markup and behaviour;
 *     its classes lose the page prefix (pf-agd-gaii → gaii-chip), page group G1a.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

// The mark at the right end of the value: two sheets while there is something to press, a tick
// once it has been. Drawn rather than typed — an icon in this interface is inline SVG.
const CopyMark = html`<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
  <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.2" />
  <path d="M10.6 3.4v-.8a1.2 1.2 0 0 0-1.2-1.2H3.6a1.2 1.2 0 0 0-1.2 1.2v5.8a1.2 1.2 0 0 0 1.2 1.2h.8" />
</svg>`;

/**
 * @param {{ gaii: string, label?: string, copiedLabel?: string }} props
 */
export function GaiiChip({ gaii, label, copiedLabel }) {
  const [copied, setCopied] = useState(false);
  const what = label || t('profile.agents.copyGaii');

  const copy = useCallback(async (e) => {
    e.stopPropagation();
    await copyToClipboard(gaii);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [gaii]);

  return html`
    <button type="button" class=${cx('gaii-chip', copied && 'gaii-chip--copied')}
            title=${copied ? (copiedLabel || t('profile.agents.gaiiCopied')) : what}
            aria-label=${what}
            onClick=${copy}>
      <code class="gaii-chip-value">${gaii}</code>
      <span class="gaii-chip-mark">${copied ? '✓' : CopyMark}</span>
    </button>`;
}

export default GaiiChip;
