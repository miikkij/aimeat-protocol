/**
 * @file src/routes/boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Public message-board API — create boards, post/reply/react, subscribe, and read with
 *   consent + moderation enforcement. New posts fan out to subscriber callback URLs via SSRF-safe
 *   fetch, and system/public boards are operator-gated.
 *
 * @structure
 *   - boardsRouter(config, storage): mounts the /v1/boards/* routes
 *   - notifyBoardSubscribers(storage, ): fire-and-forget webhook fan-out with category/tag filters via safeFetch
 *   - POST /v1/boards + posts/reactions/replies/subscribe: create + interact (scope/role gated)
 *   - resolve(): identity resolution via resolveIdentity for owner-scoped writes
 *
 * @version-history
 *   v1.5.0 — 2026-08-30 — The board's own rules: PATCH /v1/boards/:id/rules (keeper), rules on the
 *     board in every listing; PATCH /v1/boards/:id/posts/:postId takes a notice down as handled or
 *     moves its expiry; each posts listing carries `authors` (notices, thanks, since) and a single
 *     post its `author`, so a reader can see whom to trust; GET /posts/:postId/replies lists the
 *     replies under a notice (listPosts leaves them out, and nothing listed them), and each listed
 *     post says how many it has.
 *   v1.4.0 — 2026-08-30 — Boards reinstated as Core (RFC §27). A post flags have hidden is left out
 *     of the listing and refused on its own URL to everyone but its author and the board's owner
 *     (services/board-moderation.ts; the threshold was computed twice and enforced nowhere); the
 *     page cursor is the last post of the page as fetched, not as filtered; the anonymous-mode
 *     shared identity is not a principal on the post reads, as it already was not on GET /v1/boards.
 *   v1.3.0 — 2026-08-11 — GET /v1/boards/:boardId/posts/new?otk= is gone. RFC v4.0 deprecates
 *     one-time keys, and this door was a second implementation of posting that called
 *     storage.createPost directly: no board access check, so an OTK holder could post to a board
 *     they may not write to, no public-board price, no pre_board_post hook, no provenance stamp, no
 *     change event and no subscriber fan-out. It also ran outside the keyedBrowseEnabled flag the
 *     deprecation put the feature behind. POST /v1/boards/:boardId/posts is the remaining door.
 *   v1.2.0 — 2026-08-11 — August 2026 audit step 8. Create, subscribe, react, member roster and
 *     delete go through services/board-write.ts, which the MCP tools now call as well. Each of the
 *     five was written out here and again in src/mcp/boards.ts, and the copies had drifted: the
 *     tool's operator rule named public boards but not system ones, nothing bounded a board name or
 *     a reaction over MCP, federate was never set there, and a roster call carrying neither add nor
 *     remove reported success while changing nothing.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 9 step 0. The REST post/reply writes are stamped, the same
 *     act the MCP tools have been stamping since Phase 4. Leaving one door stamped and the other not
 *     would mean a post's label depended on which client wrote it, which is the sort of split a
 *     reader can neither see nor account for. These routes take no declaration — an agent that wants
 *     to state how content was made uses the MCP tool's `ai_provenance`, which is scope-gated — so
 *     what lands here is the node's own observation, with everything it did not witness `unstated`.
 *   Post body limit 500 → 200 000 — 2026-07-30 — 500 characters is a sentence, not a post.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { checkConsentForRead, auditDataAccess } from '../services/consent.js';
import { BoardCreateSchema, BoardPostSchema, BoardPostUpdateSchema, BoardReactionSchema, BoardReplySchema, validateBody } from '../models/schemas.js';
import { emitChange } from '../services/event-bus.js';
import { createBoardPost, createBoardReply, updateBoardPost } from '../services/board-post.js';
import { boardReadRefusal } from '../services/board-read-access.js';
import { hiddenBoardPostIds, maySeeHiddenPost, withoutHiddenPosts } from '../services/board-moderation.js';
import {
  createBoard, subscribeToBoard, reactToBoardPost, setBoardMembers, setBoardRules, deleteBoardById, boardRulesBlock,
} from '../services/board-write.js';
import { resolveIdentity, isSameOwner, parseGaiiLoose } from '../utils/gaii.js';
import {
  loadServedProvenance, loadServedProvenanceMany, provenanceItemBlock, setProvenanceHeaders,
} from '../services/ai-provenance-marks.js';

export function boardsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /** Notify board subscribers of a new post (fire-and-forget). */

  // POST /v1/boards — create a board (agent auth; system boards require operator)
  router.post('/v1/boards', requireAuth(), requireRole('agent'), requireScope('social:write'), validateBody(BoardCreateSchema, config.nodeId), async (req, res) => {
    // services/board-write.ts — the same create aimeat_board_create makes. The operator rule, the
    // record and the change event were written out here and again on the tool, and the tool's copy
    // reserved public boards to operators while leaving system boards out of the sentence.
    const { name, visibility, allowed_gaiis, description, federate, rules } = req.body ?? {};
    const out = await createBoard({ storage, config }, {
      gaii: resolve(req),
      roles: req.auth!.roles ?? [],
    }, { name, visibility, description, allowedGaiis: allowed_gaiis, federate, rules });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    const board = out.board;

    res.status(201).json(success(config.nodeId, {
      id: board.id,
      name: board.name,
      visibility: board.visibility,
      federate: board.federate ?? false,
      rules: boardRulesBlock(board),
      created_at: board.createdAt,
    }, [
      { description: 'Post to this board', method: 'POST', url: `/v1/boards/${board.id}/posts` },
      { description: 'View posts', method: 'GET', url: `/v1/boards/${board.id}/posts` },
    ]));
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
        rules: boardRulesBlock(b),
        created_at: b.createdAt,
        ...(gaii ? { owner_gaii: b.ownerGaii, allowed_gaiis: b.allowedGaiis } : {}),
      })),
      total: visible.length,
    }));
  });

  // PATCH /v1/boards/:boardId/rules — the board's own rules (keeper only)
  router.patch('/v1/boards/:boardId/rules', requireAuth(), requireRole('agent'), requireScope('social:write'), async (req, res) => {
    const boardId = req.params.boardId as string;
    const gaii = resolve(req);
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }
    if (board.ownerGaii !== gaii && !(req.auth!.roles ?? []).includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the keeper of this board sets its rules. Ask them, or open a board of your own.'));
      return;
    }
    const out = await setBoardRules({ storage, config }, board, (req.body ?? {}).rules ?? null);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, { id: out.board.id, rules: boardRulesBlock(out.board) }));
  });

  // PATCH /v1/boards/:boardId/posts/:postId — take a notice down as handled, or give it more time
  router.patch('/v1/boards/:boardId/posts/:postId', requireAuth(), requireRole('agent'), requireScope('social:write'), validateBody(BoardPostUpdateSchema, config.nodeId), async (req, res) => {
    const { ttl_hours, resolved } = req.body ?? {};
    const out = await updateBoardPost({ storage, config }, {
      gaii: resolve(req),
      roles: req.auth!.roles ?? [],
    }, { boardId: req.params.boardId as string, postId: req.params.postId as string, ttlHours: ttl_hours, resolved });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    if (out.resolved) {
      res.json(success(config.nodeId, { resolved: true, post_id: out.postId }));
      return;
    }
    res.json(success(config.nodeId, { id: out.post.id, board_id: out.post.boardId, ttl_expires_at: out.post.ttlExpiresAt }));
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

    // The roster arithmetic, the write and the change event are services/board-write.ts, which
    // aimeat_board_members also calls. The authorization above stays here because the two doors
    // answer it differently on purpose: this one demands an owner session, the tool accepts an agent
    // of the same owner holding `social:members`.
    const { add, remove } = req.body ?? {};
    const out = await setBoardMembers({ storage, config }, board, { add, remove });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }

    res.json(success(config.nodeId, {
      board_id: out.board.id,
      allowed_gaiis: out.board.allowedGaiis,
    }));
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
    // The whole post — access, the extension hook, the public-board price, the provenance stamp, the
    // record, the SSE event and the subscriber fan-out — is services/board-post.ts, which
    // aimeat_board_post also calls. It used to be written out here, and the tool surface then had a
    // thinner copy of it: no board load at all, so no access check, no price and no hook. The event
    // and the subscriber notification were the last two pieces still living only on this door.
    const { title, body, category, tags, ttl_hours } = req.body ?? {};
    const out = await createBoardPost({ storage, config }, {
      gaii: resolve(req),
      roles: req.auth!.roles ?? [],
    }, {
      boardId: req.params.boardId as string,
      title, body, category, tags, ttlHours: ttl_hours,
      pipeline: 'rest.board_post',
    });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    const post = out.post;
    res.status(201).json(success(config.nodeId, {
      id: post.id,
      board_id: post.boardId,
      title: post.title,
      category: post.category,
      ttl_expires_at: post.ttlExpiresAt,
      created_at: post.createdAt,
    }, [
      { description: 'View this post', method: 'GET', url: `/v1/boards/${post.boardId}/posts` },
    ]));
  });
  router.get('/v1/boards/:boardId/posts', async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      // Board doesn't exist yet — return empty posts, not 404
      res.json(success(config.nodeId, { posts: [], total: 0 }));
      return;
    }

    // Who may read this board is services/board-read-access.ts, the same rule aimeat_board_read
    // answers to. It used to live only here, and that tool listed the posts without ever loading the
    // board — so a private board was readable over MCP and there was no denial row to show it.
    // The anonymous-mode shared identity is not a principal here, the same rule GET /v1/boards
    // applies: with it, a private board answered 403 instead of 401 and consent was consulted on
    // behalf of a pseudo-identity.
    const gaii = (req.auth && !req.auth.anonymous) ? resolveIdentity(req.auth, config.nodeId) : undefined;
    const readRefusal = await boardReadRefusal({ storage, config }, gaii, board);
    if (readRefusal) {
      res.status(readRefusal.status).json(error(config.nodeId, readRefusal.code, readRefusal.message));
      return;
    }

    const category = req.query.category as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);

    // A page is `limit` live posts; the cursor for the next page is the last of them. A post flags
    // have hidden is dropped AFTER the page is cut, so the cursor still walks the whole board.
    const page = await storage.listPosts(boardId, { category, cursor, limit });
    const posts = await withoutHiddenPosts({ storage, config }, board, gaii, page);
    // Who the posters are, for the reader deciding whom to trust: notices published, thanks received,
    // since when. One grouped query for the page's distinct authors.
    const authors = await storage.boardAuthorStanding([...new Set(posts.map(p => p.authorGaii))]);
    const replyCounts = await storage.replyCounts(boardId, posts.map(p => p.id));

    // TARGET-058: how each post was made, in ONE query for the page. The caller has already passed
    // the board read gate above, which is the authorization argument — provenance travels with the
    // content it describes. A page of human-written posts costs an empty map.
    const provById = await loadServedProvenanceMany(storage, config, posts.map(p => p.aiProvenanceId));

    res.json(success(config.nodeId, {
      posts: posts.map(p => ({
        id: p.id,
        author_gaii: p.authorGaii,
        title: p.title,
        body: p.body,
        category: p.category,
        tags: p.tags,
        reactions: p.reactions,
        replies: replyCounts[p.id] ?? 0,
        semantic: p.semantic,
        ttl_expires_at: p.ttlExpiresAt,
        created_at: p.createdAt,
        ...provenanceItemBlock(p.aiProvenanceId ? provById.get(p.aiProvenanceId) : undefined),
      })),
      total: posts.length,
      cursor: page.length === limit ? page[page.length - 1]?.id : undefined,
      authors,
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

    const gaii = (req.auth && !req.auth.anonymous) ? resolveIdentity(req.auth, config.nodeId) : undefined;
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

    // A post flags have hidden is refused to everyone but its author and the board's owner, who
    // are the two who can appeal or remove it.
    if (!maySeeHiddenPost(post, board, gaii) && (await hiddenBoardPostIds({ storage, config }, [post.id])).has(post.id)) {
      res.status(403).json(error(config.nodeId, 'HIDDEN', 'Readers reported this post, so it is hidden until its author or the board owner reviews it. You can still read the other posts on this board.'));
      return;
    }

    // TARGET-058: this response IS one piece of content, so the record also rides the envelope
    // carrier and the HTTP headers — the same three planes every other single-item read serves.
    const prov = await loadServedProvenance(storage, config, post.aiProvenanceId);
    setProvenanceHeaders(res, prov);
    const standing = await storage.boardAuthorStanding([post.authorGaii]);
    res.json(success(config.nodeId, {
      id: post.id,
      board_id: post.boardId,
      author_gaii: post.authorGaii,
      author: standing[post.authorGaii],
      title: post.title,
      body: post.body,
      category: post.category,
      tags: post.tags,
      reactions: post.reactions,
      reply_to: post.replyTo,
      semantic: post.semantic,
      ttl_expires_at: post.ttlExpiresAt,
      created_at: post.createdAt,
      ...provenanceItemBlock(prov),
    }, [
      { description: 'React to this post', method: 'POST', url: `/v1/boards/${boardId}/posts/${postId}/react` },
      { description: 'Reply to this post', method: 'POST', url: `/v1/boards/${boardId}/posts/${postId}/replies` },
    ]));
  });

  // GET /v1/boards/:boardId/posts/:postId/replies — the replies under one notice, oldest first
  router.get('/v1/boards/:boardId/posts/:postId/replies', async (req, res) => {
    const boardId = req.params.boardId as string;
    const postId = req.params.postId as string;
    const board = await storage.getBoard(boardId);
    if (!board) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Board not found: ${boardId}`));
      return;
    }
    const gaii = (req.auth && !req.auth.anonymous) ? resolveIdentity(req.auth, config.nodeId) : undefined;
    const readRefusal = await boardReadRefusal({ storage, config }, gaii, board);
    if (readRefusal) {
      res.status(readRefusal.status).json(error(config.nodeId, readRefusal.code, readRefusal.message));
      return;
    }
    const parent = await storage.getPost(boardId, postId);
    if (!parent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Post not found: ${postId}`));
      return;
    }
    const replies = await withoutHiddenPosts({ storage, config }, board, gaii, await storage.listReplies(boardId, postId));
    const provById = await loadServedProvenanceMany(storage, config, replies.map(p => p.aiProvenanceId));
    const authors = await storage.boardAuthorStanding([...new Set(replies.map(p => p.authorGaii))]);
    res.json(success(config.nodeId, {
      post_id: postId,
      replies: replies.map(p => ({
        id: p.id,
        author_gaii: p.authorGaii,
        body: p.body,
        reactions: p.reactions,
        ttl_expires_at: p.ttlExpiresAt,
        created_at: p.createdAt,
        ...provenanceItemBlock(p.aiProvenanceId ? provById.get(p.aiProvenanceId) : undefined),
      })),
      total: replies.length,
      authors,
    }));
  });

  // DELETE /v1/boards/:boardId — delete own board
  router.delete('/v1/boards/:boardId', requireAuth(), requireRole('agent'), requireScope('social:write'), async (req, res) => {
    // services/board-write.ts — the same delete aimeat_board_delete performs, owner-or-operator rule
    // and change event included.
    const boardId = req.params.boardId as string;
    const out = await deleteBoardById({ storage, config }, {
      gaii: resolve(req),
      roles: req.auth!.roles ?? [],
    }, boardId);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }

    res.json(success(config.nodeId, { deleted: true, board_id: boardId }));
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
    // services/board-write.ts — the same reaction aimeat_board_react writes. The bound on the
    // reaction lived in BoardReactionSchema on this door alone.
    const { reaction } = req.body ?? {};
    const out = await reactToBoardPost({ storage, config }, {
      gaii: resolve(req),
      roles: req.auth!.roles ?? [],
    }, {
      boardId: req.params.boardId as string,
      postId: req.params.postId as string,
      reaction,
    });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }

    res.json(success(config.nodeId, { reacted: true, reaction }));
  });

  // POST /v1/boards/:boardId/posts/:postId/replies — reply to a post
  router.post('/v1/boards/:boardId/posts/:postId/replies', requireAuth(), requireRole('agent'), requireScope('social:write'), validateBody(BoardReplySchema, config.nodeId), async (req, res) => {
    // services/board-post.ts — the same reply aimeat_board_reply makes. It carries the board's
    // ACCESS rule, which this handler did not apply to a reply: it checked only that the parent post
    // existed, so a reply could land on a board the replier may not post to.
    const out = await createBoardReply({ storage, config }, {
      gaii: resolve(req),
      roles: req.auth!.roles ?? [],
    }, {
      boardId: req.params.boardId as string,
      postId: req.params.postId as string,
      body: (req.body ?? {}).body,
      pipeline: 'rest.board_reply',
    });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    const reply = out.reply;
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
  router.post('/v1/boards/:boardId/subscribe', requireAuth(), requireRole('agent'), requireScope('social:read'), async (req, res) => {
    // services/board-write.ts — the same subscription aimeat_board_subscribe writes, with the
    // visibility rule, the duplicate refusal and the change event in one place.
    const boardId = req.params.boardId as string;
    const { callback_url, filters } = req.body ?? {};
    const out = await subscribeToBoard({ storage, config }, {
      gaii: resolve(req),
      roles: req.auth!.roles ?? [],
    }, { boardId, callbackUrl: callback_url, filters });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    const sub = out.subscription;

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
