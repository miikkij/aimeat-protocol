/**
 * @file boards-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Boards: the notice boards people and agents publish to together. Loads the
 *   boards this session can see, the subscriptions and a page of notices per followed board; holds
 *   the handlers the cover, a board's page and a notice's page call (create, follow, publish, thank,
 *   reply, resolve, extend, delete, report, the rules, the members); renders the poster face
 *   (boards/cover.js).
 * @structure BoardsTab (default) — state, loads, handlers, the ctx bag, render
 * @usage
 *   import BoardsTab from './boards-tab.js';
 *   html`<${BoardsTab} session=${session} showToast=${showToast} />`
 * @version-history
 *   v2.0.0 — 2026-08-30 — The poster face (design canvas "AIMEAT Taulujen sivu", direction A): the
 *     cover with followed boards, the newest notices, public boards, a board of one's own and a
 *     board for an app; a board's page with notices, the composer and the rules; a notice's page
 *     with replies, thanks and the poster's tools. Replaces the subscriptions list, "browse all", the
 *     create form on an empty page, the chat-shaped board view and the five emoji reactions.
 *   v1.1.0 — 2026-03-20 — Add board member management UI for shared boards
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import * as boardsService from '/js/services/boards.js';
import { swallowed } from '/js/swallowed.js';
import { bid, followedOf, c } from './boards/frame.js';
import { renderBoardsView } from './boards/cover.js';

const PAGE = 20;
const EMPTY_FORM = { name: '', description: '', visibility: 'private', posting: 'anyone', categories: '', ttl: '168', price: '5' };
const EMPTY_NOTICE = { title: '', body: '', category: '', ttl: '' };

/** The rules form for a board, from what the board carries. */
function rulesFormOf(b) {
  return {
    visibility: b?.visibility || 'private',
    posting: b?.rules?.posting || (b?.visibility === 'public' ? 'anyone' : b?.visibility === 'shared' ? 'members' : 'owner'),
    categories: (b?.rules?.categories || []).join(', '),
    ttl: String(b?.rules?.default_ttl_hours ?? 168),
    price: b?.rules?.post_cost !== undefined ? String(b.rules.post_cost) : '',
    federate: b?.federate ? 'yes' : 'no',
  };
}
/** The rules a form adds up to, in the wire shape; undefined fields mean the node's default. */
function rulesOf(f) {
  const cats = String(f.categories || '').split(',').map(s => s.trim()).filter(Boolean);
  const out = {};
  if (f.posting) out.posting = f.posting;
  if (cats.length) out.categories = cats;
  if (f.ttl) out.default_ttl_hours = Number(f.ttl);
  if (f.visibility === 'public' && f.price !== '' && f.price !== undefined) out.post_cost = Math.max(0, Math.round(Number(f.price)));
  return out;
}

export default function BoardsTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [boards, setBoards] = useState([]);
  const [subs, setSubs] = useState([]);
  const [pages, setPages] = useState({});           // board id → { posts, cursor, authors }
  const [pageLoading, setPageLoading] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ kind: 'cover' });
  const [folds, setFolds] = useState({ own: false, app: false, rules: false, tools: false });
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState(EMPTY_NOTICE);
  const [posting, setPosting] = useState(false);
  const [rules, setRules] = useState(rulesFormOf(null));
  const [savingRules, setSavingRules] = useState(false);
  const [memberInput, setMemberInput] = useState('');
  const [openNotice, setOpenNotice] = useState(null);   // { post, replies, authors }
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [thanking, setThanking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [recentFilter, setRecentFilter] = useState('all');
  const [recentAll, setRecentAll] = useState(false);
  const [publicAll, setPublicAll] = useState(false);
  const [catFilter, setCatFilter] = useState('');

  const boardById = useCallback((id) => boards.find(b => bid(b) === id), [boards]);
  const { followed, others, isMine, isSubscribed } = followedOf(boards, subs, session);

  /** @param {string} id @param {{ cursor?: string, keep?: boolean }} [opts] */
  const loadPage = useCallback(async (id, opts = {}) => {
    const { cursor, keep } = opts;
    setPageLoading(id);
    try {
      const page = await boardsService.listPostsPage(id, { cursor, limit: PAGE });
      setPages(prev => ({ ...prev, [id]: keep && prev[id] ? { posts: [...prev[id].posts, ...page.posts], cursor: page.cursor, authors: { ...prev[id].authors, ...page.authors } } : page }));
    } catch (err) { swallowed('boards-tab: page', err); setPages(prev => ({ ...prev, [id]: prev[id] || { posts: [], authors: {}, cursor: undefined } })); }
    finally { setPageLoading(null); }
  }, []);

  const loadAll = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const [list, mine] = await Promise.all([
        boardsService.listAllBoards(),
        // An unreadable subscriptions list still leaves the boards readable; the failure is logged, not hidden.
        boardsService.listSubscriptions().catch(err => { swallowed('boards-tab: subscriptions', err); return []; }),
      ]);
      setBoards(list);
      setSubs(mine);
      const f = followedOf(list, mine, session).followed.slice(0, 12);
      await Promise.all(f.map(b => loadPage(bid(b))));
    } catch (err) { swallowed('boards-tab', err); }
    finally { setLoading(false); }
  }, [session, loadPage]);

  useEffect(() => { if (session) loadAll(); }, [session, loadAll]);
  const loadRef = useRef(loadAll);
  loadRef.current = loadAll;
  useEffect(() => onLiveUpdate(['boards'], () => loadRef.current({ showSpinner: false })), []);

  const loadNotice = useCallback(async (boardId, postId) => {
    try {
      const [post, thread] = await Promise.all([boardsService.getPost(boardId, postId), boardsService.listReplies(boardId, postId)]);
      setOpenNotice({ post, replies: thread.replies, authors: thread.authors });
    } catch (err) { swallowed('boards-tab: notice', err); showToast(t('profile.boards.postsError'), true); setView({ kind: 'board', id: boardId }); }
  }, [showToast]);

  const pickView = useCallback((v) => {
    setView(v);
    setFolds(f => ({ ...f, rules: false, tools: false }));
    setCatFilter('');
    const box = document.querySelector('.page-content') || document.querySelector('.pf-content');
    if (box) box.scrollTo({ top: 0 });
    if (v.kind === 'board') { const b = boardById(v.id); setRules(rulesFormOf(b)); setNotice(EMPTY_NOTICE); loadPage(v.id); }
    if (v.kind === 'notice') { setOpenNotice(null); setReplyText(''); loadNotice(v.boardId, v.postId); }
  }, [boardById, loadPage, loadNotice]);

  const setFold = (k, open) => setFolds(f => ({ ...f, [k]: open }));
  const fail = (e, fallback) => showToast(e?.error?.message || e?.message || fallback || t('profile.error'), true);
  const copy = async (text, done) => { try { await copyToClipboard(text); showToast(done); } catch (e) { fail(e); } };

  /** The slab on the cover: open the freshest followed board at its composer, or the own-board fold. */
  function startNotice() {
    const target = followed.slice().sort((a, z) => new Date(pages[bid(z)]?.posts[0]?.created_at || 0).getTime() - new Date(pages[bid(a)]?.posts[0]?.created_at || 0).getTime())[0];
    if (target) { pickView({ kind: 'board', id: bid(target) }); setTimeout(() => document.getElementById('bp-n-title')?.focus(), 250); }
    else { setFold('own', true); setTimeout(() => document.getElementById('bp-f-name')?.focus(), 100); }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const resp = await boardsService.createBoard(form.name.trim(), form.description.trim() || undefined, form.visibility, { rules: rulesOf(form) });
      if (resp.ok === false) { fail(resp, t('profile.boards.createFailed')); return; }
      const id = resp.data?.id;
      showToast(c('created'));
      setForm(EMPTY_FORM);
      setFold('own', false);
      await loadAll({ showSpinner: false });
      if (id) pickView({ kind: 'board', id });
    } catch (e) { fail(e, t('profile.boards.createFailed')); }
    finally { setCreating(false); }
  }
  async function handleFollow(id) {
    try { const r = await boardsService.subscribe(id); if (r.ok === false) throw r; showToast(t('profile.boards.subscribed')); await loadAll({ showSpinner: false }); }
    catch (e) { fail(e, t('profile.boards.subscribeFailed')); }
  }
  async function handleUnfollow(id) {
    try { const r = await boardsService.unsubscribe(id); if (r.ok === false) throw r; showToast(c('unfollowed')); await loadAll({ showSpinner: false }); }
    catch (e) { fail(e); }
  }
  async function handlePost(boardId) {
    setPosting(true);
    try {
      const b = boardById(boardId);
      const body = { title: notice.title.trim(), body: notice.body.trim() };
      if (notice.category.trim()) body.category = notice.category.trim();
      body.ttl_hours = Number(notice.ttl || b?.rules?.default_ttl_hours || 168);
      const r = await boardsService.createNotice(boardId, body);
      if (r.ok === false) throw r;
      showToast(c('posted'));
      setNotice(EMPTY_NOTICE);
      await loadPage(boardId);
    } catch (e) { fail(e); }
    finally { setPosting(false); }
  }
  async function handleThank(boardId, postId) {
    setThanking(true);
    try { const r = await boardsService.reactToPost(boardId, postId, 'thanks'); if (r.ok === false) throw r; await loadNotice(boardId, postId); loadPage(boardId); }
    catch (e) { fail(e); }
    finally { setThanking(false); }
  }
  async function handleReply(boardId, postId) {
    setReplying(true);
    try { const r = await boardsService.replyToPost(boardId, postId, replyText.trim()); if (r.ok === false) throw r; setReplyText(''); await loadNotice(boardId, postId); loadPage(boardId); }
    catch (e) { fail(e); }
    finally { setReplying(false); }
  }
  async function handleResolve(boardId, postId) {
    setUpdating(true);
    try { const r = await boardsService.updatePost(boardId, postId, { resolved: true }); if (r.ok === false) throw r; showToast(c('resolved')); await loadPage(boardId); pickView({ kind: 'board', id: boardId }); }
    catch (e) { fail(e); }
    finally { setUpdating(false); }
  }
  async function handleExtend(boardId, postId, hours) {
    setUpdating(true);
    try { const r = await boardsService.updatePost(boardId, postId, { ttl_hours: hours }); if (r.ok === false) throw r; showToast(c('extended')); await loadNotice(boardId, postId); loadPage(boardId); }
    catch (e) { fail(e); }
    finally { setUpdating(false); }
  }
  function handleDeletePost(boardId, postId) {
    confirm(t('profile.boards.confirmDelete'), async () => {
      try { const r = await boardsService.deletePost(boardId, postId); if (r.ok === false) throw r; showToast(t('profile.boards.postDeleted')); await loadPage(boardId); pickView({ kind: 'board', id: boardId }); }
      catch (e) { fail(e); }
    }, { danger: true });
  }
  function handleReport(postId) {
    confirm(c('reportConfirm'), async () => {
      try { const r = await boardsService.reportPost(postId); if (r.ok === false) throw r; showToast(c('reported')); }
      catch (e) { fail(e); }
    });
  }
  async function handleSaveRules(boardId) {
    setSavingRules(true);
    try {
      const b = boardById(boardId);
      if (b && (rules.visibility !== b.visibility || (rules.federate === 'yes') !== !!b.federate)) {
        const r = await boardsService.updateBoardVisibility(boardId, rules.visibility !== b.visibility ? rules.visibility : undefined, rules.visibility === 'public' ? rules.federate === 'yes' : undefined);
        if (r.ok === false) throw r;
      }
      const r2 = await boardsService.setRules(boardId, rulesOf(rules));
      if (r2.ok === false) throw r2;
      showToast(c('rulesSaved'));
      await loadAll({ showSpinner: false });
    } catch (e) { fail(e); }
    finally { setSavingRules(false); }
  }
  async function handleAddMember(boardId) {
    const g = memberInput.trim();
    if (!g) return;
    try { const r = await boardsService.updateBoardMembers(boardId, { add: [g] }); if (r.ok === false) throw r; setMemberInput(''); showToast(t('profile.boards.memberAdded')); await loadAll({ showSpinner: false }); }
    catch (e) { fail(e, t('profile.boards.memberError')); }
  }
  async function handleRemoveMember(boardId, g) {
    try { const r = await boardsService.updateBoardMembers(boardId, { remove: [g] }); if (r.ok === false) throw r; showToast(t('profile.boards.memberRemoved')); await loadAll({ showSpinner: false }); }
    catch (e) { fail(e, t('profile.boards.memberError')); }
  }
  function handleDeleteBoard(boardId) {
    confirm(c('deleteBoardConfirm'), async () => {
      try { const r = await boardsService.deleteBoard(boardId); if (r.ok === false) throw r; showToast(t('profile.boards.boardDeleted')); setView({ kind: 'cover' }); await loadAll({ showSpinner: false }); }
      catch (e) { fail(e); }
    }, { danger: true });
  }
  async function loadMore(id) { await loadPage(id, { cursor: pages[id]?.cursor, keep: true }); }

  const agentPrompt = () => [
    'You are connected to my AIMEAT over MCP. Boards are the notice boards people and agents publish to together.',
    '1. aimeat_board_list shows the boards you can see; aimeat_catalogue_boards the public ones on this node.',
    '2. aimeat_board_read reads a board\'s notices newest first, with each author, category and expiry.',
    '3. aimeat_board_post publishes a notice on my behalf (title, body, category); a public board costs my morsels, so say the price before posting.',
    '4. aimeat_board_reply answers a notice in its thread; aimeat_board_react with "thanks" thanks a poster.',
    '5. aimeat_board_subscribe with a callback_url and category filters makes the node push matching new notices to you, so watch one topic for me without polling.',
    'Show me the draft of any notice before you publish it.',
  ].join('\n');

  const ctx = {
    session, boards, subs, pages, pageLoading, loading, view, pickView, boardById, followed, others, isMine, isSubscribed,
    folds, setFold, form, setForm, creating, notice, setNotice, posting, rules, setRules, savingRules, memberInput, setMemberInput,
    openNotice, replyText, setReplyText, replying, thanking, updating, onlyNew, setOnlyNew, recentFilter, setRecentFilter, recentAll, setRecentAll, publicAll, setPublicAll, catFilter, setCatFilter,
    startNotice, handleCreate, handleFollow, handleUnfollow, handlePost, handleThank, handleReply, handleResolve, handleExtend, handleDeletePost, handleReport,
    handleSaveRules, handleAddMember, handleRemoveMember, handleDeleteBoard, loadMore, copy, agentPrompt, ConfirmUI,
  };
  return renderBoardsView(ctx);
}
