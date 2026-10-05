/**
 * @file src/storage/providers/sqlite/methods/knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/knowledge.ts (knowledgeMethods), so a
 *   fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure knowledgeMethods
 * @usage Object.assign(SqliteStorage.prototype, knowledgeMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — createLink, listLinks, deleteLink, findBrokenLinks, deleteLinksByContributor moved
 *     here from knowledge-links.ts; createReview, listReviews, deleteReviewsByOperator moved here from
 *     federation-oauth.ts so the file mirrors postgres-kysely/methods/knowledge.ts (secaudit 2026-10, M8).
 */
import type { MemoryLinkRecord, OperatorReviewRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const knowledgeMethods = {

  async createLink(this: SqliteStorage, record: MemoryLinkRecord): Promise<MemoryLinkRecord> {
    this.db.prepare(`
      INSERT INTO knowledge_links (source, target, relation, description, linked_at, linked_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, target) DO UPDATE SET
        relation = excluded.relation, description = excluded.description,
        linked_at = excluded.linked_at, linked_by = excluded.linked_by
    `).run(record.source, record.target, record.relation, record.description, record.linked_at, record.linked_by);
    return record;
  },

  async listLinks(this: SqliteStorage, key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string }): Promise<MemoryLinkRecord[]> {
    const dir = opts?.direction ?? 'both';
    let sql: string;
    const params: string[] = [];

    if (dir === 'outgoing') {
      sql = 'SELECT * FROM knowledge_links WHERE source = ?';
      params.push(key);
    } else if (dir === 'incoming') {
      sql = 'SELECT * FROM knowledge_links WHERE target = ?';
      params.push(key);
    } else {
      sql = 'SELECT * FROM knowledge_links WHERE source = ? OR target = ?';
      params.push(key, key);
    }

    if (opts?.relation) {
      sql += ' AND relation = ?';
      params.push(opts.relation);
    }

    return this.db.prepare(sql).all(...params) as MemoryLinkRecord[];
  },

  async deleteLink(this: SqliteStorage, source: string, target: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE source = ? AND target = ?').run(source, target);
    return result.changes > 0;
  },

  async findBrokenLinks(this: SqliteStorage, ownerGaii: string): Promise<MemoryLinkRecord[]> {
    const links = this.db.prepare('SELECT * FROM knowledge_links WHERE linked_by = ?').all(ownerGaii) as MemoryLinkRecord[];
    const broken: MemoryLinkRecord[] = [];
    for (const link of links) {
      const sourceExists = await this.getMemory(ownerGaii, link.source);
      const targetExists = await this.getMemory(ownerGaii, link.target);
      if (!sourceExists || !targetExists) broken.push(link);
    }
    return broken;
  },

  async deleteLinksByContributor(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE linked_by = ?').run(gaii);
    return result.changes;
  },
  // ── Knowledge: Operator Reviews ──
  // ══════════════════════════════════════════════════════════

  async createReview(this: SqliteStorage, record: OperatorReviewRecord): Promise<OperatorReviewRecord> {
    this.db.prepare(`
      INSERT INTO knowledge_reviews (id, packageId, operatorGaii, reason, customText, action, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.packageId, record.operatorGaii, record.reason, record.customText ?? null, record.action, record.timestamp);
    return record;
  },

  async listReviews(this: SqliteStorage, packageId: string): Promise<OperatorReviewRecord[]> {
    return this.db.prepare('SELECT * FROM knowledge_reviews WHERE packageId = ? ORDER BY timestamp ASC').all(packageId) as OperatorReviewRecord[];
  },

  async deleteReviewsByOperator(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM knowledge_reviews WHERE operatorGaii = ?').run(gaii);
    return result.changes;
  },
};
