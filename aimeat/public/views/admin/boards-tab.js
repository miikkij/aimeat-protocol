import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, Empty, useToast, Toast } from './shared.js';
import { getBoardPosts } from '/js/services/admin.js';
import { apiPost } from '/js/api.js';

export default function BoardsTab({ data, reload }) {
  const boards = data.boards?.boards || [];
  const [posts, setPosts] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: '', slug: '', description: '', visibility: 'public' });
  const [toast, showErr, showOk, clearToast] = useToast();

  async function togglePosts(slug) {
    if (posts[slug]) {
      setPosts(prev => { const n = { ...prev }; delete n[slug]; return n; });
      return;
    }
    try {
      const r = await getBoardPosts(slug);
      setPosts(prev => ({ ...prev, [slug]: r.data?.posts || [] }));
    } catch (e) { console.warn('Failed to load data:', e.message); }
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
      showOk(t('dashboard.boardCreateConfirm'));
      setNewBoard({ name: '', slug: '', description: '', visibility: 'public' });
      setShowCreate(false);
      reload();
    } catch (e) { showErr(e.message); }
  }

  if (!boards.length) return html`<${Empty} text=${t('dashboard.noBoardsCreated')} />`;

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <div class="adm-mb-md">
      <button class="adm-btn-action" onClick=${() => setShowCreate(!showCreate)}>
        + ${t('dashboard.boardCreateSystem')}
      </button>
      ${showCreate && html`
        <div class="adm-card adm-mt-sm">
          <div class="adm-flex-col">
            <input class="adm-input adm-input-full" value=${newBoard.name} onInput=${e => setNewBoard(prev => ({...prev, name: e.target.value}))}
              placeholder=${t('dashboard.boardName')} />
            <input class="adm-input adm-input-full" value=${newBoard.slug} onInput=${e => setNewBoard(prev => ({...prev, slug: e.target.value}))}
              placeholder=${t('dashboard.boardSlug')}
              style="font-family:monospace" />
            <input class="adm-input adm-input-full" value=${newBoard.description} onInput=${e => setNewBoard(prev => ({...prev, description: e.target.value}))}
              placeholder=${t('dashboard.boardDescription')} />
            <select class="adm-input adm-input-full" value=${newBoard.visibility} onChange=${e => setNewBoard(prev => ({...prev, visibility: e.target.value}))}>
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
          <div class="adm-flex-between adm-mb-sm">
            <strong>${escHtml(b.name || b.slug)}</strong>
            <${Badge} type=${b.visibility || 'public'} />
          </div>
          ${b.description && html`<p class="adm-text-sm adm-text-dim adm-mb-sm" style="margin:0">${escHtml(b.description)}</p>`}
          <div class="adm-text-xs adm-text-dim adm-mb-sm">
            ${t('dashboard.slug')}: <code>${escHtml(b.slug)}</code> · ${t('dashboard.created')}: ${dt(b.created_at)}
          </div>
          <button class="adm-btn-sm" onClick=${() => togglePosts(b.slug)}>
            ${posts[b.slug] ? t('dashboard.hidePosts') : t('dashboard.showPosts')}
          </button>
          ${posts[b.slug] && html`
            <div class="adm-mt-sm" style="border-top:1px solid var(--card-border);padding-top:8px">
              ${!posts[b.slug].length
                ? html`<div class="adm-text-sm adm-text-dim">${t('dashboard.noPosts')}</div>`
                : posts[b.slug].map(p => html`
                    <div style="margin-bottom:6px;padding:6px;background:var(--bg-card);border-radius:6px">
                      <div class="adm-flex-between adm-text-xs adm-text-dim">
                        <span>${escHtml(p.author)}</span>
                        <span>${dt(p.created_at)}</span>
                      </div>
                      <div class="adm-text-base" style="margin-top:2px">${escHtml(p.content?.substring(0, 200) || '')}</div>
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
