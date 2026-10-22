/**
 * @file src/storage/providers/sqlite/schema-knowledge-links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Re-key an older knowledge_links table on (ownerGaii, source, target). Mirrors Postgres
 *   migration 0114_knowledge_link_owner.sql.
 *
 *   WHY. A link row named its source by the manifest key alone and was keyed on (source, target). A
 *   key is unique within one namespace only, so another account that wrote a record of its own at
 *   packages/<id>/manifest read, replaced and deleted the package owner's link rows through it
 *   (secaudit 2026-10, v78). SQLite cannot change a primary key with ALTER, so this is the standard
 *   rebuild, gated on PRAGMA table_info: a fresh database, which schema-tables-2.ts creates with the
 *   column, pays nothing. Every existing row is carried over with ownerGaii '' (not yet placed); the
 *   once-only start step services/knowledge-link-owner-keep.ts places it. The old key was unique on
 *   (source, target), so no two carried rows can meet on the new key.
 * @structure keyKnowledgeLinksByOwner(db)
 * @usage keyKnowledgeLinksByOwner(db);   // schema-tables-2.ts, after the CREATE TABLE block
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v78).
 */
import type Database from 'better-sqlite3';

/** Rebuild knowledge_links with ownerGaii in its key when the table has no such column. */
export function keyKnowledgeLinksByOwner(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info('knowledge_links')").all() as Array<{ name: string }>;
  if (!cols.length) return;                                   // table not created yet
  if (cols.some(c => c.name === 'ownerGaii')) return;         // already keyed by owner

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE knowledge_links_new (
        ownerGaii   TEXT NOT NULL DEFAULT '',
        source      TEXT NOT NULL,
        target      TEXT NOT NULL,
        relation    TEXT NOT NULL,
        description TEXT NOT NULL,
        linked_at   TEXT NOT NULL,
        linked_by   TEXT NOT NULL,
        PRIMARY KEY (ownerGaii, source, target)
      );
      INSERT INTO knowledge_links_new (ownerGaii, source, target, relation, description, linked_at, linked_by)
        SELECT '', source, target, relation, description, linked_at, linked_by FROM knowledge_links;
      DROP TABLE knowledge_links;
      ALTER TABLE knowledge_links_new RENAME TO knowledge_links;
      CREATE INDEX IF NOT EXISTS idx_klinks_source ON knowledge_links(source);
      CREATE INDEX IF NOT EXISTS idx_klinks_target ON knowledge_links(target);
      CREATE INDEX IF NOT EXISTS idx_klinks_linked_by ON knowledge_links(linked_by);
    `);
  });
  tx();
}
