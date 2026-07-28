/**
 * @file members.js
 * @description Node members showcase — registered owners who have PUBLISHED a portfolio. A public grid
 *   (avatar + name + bio) that links each member to their portfolio (/v1/portfolio/<username>). Data from
 *   GET /v1/portfolio/members. "Discover the people on this node."
 * @structure MembersView (default) — fetch + grid.
 * @usage routed at /v1/members by spa.html.
 * @version-history
 *   v1.0.0 — 2026-06-23 — Initial node member showcase (published-portfolio owners).
 *   v1.1.0 — 2026-07-28 — Say that the reader can be on this page too. It listed other people
 *     and gave a visitor no way to understand that a page is available to every account, either
 *     hand-made or written by their own AI from what they have actually done here.
 *   v1.2.0 — 2026-07-28 — Cards read as ID cards: the member's identicon (the same one their own
 *     profile home shows) beside their name and their full GHII. A name is a label; the
 *     identifier is what other people and their agents actually address.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { useState, useEffect } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { escHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { Spinner } from '/components/Spinner.js';
import { EmptyState } from '/components/EmptyState.js';
import { minidenticon } from '/lib/minidenticons.min.js';

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

      <!-- The point of the page is not the list, it is that the reader can join it. Every
           account can have a page, and the second route is the interesting one: the AI writes
           it from what you have actually done here rather than from what you claim. -->
      <div class="mbr-yours">
        <p class="mbr-yours-text">${t('members.yours')}</p>
        <a class="btn-primary mbr-yours-cta" href="/v1/portfolio">${t('members.yoursCta')}</a>
      </div>

      ${members === null ? html`<${Spinner} />`
        : members.length === 0 ? html`<${EmptyState} text=${t('members.empty')} />`
        : html`<div class="mbr-grid">
            ${members.map(m => html`
              <a class="mbr-card" key=${m.username} href=${`/v1/portfolio/${encodeURIComponent(m.username)}`}>
                <div class="mbr-card-head">
                  <!-- The same identicon the owner sees on their own profile home, so the face
                       here and the face there are one face. A short avatar value is an emoji the
                       member chose; anything longer is a storage key, which this public list does
                       not resolve, so it falls back to the identicon rather than a broken image. -->
                  ${(m.avatar && String(m.avatar).length <= 4)
                    ? html`<div class="mbr-avatar mbr-avatar--emoji">${m.avatar}</div>`
                    : html`<div class="mbr-avatar" dangerouslySetInnerHTML=${{ __html: minidenticon(m.username || 'user') }}></div>`}
                  <div class="mbr-idlines">
                    <div class="mbr-name">${escHtml(m.display_name || m.username)}</div>
                    <div class="mbr-ghii" title=${m.ghii || m.username}>${escHtml(m.ghii || m.username)}</div>
                  </div>
                </div>
                ${m.bio ? html`<div class="mbr-bio">${escHtml(m.bio)}</div>` : null}
              </a>`)}
          </div>`}
    </div>`;
}
