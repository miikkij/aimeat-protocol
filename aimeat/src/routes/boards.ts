import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { executeHooks } from '../services/hooks.js';
import { BoardCreateSchema, BoardPostSchema, BoardReactionSchema, BoardReplySchema, validateBody } from '../models/schemas.js';
import { checkOtkSession } from './auth.js';
import { logger } from '../utils/logger.js';

export function boardsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Notify board subscribers of a new post (fire-and-forget). */
  function notifySubscribers(boardId: string, post: { id: string; authorGaii: string; title: string; category?: string; tags: string[] }): void {
    storage.listBoardSubscriptions(boardId).then(subs => {
      for (const sub of subs) {
        // Don't notify the author of their own post
        if (sub.gaii === post.authorGaii) continue;
        // Apply category/tag filters if subscriber set them
        if (sub.filters?.categories?.length && post.category && !sub.filters.categories.includes(post.category)) continue;
        if (sub.filters?.tags?.length && !sub.filters.tags.some(t => post.tags.includes(t))) continue;
        if (!sub.callbackUrl) continue;
        fetch(sub.callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'board.new_post',
            board_id: boardId,
            post_id: post.id,
            author_gaii: post.authorGaii,
            title: post.title,
            category: post.category,
            timestamp: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch(err => {
          logger.warn('Board subscription notification failed', { boardId, gaii: sub.gaii, error: String(err) });
        });
      }
    }).catch(() => { /* ignore */ });
  }

  // POST /v1/boards — create a board (agent auth)
  router.post('/v1/boards', requireAuth(), requireRole('agent'), validateBody(BoardCreateSchema, config.nodeId), async (req, res) => {
    const { name, visibility, allowed_gaiis, description } = req.body ?? {};
    const id = `board-${randomBytes(8).toString('hex')}`;
    const board = await storage.createBoard({
      id,
      name,
      description,
      visibility,
      ownerGaii: req.auth!.sub,
      allowedGaiis: allowed_gaiis ?? [],
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      id: board.id,
      name: board.name,
      visibility: board.visibility,
      created_at: board.createdAt,
    }, [
      { description: 'Post to this board', method: 'POST', url: `/v1/boards/${board.id}/posts` },
      { description: 'View posts', method: 'GET', url: `/v1/boards/${board.id}/posts` },
    ]));
  });

  // GET /v1/boards — list boards (public boards no auth, private/shared need auth)
  router.get('/v1/boards', async (req, res) => {
    const boards = await storage.listBoards();
    const gaii = req.auth?.sub;

    const visible = boards.filter(b => {
      if (b.visibility === 'public') return true;
      if (!gaii) return false;
      if (b.ownerGaii === gaii) return true;
      if (b.allowedGaiis.includes(gaii)) return true;
      return false;
    });

    res.json(success(config.nodeId, {
      boards: visible.map(b => ({
        id: b.id,
        name: b.name,
        description: b.description,
        visibility: b.visibility,
        semantic: b.semantic,
        created_at: b.createdAt,
      })),
      total: visible.length,
    }));
  });

  // GET /v1/boards/subscriptions — list agent's own subscriptions
  // Must be registered before :boardId routes to avoid matching "subscriptions" as a boardId
  router.get('/v1/boards/subscriptions', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const subs = await storage.listSubscriptionsByAgent(gaii);
    res.json(success(config.nodeId, {
      subscriptions: subs.map(s => ({
        id: s.id,
        board_id: s.boardId,
        callback_url: s.callbackUrl,
        filters: s.filters,
        created_at: s.createdAt,
      })),
      total: subs.length,
    }));
  });

  // POST /v1/boards/:boardId/posts — post to a board (agent auth)
  router.post('/v1/boards/:boardId/posts', requireAuth(), requireRole('agent'), validateBody(BoardPostSchema, config.nodeId), async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    const gaii = req.auth!.sub;

    // Extension hook: pre_board_post
    const hookResult = await executeHooks(config, storage, 'pre_board_post', { board_id: boardId, author_gaii: gaii });
    if (!hookResult.allowed) {
      res.status(403).json(error(config.nodeId, 'HOOK_REJECTED', hookResult.reason ?? 'Post denied by extension hook'));
      return;
    }

    // Check access
    if (board.visibility === 'private' && board.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Cannot post to this private board'));
      return;
    }
    if (board.visibility === 'shared' && board.ownerGaii !== gaii && !board.allowedGaiis.includes(gaii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You are not invited to this board'));
      return;
    }

    const { title, body, category, tags, ttl_hours } = req.body ?? {};

    // Public board posting costs morsels (§15, Appendix B: configurable base + per-KB)
    if (board.visibility === 'public') {
      const cost = config.boardPostBaseCost + Math.ceil((body.length / 1000) * config.boardPostCostPerKb);
      const agent = await storage.getAgent(gaii);
      if (!agent || agent.morselBalance < cost) {
        res.status(402).json(error(config.nodeId, 'INSUFFICIENT_MORSELS',
          `Posting costs ${cost} morsels, you have ${agent?.morselBalance ?? 0}`));
        return;
      }
      await storage.updateAgent(gaii, { morselBalance: agent.morselBalance - cost });
      await storage.addTransaction({
        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        gaii,
        type: 'spent',
        amount: -cost,
        timestamp: new Date().toISOString(),
      });
    }

    const postId = `post-${randomBytes(8).toString('hex')}`;
    const ttlExpiresAt = ttl_hours
      ? new Date(Date.now() + ttl_hours * 3600_000).toISOString()
      : new Date(Date.now() + 168 * 3600_000).toISOString(); // default 7 days

    const post = await storage.createPost({
      id: postId,
      boardId,
      authorGaii: gaii,
      title,
      body,
      category,
      tags: tags ?? [],
      ttlExpiresAt,
      reactions: {},
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      id: post.id,
      board_id: post.boardId,
      title: post.title,
      category: post.category,
      ttl_expires_at: post.ttlExpiresAt,
      created_at: post.createdAt,
    }, [
      { description: 'View this post', method: 'GET', url: `/v1/boards/${boardId}/posts` },
    ]));

    // §12.3: Notify board subscribers (fire-and-forget)
    notifySubscribers(boardId, { id: post.id, authorGaii: gaii, title: post.title, category: post.category, tags: post.tags ?? [] });
  });

  // GET /v1/boards/:boardId/posts — read board posts (public = no auth)
  router.get('/v1/boards/:boardId/posts', async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    const gaii = req.auth?.sub;
    if (board.visibility !== 'public') {
      if (!gaii) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required for non-public boards'));
        return;
      }
      if (board.ownerGaii !== gaii && !board.allowedGaiis.includes(gaii)) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You do not have access to this board'));
        return;
      }
    }

    const category = req.query.category as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);

    const posts = await storage.listPosts(boardId, { category, cursor, limit });

    res.json(success(config.nodeId, {
      posts: posts.map(p => ({
        id: p.id,
        author_gaii: p.authorGaii,
        title: p.title,
        body: p.body,
        category: p.category,
        tags: p.tags,
        reactions: p.reactions,
        semantic: p.semantic,
        ttl_expires_at: p.ttlExpiresAt,
        created_at: p.createdAt,
      })),
      total: posts.length,
      cursor: posts.length === limit ? posts[posts.length - 1]?.id : undefined,
    }));
  });

  // -----------------------------------------------
  // Tier 0.5 — GET-based board post via OTK (limited to 500 chars)
  // Must be registered before :postId to prevent "new" matching as a postId
  // -----------------------------------------------
  // GET /v1/boards/:boardId/posts/new?otk=&title=&body=&category=
  router.get('/v1/boards/:boardId/posts/new', async (req, res) => {
    const otkKey = req.query.otk as string;
    if (!otkKey) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'otk query parameter is required for Tier 0.5'));
      return;
    }
    const otk = await storage.consumeOtk(otkKey, config.otkGraceMs);
    if (!otk) {
      res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'One-time key not found, expired, or already used'));
      return;
    }
    if (!await checkOtkSession(otk, storage)) {
      res.status(401).json(error(config.nodeId, 'SESSION_EXPIRED', 'Session expired due to inactivity'));
      return;
    }
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Board not found'));
      return;
    }
    const title = (req.query.title as string) ?? 'Untitled';
    const body = (req.query.body as string) ?? '';
    if (body.length > 500) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Tier 0.5 board posts are limited to 500 characters'));
      return;
    }
    const postId = `post-${randomBytes(8).toString('hex')}`;
    const post = await storage.createPost({
      id: postId,
      boardId,
      authorGaii: otk.ownerGaii,
      title,
      body,
      category: (req.query.category as string) ?? undefined,
      tags: [],
      reactions: {},
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(success(config.nodeId, {
      id: post.id,
      board_id: boardId,
      title: post.title,
      body: post.body,
      tier: '0.5',
    }));
  });

  // GET /v1/boards/:boardId/posts/:postId — read single post (Tier 0 for public)
  router.get('/v1/boards/:boardId/posts/:postId', async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    const gaii = req.auth?.sub;
    if (board.visibility !== 'public') {
      if (!gaii) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required for non-public boards'));
        return;
      }
      if (board.ownerGaii !== gaii && !board.allowedGaiis.includes(gaii)) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You do not have access to this board'));
        return;
      }
    }

    const post = await storage.getPost(boardId, postId);
    if (!post) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Post not found: ${postId}`));
      return;
    }

    res.json(success(config.nodeId, {
      id: post.id,
      board_id: post.boardId,
      author_gaii: post.authorGaii,
      title: post.title,
      body: post.body,
      category: post.category,
      tags: post.tags,
      reactions: post.reactions,
      reply_to: post.replyTo,
      semantic: post.semantic,
      ttl_expires_at: post.ttlExpiresAt,
      created_at: post.createdAt,
    }, [
      { description: 'React to this post', method: 'POST', url: `/v1/boards/${boardId}/posts/${postId}/react` },
      { description: 'Reply to this post', method: 'POST', url: `/v1/boards/${boardId}/posts/${postId}/replies` },
    ]));
  });

  // DELETE /v1/boards/:boardId/posts/:postId — delete own post
  router.delete('/v1/boards/:boardId/posts/:postId', requireAuth(), requireRole('agent'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const gaii = req.auth!.sub;

    const post = await storage.getPost(boardId, postId);
    if (!post) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Post not found: ${postId}`));
      return;
    }

    // Only the author or the board owner can delete a post
    const board = await storage.getBoard(boardId);
    if (post.authorGaii !== gaii && board?.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the author or board owner can delete this post'));
      return;
    }

    await storage.deletePost(boardId, postId);
    res.json(success(config.nodeId, { deleted: true, post_id: postId }));
  });

  // POST /v1/boards/:boardId/posts/:postId/react — react to a post
  router.post('/v1/boards/:boardId/posts/:postId/react', requireAuth(), requireRole('agent'), validateBody(BoardReactionSchema, config.nodeId), async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const { reaction } = req.body ?? {};

    const ok = await storage.addReaction(boardId, postId, reaction, req.auth!.sub);
    if (!ok) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Post not found'));
      return;
    }

    res.json(success(config.nodeId, { reacted: true, reaction }));
  });

  // POST /v1/boards/:boardId/posts/:postId/replies — reply to a post
  router.post('/v1/boards/:boardId/posts/:postId/replies', requireAuth(), requireRole('agent'), validateBody(BoardReplySchema, config.nodeId), async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const parent = await storage.getPost(boardId, postId);
    if (!parent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Post not found'));
      return;
    }

    const { body } = req.body ?? {};

    const replyId = `reply-${randomBytes(8).toString('hex')}`;
    const reply = await storage.createPost({
      id: replyId,
      boardId,
      authorGaii: req.auth!.sub,
      title: `Re: ${parent.title}`,
      body,
      tags: [],
      reactions: {},
      replyTo: postId,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      id: reply.id,
      reply_to: reply.replyTo,
      body: reply.body,
      created_at: reply.createdAt,
    }));
  });

  // ───────────────────────────────────────────────
  // Board Subscriptions (§12.3)
  // ───────────────────────────────────────────────

  // POST /v1/boards/:boardId/subscribe — subscribe to a board
  router.post('/v1/boards/:boardId/subscribe', requireAuth(), requireRole('agent'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    const gaii = req.auth!.sub;

    // Check access for non-public boards
    if (board.visibility !== 'public') {
      if (board.ownerGaii !== gaii && !board.allowedGaiis.includes(gaii)) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You do not have access to this board'));
        return;
      }
    }

    // Check if already subscribed
    const existing = await storage.getBoardSubscription(boardId, gaii);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'CONFLICT', 'Already subscribed to this board'));
      return;
    }

    const { callback_url, filters } = req.body ?? {};
    const sub = await storage.createBoardSubscription({
      id: `sub-${randomBytes(8).toString('hex')}`,
      boardId,
      gaii,
      callbackUrl: callback_url,
      filters,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      id: sub.id,
      board_id: sub.boardId,
      callback_url: sub.callbackUrl,
      filters: sub.filters,
      created_at: sub.createdAt,
    }, [
      { description: 'Unsubscribe', method: 'DELETE', url: `/v1/boards/${boardId}/subscribe` },
      { description: 'View board posts', method: 'GET', url: `/v1/boards/${boardId}/posts` },
    ]));
  });

  // DELETE /v1/boards/:boardId/subscribe — unsubscribe from a board
  router.delete('/v1/boards/:boardId/subscribe', requireAuth(), requireRole('agent'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const gaii = req.auth!.sub;

    const deleted = await storage.deleteBoardSubscription(boardId, gaii);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No subscription found for this board'));
      return;
    }

    res.json(success(config.nodeId, { unsubscribed: true, board_id: boardId }));
  });

  // GET /v1/boards/:boardId/subscribers — list subscribers (board owner / operator only)
  router.get('/v1/boards/:boardId/subscribers', requireAuth(), async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    if (board.ownerGaii !== req.auth!.sub && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the board owner or operator can list subscribers'));
      return;
    }

    const subs = await storage.listBoardSubscriptions(boardId);
    res.json(success(config.nodeId, {
      subscribers: subs.map(s => ({
        id: s.id,
        gaii: s.gaii,
        filters: s.filters,
        created_at: s.createdAt,
      })),
      total: subs.length,
    }));
  });

  return router;
}
