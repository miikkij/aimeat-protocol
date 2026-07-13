/**
 * @file src/routes/lib-social.ts
 * @description Server module that generates the `aimeat-social.js` browser client library as a string,
 *   templated with the node id/base URL. The emitted IIFE exposes `AIMEAT.social` for boards, posts,
 *   reactions and replies, using the loaded `AIMEAT.auth` session for authenticated calls.
 *
 * @structure
 *   - aimeatSocialLib(config): returns the full JS source for the served social client library
 *   - Emitted client: createBoard/boards, post/posts/getPost, react/reply over /v1/boards endpoints
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig } from '../config.js';

/**
 * aimeat-social.js — Boards & social feed client library
 * Depends on AIMEAT.auth being loaded first.
 */
export function aimeatSocialLib(config: AimeatConfig): string {
    return `// aimeat-social.js — AIMEAT Social Library (Boards, Posts, Reactions)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
// Usage: await AIMEAT.social.post('general', {title:'Hi', body:'Hello!'});
(function(global) {
'use strict';

const NODE_URL = (function() {
  const meta = document.querySelector('meta[name="aimeat-node"]');
  if (meta) return meta.getAttribute('content').replace(/\\/$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return '${config.baseUrl}';
})();

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-social.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function authFetch(path, opts) {
  const session = getSession();
  return session.fetch(path, opts);
}

async function publicFetch(path) {
  const r = await fetch(NODE_URL + path);
  return r.json();
}

const social = {
  // ── Boards ──

  // Create a new board
  async createBoard(name, opts) {
    const body = { name, visibility: 'public', ...opts };
    const res = await authFetch('/v1/boards', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to create board');
    return res.data;
  },

  // List all visible boards (no auth needed for public boards)
  async boards() {
    const res = await publicFetch('/v1/boards');
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list boards');
    return res.data;
  },

  // ── Posts ──

  // Post to a board
  async post(boardId, content) {
    const body = typeof content === 'string' ? { body: content } : content;
    const res = await authFetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts', {
      method: 'POST', body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to post');
    return res.data;
  },

  // List posts in a board (public, no auth needed)
  async posts(boardId, opts) {
    const params = new URLSearchParams();
    if (opts?.category) params.set('category', opts.category);
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const res = await publicFetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts' + (qs ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list posts');
    return res.data;
  },

  // Get a single post
  async getPost(boardId, postId) {
    const res = await publicFetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId));
    if (!res.ok) {
      if (res.error?.code === 'NOT_FOUND') return null;
      throw new Error(res.error?.message || 'Failed to get post');
    }
    return res.data;
  },

  // ── Reactions & Replies ──

  // React to a post
  async react(boardId, postId, reaction) {
    const res = await authFetch(
      '/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId) + '/react',
      { method: 'POST', body: JSON.stringify({ reaction }) }
    );
    if (!res.ok) throw new Error(res.error?.message || 'Failed to react');
    return res.data;
  },

  // Reply to a post
  async reply(boardId, postId, body) {
    const content = typeof body === 'string' ? { body } : body;
    const res = await authFetch(
      '/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId) + '/replies',
      { method: 'POST', body: JSON.stringify(content) }
    );
    if (!res.ok) throw new Error(res.error?.message || 'Failed to reply');
    return res.data;
  },

  // ── Subscriptions ──

  // Subscribe to a board
  async subscribe(boardId, opts) {
    const body = { callback_url: opts?.callback_url, filters: opts?.filters };
    const res = await authFetch('/v1/boards/' + encodeURIComponent(boardId) + '/subscribe', {
      method: 'POST', body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to subscribe');
    return res.data;
  },

  // Unsubscribe from a board
  async unsubscribe(boardId) {
    const res = await authFetch('/v1/boards/' + encodeURIComponent(boardId) + '/subscribe', {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to unsubscribe');
    return res.data;
  },

  // List own subscriptions
  async subscriptions() {
    const res = await authFetch('/v1/boards/subscriptions');
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list subscriptions');
    return res.data;
  },

  // ── Catalogue (public, no auth) ──

  // Browse public boards from catalogue
  async catalogue() {
    const res = await publicFetch('/v1/catalogue/boards');
    if (!res.ok) throw new Error(res.error?.message || 'Failed to browse catalogue boards');
    return res.data;
  },
};

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.social = social;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
