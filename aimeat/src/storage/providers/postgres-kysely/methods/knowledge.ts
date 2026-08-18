/**
 * @file src/storage/providers/postgres-kysely/methods/knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Knowledge domain for the Postgres+Kysely backend: memory links (KnowledgeLink) + operator
 *   package reviews (KnowledgeReview). Translated 1:1 from the Prisma implementation. findBrokenLinks
 *   walks the contributor's links and checks both endpoints via getMemory.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: knowledge on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { MemoryLinkRecord, OperatorReviewRecord } from '../../../interface.js';
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
  async createLink(this: PostgresKyselyStorage, r: MemoryLinkRecord): Promise<MemoryLinkRecord> {
    await this.db.insertInto('KnowledgeLink').values({ source: r.source, target: r.target, relation: r.relation, description: r.description, linkedAt: new Date(r.linked_at), linkedBy: r.linked_by }).execute();
    return r;
  },
  async getLink(this: PostgresKyselyStorage, source: string, target: string): Promise<MemoryLinkRecord | null> {
    const r = await this.db.selectFrom('KnowledgeLink').selectAll().where('source', '=', source).where('target', '=', target).executeTakeFirst();
    return r ? toLink(r) : null;
  },
  async listLinks(this: PostgresKyselyStorage, key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string }): Promise<MemoryLinkRecord[]> {
    const dir = opts?.direction ?? 'both';
    let q = this.db.selectFrom('KnowledgeLink').selectAll();
    if (dir === 'outgoing') q = q.where('source', '=', key);
    else if (dir === 'incoming') q = q.where('target', '=', key);
    else q = q.where(eb => eb.or([eb('source', '=', key), eb('target', '=', key)]));
    if (opts?.relation) q = q.where('relation', '=', opts.relation);
    return (await q.execute()).map(toLink);
  },
  async deleteLink(this: PostgresKyselyStorage, source: string, target: string): Promise<boolean> {
    const r = await this.db.deleteFrom('KnowledgeLink').where('source', '=', source).where('target', '=', target).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async findBrokenLinks(this: PostgresKyselyStorage, ownerGaii: string): Promise<MemoryLinkRecord[]> {
    const links = await this.db.selectFrom('KnowledgeLink').selectAll().where('linkedBy', '=', ownerGaii).execute();
    const broken: MemoryLinkRecord[] = [];
    for (const link of links) {
      const sourceExists = await this.getMemory(ownerGaii, link.source);
      const targetExists = await this.getMemory(ownerGaii, link.target);
      if (!sourceExists || !targetExists) broken.push(toLink(link));
    }
    return broken;
  },
  async deleteLinksByContributor(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('KnowledgeLink').where('linkedBy', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async createReview(this: PostgresKyselyStorage, r: OperatorReviewRecord): Promise<OperatorReviewRecord> {
    await this.db.insertInto('KnowledgeReview').values({ id: r.id, packageId: r.packageId, operatorGaii: r.operatorGaii, reason: r.reason, customText: r.customText ?? null, action: r.action, timestamp: new Date(r.timestamp) }).execute();
    return r;
  },
  async listReviews(this: PostgresKyselyStorage, packageId: string): Promise<OperatorReviewRecord[]> {
    return (await this.db.selectFrom('KnowledgeReview').selectAll().where('packageId', '=', packageId).execute()).map(toReview);
  },
  async listAllReviews(this: PostgresKyselyStorage, opts?: { page?: number; perPage?: number }): Promise<OperatorReviewRecord[]> {
    const page = opts?.page ?? 1, perPage = opts?.perPage ?? 20;
    return (await this.db.selectFrom('KnowledgeReview').selectAll().orderBy('timestamp', 'desc').limit(perPage).offset((page - 1) * perPage).execute()).map(toReview);
  },
  async deleteReviewsByOperator(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('KnowledgeReview').where('operatorGaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
