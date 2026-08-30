/**
 * @file public/js/services/boards.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend service layer for the Boards API — thin wrappers over /v1/boards*
 *   for board CRUD, membership/subscriptions, posts, replies, reactions, the board's own rules and
 *   what happens to a notice after publishing.
 *
 * @structure
 *   - listSubscriptions / listAllBoards: read subscribed and visible boards
 *   - createBoard / deleteBoard / updateBoardVisibility / updateBoardMembers / setRules: board management
 *   - subscribe / unsubscribe: following
 *   - listPosts / listPostsPage / getPost / listReplies: reading
 *   - createPost / createNotice / replyToPost / reactToPost / updatePost / deletePost / reportPost: participation
 *
 * @version-history
 *   v1.1.0 — 2026-08-30 — Boards are Core again (RFC §27): listPostsPage (cursor, authors, reply
 *     counts), getPost, listReplies, replyToPost, createNotice (title, category, lifetime), updatePost
 *     (resolve or extend), setRules, unsubscribe, reportPost; createBoard takes the board's rules.
 *     The old signatures stay for organisms/panels.js.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';

const enc = encodeURIComponent;

/** List boards the user is subscribed to. Returns array. */
export async function listSubscriptions() {
  const data = await apiGet('/v1/boards/subscriptions');
  return data?.data?.subscriptions || data?.data?.boards || (Array.isArray(data?.data) ? data.data : []);
}

/** List every board this session can see (public ones plus the shared and private ones it is on). Returns array. */
export async function listAllBoards() {
  const data = await apiGet('/v1/boards');
  return data?.data?.boards || data?.data || [];
}

/** Create a board. `opts` may carry description, visibility, federate and the board's own rules. */
export async function createBoard(name, description, visibility, opts = {}) {
  return api('/v1/boards', {
    method: 'POST',
    body: JSON.stringify({ name, description, visibility: visibility || 'private', ...opts }),
  });
}

/** Delete a board (owner only). */
export async function deleteBoard(boardId) {
  return apiDelete(`/v1/boards/${enc(boardId)}`);
}

/** Update board visibility and/or federate flag. */
export async function updateBoardVisibility(boardId, visibility, federate) {
  const body = {};
  if (visibility !== undefined) body.visibility = visibility;
  if (federate !== undefined) body.federate = federate;
  return api(`/v1/boards/${enc(boardId)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** The board's own rules: { posting, categories, default_ttl_hours, post_cost }; null resets them. */
export async function setRules(boardId, rules) {
  return api(`/v1/boards/${enc(boardId)}/rules`, {
    method: 'PATCH',
    body: JSON.stringify({ rules }),
  });
}

/** Subscribe to a board. */
export async function subscribe(boardId) {
  return apiPost(`/v1/boards/${enc(boardId)}/subscribe`);
}

/** Stop following a board. */
export async function unsubscribe(boardId) {
  return apiDelete(`/v1/boards/${enc(boardId)}/subscribe`);
}

/** List posts in a board. Returns array. */
export async function listPosts(boardId) {
  const data = await apiGet(`/v1/boards/${enc(boardId)}/posts`);
  return data?.data?.posts || data?.data || [];
}

/**
 * One page of a board's notices: { posts, cursor, authors }.
 * @param {string} boardId
 * @param {{ category?: string, cursor?: string, limit?: number }} [opts]
 */
export async function listPostsPage(boardId, opts = {}) {
  const { category, cursor, limit } = opts;
  const q = new URLSearchParams();
  if (category) q.set('category', category);
  if (cursor) q.set('cursor', cursor);
  if (limit) q.set('limit', String(limit));
  const qs = q.toString();
  const data = await apiGet(`/v1/boards/${enc(boardId)}/posts${qs ? '?' + qs : ''}`);
  return { posts: data?.data?.posts || [], cursor: data?.data?.cursor, authors: data?.data?.authors || {} };
}

/** One notice, with its author's standing. */
export async function getPost(boardId, postId) {
  const data = await apiGet(`/v1/boards/${enc(boardId)}/posts/${enc(postId)}`);
  return data?.data || null;
}

/** The replies under a notice: { replies, authors }. */
export async function listReplies(boardId, postId) {
  const data = await apiGet(`/v1/boards/${enc(boardId)}/posts/${enc(postId)}/replies`);
  return { replies: data?.data?.replies || [], authors: data?.data?.authors || {} };
}

/** Create a post in a board from one text (the organism panel's shape). */
export async function createPost(boardId, content) {
  const title = content.trim().slice(0, 80) || 'Post';
  return api(`/v1/boards/${enc(boardId)}/posts`, {
    method: 'POST',
    body: JSON.stringify({ title, body: content }),
  });
}

/** Publish a notice: { title, body, category?, tags?, ttl_hours? }. */
export async function createNotice(boardId, notice) {
  return api(`/v1/boards/${enc(boardId)}/posts`, {
    method: 'POST',
    body: JSON.stringify(notice),
  });
}

/** Reply under a notice. */
export async function replyToPost(boardId, postId, body) {
  return api(`/v1/boards/${enc(boardId)}/posts/${enc(postId)}/replies`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

/** Take a notice down as handled ({ resolved: true }) or move its expiry ({ ttl_hours }). */
export async function updatePost(boardId, postId, changes) {
  return api(`/v1/boards/${enc(boardId)}/posts/${enc(postId)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

/** Delete a post. */
export async function deletePost(boardId, postId) {
  return apiDelete(`/v1/boards/${enc(boardId)}/posts/${enc(postId)}`);
}

/** Update board members (add/remove GAIIs). */
export async function updateBoardMembers(boardId, { add, remove } = /** @type {{ add?: any, remove?: any }} */ ({})) {
  return api(`/v1/boards/${enc(boardId)}/members`, {
    method: 'PATCH',
    body: JSON.stringify({ add, remove }),
  });
}

/** React to a post; 'thanks' is the reaction a poster's standing counts. */
export async function reactToPost(boardId, postId, reaction) {
  return api(`/v1/boards/${enc(boardId)}/posts/${enc(postId)}/react`, {
    method: 'POST',
    body: JSON.stringify({ reaction }),
  });
}

/** Report a notice; enough reports hide it. */
export async function reportPost(postId, reason = 'inappropriate') {
  return api('/v1/flags', {
    method: 'POST',
    body: JSON.stringify({ targetType: 'board_post', targetId: postId, reason }),
  });
}
