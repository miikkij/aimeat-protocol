import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export default function PortfolioTab({ session, navigate }) {
  return html`
    <div class="tab-content">
      <div style="text-align:center; padding:2rem;">
        <h3>${t('portfolio.builder.heading')}</h3>
        <p style="color:var(--text-dim); margin-bottom:1.5rem;">${t('portfolio.builder.subtitle')}</p>
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
