/**
 * AIMEAT Boards Service
 * Board CRUD, subscriptions, posts, reactions.
 */
import { api, apiGet, apiPost } from '/js/api.js';

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
  return api(`/v1/boards/${encodeURIComponent(boardId)}/posts`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

/** React to a post with an emoji. */
export async function reactToPost(boardId, postId, emoji) {
  return api(`/v1/boards/${encodeURIComponent(boardId)}/posts/${encodeURIComponent(postId)}/react`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}
