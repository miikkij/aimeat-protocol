import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, Empty } from './shared.js';
import { getBoardPosts } from '/js/services/admin.js';
import { apiPost } from '/js/api.js';

export default function BoardsTab({ data, reload }) {
  const boards = data.boards?.boards || [];
  const [posts, setPosts] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: '', slug: '', description: '', visibility: 'public' });

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

  async function createBoard() {
    if (!newBoard.name.trim() || !newBoard.slug.trim()) return;
    try {
      await apiPost('/v1/boards', {
        name: newBoard.name,
        slug: newBoard.slug,
        description: newBoard.description,
        visibility: newBoard.visibility,
      });
      alert(t('dashboard.boardCreateConfirm'));
      setNewBoard({ name: '', slug: '', description: '', visibility: 'public' });
      setShowCreate(false);
      reload();
    } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  if (!boards.length) return html`<${Empty} text=${t('dashboard.noBoardsCreated')} />`;

  return html`
    <div style="margin-bottom:12px">
      <button class="adm-btn-action" onClick=${() => setShowCreate(!showCreate)}>
        + ${t('dashboard.boardCreateSystem')}
      </button>
      ${showCreate && html`
        <div class="adm-card" style="margin-top:8px">
          <div style="display:flex;flex-direction:column;gap:8px">
            <input value=${newBoard.name} onInput=${e => setNewBoard(prev => ({...prev, name: e.target.value}))}
              placeholder=${t('dashboard.boardName')}
              style="background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px" />
            <input value=${newBoard.slug} onInput=${e => setNewBoard(prev => ({...prev, slug: e.target.value}))}
              placeholder=${t('dashboard.boardSlug')}
              style="background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px;font-family:monospace" />
            <input value=${newBoard.description} onInput=${e => setNewBoard(prev => ({...prev, description: e.target.value}))}
              placeholder=${t('dashboard.boardDescription')}
              style="background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px" />
            <select value=${newBoard.visibility} onChange=${e => setNewBoard(prev => ({...prev, visibility: e.target.value}))}
              style="background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px">
              <option value="public">${t('dashboard.boardPublic')}</option>
              <option value="private">${t('dashboard.boardPrivate')}</option>
            </select>
            <button class="adm-btn-action" onClick=${createBoard}>${t('dashboard.boardCreateSystem')}</button>
          </div>
        </div>
      `}
    </div>
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
