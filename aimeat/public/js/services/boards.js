/**
 * AIMEAT Boards Service
 * Board CRUD, subscriptions, posts, reactions.
 */
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';

/** List boards the user is subscribed to. Returns array. */
export async function listSubscriptions() {
  const data = await apiGet('/v1/boards/subscriptions');
  return data?.data?.subscriptions || data?.data?.boards || (Array.isArray(data?.data) ? data.data : []);
}

/** List all public boards. Returns array. */
export async function listAllBoards() {
  const data = await apiGet('/v1/boards');
  return data?.data?.boards || data?.data || [];
}

/** Create a new board. */
export async function createBoard(name, description, visibility) {
  return api('/v1/boards', {
    method: 'POST',
    body: JSON.stringify({ name, description, visibility: visibility || 'private' }),
  });
}

/** Delete a board (owner only). */
export async function deleteBoard(boardId) {
  return apiDelete(`/v1/boards/${encodeURIComponent(boardId)}`);
}

/** Update board visibility and/or federate flag. */
export async function updateBoardVisibility(boardId, visibility, federate) {
  const body = {};
  if (visibility !== undefined) body.visibility = visibility;
  if (federate !== undefined) body.federate = federate;
  return api(`/v1/boards/${encodeURIComponent(boardId)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Subscribe to a board. */
export async function subscribe(boardId) {
  return apiPost(`/v1/boards/${encodeURIComponent(boardId)}/subscribe`);
}

/** List posts in a board. Returns array. */
export async function listPosts(boardId) {
  const data = await apiGet(`/v1/boards/${encodeURIComponent(boardId)}/posts`);
  return data?.data?.posts || data?.data || [];
}

/** Create a post in a board. */
export async function createPost(boardId, content) {
  const title = content.trim().slice(0, 80) || 'Post';
  return api(`/v1/boards/${encodeURIComponent(boardId)}/posts`, {
    method: 'POST',
    body: JSON.stringify({ title, body: content }),
  });
}

/** Delete a post. */
export async function deletePost(boardId, postId) {
  return apiDelete(`/v1/boards/${encodeURIComponent(boardId)}/posts/${encodeURIComponent(postId)}`);
}

/** Update board members (add/remove GAIIs). */
export async function updateBoardMembers(boardId, { add, remove }) {
  return api(`/v1/boards/${encodeURIComponent(boardId)}/members`, {
    method: 'PATCH',
    body: JSON.stringify({ add, remove }),
  });
}

/** React to a post with an emoji. */
export async function reactToPost(boardId, postId, emoji) {
  return api(`/v1/boards/${encodeURIComponent(boardId)}/posts/${encodeURIComponent(postId)}/react`, {
    method: 'POST',
    body: JSON.stringify({ reaction: emoji }),
  });
}
