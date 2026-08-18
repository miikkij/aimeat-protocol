/**
 * @file tab-readme.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description README tab for the agent detail tab-view. Renders the agent's
 *   owner-namespaced `agents.<name>.readme` memory entry as GitHub-flavored
 *   Markdown. The value is agent-authored (often LLM-generated) and already
 *   final — crewaimeat expands all dynamic directives ([[FIGLET]], [[LLM]],
 *   [[AVAILABLE_COMMANDS]]) before storage — so the dashboard only reads and
 *   renders it. Rendering goes through components/Markdown.js, which builds
 *   Preact vnodes (never innerHTML) and sanitizes link schemes, so this
 *   untrusted content carries no XSS / prompt-injection-execution surface and
 *   is display-only (never used for any trust or routing decision).
 *
 *   The parent (agent-card.js) fetches the value and only mounts this tab when
 *   it is a non-empty string, so the empty state here is just a safety net.
 * @structure
 *   - TabReadme ({ readme }) -> rendered Markdown, or a quiet empty state
 * @version-history
 *   v1.0.0 -- 2026-05-31 -- Initial creation for the agent README tab
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';

const html = htm.bind(h);

export default function TabReadme({ readme }) {
  const value = typeof readme === 'string' ? readme.trim() : '';
  if (!value) {
    return html`<div class="pf-agd-empty">${t('profile.agents.detail.empty.readme')}</div>`;
  }
  return html`
    <div class="pf-agd-readme">
      <${Markdown} text=${value} />
    </div>
  `;
}
