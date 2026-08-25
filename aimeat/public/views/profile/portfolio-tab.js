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
  const [seoBusy, setSeoBusy] = useState(false);

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
  // Unpublished but PREVIOUSLY PUBLISHED is its own state, and it used to have no page at all.
  // The forward below sent anyone whose portfolio was switched off straight into the builder, where
  // nothing said the old page still existed — so pressing Unpublish read as having destroyed the
  // work. It never did: unpublishing writes `enabled: false` and does not touch the stored HTML.
  // `publishedAt` is the evidence that a page is sitting there, and it earns a card of its own.
  const wasPublished = !!(cfg && (cfg.publishedAt || cfg.htmlSizeKb));

  useEffect(() => {
    if (cfg !== undefined && !cfg?.enabled && !wasPublished) {
      try { sessionStorage.removeItem('aimeat-profile-tab'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
      navigate('/v1/portfolio');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, wasPublished]);

  if (cfg === undefined) return html`<${Spinner} text=${t('loading') || 'Loading…'} />`;
  if (!cfg?.enabled && !wasPublished) return null; // nothing here yet — forwarding to the builder

  const url = `${window.location.origin}/v1/portfolio/${encodeURIComponent(session.owner)}`;

  const handleRepublish = async () => {
    setSeoBusy(true);
    try {
      // The stored HTML was never touched, so this is the whole restore: one field back to true.
      await apiPut('/v1/portfolio/config', { ...cfg, enabled: true, tags: ['portfolio'] });
      setCfg({ ...cfg, enabled: true });
      showToast?.(tr('portfolio.builder.republished', 'Your portfolio is public again.'));
    } catch (e) {
      showToast?.(e.message || 'Failed', true);
    } finally {
      setSeoBusy(false);
    }
  };

  const handleSeoToggle = async () => {
    setSeoBusy(true);
    try {
      const next = !cfg.seoIndex;
      // The PUT merges over what is already stored, so this changes the one field and leaves the
      // rest of the portfolio config exactly where it was.
      await apiPut('/v1/portfolio/config', { ...cfg, seoIndex: next, tags: ['portfolio'] });
      setCfg({ ...cfg, seoIndex: next });
      showToast?.(next
        ? tr('portfolio.builder.seoOnOk', 'Search engines can find your portfolio. They usually take a few days.')
        : tr('portfolio.builder.seoOffOk', 'Taken out of search engines.'));
    } catch (e) {
      showToast?.(e.message || 'Failed', true);
    } finally {
      setSeoBusy(false);
    }
  };

  const handleUnpublish = () => {
    confirm(tr('portfolio.builder.unpublishConfirm', 'Take your portfolio off the web? Nothing is deleted \u2014 the page stays stored here and you can make it public again from this tab whenever you like.'), async () => {
      try {
        await apiPut('/v1/portfolio/config', { ...cfg, enabled: false, tags: ['portfolio'] });
        // Stay here. Forwarding to the builder is what made this act read as destructive: the
        // page vanished, the builder said nothing about it, and the way back did not exist. The
        // card this now falls through to says the page is still stored and offers to restore it.
        setCfg({ ...cfg, enabled: false });
        showToast?.(tr('portfolio.builder.unpublished',
          'Taken off the web. The page is still stored here — you can make it public again below.'));
      } catch (e) { showToast?.(e.message || 'Failed', true); }
    }, { danger: true });
  };

  // Switched off, with a page still sitting there. Says so, and offers the one thing that was
  // missing: the way back. Everything else on this tab describes a live page, so it stays hidden.
  if (!cfg.enabled) {
    return html`
      <div class="tab-content">
        <div class="section-title">${t('portfolio.builder.heading')}</div>
        <div class="card">
          <div class="mem-item">
            <span class="mem-key">${tr('portfolio.builder.offLabel', 'Status')}</span>
            <span>${tr('portfolio.builder.offBody',
              'Your portfolio is not public right now. It has not been deleted — the page you built is still stored here, exactly as it was.')}</span>
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
            <button class="btn-primary btn-sm" disabled=${seoBusy} onClick=${handleRepublish}>
              ${tr('portfolio.builder.republish', 'Make it public again')}
            </button>
            <button class="btn-outline btn-sm" onClick=${() => navigate('/v1/portfolio')}>
              ${tr('portfolio.builder.editBtn', 'Edit in builder')}
            </button>
          </div>
        </div>
        <${ConfirmUI} />
      </div>
    `;
  }

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

      <!-- Two switches, not one. Publishing puts the page online and on this node's member
           showcase; letting a search engine list a page carrying your own name is a separate
           question, and it is the one worth asking separately. Off until asked. -->
      <div class="card">
        <div class="mem-item">
          <span class="mem-key">${tr('portfolio.builder.seoLabel', 'Search engines')}</span>
          <span>${cfg.seoIndex
            ? tr('portfolio.builder.seoOn', 'Your portfolio can be found in search engines.')
            : tr('portfolio.builder.seoOff', 'Your portfolio is not in search engines. The page works and can be shared by link.')}</span>
        </div>
        <div class="card-actions">
          <button class=${cfg.seoIndex ? 'btn-outline btn-sm' : 'btn-primary btn-sm'}
                  disabled=${seoBusy}
                  onClick=${handleSeoToggle}>
            ${cfg.seoIndex
              ? tr('portfolio.builder.seoTurnOff', 'Take it out of search engines')
              : tr('portfolio.builder.seoTurnOn', 'Let search engines find it')}
          </button>
        </div>
      </div>
      <${ConfirmUI} />
    </div>
  `;
}
