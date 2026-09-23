/**
 * @file public/components/StatLine.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One line that is a door, over a 3px ink rule (poster.css .poster-stat): a sentence
 *   with its number set big, led by an icon (kept for readers, hidden on screen) or a state dot.
 *   Its look is css/components/stat-line.css; the catalogue entry is `stat-line`. statSentence()
 *   sets the number inside a translated sentence where that language put it.
 * @structure StatLine({ href, tone, icon, dot, children }) · statSentence(sentence, placeholder, value)
 * @usage
 *   html`<${StatLine} href="/v1/profile?tab=messages" tone="alert" icon="📬">
 *     ${statSentence(t('home.mail.unread'), '{n}', 7)}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js (the mailbox and fleet lines)
 *     with its markup unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

const TONES = { alert: 'poster-stat--alert', ok: 'poster-stat--ok', trouble: 'poster-stat--trouble' };

/**
 * A sentence with its number set big. The translated string keeps its placeholder until here, so
 * the numeral lands where that language puts it; a string without the placeholder renders as it is.
 */
export function statSentence(sentence, placeholder, value) {
  const at = sentence.indexOf(placeholder);
  if (at < 0) return sentence;
  return html`${sentence.slice(0, at)}<b class="poster-stat-number">${String(value)}</b>${sentence.slice(at + placeholder.length)}`;
}

/**
 * @param {{ href: string, tone?: 'alert'|'ok'|'trouble', icon?: string, dot?: boolean, children?: any }} props
 */
export function StatLine({ href, tone, icon, dot = false, children }) {
  return html`
    <a class="poster-stat ${tone ? TONES[tone] : ''}" href=${href}>
      ${icon ? html`<span class="poster-stat-icon" aria-hidden="true">${icon}</span>` : ''}
      ${dot ? html`<span class="poster-stat-dot" aria-hidden="true"></span>` : ''}
      <span>
        ${children}
      </span>
    </a>`;
}

export default StatLine;
