import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as boardsService from '/js/services/boards.js';

export default function BoardsTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
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

  // Live update listener
  const loadRef = useRef(loadMyData);
  loadRef.current = loadMyData;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

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
    try {
      await boardsService.createPost(boardId, content);
      showToast(t('profile.boards.posted'));
      viewPosts(boardId, boardView?.name);
    } catch (e) { showToast(e.message || t('profile.error'), true); }
  }

  async function handleReact(boardId, postId, emoji) {
    try {
      await boardsService.reactToPost(boardId, postId, emoji);
      viewPosts(boardId, boardView?.name);
    } catch (e) { showToast(e.message || t('profile.error'), true); }
  }

  async function handleDeleteBoard(boardId) {
    confirm(t('profile.boards.confirmDeleteBoard') || 'Delete this board and all its posts?', async () => {
      try {
        await boardsService.deleteBoard(boardId);
        showToast(t('profile.boards.boardDeleted') || 'Board deleted');
        loadMyData();
      } catch (e) { showToast(e.message || t('profile.error'), true); }
    }, { danger: true });
  }

  async function handleDeletePost(boardId, postId) {
    confirm(t('profile.boards.confirmDelete') || 'Delete this post?', async () => {
      try {
        await boardsService.deletePost(boardId, postId);
        showToast(t('profile.boards.postDeleted') || 'Post deleted');
        viewPosts(boardId, boardView?.name);
      } catch (e) { showToast(e.message || t('profile.error'), true); }
    }, { danger: true });
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
      }
      <${ConfirmUI} />`;
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
        : myBoards.map(b => { const bid = b.board_id || b.id; return html`
          <div class="card" style="cursor:pointer" onClick=${() => viewPosts(bid, b.name)}>
            <div class="card-header">
              <div class="card-title">${escHtml(b.name)}</div>
              <div style="display:flex;align-items:center;gap:.5rem">
                <span class="badge ${b.visibility === 'public' ? 'badge-success' : 'badge-muted'}">${b.visibility || 'private'}</span>
                <button class="btn-sm btn-danger" style="font-size:.7rem;padding:2px 8px" onClick=${(e) => { e.stopPropagation(); handleDeleteBoard(bid); }}>${t('profile.boards.deleteBoard') || 'Delete'}</button>
              </div>
            </div>
            <div class="card-subtitle">${escHtml(b.description || '')}</div>
          </div>
        `; })
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
    <${ConfirmUI} />
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
