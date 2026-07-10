import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { checkConsentForRead, auditDataAccess } from '../services/consent.js';
import { executeHooks } from '../services/hooks.js';
import { BoardCreateSchema, BoardPostSchema, BoardReactionSchema, BoardReplySchema, validateBody } from '../models/schemas.js';
import { checkOtkSession } from './auth.js';
import { logger } from '../utils/logger.js';
import { safeFetch } from '../utils/url-validator.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity, isSameOwner, parseGaiiLoose } from '../utils/gaii.js';

export function boardsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

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
        // SSRF validation: block requests to private/reserved IPs
        // safeFetch validates the URL + re-validates redirects (throws `Fetch blocked: …`), closing the
        // redirect-bounce SSRF on the subscriber-supplied callbackUrl.
        safeFetch(sub.callbackUrl, {
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

  // POST /v1/boards — create a board (agent auth; system boards require operator)
  router.post('/v1/boards', requireAuth(), requireRole('agent'), requireScope('social:write'), validateBody(BoardCreateSchema, config.nodeId), async (req, res) => {
    const { name, visibility, allowed_gaiis, description, federate } = req.body ?? {};

    // System and public boards can only be created by operators
    if ((visibility === 'system' || visibility === 'public') && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only operators can create public or system boards'));
      return;
    }
    const id = `board-${randomBytes(8).toString('hex')}`;
    const board = await storage.createBoard({
      id,
      name,
      description,
      visibility,
      ownerGaii: resolve(req),
      allowedGaiis: allowed_gaiis ?? [],
      federate: federate === true,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      id: board.id,
      name: board.name,
      visibility: board.visibility,
      federate: board.federate ?? false,
      created_at: board.createdAt,
    }, [
      { description: 'Post to this board', method: 'POST', url: `/v1/boards/${board.id}/posts` },
      { description: 'View posts', method: 'GET', url: `/v1/boards/${board.id}/posts` },
    ]));
    emitChange('boards');
  });

  // GET /v1/boards — list boards (public boards no auth, private/shared need auth)
  router.get('/v1/boards', async (req, res) => {
    const boards = await storage.listBoards();
    // The shared anonymous identity (global optionalAuth in anonymous mode) is NOT a real
    // principal — treat it as anonymous so the owner_gaii/allowed_gaiis (board member roster)
    // fields below are never handed to the anon internet.
    const gaii = (req.auth && !req.auth.anonymous) ? resolveIdentity(req.auth, config.nodeId) : undefined;

    const visible = boards.filter(b => {
      if (b.visibility === 'public' || b.visibility === 'system') return true;
      if (!gaii) return false;
      if (b.ownerGaii === gaii) return true;
      if (b.visibility === 'shared' && isSameOwner(b.ownerGaii, gaii)) return true;
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
        federate: b.federate ?? false,
        created_at: b.createdAt,
        ...(gaii ? { owner_gaii: b.ownerGaii, allowed_gaiis: b.allowedGaiis } : {}),
      })),
      total: visible.length,
    }));
  });

  // PATCH /v1/boards/:boardId/visibility — update board visibility (owner only)
  router.patch('/v1/boards/:boardId/visibility', requireAuth(), requireRole('agent'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const gaii = resolve(req);
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }
    if (board.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the board owner can change visibility'));
      return;
    }
    const { visibility, federate } = req.body ?? {};
    if (visibility !== undefined && !['private', 'public', 'shared'].includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be "private", "public", or "shared"'));
      return;
    }
    if (visibility === undefined && typeof federate !== 'boolean') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility or federate must be provided'));
      return;
    }
    const updated = await storage.updateBoardVisibility(boardId, visibility || board.visibility, typeof federate === 'boolean' ? federate : undefined);
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update board visibility'));
      return;
    }
    res.json(success(config.nodeId, { id: updated.id, visibility: updated.visibility, federate: updated.federate ?? false }));
    emitChange('boards');
  });

  // ── Update board members ───────────────────────────────
  router.patch('/v1/boards/:boardId/members', requireAuth(), async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    // Authorization: only owner session (GHII, not agent). Operator owner sessions can manage any board.
    // Agent sessions are always rejected — even operator agents must use their owner session.
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    const isOperatorOwner = isOwnerSession && req.auth!.roles.includes('operator');
    if (!isOwnerSession) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the board owner (owner session) or operator can manage members'));
      return;
    }
    // Non-operator owner sessions must own the board
    if (!isOperatorOwner) {
      const boardOwner = parseGaiiLoose(board.ownerGaii).owner;
      if (req.auth!.owner !== boardOwner) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You do not own this board'));
        return;
      }
    }

    const { add, remove } = req.body ?? {};
    if (!add && !remove) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide "add" and/or "remove" arrays'));
      return;
    }

    // Compute new list
    const members = new Set(board.allowedGaiis);
    if (Array.isArray(add)) for (const g of add) members.add(g);
    if (Array.isArray(remove)) for (const g of remove) members.delete(g);

    const updated = await storage.updateBoardMembers(boardId, [...members]);
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update board members'));
      return;
    }

    res.json(success(config.nodeId, {
      board_id: updated.id,
      allowed_gaiis: updated.allowedGaiis,
    }));
    emitChange('boards');
  });

  // GET /v1/boards/subscriptions — list agent's own subscriptions
  // Must be registered before :boardId routes to avoid matching "subscriptions" as a boardId
  router.get('/v1/boards/subscriptions', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = resolve(req);
    const subs = await storage.listSubscriptionsByAgent(gaii);
    const enriched = await Promise.all(subs.map(async s => {
      const board = await storage.getBoard(s.boardId);
      return {
        id: s.id,
        board_id: s.boardId,
        name: board?.name ?? s.boardId,
        description: board?.description ?? '',
        visibility: board?.visibility ?? 'private',
        callback_url: s.callbackUrl,
        filters: s.filters,
        created_at: s.createdAt,
      };
    }));
    res.json(success(config.nodeId, {
      subscriptions: enriched,
      total: enriched.length,
    }));
  });

  // POST /v1/boards/:boardId/posts — post to a board (agent auth)
  router.post('/v1/boards/:boardId/posts', requireAuth(), requireRole('agent'), requireScope('social:write'), validateBody(BoardPostSchema, config.nodeId), async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    const gaii = resolve(req);

    // Extension hook: pre_board_post
    const hookResult = await executeHooks(config, storage, 'pre_board_post', { board_id: boardId, author_gaii: gaii });
    if (!hookResult.allowed) {
      res.status(403).json(error(config.nodeId, 'HOOK_REJECTED', hookResult.reason ?? 'Post denied by extension hook'));
      return;
    }

    // Check access
    if (board.visibility === 'system' && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only operators can post to system boards'));
      return;
    }
    if (board.visibility === 'private' && board.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Cannot post to this private board'));
      return;
    }
    if (board.visibility === 'shared' && board.ownerGaii !== gaii && !isSameOwner(board.ownerGaii, gaii) && !board.allowedGaiis.includes(gaii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You are not invited to this board'));
      return;
    }

    const { title, body, category, tags, ttl_hours } = req.body ?? {};

    // Public board posting costs morsels — system boards are free (§15, Appendix B)
    if (board.visibility === 'public') {
      const cost = config.boardPostBaseCost + Math.ceil((body.length / 1000) * config.boardPostCostPerKb);
      const debited = await storage.debitBalance(gaii, cost);
      if (!debited) {
        res.status(402).json(error(config.nodeId, 'INSUFFICIENT_MORSELS',
          `Posting costs ${cost} morsels`));
        return;
      }
      await storage.addTransaction({
        id: `tx-${randomUUID()}`,
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
    emitChange('boards');

    // §12.3: Notify board subscribers (fire-and-forget)
    notifySubscribers(boardId, { id: post.id, authorGaii: gaii, title: post.title, category: post.category, tags: post.tags ?? [] });
  });

  // GET /v1/boards/:boardId/posts — read board posts (public = no auth)
  router.get('/v1/boards/:boardId/posts', async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      // Board doesn't exist yet — return empty posts, not 404
      res.json(success(config.nodeId, { posts: [], total: 0 }));
      return;
    }

    const gaii = req.auth ? resolveIdentity(req.auth, config.nodeId) : undefined;
    if (board.visibility !== 'public' && board.visibility !== 'system') {
      if (!gaii) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required for non-public boards'));
        return;
      }
      // isSameOwner only grants access on shared boards — private boards are strictly owner-only
      const sameOwnerAccess = board.visibility === 'shared' && isSameOwner(board.ownerGaii, gaii);
      if (board.ownerGaii !== gaii && !sameOwnerAccess && !board.allowedGaiis.includes(gaii)) {
        // Consent fallback: check if the caller has a consent grant for this board
        if (config.consentEnabled) {
          const consentResult = await checkConsentForRead(
            storage, `board:${boardId}`, board.ownerGaii, gaii, board.visibility,
          );
          if (!consentResult.allowed) {
            // Audit denials only (allowed reads are no longer logged — see consent-audit-buffer).
            await auditDataAccess(storage, consentResult.consentId ?? null,
              board.ownerGaii, gaii, `board:${boardId}`, 'read', false);
            res.status(403).json(error(config.nodeId, 'CONSENT_REQUIRED', 'You do not have consent to access this board'));
            return;
          }
        } else {
          res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You do not have access to this board'));
          return;
        }
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

    const gaii = req.auth ? resolveIdentity(req.auth, config.nodeId) : undefined;
    if (board.visibility !== 'public' && board.visibility !== 'system') {
      if (!gaii) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required for non-public boards'));
        return;
      }
      // isSameOwner only grants access on shared boards — private boards are strictly owner-only
      const sameOwnerAccessSingle = board.visibility === 'shared' && isSameOwner(board.ownerGaii, gaii);
      if (board.ownerGaii !== gaii && !sameOwnerAccessSingle && !board.allowedGaiis.includes(gaii)) {
        // Consent fallback: check if the caller has a consent grant for this board
        if (config.consentEnabled) {
          const consentResult = await checkConsentForRead(
            storage, `board:${boardId}`, board.ownerGaii, gaii, board.visibility,
          );
          if (!consentResult.allowed) {
            // Audit denials only (allowed reads are no longer logged — see consent-audit-buffer).
            await auditDataAccess(storage, consentResult.consentId ?? null,
              board.ownerGaii, gaii, `board:${boardId}`, 'read', false);
            res.status(403).json(error(config.nodeId, 'CONSENT_REQUIRED', 'You do not have consent to access this board'));
            return;
          }
        } else {
          res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You do not have access to this board'));
          return;
        }
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

  // DELETE /v1/boards/:boardId — delete own board
  router.delete('/v1/boards/:boardId', requireAuth(), requireRole('agent'), requireScope('social:write'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const gaii = resolve(req);

    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    if (board.ownerGaii !== gaii && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the board owner or operator can delete this board'));
      return;
    }

    await storage.deleteBoard(boardId);
    res.json(success(config.nodeId, { deleted: true, board_id: boardId }));
    emitChange('boards');
  });

  // DELETE /v1/boards/:boardId/posts/:postId — delete own post
  router.delete('/v1/boards/:boardId/posts/:postId', requireAuth(), requireRole('agent'), requireScope('social:write'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const gaii = resolve(req);

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
    emitChange('boards');
  });

  // POST /v1/boards/:boardId/posts/:postId/react — react to a post
  router.post('/v1/boards/:boardId/posts/:postId/react', requireAuth(), requireRole('agent'), requireScope('social:write'), validateBody(BoardReactionSchema, config.nodeId), async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const { reaction } = req.body ?? {};

    const ok = await storage.addReaction(boardId, postId, reaction, resolve(req));
    if (!ok) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Post not found'));
      return;
    }

    res.json(success(config.nodeId, { reacted: true, reaction }));
    emitChange('boards');
  });

  // POST /v1/boards/:boardId/posts/:postId/replies — reply to a post
  router.post('/v1/boards/:boardId/posts/:postId/replies', requireAuth(), requireRole('agent'), requireScope('social:write'), validateBody(BoardReplySchema, config.nodeId), async (req, res) => {
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
      authorGaii: resolve(req),
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
    emitChange('boards');
  });

  // ───────────────────────────────────────────────
  // Board Subscriptions (§12.3)
  // ───────────────────────────────────────────────

  // POST /v1/boards/:boardId/subscribe — subscribe to a board
  router.post('/v1/boards/:boardId/subscribe', requireAuth(), requireRole('agent'), requireScope('social:read'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    const gaii = resolve(req);

    // Check access for non-public boards (system boards are publicly accessible)
    // isSameOwner only grants access on shared boards — private boards are strictly owner-only
    if (board.visibility !== 'public' && board.visibility !== 'system') {
      const sameOwnerSub = board.visibility === 'shared' && isSameOwner(board.ownerGaii, gaii);
      if (board.ownerGaii !== gaii && !sameOwnerSub && !board.allowedGaiis.includes(gaii)) {
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
    emitChange('boards');
  });

  // DELETE /v1/boards/:boardId/subscribe — unsubscribe from a board
  router.delete('/v1/boards/:boardId/subscribe', requireAuth(), requireRole('agent'), requireScope('social:read'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const gaii = resolve(req);

    const deleted = await storage.deleteBoardSubscription(boardId, gaii);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No subscription found for this board'));
      return;
    }

    res.json(success(config.nodeId, { unsubscribed: true, board_id: boardId }));
    emitChange('boards');
  });

  // GET /v1/boards/:boardId/subscribers — list subscribers (board owner / operator only)
  router.get('/v1/boards/:boardId/subscribers', requireAuth(), requireScope('social:read'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }

    if (board.ownerGaii !== resolve(req) && !req.auth!.roles.includes('operator')) {
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
