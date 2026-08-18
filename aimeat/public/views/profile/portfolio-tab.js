/**
 * @file portfolio-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for the portfolio. NOT a landing page: with no published
 *   portfolio it forwards straight to the builder (an empty two-button page was a wasted
 *   click); with one published it earns its place — public URL with copy, last updated,
 *   and Visit / Edit / Unpublish.
 * @version-history
 *   v2.0.0 — 2026-06-10 — Replace the two-button landing: auto-forward to the builder when
 *     nothing is published; published state shows URL + last updated + Visit/Edit/Unpublish.
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.0.0 — 2026-03-16 — Initial portfolio tab
 *   v2.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

// t() echoes the key when a translation is missing (e.g. a server still serving
// pre-update locales) — fall back to readable English instead of raw keys.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
import { apiGet, apiPut } from '/js/api.js';
import { Spinner } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { useConfirm } from '/components/Modal.js';

export default function PortfolioTab({ session, navigate, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  // undefined = loading, null = no config, object = config
  const [cfg, setCfg] = useState(undefined);

  const load = () => apiGet('/v1/portfolio/config')
    .then(r => setCfg(r?.data?.config || null))
    .catch(() => setCfg(null));
  useEffect(() => { load(); }, []);

  // No published portfolio → the builder IS the page. Forward instead of showing
  // two buttons on 90% whitespace. CRITICAL: clear the profile's remembered-open-tab
  // first — otherwise every later /v1/profile visit restores this tab, which forwards
  // again, and the user can never reach the profile home (bounce loop).
  // Forward to the builder once cfg resolves to "not published". Keyed on cfg only: navigate is a
  // prop function of uncertain stability, and adding it could re-fire the forward before unmount.
  useEffect(() => {
    if (cfg !== undefined && !cfg?.enabled) {
      try { sessionStorage.removeItem('aimeat-profile-tab'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
      navigate('/v1/portfolio');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  if (cfg === undefined) return html`<${Spinner} text=${t('loading') || 'Loading…'} />`;
  if (!cfg?.enabled) return null; // forwarding to the builder

  const url = `${window.location.origin}/v1/portfolio/${encodeURIComponent(session.owner)}`;

  const handleUnpublish = () => {
    confirm(tr('portfolio.builder.unpublishConfirm', 'Unpublish your portfolio? The public page stops working until you publish again.'), async () => {
      try {
        await apiPut('/v1/portfolio/config', { ...cfg, enabled: false, tags: ['portfolio'] });
        showToast?.(tr('portfolio.builder.unpublished', 'Portfolio unpublished'));
        navigate('/v1/portfolio');
      } catch (e) { showToast?.(e.message || 'Failed', true); }
    }, { danger: true });
  };

  return html`
    <div class="tab-content">
      <div class="section-title">${t('portfolio.builder.heading')}</div>
      <div class="section-desc">${t('portfolio.builder.enabled')}</div>

      <div class="card">
        <div class="mem-item">
          <span class="mem-key">${tr('portfolio.builder.publicUrl', 'Public URL')}</span>
          <span class="access-copy-val">
            <a href=${url} target="_blank">${url}</a>
            <${CopyButton} text=${url} className="btn-ghost btn-sm" label="📋"
              onCopied=${() => showToast?.(t('common.copied') || 'Copied')} />
          </span>
        </div>
        ${cfg.publishedAt && html`
          <div class="mem-item">
            <span class="mem-key">${tr('portfolio.builder.lastUpdated', 'Last updated')}</span>
            <span>${new Date(cfg.publishedAt).toLocaleString(getLocale() === 'fi' ? 'fi-FI' : undefined)}</span>
          </div>
        `}
        ${cfg.htmlSizeKb && html`
          <div class="mem-item">
            <span class="mem-key">${tr('portfolio.builder.sizeLabel', 'Size')}</span>
            <span>${cfg.htmlSizeKb} KB</span>
          </div>
        `}
        <div class="card-actions">
          <a class="btn-outline btn-sm" href=${url} target="_blank">${tr('portfolio.builder.visitBtn', 'Visit')}</a>
          <button class="btn-outline btn-sm" onClick=${() => navigate('/v1/portfolio')}>${tr('portfolio.builder.editBtn', 'Edit in builder')}</button>
          <button class="btn-danger btn-sm" onClick=${handleUnpublish}>${tr('portfolio.builder.unpublish', 'Unpublish')}</button>
        </div>
      </div>
      <${ConfirmUI} />
    </div>
  `;
}
