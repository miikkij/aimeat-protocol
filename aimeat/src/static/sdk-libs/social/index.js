/**
 * @file social/index.js
 * @description The aimeat-social library (SDK-libs migration Phase 2). Exposes AIMEAT.social — the
 *   boards & social feed client: createBoard/boards, post/posts/getPost, react/reply, subscribe/
 *   unsubscribe/subscriptions, and the public catalogue. Authenticated calls go through the
 *   AIMEAT.auth session; public reads go direct to NODE_URL. Componentized ESM source esbuild
 *   bundles to the IIFE served, unchanged, at /v1/libs/aimeat-social.js. Ported verbatim from
 *   lib-social.ts; NODE_URL now comes from _core/config.
 * @structure imports NODE_URL (config) + authFetch (session) + attach (namespace); publicFetch();
 *   the `social` object; attach('social', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-social.js"></script>
 *   await AIMEAT.social.post('general', { title: 'Hi', body: 'Hello!' });
 * @version-history
 *   v1.1.0 — 2026-08-30 — Boards are Core again (RFC §27): updatePost (resolve a notice or move its
 *     expiry), setRules (the board's own rules), and signedIn() so a page can offer a visitor a
 *     sign-in door instead of letting a write throw.
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-social.ts (SDK-libs migration Phase 2).
 */
import { NODE_URL } from '../_core/config.js';
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-social.js');
import { attach } from '../_core/namespace.js';

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
      { method: 'POST', body: JSON.stringify({ reaction }) },
    );
    if (!res.ok) throw new Error(res.error?.message || 'Failed to react');
    return res.data;
  },

  // Reply to a post
  async reply(boardId, postId, body) {
    const content = typeof body === 'string' ? { body } : body;
    const res = await authFetch(
      '/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId) + '/replies',
      { method: 'POST', body: JSON.stringify(content) },
    );
    if (!res.ok) throw new Error(res.error?.message || 'Failed to reply');
    return res.data;
  },

  // Take a notice down as handled (resolved: true) or move its expiry (ttl_hours). Author or board keeper.
  async updatePost(boardId, postId, changes) {
    const res = await authFetch(
      '/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId),
      { method: 'PATCH', body: JSON.stringify(changes) },
    );
    if (!res.ok) throw new Error(res.error?.message || 'Failed to update post');
    return res.data;
  },

  // ── Rules (board keeper only) ──

  // Set the board's own rules: { posting, categories, default_ttl_hours, post_cost }. null resets them.
  async setRules(boardId, rules) {
    const res = await authFetch('/v1/boards/' + encodeURIComponent(boardId) + '/rules', {
      method: 'PATCH', body: JSON.stringify({ rules }),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to set board rules');
    return res.data;
  },

  // True when a session is signed in, so a page can show the visitor a sign-in door instead of
  // letting post()/react()/reply() throw.
  signedIn() {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    return !!(auth && auth.getSession && auth.getSession());
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
attach('social', social);
