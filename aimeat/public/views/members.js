/**
 * @file members.js
 * @description Node members showcase — registered owners who have PUBLISHED a portfolio. A public grid
 *   (avatar + name + bio) that links each member to their portfolio (/v1/portfolio/<username>). Data from
 *   GET /v1/portfolio/members. "Discover the people on this node."
 * @structure MembersView (default) — fetch + grid.
 * @usage routed at /v1/members by spa.html.
 * @version-history
 *   v1.0.0 — 2026-06-23 — Initial node member showcase (published-portfolio owners).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { useState, useEffect } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { escHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';

export default function MembersView() {
  useViewCSS('/css/views/members.css');
  const [members, setMembers] = useState(null);
  useEffect(() => {
    apiGet('/v1/portfolio/members').then(r => setMembers(r?.data?.members || [])).catch(() => setMembers([]));
  }, []);

  return html`
    <div class="mbr">
      <h1 class="mbr-title">${t('members.title')}</h1>
      <p class="mbr-desc">${t('members.desc')}</p>
      ${members === null ? html`<div class="mbr-empty">…</div>`
        : members.length === 0 ? html`<div class="mbr-empty">${t('members.empty')}</div>`
        : html`<div class="mbr-grid">
            ${members.map(m => html`
              <a class="mbr-card" key=${m.username} href=${`/v1/portfolio/${encodeURIComponent(m.username)}`}>
                <div class="mbr-avatar">${(m.avatar && String(m.avatar).length <= 4) ? m.avatar : '👤'}</div>
                <div class="mbr-name">${escHtml(m.display_name || m.username)}</div>
                ${m.bio ? html`<div class="mbr-bio">${escHtml(m.bio)}</div>` : null}
              </a>`)}
          </div>`}
    </div>`;
}
