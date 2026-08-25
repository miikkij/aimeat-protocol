/**
 * @file src/storage/providers/sqlite/methods/knowledge-links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Knowledge memory-link methods for the SQLite provider: the rows that say a memory
 *   record was contributed to a knowledge base, and who contributed it.
 *
 *   Extracted from methods/apps.ts unchanged when that file passed the 800-line ceiling. A pure
 *   move: same bodies, same comments, same behaviour, merged onto SqliteStorage by the same
 *   prototype merge. Knowledge links were never an app-catalog concern; they lived there because
 *   the original extraction from index.ts cut by file size rather than by subject.
 * @structure knowledgeLinkMethods — createLink, getLink, listLinks, deleteLink, and the
 *   contributor sweep the erasure path uses.
 * @usage merged into SqliteStorage alongside appsMethods (providers/sqlite/index.ts)
 * @version-history
 *   v1.0.0 — 2026-08-25 — Extracted from methods/apps.ts (max-file-lines)
 */
import type { MemoryLinkRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const knowledgeLinkMethods = {

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

  async getLink(this: SqliteStorage, source: string, target: string): Promise<MemoryLinkRecord | null> {
    const row = this.db.prepare('SELECT * FROM knowledge_links WHERE source = ? AND target = ?').get(source, target) as MemoryLinkRecord | undefined;
    return row ?? null;
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

};
