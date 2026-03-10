import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as boardsService from '/js/services/boards.js';

export default function BoardsTab({ session, showToast }) {
  const [myBoards, setMyBoards] = useState(null);
  const [allBoards, setAllBoards] = useState(null);
  const [boardView, setBoardView] = useState(null);
  const [brdSubTab, setBrdSubTab] = useState('mine');
  const [showBrdForm, setShowBrdForm] = useState(false);

  useEffect(() => {
    if (session) loadMyData();
  }, [session]);

  async function loadMyData() {
    try { setMyBoards(await boardsService.listSubscriptions()); }
    catch { setMyBoards([]); }
  }

  async function loadAllData() {
    try { setAllBoards(await boardsService.listAllBoards()); }
    catch { setAllBoards([]); }
  }

  async function handleCreate(name, desc, vis) {
    const resp = await boardsService.createBoard(name, desc, vis);
    if (resp.ok !== false) {
      // Auto-subscribe owner to their own board so it appears in "my boards"
      const boardId = resp.data?.id || resp.data?.board_id;
      if (boardId) await boardsService.subscribe(boardId).catch(() => {});
      showToast(t('profile.boards.created'));
      setShowBrdForm(false);
      loadMyData();
    } else showToast(t('profile.boards.createFailed'), true);
  }

  async function handleSubscribe(boardId) {
    try {
      const resp = await boardsService.subscribe(boardId);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Subscribe failed');
      showToast(t('profile.boards.subscribed'));
      loadMyData();
    } catch(e) { showToast(e.message || t('profile.boards.subscribeFailed'), true); }
  }

  async function viewPosts(boardId, boardName) {
    try {
      const posts = await boardsService.listPosts(boardId);
      setBoardView({ id: boardId, name: boardName, posts });
    } catch { setBoardView({ id: boardId, name: boardName, posts: [] }); }
  }

  async function handlePost(boardId, content) {
    if (!content?.trim()) { showToast(t('profile.boards.writeFirst'), true); return; }
    const resp = await boardsService.createPost(boardId, content);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.boards.posted'));
    viewPosts(boardId, boardView?.name);
  }

  async function handleReact(boardId, postId, emoji) {
    const resp = await boardsService.reactToPost(boardId, postId, emoji);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    viewPosts(boardId, boardView?.name);
  }

  async function handleDeleteBoard(boardId) {
    if (!confirm(t('profile.boards.confirmDeleteBoard') || 'Delete this board and all its posts?')) return;
    const resp = await boardsService.deleteBoard(boardId);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.boards.boardDeleted') || 'Board deleted');
    loadMyData();
  }

  async function handleDeletePost(boardId, postId) {
    if (!confirm(t('profile.boards.confirmDelete') || 'Delete this post?')) return;
    const resp = await boardsService.deletePost(boardId, postId);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.boards.postDeleted') || 'Post deleted');
    viewPosts(boardId, boardView?.name);
  }

  function isMyPost(post) {
    const author = post.author_gaii || post.author || '';
    return author === session?.ghii || author === session?.owner || author === session?.gaii;
  }

  if (boardView) {
    const postRef = useRef(null);
    return html`
      <button class="btn-outline" style="margin-bottom:1rem" onClick=${() => setBoardView(null)}>\u2190 ${t('profile.boards.backToBoards')}</button>
      <div class="section-title">${escHtml(boardView.name)}</div>
      <div style="margin-bottom:1rem">
        <textarea ref=${postRef} class="input-field" rows="2" placeholder=${t('profile.boards.postPlaceholder')}></textarea>
        <button class="btn-primary" style="margin-top:.5rem" onClick=${() => { handlePost(boardView.id, postRef.current?.value); if (postRef.current) postRef.current.value = ''; }}>${t('profile.boards.postBtn')}</button>
      </div>
      ${boardView.posts.length === 0
        ? html`<div class="empty">${t('profile.boards.postsEmpty')}</div>`
        : boardView.posts.map(p => html`
          <div class="post-card">
            <div class="post-content">${escHtml(p.content)}</div>
            <div class="post-meta">
              <span>${escHtml(p.author_gaii || p.author || '-')}</span>
              <span>${p.created_at ? timeAgo(p.created_at) : ''}</span>
              ${isMyPost(p) ? html`<button class="btn-sm btn-danger" style="margin-left:auto;font-size:.75rem;padding:2px 8px" onClick=${(e) => { e.stopPropagation(); handleDeletePost(boardView.id, p.id || p.post_id); }}>${t('profile.boards.deletePost') || 'Delete'}</button>` : null}
            </div>
            <div class="post-reactions">
              ${['\u{1F44D}','\u2764\uFE0F','\u{1F525}','\u{1F4A1}','\u{1F602}'].map(emoji => html`
                <button class="reaction-btn" onClick=${() => handleReact(boardView.id, p.id || p.post_id, emoji)}>${emoji} ${p.reactions?.[emoji] || ''}</button>
              `)}
            </div>
          </div>
        `)
      }`;
  }

  return html`
    <div class="section-title">${t('profile.boards.title')}</div>
    <div class="section-desc">${t('profile.boards.desc')}</div>
    <div class="sub-tabs">
      <button class="sub-tab ${brdSubTab === 'mine' ? 'active' : ''}" onClick=${() => { setBrdSubTab('mine'); if (!myBoards) loadMyData(); }}>${t('profile.boards.mine')}</button>
      <button class="sub-tab ${brdSubTab === 'browse' ? 'active' : ''}" onClick=${() => { setBrdSubTab('browse'); if (!allBoards) loadAllData(); }}>${t('profile.boards.browse')}</button>
    </div>
    ${brdSubTab === 'mine' ? html`
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowBrdForm(!showBrdForm)}>${t('profile.boards.createBtn')}</button>
      ${showBrdForm && html`<${BoardForm} onCreate=${handleCreate} onCancel=${() => setShowBrdForm(false)} />`}
      ${!myBoards ? html`<${Spinner} text=${t('profile.boards.loading')} />`
        : myBoards.length === 0 ? html`<div class="empty">${t('profile.boards.empty')}</div>`
        : myBoards.map(b => html`
          <div class="card" style="cursor:pointer" onClick=${() => viewPosts(b.id || b.board_id, b.name)}>
            <div class="card-header">
              <div class="card-title">${escHtml(b.name)}</div>
              <div style="display:flex;align-items:center;gap:.5rem">
                <span class="badge ${b.visibility === 'public' ? 'badge-success' : 'badge-muted'}">${b.visibility || 'private'}</span>
                <button class="btn-sm btn-danger" style="font-size:.7rem;padding:2px 8px" onClick=${(e) => { e.stopPropagation(); handleDeleteBoard(b.id || b.board_id); }}>${t('profile.boards.deleteBoard') || 'Delete'}</button>
              </div>
            </div>
            <div class="card-subtitle">${escHtml(b.description || '')}</div>
          </div>
        `)
      }
    ` : html`
      ${!allBoards ? html`<${Spinner} text=${t('profile.boards.browseLoading')} />`
        : allBoards.length === 0 ? html`<div class="empty">${t('profile.boards.browseEmpty')}</div>`
        : allBoards.map(b => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title" style="cursor:pointer" onClick=${() => viewPosts(b.id || b.board_id, b.name)}>${escHtml(b.name)}</div>
              <button class="btn-sm" onClick=${() => handleSubscribe(b.id || b.board_id)}>${t('profile.boards.subscribe')}</button>
            </div>
            <div class="card-subtitle">${escHtml(b.description || '')}</div>
          </div>
        `)
      }
    `}
  `;
}

function BoardForm({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [vis, setVis] = useState('private');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.boards.nameLabel')}</label><input class="input-field" placeholder=${t('profile.boards.namePlaceholder')} value=${name} onInput=${e => setName(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.boards.descLabel')}</label><input class="input-field" placeholder=${t('profile.boards.descPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.boards.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.boards.visPrivate')}</option>
          <option value="public">${t('profile.boards.visPublic')}</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onCreate(name, desc, vis)}>${t('profile.boards.createSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}
