/**
 * @file public/views/admin/boards-tab.js
 * @description Admin dashboard "Boards" tab (Preact + HTM) — lists boards, expands/collapses
 *   their posts, creates new boards, and adds/removes board members through the admin API service.
 *
 * @structure
 *   - BoardsTab: default component rendering the board list + create form + member controls
 *   - togglePosts: lazy-loads and shows/hides a board's posts
 *   - createBoard: submits the new-board form to POST /v1/boards
 *   - addMember/removeMember: PATCH board membership via patchBoardMembers
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, Empty, useToast, Toast } from './shared.js';
import { getBoardPosts, patchBoardMembers } from '/js/services/admin.js';
import { apiPost } from '/js/api.js';

export default function BoardsTab({ data, reload }) {
  const boards = data.boards?.boards || [];
  const [posts, setPosts] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: '', slug: '', description: '', visibility: 'public' });
  const [toast, showErr, showOk, clearToast] = useToast();
  const [memberInput, setMemberInput] = useState({});

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

  async function addMember(boardId) {
    const gaii = (memberInput[boardId] || '').trim();
    if (!gaii) return;
    try {
      await patchBoardMembers(boardId, { add: [gaii] });
      showOk(t('dashboard.boardsTab.memberAdded'));
      setMemberInput(prev => ({ ...prev, [boardId]: '' }));
      reload();
    } catch (e) { showErr(e.message || t('dashboard.boardsTab.memberError')); }
  }

  async function removeMember(boardId, gaii) {
    try {
      await patchBoardMembers(boardId, { remove: [gaii] });
      showOk(t('dashboard.boardsTab.memberRemoved'));
      reload();
    } catch (e) { showErr(e.message || t('dashboard.boardsTab.memberError')); }
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
            <input class="adm-input adm-input-full adm-font-mono" value=${newBoard.slug} onInput=${e => setNewBoard(prev => ({...prev, slug: e.target.value}))}
              placeholder=${t('dashboard.boardSlug')} />
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
      ${boards.map(b => {
        const members = b.allowed_gaiis || [];
        const boardId = b.board_id || b.id || b.slug;
        return html`
          <div class="adm-card">
            <div class="adm-flex-between adm-mb-sm">
              <strong>${escHtml(b.name || b.slug)}</strong>
              <${Badge} type=${b.visibility || 'public'} />
            </div>
            ${b.description && html`<p class="adm-text-sm adm-text-dim adm-mb-sm" style="margin:0">${escHtml(b.description)}</p>`}
            <div class="adm-text-xs adm-text-dim adm-mb-sm">
              ${t('dashboard.slug')}: <code>${escHtml(b.slug)}</code> · ${t('dashboard.created')}: ${dt(b.created_at)}
              ${members.length > 0 && html` · ${t('dashboard.boardsTab.externalMembersCount', { count: members.length })}`}
            </div>
            <button class="adm-btn-sm" onClick=${() => togglePosts(b.slug)}>
              ${posts[b.slug] ? t('dashboard.hidePosts') : t('dashboard.showPosts')}
            </button>
            ${posts[b.slug] && html`
              <div class="adm-mt-sm adm-board-detail">
                ${!posts[b.slug].length
                  ? html`<div class="adm-text-sm adm-text-dim">${t('dashboard.noPosts')}</div>`
                  : posts[b.slug].map(p => html`
                      <div class="adm-board-post">
                        <div class="adm-flex-between adm-text-xs adm-text-dim">
                          <span>${escHtml(p.author)}</span>
                          <span>${dt(p.created_at)}</span>
                        </div>
                        <div class="adm-text-base">${escHtml(p.content?.substring(0, 200) || '')}</div>
                      </div>
                    `)
                }
                <div class="adm-board-members adm-mt-sm">
                  <strong class="adm-text-sm">${t('dashboard.boardsTab.membersSection')}</strong>
                  <div class="adm-text-xs adm-text-dim adm-mb-sm">${t('dashboard.boardsTab.sameOwnerInfo')}</div>
                  ${members.length > 0
                    ? html`<div class="adm-flex-wrap adm-mb-sm">
                        ${members.map(gaii => html`
                          <span class="adm-member-tag">
                            <code>${escHtml(gaii)}</code>
                            <button class="adm-member-remove" onClick=${() => removeMember(boardId, gaii)} title="Remove">\u00d7</button>
                          </span>
                        `)}
                      </div>`
                    : html`<div class="adm-text-xs adm-text-dim adm-mb-sm">${t('dashboard.boardsTab.noMembers')}</div>`
                  }
                  <div class="adm-member-add">
                    <input class="adm-input" value=${memberInput[boardId] || ''}
                      onInput=${e => setMemberInput(prev => ({ ...prev, [boardId]: e.target.value }))}
                      onKeyDown=${e => e.key === 'Enter' && addMember(boardId)}
                      placeholder=${t('dashboard.boardsTab.addMemberPlaceholder')} />
                    <button class="adm-btn-sm" onClick=${() => addMember(boardId)}>
                      ${t('dashboard.boardsTab.addMemberBtn')}
                    </button>
                  </div>
                </div>
              </div>
            `}
          </div>
        `;
      })}
    </div>
  `;
}
