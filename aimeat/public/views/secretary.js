/**
 * @file secretary.js
 * @description Secretary view (Phase 0 shell). Confirms the per-owner Secretary agent is provisioned
 *   and shows its identity + granted scopes. Reached from the header Secretary button, which appears
 *   once OpenRouter is configured. The full interactive Secretary (onboarding interview, brain, chat,
 *   feed, calendar) lands in later phases — see docs/plans/2026-06-23-secretary-feature.md.
 * @structure SECRETARY_ICON (heart-shield + quill svg) · SecretaryView (default) — fetch /v1/agents,
 *   find the `system:secretary` agent, show provisioning status + identity + scopes.
 * @usage routed at /v1/secretary by spa.html.
 * @version-history v0.1.0 — 2026-06-23 — Phase 0 shell: provisioning status + identity.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { useState, useEffect } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { escHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';

// Heart-shaped shield with a quill across it — the Secretary's mark.
export const SECRETARY_ICON = html`
  <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
    <path d="M12 20.6C6.4 16.7 3.4 13.2 3.4 9.2 3.4 6.5 5.4 4.6 7.9 4.6c1.7 0 3.2.9 4.1 2.4.9-1.5 2.4-2.4 4.1-2.4 2.5 0 4.5 1.9 4.5 4.6 0 4-3 7.5-8.6 11.4z"
          fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M16 8l-5.6 5.6M10.4 13.6l-1.5 2.4 2.4-1.5"
          fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export default function SecretaryView() {
  useViewCSS('/css/views/secretary.css');
  // undefined = loading, null = not provisioned yet, object = the Secretary agent.
  const [secretary, setSecretary] = useState(undefined);

  useEffect(() => {
    apiGet('/v1/agents')
      .then((r) => {
        const agents = (r && r.data && r.data.agents) || [];
        const sec = agents.find((a) => (a.tags || []).includes('system:secretary'))
          || agents.find((a) => a.name === 'secretary')
          || null;
        setSecretary(sec);
      })
      .catch(() => setSecretary(null));
  }, []);

  return html`
    <div class="sec">
      <header class="sec-hero">
        <span class="sec-hero-icon">${SECRETARY_ICON}</span>
        <div>
          <h1 class="sec-title">${t('secretary.title')}</h1>
          <p class="sec-desc">${t('secretary.desc')}</p>
        </div>
      </header>

      ${secretary === undefined
        ? html`<div class="sec-empty">…</div>`
        : secretary === null
        ? html`<div class="sec-empty">${t('secretary.notReady')}</div>`
        : html`
            <section class="sec-card">
              <div class="sec-status"><span class="sec-dot"></span> ${t('secretary.ready')}</div>
              <dl class="sec-meta">
                <dt>${t('secretary.identity')}</dt>
                <dd><code>${escHtml(secretary.gaii)}</code></dd>
                <dt>${t('secretary.scopes')}</dt>
                <dd class="sec-scopes">
                  ${(secretary.default_scopes || []).map((s) => html`<span class="sec-scope" key=${s}>${s}</span>`)}
                </dd>
              </dl>
              <p class="sec-soon">${t('secretary.soon')}</p>
            </section>`}
    </div>`;
}
