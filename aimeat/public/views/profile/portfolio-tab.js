/**
 * @file portfolio-tab.js
 * @description Profile tab providing navigation to the portfolio builder and public view.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial portfolio tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export default function PortfolioTab({ session, navigate }) {
  return html`
    <div class="tab-content">
      <div class="portfolio-center">
        <h3>${t('portfolio.builder.heading')}</h3>
        <p class="portfolio-subtitle">${t('portfolio.builder.subtitle')}</p>
        <button class="btn btn-primary" onClick=${() => navigate('/v1/portfolio')}>
          ${t('portfolio.builder.heading')}
        </button>
        <br/><br/>
        ${session && html`
          <a href="/v1/portfolio/${encodeURIComponent(session.owner)}" class="btn btn-ghost" target="_blank">
            ${t('portfolio.builder.viewPublic')}
          </a>
        `}
      </div>
    </div>
  `;
}
