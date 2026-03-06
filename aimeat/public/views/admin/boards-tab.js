import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, Empty } from './shared.js';
import { getBoardPosts } from '/js/services/admin.js';

export default function BoardsTab({ data }) {
  const boards = data.boards?.boards || [];
  const [posts, setPosts] = useState({});

  async function togglePosts(slug) {
    if (posts[slug]) {
      setPosts(prev => { const n = { ...prev }; delete n[slug]; return n; });
      return;
    }
    try {
      const r = await getBoardPosts(slug);
      setPosts(prev => ({ ...prev, [slug]: r.data?.posts || [] }));
    } catch {}
  }

  if (!boards.length) return html`<${Empty} text=${t('dashboard.noBoardsCreated')} />`;

  return html`
    <div class="adm-card-grid">
      ${boards.map(b => html`
        <div class="adm-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong>${escHtml(b.name || b.slug)}</strong>
            <${Badge} type=${b.visibility || 'public'} />
          </div>
          ${b.description && html`<p style="font-size:.8rem;color:var(--text-dim);margin:0 0 8px">${escHtml(b.description)}</p>`}
          <div style="font-size:.75rem;color:var(--text-dim);margin-bottom:8px">
            ${t('dashboard.slug')}: <code>${escHtml(b.slug)}</code> · ${t('dashboard.created')}: ${dt(b.created_at)}
          </div>
          <button class="adm-btn-sm" onClick=${() => togglePosts(b.slug)}>
            ${posts[b.slug] ? t('dashboard.hidePosts') : t('dashboard.showPosts')}
          </button>
          ${posts[b.slug] && html`
            <div style="margin-top:8px;border-top:1px solid var(--card-border);padding-top:8px">
              ${!posts[b.slug].length
                ? html`<div style="font-size:.8rem;color:var(--text-dim)">${t('dashboard.noPosts')}</div>`
                : posts[b.slug].map(p => html`
                    <div style="margin-bottom:6px;padding:6px;background:var(--bg-card);border-radius:6px">
                      <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--text-dim)">
                        <span>${escHtml(p.author)}</span>
                        <span>${dt(p.created_at)}</span>
                      </div>
                      <div style="font-size:.85rem;margin-top:2px">${escHtml(p.content?.substring(0, 200) || '')}</div>
                    </div>
                  `)
              }
            </div>
          `}
        </div>
      `)}
    </div>
  `;
}
