/**
 * @file src/storage/providers/postgres-kysely/methods/knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Knowledge domain for the Postgres+Kysely backend: memory links (KnowledgeLink) + operator
 *   package reviews (KnowledgeReview). Translated 1:1 from the Prisma implementation. findBrokenLinks
 *   walks one namespace's links and checks both endpoints via getMemory.
 * @version-history
 *   2026-10-22 — A link row carries "ownerGaii", the namespace that holds its source manifest, unique
 *     on (ownerGaii, source, target) (migration 0114). createLink upserts on that key as SQLite does:
 *     it was a plain insert, so a second account's row for the same source and target made the
 *     owner's own POST answer 500. deleteLink and the outgoing rows of listLinks act on one
 *     namespace's rows only (secaudit 2026-10, v78). findBrokenLinks reads one namespace; the
 *     unplaced-row methods serve services/knowledge-link-owner-keep.ts.
 *   2026-10-16 — listReviews in timestamp order, as on SQLite; a caller takes the last one as the latest (QA audit D4-04).
 *   v1.1.0 — 2026-09-09 — getLink and listAllReviews deleted: no caller.
 *   v1.0.0 — 2026-07-15 — Phase 5: knowledge on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { MemoryLinkRecord, OperatorReviewRecord } from '../../../interface.js';
import { UNPLACED_LINK_OWNER } from '../../../repositories/knowledge.repository.js';
import type { KnowledgeLink, KnowledgeReview } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toLink(r: Selectable<KnowledgeLink>): MemoryLinkRecord {
  return { source: r.source, target: r.target, relation: r.relation as MemoryLinkRecord['relation'], description: r.description, linked_at: iso(r.linkedAt), linked_by: r.linkedBy };
}
function toReview(r: Selectable<KnowledgeReview>): OperatorReviewRecord {
  return { id: r.id, packageId: r.packageId, operatorGaii: r.operatorGaii, reason: r.reason as OperatorReviewRecord['reason'], customText: r.customText ?? undefined, action: r.action as OperatorReviewRecord['action'], timestamp: iso(r.timestamp) };
}

export const knowledgeMethods = {
  async createLink(this: PostgresKyselyStorage, r: MemoryLinkRecord, sourceOwner: string): Promise<MemoryLinkRecord> {
    await this.db.insertInto('KnowledgeLink')
      .values({ ownerGaii: sourceOwner, source: r.source, target: r.target, relation: r.relation, description: r.description, linkedAt: new Date(r.linked_at), linkedBy: r.linked_by })
      .onConflict(oc => oc.columns(['ownerGaii', 'source', 'target']).doUpdateSet({
        relation: r.relation, description: r.description, linkedAt: new Date(r.linked_at), linkedBy: r.linked_by,
      }))
      .execute();
    return r;
  },
  async listLinks(this: PostgresKyselyStorage, key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string; sourceOwner?: string }): Promise<MemoryLinkRecord[]> {
    const dir = opts?.direction ?? 'both';
    // Outgoing rows are one namespace's: without an owner there are none (fail closed).
    const owner = opts?.sourceOwner;
    const outgoing = owner !== undefined && owner !== UNPLACED_LINK_OWNER;
    if (dir === 'outgoing' && !outgoing) return [];
    let q = this.db.selectFrom('KnowledgeLink').selectAll();
    if (dir === 'outgoing') q = q.where('source', '=', key).where('ownerGaii', '=', owner!);
    else if (dir === 'incoming' || !outgoing) q = q.where('target', '=', key);
    else q = q.where(eb => eb.or([eb.and([eb('source', '=', key), eb('ownerGaii', '=', owner!)]), eb('target', '=', key)]));
    if (opts?.relation) q = q.where('relation', '=', opts.relation);
    return (await q.execute()).map(toLink);
  },
  async deleteLink(this: PostgresKyselyStorage, source: string, target: string, sourceOwner: string): Promise<boolean> {
    if (sourceOwner === UNPLACED_LINK_OWNER) return false;
    const r = await this.db.deleteFrom('KnowledgeLink').where('ownerGaii', '=', sourceOwner).where('source', '=', source).where('target', '=', target).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async findBrokenLinks(this: PostgresKyselyStorage, sourceOwner: string, source?: string): Promise<MemoryLinkRecord[]> {
    if (sourceOwner === UNPLACED_LINK_OWNER) return [];
    let q = this.db.selectFrom('KnowledgeLink').selectAll().where('ownerGaii', '=', sourceOwner);
    if (source !== undefined) q = q.where('source', '=', source);
    const links = await q.execute();
    const broken: MemoryLinkRecord[] = [];
    for (const link of links) {
      const sourceExists = await this.getMemory(sourceOwner, link.source);
      const targetExists = await this.getMemory(sourceOwner, link.target);
      if (!sourceExists || !targetExists) broken.push(toLink(link));
    }
    return broken;
  },
  async deleteLinksByContributor(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('KnowledgeLink').where('linkedBy', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async listUnplacedLinks(this: PostgresKyselyStorage): Promise<MemoryLinkRecord[]> {
    return (await this.db.selectFrom('KnowledgeLink').selectAll().where('ownerGaii', '=', UNPLACED_LINK_OWNER).execute()).map(toLink);
  },
  async updateUnplacedLink(this: PostgresKyselyStorage, source: string, target: string, change: { sourceOwner?: string; linkedBy?: string }): Promise<boolean> {
    const set: { ownerGaii?: string; linkedBy?: string } = {};
    if (change.sourceOwner !== undefined) set.ownerGaii = change.sourceOwner;
    if (change.linkedBy !== undefined) set.linkedBy = change.linkedBy;
    if (!Object.keys(set).length) return false;
    const r = await this.db.updateTable('KnowledgeLink').set(set)
      .where('ownerGaii', '=', UNPLACED_LINK_OWNER).where('source', '=', source).where('target', '=', target).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },
  async deleteUnplacedLink(this: PostgresKyselyStorage, source: string, target: string): Promise<boolean> {
    const r = await this.db.deleteFrom('KnowledgeLink').where('ownerGaii', '=', UNPLACED_LINK_OWNER).where('source', '=', source).where('target', '=', target).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async createReview(this: PostgresKyselyStorage, r: OperatorReviewRecord): Promise<OperatorReviewRecord> {
    await this.db.insertInto('KnowledgeReview').values({ id: r.id, packageId: r.packageId, operatorGaii: r.operatorGaii, reason: r.reason, customText: r.customText ?? null, action: r.action, timestamp: new Date(r.timestamp) }).execute();
    return r;
  },
  async listReviews(this: PostgresKyselyStorage, packageId: string): Promise<OperatorReviewRecord[]> {
    return (await this.db.selectFrom('KnowledgeReview').selectAll().where('packageId', '=', packageId).orderBy('timestamp', 'asc').orderBy('id', 'asc').execute()).map(toReview);
  },
  async deleteReviewsByOperator(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('KnowledgeReview').where('operatorGaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
