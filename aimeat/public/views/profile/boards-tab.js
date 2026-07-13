/**
 * @file boards-tab.js
 * @description Profile tab for discussion boards — create, subscribe, browse, post, react, delete, member management.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes
 *   v1.1.0 — 2026-03-20 — Add board member management UI for shared boards
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as boardsService from '/js/services/boards.js';

/** Extract the owner name from a GAII or GHII string. */
function extractOwner(gaii) {
  if (!gaii) return '';
  // agent#owner@node -> owner
  const hashIdx = gaii.indexOf('#');
  const atIdx = gaii.indexOf('@');
  if (hashIdx >= 0 && atIdx > hashIdx) return gaii.slice(hashIdx + 1, atIdx);
  // owner@node -> owner
  if (atIdx >= 0) return gaii.slice(0, atIdx);
  return gaii;
}

export default function BoardsTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [myBoards, setMyBoards] = useState(null);
  const [allBoards, setAllBoards] = useState(null);
  const [boardView, setBoardView] = useState(null);
  const [brdSubTab, setBrdSubTab] = useState('mine');
  const [showBrdForm, setShowBrdForm] = useState(false);
  // Ref used by the board-detail view below — declared unconditionally (Rules of Hooks).
  const postRef = useRef(null);

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
  useEffect(() => onLiveUpdate(['boards'], () => loadRef.current()), []);

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

  const cycleVis = ['private', 'shared', 'public'];
  const visColor = { private: '#c084fc', shared: '#60a5fa', public: '#4ade80' };
  const visBg = { private: 'rgba(150,100,200,.2)', shared: 'rgba(96,165,250,.2)', public: 'rgba(0,200,100,.2)' };

  async function handleUpdateBoardVisibility(boardId, newVis) {
    setMyBoards(prev => prev?.map(b => (b.board_id || b.id) === boardId ? { ...b, visibility: newVis } : b));
    const resp = await boardsService.updateBoardVisibility(boardId, newVis);
    if (resp.ok === false) {
      showToast(resp.error?.message || t('profile.error'), true);
      loadMyData();
    }
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
      // Find the board data to get owner_gaii and allowed_gaiis
      const boardData = myBoards?.find(b => (b.board_id || b.id) === boardId)
        || allBoards?.find(b => (b.board_id || b.id) === boardId);
      setBoardView({ id: boardId, name: boardName, posts, boardData });
    } catch { setBoardView({ id: boardId, name: boardName, posts: [], boardData: null }); }
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

  async function toggleBoardFederate(boardId, value) {
    try {
      await boardsService.updateBoardVisibility(boardId, undefined, value);
      loadMyData();
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

  async function handleAddMember(boardId, gaii) {
    try {
      await boardsService.updateBoardMembers(boardId, { add: [gaii] });
      showToast(t('profile.boards.memberAdded'));
      // Reload board list to get updated allowed_gaiis, then refresh the view
      await loadMyData();
      viewPosts(boardId, boardView?.name);
    } catch (e) { showToast(e.message || t('profile.boards.memberError'), true); }
  }

  async function handleRemoveMember(boardId, gaii) {
    try {
      await boardsService.updateBoardMembers(boardId, { remove: [gaii] });
      showToast(t('profile.boards.memberRemoved'));
      await loadMyData();
      viewPosts(boardId, boardView?.name);
    } catch (e) { showToast(e.message || t('profile.boards.memberError'), true); }
  }

  function isMyPost(post) {
    const author = post.author_gaii || post.author || '';
    return author === session?.ghii || author === session?.owner || author === session?.gaii;
  }

  /** Check if current user owns the board. */
  function isBoardOwner(boardData) {
    if (!boardData?.owner_gaii || !session?.owner) return false;
    return extractOwner(boardData.owner_gaii) === session.owner;
  }

  if (boardView) {
    const bd = boardView.boardData;
    const showMembers = bd && bd.visibility === 'shared' && isBoardOwner(bd);
    return html`
      <button class="btn-outline mb-1" onClick=${() => setBoardView(null)}>\u2190 ${t('profile.boards.backToBoards')}</button>
      <div class="section-title">${escHtml(boardView.name)}</div>
      ${showMembers && html`<${BoardMembers}
        boardId=${boardView.id}
        allowedGaiis=${bd.allowed_gaiis || []}
        onAdd=${(gaii) => handleAddMember(boardView.id, gaii)}
        onRemove=${(gaii) => handleRemoveMember(boardView.id, gaii)}
      />`}
      <div class="mb-1">
        <textarea ref=${postRef} class="input-field" rows="2" placeholder=${t('profile.boards.postPlaceholder')}></textarea>
        <button class="btn-primary mb-half" onClick=${() => { handlePost(boardView.id, postRef.current?.value); if (postRef.current) postRef.current.value = ''; }}>${t('profile.boards.postBtn')}</button>
      </div>
      ${boardView.posts.length === 0
        ? html`<div class="empty">${t('profile.boards.postsEmpty')}</div>`
        : boardView.posts.map(p => html`
          <div class="post-card">
            <div class="post-content">${escHtml(p.body || p.content || '')}</div>
            <div class="post-meta">
              <span>${escHtml(p.author_gaii || p.author || '-')}</span>
              <span class="text-meta">\u00B7</span>
              <span>${p.created_at ? timeAgo(p.created_at) : ''}</span>
              ${isMyPost(p) ? html`<button class="btn-danger-solid btn-sm pf-ml-auto" onClick=${(e) => { e.stopPropagation(); handleDeletePost(boardView.id, p.id || p.post_id); }}>${t('profile.boards.deletePost') || 'Delete'}</button>` : null}
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
      <button class="btn-primary mb-1" onClick=${() => setShowBrdForm(!showBrdForm)}>${t('profile.boards.createBtn')}</button>
      ${showBrdForm && html`<${BoardForm} onCreate=${handleCreate} onCancel=${() => setShowBrdForm(false)} />`}
      ${!myBoards ? html`<${Spinner} text=${t('profile.boards.loading')} />`
        : myBoards.length === 0 ? html`<div class="empty">${t('profile.boards.empty')}</div>`
        : myBoards.map(b => { const bid = b.board_id || b.id; const vis = b.visibility || 'private'; const nextVis = cycleVis[(cycleVis.indexOf(vis) + 1) % cycleVis.length]; return html`
          <div class="card card-clickable" onClick=${() => viewPosts(bid, b.name)}>
            <div class="card-header">
              <div class="card-title">${escHtml(b.name)}</div>
              <div class="flex-row">
                <button class="kpkg-vis-pill"
                  onClick=${(e) => { e.stopPropagation(); handleUpdateBoardVisibility(bid, nextVis); }}
                  title="${t('knowledge.visibility.' + vis)} \u2192 ${t('knowledge.visibility.' + nextVis)}"
                  style="background:${visBg[vis]};color:${visColor[vis]};border-color:${visColor[vis]}"
                >${t('knowledge.visibility.' + vis)} \u25BE</button>
                ${vis === 'public' && html`<span class="${b.federate ? 'badge badge-success' : 'badge badge-muted'}"
                  onClick=${(e) => { e.stopPropagation(); toggleBoardFederate(bid, !b.federate); }}
                  title=${t('profile.federateTooltip')}>
                  ${b.federate ? t('profile.federated') : t('profile.notFederated')}
                </span>`}
                <button class="btn-danger-solid btn-sm" onClick=${(e) => { e.stopPropagation(); handleDeleteBoard(bid); }}>${t('profile.boards.deleteBoard')}</button>
              </div>
            </div>
            ${b.description ? html`<div class="card-subtitle">${escHtml(b.description)}</div>` : null}
            <div class="text-meta-sm">${b.created_at ? timeAgo(b.created_at) : ''}</div>
          </div>
        `; })
      }
    ` : html`
      ${!allBoards ? html`<${Spinner} text=${t('profile.boards.browseLoading')} />`
        : allBoards.length === 0 ? html`<div class="empty">${t('profile.boards.browseEmpty')}</div>`
        : allBoards.map(b => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title card-clickable" onClick=${() => viewPosts(b.id || b.board_id, b.name)}>${escHtml(b.name)}</div>
              <button class="btn-sm" onClick=${() => handleSubscribe(b.id || b.board_id)}>${t('profile.boards.subscribe')}</button>
            </div>
            ${b.description ? html`<div class="card-subtitle">${escHtml(b.description)}</div>` : null}
            <div class="text-meta-sm">${b.created_at ? timeAgo(b.created_at) : ''}</div>
          </div>
        `)
      }
    `}
    <${ConfirmUI} />
  `;
}

/** Board member management section for shared boards. */
function BoardMembers({ allowedGaiis, onAdd, onRemove }) {
  const inputRef = useRef(null);

  function handleAdd() {
    const val = inputRef.current?.value?.trim();
    if (!val) return;
    onAdd(val);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
  }

  /** Truncate long GAII for display. */
  function truncGaii(gaii) {
    if (!gaii || gaii.length <= 40) return gaii;
    return gaii.slice(0, 18) + '\u2026' + gaii.slice(-18);
  }

  return html`
    <div class="brd-members card mb-1">
      <div class="card-title">${t('profile.boards.membersTitle')}</div>
      <div class="text-meta-sm mb-half">${t('profile.boards.autoAccessInfo')}</div>
      ${allowedGaiis.length > 0 && html`
        <div class="brd-member-tags mb-half">
          ${allowedGaiis.map(g => html`
            <span class="brd-member-tag" title=${escHtml(g)}>
              <span>${escHtml(truncGaii(g))}</span>
              <button class="brd-member-remove" onClick=${() => onRemove(g)} aria-label="Remove">\u00D7</button>
            </span>
          `)}
        </div>
      `}
      <div class="brd-member-add">
        <input ref=${inputRef} class="input-field" placeholder=${t('profile.boards.addMemberPlaceholder')} onKeyDown=${handleKeyDown} />
        <button class="btn-primary btn-sm" onClick=${handleAdd}>${t('profile.boards.addMember')}</button>
      </div>
    </div>
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
          <option value="shared">${t('profile.boards.visShared')}</option>
          <option value="public">${t('profile.boards.visPublic')}</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onCreate(name, desc, vis)}>${t('profile.boards.createSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}
