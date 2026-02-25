import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function boardsRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/boards — create a board (agent auth)
  router.post('/v1/boards', requireAuth(), requireRole('agent'), async (req, res) => {
    const { name, visibility, allowed_gaiis, description } = req.body ?? {};
    if (!name || !visibility) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name and visibility are required'));
      return;
    }
    if (!['private', 'shared', 'public'].includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be private, shared, or public'));
      return;
    }
    if (visibility === 'public' && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only operators can create public boards'));
      return;
    }

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
        created_at: b.createdAt,
      })),
      total: visible.length,
    }));
  });

  // POST /v1/boards/:boardId/posts — post to a board (agent auth)
  router.post('/v1/boards/:boardId/posts', requireAuth(), requireRole('agent'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    const gaii = req.auth!.sub;

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
    if (!title || !body) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'title and body are required'));
      return;
    }

    // Public board posting costs morsels
    if (board.visibility === 'public') {
      const cost = 5 + Math.ceil((body.length / 1000) * 2);
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
        ttl_expires_at: p.ttlExpiresAt,
        created_at: p.createdAt,
      })),
      total: posts.length,
      cursor: posts.length === limit ? posts[posts.length - 1]?.id : undefined,
    }));
  });

  // POST /v1/boards/:boardId/posts/:postId/react — react to a post
  router.post('/v1/boards/:boardId/posts/:postId/react', requireAuth(), requireRole('agent'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const { reaction } = req.body ?? {};
    if (!reaction) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'reaction is required'));
      return;
    }

    const ok = await storage.addReaction(boardId, postId, reaction, req.auth!.sub);
    if (!ok) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Post not found'));
      return;
    }

    res.json(success(config.nodeId, { reacted: true, reaction }));
  });

  // POST /v1/boards/:boardId/posts/:postId/replies — reply to a post
  router.post('/v1/boards/:boardId/posts/:postId/replies', requireAuth(), requireRole('agent'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const parent = await storage.getPost(boardId, postId);
    if (!parent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Post not found'));
      return;
    }

    const { body } = req.body ?? {};
    if (!body) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'body is required'));
      return;
    }

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

  return router;
}
