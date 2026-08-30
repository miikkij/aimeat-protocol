/**
 * @file src/storage/providers/postgres-kysely/methods/boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Boards domain for the Postgres+Kysely backend (Board / BoardPost / BoardSubscription).
 *   Each organism owns a board (organism creation calls createBoard), so this unblocks POST /v1/organisms
 *   and the boards API. Translated 1:1 from the Prisma implementation. The business key is `boardId`
 *   (record.id), `postId` for posts.
 * @version-history
 *   v1.4.0 — 2026-08-30 — Board.rules round-trips (migration 0057); updateBoardRules, updatePostExpiry
 *     and boardAuthorStanding (posts, thanks, first post per author in one grouped query);
 *     listReplies and replyCounts, since listPosts leaves replies out and nothing listed them.
 *   v1.3.0 — 2026-08-30 — listPosts honours the cursor (it was accepted and ignored, so page two was
 *     page one) and filters expiry in SQL rather than after LIMIT; deleteBoard removes the board's
 *     subscriptions with its posts.
 *   v1.2.0 — 2026-08-17 — pruneExpiredBoardPosts: this backend gains its first real TTL delete
 *     (listPosts only filtered, so expired posts accumulated forever).
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 9 step 0: `BoardPost.aiProvenanceId` round-trips
 *     (migration 0020). A post on a public board also satisfies the derived-visibility predicate in
 *     ./ai-provenance.ts, so an anonymous reader of that board can resolve the record behind it.
 *   v1.0.0 — 2026-07-15 — Phase 5: boards on Postgres+Kysely.
 */
import { sql, type Selectable } from 'kysely';
import type { BoardPostRecord, BoardRecord, BoardSubscriptionRecord, BoardRules, BoardAuthorStanding } from '../../../interface.js';
import type { Board, BoardPost, BoardSubscription } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toBoard(r: Selectable<Board>): BoardRecord {
  return {
    id: r.boardId, name: r.name, description: r.description ?? undefined, visibility: r.visibility as BoardRecord['visibility'], ownerGaii: r.ownerGaii,
    allowedGaiis: r.allowedGaiis ?? [], federate: r.federate ?? false, createdAt: iso(r.createdAt),
    ...(r.rules ? { rules: r.rules as BoardRules } : {}),
  };
}
function toPost(r: Selectable<BoardPost>): BoardPostRecord {
  return { id: r.postId, boardId: r.boardId, authorGaii: r.authorGaii, title: r.title, body: r.body, category: r.category ?? undefined, tags: r.tags ?? [], ttlExpiresAt: r.ttlExpiresAt ? iso(r.ttlExpiresAt) : undefined, reactions: (r.reactions ?? {}) as BoardPostRecord['reactions'], replyTo: r.replyTo ?? undefined, createdAt: iso(r.createdAt), aiProvenanceId: r.aiProvenanceId ?? undefined };
}
function toSub(r: Selectable<BoardSubscription>): BoardSubscriptionRecord {
  return { id: r.id, boardId: r.boardId, gaii: r.gaii, callbackUrl: r.callbackUrl ?? undefined, filters: (r.filters ?? undefined) as BoardSubscriptionRecord['filters'], createdAt: iso(r.createdAt) };
}

export const boardMethods = {
  async createBoard(this: PostgresKyselyStorage, b: BoardRecord): Promise<BoardRecord> {
    const [row] = await this.db.insertInto('Board').values({
      boardId: b.id, name: b.name, description: b.description ?? null, visibility: b.visibility, ownerGaii: b.ownerGaii, allowedGaiis: b.allowedGaiis ?? null,
      federate: b.federate ?? false, createdAt: new Date(b.createdAt), rules: b.rules ? jsonb(b.rules) : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toBoard(row);
  },
  async updateBoardRules(this: PostgresKyselyStorage, id: string, rules: BoardRules | null): Promise<BoardRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await this.db.updateTable('Board').set({ rules: rules ? jsonb(rules) : null } as any).where('boardId', '=', id).returningAll().execute();
    return rows[0] ? toBoard(rows[0]) : null;
  },
  async getBoard(this: PostgresKyselyStorage, id: string): Promise<BoardRecord | null> {
    const r = await this.db.selectFrom('Board').selectAll().where('boardId', '=', id).executeTakeFirst();
    return r ? toBoard(r) : null;
  },
  async listBoards(this: PostgresKyselyStorage, opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]> {
    let q = this.db.selectFrom('Board').selectAll();
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    if (opts?.ownerGaii) q = q.where('ownerGaii', '=', opts.ownerGaii);
    return (await q.execute()).map(toBoard);
  },
  async updateBoardVisibility(this: PostgresKyselyStorage, id: string, visibility: string, federate?: boolean): Promise<BoardRecord | null> {
    const data: Record<string, unknown> = { visibility };
    if (federate !== undefined) data.federate = federate;
    const rows = await this.db.updateTable('Board').set(data as never).where('boardId', '=', id).returningAll().execute();
    return rows[0] ? toBoard(rows[0]) : null;
  },
  async updateBoardMembers(this: PostgresKyselyStorage, id: string, allowedGaiis: string[]): Promise<BoardRecord | null> {
    const rows = await this.db.updateTable('Board').set({ allowedGaiis }).where('boardId', '=', id).returningAll().execute();
    return rows[0] ? toBoard(rows[0]) : null;
  },
  async deleteBoard(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Board').where('boardId', '=', id).executeTakeFirst();
    await this.db.deleteFrom('BoardPost').where('boardId', '=', id).execute();
    // A subscription to a board that no longer exists is a phantom row on the subscriber's list,
    // and until 2026-08-30 every deleted board left one behind per follower.
    await this.db.deleteFrom('BoardSubscription').where('boardId', '=', id).execute();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async createPost(this: PostgresKyselyStorage, p: BoardPostRecord): Promise<BoardPostRecord> {
    const [row] = await this.db.insertInto('BoardPost').values({
      postId: p.id, boardId: p.boardId, authorGaii: p.authorGaii, title: p.title, body: p.body, category: p.category ?? null,
      tags: p.tags ?? null, ttlExpiresAt: p.ttlExpiresAt ? new Date(p.ttlExpiresAt) : null, reactions: jsonb(p.reactions ?? {}),
      replyTo: p.replyTo ?? null, createdAt: new Date(p.createdAt), aiProvenanceId: p.aiProvenanceId ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toPost(row);
  },
  async getPost(this: PostgresKyselyStorage, boardId: string, postId: string): Promise<BoardPostRecord | null> {
    const r = await this.db.selectFrom('BoardPost').selectAll().where('boardId', '=', boardId).where('postId', '=', postId).executeTakeFirst();
    return r ? toPost(r) : null;
  },
  async listPosts(this: PostgresKyselyStorage, boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]> {
    // Expiry is a WHERE clause, so a page of N is N live posts: filtering after LIMIT returned short
    // pages a caller could not tell from the end of the board. The cursor is the last post of the
    // previous page, and the next page is everything older than it (ties broken on postId, so two
    // posts created in the same millisecond cannot be skipped). Until 2026-08-30 the cursor was
    // accepted and never read, so page two was always page one.
    const now = new Date();
    let q = this.db.selectFrom('BoardPost').selectAll().where('boardId', '=', boardId).where('replyTo', 'is', null)
      .where(eb => eb.or([eb('ttlExpiresAt', 'is', null), eb('ttlExpiresAt', '>', now)]));
    if (opts?.category) q = q.where('category', '=', opts.category);
    if (opts?.cursor) {
      const at = await this.db.selectFrom('BoardPost').select('createdAt').where('boardId', '=', boardId).where('postId', '=', opts.cursor).executeTakeFirst();
      if (at) {
        const cursorAt = at.createdAt instanceof Date ? at.createdAt : new Date(at.createdAt);
        const cursorId = opts.cursor;
        q = q.where(eb => eb.or([eb('createdAt', '<', cursorAt), eb.and([eb('createdAt', '=', cursorAt), eb('postId', '<', cursorId)])]));
      }
    }
    const rows = await q.orderBy('createdAt', 'desc').orderBy('postId', 'desc').limit(opts?.limit ?? 20).execute();
    return rows.map(toPost);
  },
  async deletePost(this: PostgresKyselyStorage, boardId: string, postId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('BoardPost').where('boardId', '=', boardId).where('postId', '=', postId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async listReplies(this: PostgresKyselyStorage, boardId: string, postId: string): Promise<BoardPostRecord[]> {
    const rows = await this.db.selectFrom('BoardPost').selectAll().where('boardId', '=', boardId).where('replyTo', '=', postId).orderBy('createdAt', 'asc').orderBy('postId', 'asc').execute();
    return rows.map(toPost);
  },
  async replyCounts(this: PostgresKyselyStorage, boardId: string, postIds: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (postIds.length === 0) return out;
    const rows = await this.db.selectFrom('BoardPost').select(['replyTo']).select(sql<number>`count(*)`.as('n'))
      .where('boardId', '=', boardId).where('replyTo', 'in', postIds).groupBy('replyTo').execute();
    for (const r of rows) if (r.replyTo) out[r.replyTo] = Number(r.n);
    return out;
  },
  async updatePostExpiry(this: PostgresKyselyStorage, boardId: string, postId: string, ttlExpiresAt: string): Promise<boolean> {
    const r = await this.db.updateTable('BoardPost').set({ ttlExpiresAt: new Date(ttlExpiresAt) }).where('boardId', '=', boardId).where('postId', '=', postId).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },
  async boardAuthorStanding(this: PostgresKyselyStorage, gaiis: string[]): Promise<Record<string, BoardAuthorStanding>> {
    // One grouped query for the page's authors; 'thanks' is the reaction the standing counts.
    const out: Record<string, BoardAuthorStanding> = {};
    if (gaiis.length === 0) return out;
    const res = await sql<{ authorGaii: string; posts: string | number; thanks: string | number; since: Date | string | null }>`
      SELECT "authorGaii",
             COUNT(*) FILTER (WHERE "replyTo" IS NULL) AS posts,
             COALESCE(SUM(jsonb_array_length(COALESCE("reactions"->'thanks', '[]'::jsonb))), 0) AS thanks,
             MIN("createdAt") AS since
      FROM "BoardPost"
      WHERE "authorGaii" = ANY(${gaiis})
      GROUP BY "authorGaii"`.execute(this.db);
    for (const r of res.rows) {
      out[r.authorGaii] = { gaii: r.authorGaii, posts: Number(r.posts), thanks: Number(r.thanks), ...(r.since ? { since: iso(r.since) } : {}) };
    }
    return out;
  },
  async pruneExpiredBoardPosts(this: PostgresKyselyStorage, nowIso: string): Promise<number> {
    // One cross-board DELETE. Until 2026-08-17 this backend never removed expired posts at all:
    // listPosts only filtered them out, so the rows accumulated forever on production.
    const r = await this.db.deleteFrom('BoardPost').where('ttlExpiresAt', 'is not', null).where('ttlExpiresAt', '<', new Date(nowIso)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async addReaction(this: PostgresKyselyStorage, boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean> {
    const post = await this.db.selectFrom('BoardPost').select('reactions').where('boardId', '=', boardId).where('postId', '=', postId).executeTakeFirst();
    if (!post) return false;
    const reactions = (post.reactions ?? {}) as Record<string, string[]>;
    if (!reactions[emoji]) reactions[emoji] = [];
    if (!reactions[emoji].includes(gaii)) reactions[emoji].push(gaii);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('BoardPost').set({ reactions: jsonb(reactions) } as any).where('boardId', '=', boardId).where('postId', '=', postId).execute();
    return true;
  },

  async createBoardSubscription(this: PostgresKyselyStorage, sub: BoardSubscriptionRecord): Promise<BoardSubscriptionRecord> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insertInto('BoardSubscription').values({ id: sub.id, boardId: sub.boardId, gaii: sub.gaii, callbackUrl: sub.callbackUrl ?? null, filters: jsonb(sub.filters ?? null), createdAt: new Date(sub.createdAt) } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.columns(['boardId', 'gaii']).doUpdateSet({ callbackUrl: sub.callbackUrl ?? null, filters: jsonb(sub.filters ?? null) } as any)).execute();
    return sub;
  },
  async getBoardSubscription(this: PostgresKyselyStorage, boardId: string, gaii: string): Promise<BoardSubscriptionRecord | null> {
    const r = await this.db.selectFrom('BoardSubscription').selectAll().where('boardId', '=', boardId).where('gaii', '=', gaii).executeTakeFirst();
    return r ? toSub(r) : null;
  },
  async listBoardSubscriptions(this: PostgresKyselyStorage, boardId: string): Promise<BoardSubscriptionRecord[]> {
    return (await this.db.selectFrom('BoardSubscription').selectAll().where('boardId', '=', boardId).execute()).map(toSub);
  },
  async listSubscriptionsByAgent(this: PostgresKyselyStorage, gaii: string): Promise<BoardSubscriptionRecord[]> {
    return (await this.db.selectFrom('BoardSubscription').selectAll().where('gaii', '=', gaii).execute()).map(toSub);
  },
  async deleteBoardSubscription(this: PostgresKyselyStorage, boardId: string, gaii: string): Promise<boolean> {
    const r = await this.db.deleteFrom('BoardSubscription').where('boardId', '=', boardId).where('gaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
