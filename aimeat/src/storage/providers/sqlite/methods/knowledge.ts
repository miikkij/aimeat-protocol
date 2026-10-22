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
 *   v1.1.0 — 2026-10-22 — A link row carries `ownerGaii`, the namespace that holds its source
 *     manifest, and is keyed on (ownerGaii, source, target). createLink, deleteLink and the outgoing
 *     rows of listLinks act on one namespace's rows only: a manifest key is unique within one
 *     namespace, and another account that wrote a record at packages/<id>/manifest read, replaced and
 *     deleted the owner's links (secaudit 2026-10, v78). findBrokenLinks reads one namespace; the
 *     unplaced-row methods serve services/knowledge-link-owner-keep.ts. A read names its columns, so
 *     the owner column never reaches a caller.
 *   v1.0.0 — 2026-10-05 — createLink, listLinks, deleteLink, findBrokenLinks, deleteLinksByContributor moved
 *     here from knowledge-links.ts; createReview, listReviews, deleteReviewsByOperator moved here from
 *     federation-oauth.ts so the file mirrors postgres-kysely/methods/knowledge.ts (secaudit 2026-10, M8).
 */
import type { MemoryLinkRecord, OperatorReviewRecord } from '../../../interface.js';
import { UNPLACED_LINK_OWNER } from '../../../repositories/knowledge.repository.js';
import type { SqliteStorage } from '../index.js';

/** The columns a link read returns: the record's own fields, never the owner column. */
const LINK_COLUMNS = 'source, target, relation, description, linked_at, linked_by';

export const knowledgeMethods = {

  async createLink(this: SqliteStorage, record: MemoryLinkRecord, sourceOwner: string): Promise<MemoryLinkRecord> {
    this.db.prepare(`
      INSERT INTO knowledge_links (ownerGaii, source, target, relation, description, linked_at, linked_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ownerGaii, source, target) DO UPDATE SET
        relation = excluded.relation, description = excluded.description,
        linked_at = excluded.linked_at, linked_by = excluded.linked_by
    `).run(sourceOwner, record.source, record.target, record.relation, record.description, record.linked_at, record.linked_by);
    return record;
  },

  async listLinks(this: SqliteStorage, key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string; sourceOwner?: string }): Promise<MemoryLinkRecord[]> {
    const dir = opts?.direction ?? 'both';
    // Outgoing rows are one namespace's: without an owner there are none (fail closed).
    const owner = opts?.sourceOwner;
    const outgoing = owner !== undefined && owner !== UNPLACED_LINK_OWNER;
    let where: string;
    const params: string[] = [];

    if (dir === 'outgoing') {
      if (!outgoing) return [];
      where = '(source = ? AND ownerGaii = ?)';
      params.push(key, owner);
    } else if (dir === 'incoming') {
      where = 'target = ?';
      params.push(key);
    } else if (outgoing) {
      where = '((source = ? AND ownerGaii = ?) OR target = ?)';
      params.push(key, owner, key);
    } else {
      where = 'target = ?';
      params.push(key);
    }

    if (opts?.relation) {
      where += ' AND relation = ?';
      params.push(opts.relation);
    }

    return this.db.prepare(`SELECT ${LINK_COLUMNS} FROM knowledge_links WHERE ${where}`).all(...params) as MemoryLinkRecord[];
  },

  async deleteLink(this: SqliteStorage, source: string, target: string, sourceOwner: string): Promise<boolean> {
    if (sourceOwner === UNPLACED_LINK_OWNER) return false;
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE ownerGaii = ? AND source = ? AND target = ?').run(sourceOwner, source, target);
    return result.changes > 0;
  },

  async findBrokenLinks(this: SqliteStorage, sourceOwner: string, source?: string): Promise<MemoryLinkRecord[]> {
    if (sourceOwner === UNPLACED_LINK_OWNER) return [];
    const links = (source === undefined
      ? this.db.prepare(`SELECT ${LINK_COLUMNS} FROM knowledge_links WHERE ownerGaii = ?`).all(sourceOwner)
      : this.db.prepare(`SELECT ${LINK_COLUMNS} FROM knowledge_links WHERE ownerGaii = ? AND source = ?`).all(sourceOwner, source)) as MemoryLinkRecord[];
    const broken: MemoryLinkRecord[] = [];
    for (const link of links) {
      const sourceExists = await this.getMemory(sourceOwner, link.source);
      const targetExists = await this.getMemory(sourceOwner, link.target);
      if (!sourceExists || !targetExists) broken.push(link);
    }
    return broken;
  },

  async deleteLinksByContributor(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE linked_by = ?').run(gaii);
    return result.changes;
  },

  async listUnplacedLinks(this: SqliteStorage): Promise<MemoryLinkRecord[]> {
    return this.db.prepare(`SELECT ${LINK_COLUMNS} FROM knowledge_links WHERE ownerGaii = ?`).all(UNPLACED_LINK_OWNER) as MemoryLinkRecord[];
  },

  async updateUnplacedLink(this: SqliteStorage, source: string, target: string, change: { sourceOwner?: string; linkedBy?: string }): Promise<boolean> {
    const row = this.db.prepare('SELECT linked_by FROM knowledge_links WHERE ownerGaii = ? AND source = ? AND target = ?')
      .get(UNPLACED_LINK_OWNER, source, target) as { linked_by: string } | undefined;
    if (!row) return false;
    const result = this.db.prepare('UPDATE knowledge_links SET ownerGaii = ?, linked_by = ? WHERE ownerGaii = ? AND source = ? AND target = ?')
      .run(change.sourceOwner ?? UNPLACED_LINK_OWNER, change.linkedBy ?? row.linked_by, UNPLACED_LINK_OWNER, source, target);
    return result.changes > 0;
  },

  async deleteUnplacedLink(this: SqliteStorage, source: string, target: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE ownerGaii = ? AND source = ? AND target = ?').run(UNPLACED_LINK_OWNER, source, target);
    return result.changes > 0;
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
